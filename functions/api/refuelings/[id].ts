import { ensureSeedData, requireAuth, requireRole } from "../_lib/auth";
import { ensureCoreTables } from "../_lib/setup";

function normalizeRefuelDate(input: string) {
  const raw = input.trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return raw.slice(0, 16);
  return "";
}

async function fuelEventsColumns(db: D1Database) {
  const info = await db.prepare("PRAGMA table_info(fuel_events)").all<{ name: string }>();
  return new Set((info.results || []).map((c) => c.name));
}

export const onRequestPatch: PagesFunction<{ DB: D1Database }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const id = Number(params.id);
  if (!id) return Response.json({ ok: false, error: "ID non valido" }, { status: 400 });

  const body = await request.json().catch(() => null) as {
    refuelAt?: string;
    odometerKm?: number;
    liters?: number;
    amount?: number;
    sourceType?: string;
    sourceIdentifier?: string;
  } | null;

  const refuelAt = normalizeRefuelDate(String(body?.refuelAt || ""));
  const odometerKm = Number(body?.odometerKm || 0);
  const liters = Number(body?.liters || 0);
  const amount = Number(body?.amount || 0);
  const sourceType = body?.sourceType === "tank" ? "tank" : "card";
  const sourceIdentifier = String(body?.sourceIdentifier || "").trim().toUpperCase();

  if (!refuelAt || odometerKm < 0 || liters <= 0 || amount < 0 || !sourceIdentifier) {
    return Response.json({ ok: false, error: "Dati non validi" }, { status: 400 });
  }

  const current = await env.DB.prepare("SELECT id, vehicle_id as vehicleId FROM fuel_events WHERE id = ?").bind(id).first<{ id: number; vehicleId: number }>();
  if (!current) return Response.json({ ok: false, error: "Rifornimento non trovato" }, { status: 404 });

  const prev = await env.DB.prepare(`
    SELECT odometer_km as km
    FROM fuel_events
    WHERE vehicle_id = ? AND id <> ? AND refuel_at < ?
    ORDER BY refuel_at DESC
    LIMIT 1
  `).bind(current.vehicleId, id, refuelAt).first<{ km: number }>();

  if (prev && odometerKm < prev.km) {
    return Response.json({ ok: false, error: "Il chilometraggio non può essere inferiore al precedente" }, { status: 400 });
  }

  const next = await env.DB.prepare(`
    SELECT odometer_km as km
    FROM fuel_events
    WHERE vehicle_id = ? AND id <> ? AND refuel_at > ?
    ORDER BY refuel_at ASC
    LIMIT 1
  `).bind(current.vehicleId, id, refuelAt).first<{ km: number }>();

  if (next && odometerKm > next.km) {
    return Response.json({ ok: false, error: "Il chilometraggio non può superare il successivo" }, { status: 400 });
  }

  const cols = await fuelEventsColumns(env.DB);
  const updates: string[] = [
    "refuel_at = ?",
    ...(cols.has("date") ? ["date = ?"] : []),
    "odometer_km = ?",
    "liters = ?",
    "amount = ?",
    ...(cols.has("source") ? ["source = ?"] : []),
    ...(cols.has("station") ? ["station = ?"] : []),
    ...(cols.has("site") ? ["site = ?"] : []),
    "source_type = ?",
    "source_identifier = ?",
  ];

  const values: unknown[] = [
    refuelAt,
    ...(cols.has("date") ? [refuelAt.slice(0, 10)] : []),
    odometerKm,
    liters,
    amount,
    ...(cols.has("source") ? [sourceType] : []),
    ...(cols.has("station") ? [sourceIdentifier] : []),
    ...(cols.has("site") ? [sourceIdentifier] : []),
    sourceType,
    sourceIdentifier,
    id,
  ];

  await env.DB.prepare(`UPDATE fuel_events SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  return Response.json({ ok: true });
};

export const onRequestDelete: PagesFunction<{ DB: D1Database; PHOTOS?: R2Bucket }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const id = Number(params.id);
  if (!id) return Response.json({ ok: false, error: "ID non valido" }, { status: 400 });

  const row = await env.DB.prepare("SELECT receipt_key as receiptKey FROM fuel_events WHERE id = ?").bind(id).first<{ receiptKey: string | null }>();
  if (!row) return Response.json({ ok: false, error: "Rifornimento non trovato" }, { status: 404 });

  await env.DB.prepare("DELETE FROM fuel_events WHERE id = ?").bind(id).run();
  if (row.receiptKey && env.PHOTOS) await env.PHOTOS.delete(row.receiptKey).catch(() => undefined);

  return Response.json({ ok: true });
};
