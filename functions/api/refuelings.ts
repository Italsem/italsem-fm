import { ensureSeedData, requireAuth, requireRole } from "./_lib/auth";
import { ensureCoreTables } from "./_lib/setup";

function extFromFilename(name: string) {
  const raw = name.split(".").pop()?.toLowerCase() || "bin";
  return raw.replace(/[^a-z0-9]/g, "") || "bin";
}

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

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value
    && typeof value === "object"
    && "size" in value
    && "name" in value
    && "type" in value
    && "arrayBuffer" in value,
  );
}

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  try {
    await ensureSeedData(env.DB);
    await ensureCoreTables(env.DB);
    const auth = await requireAuth(request, env.DB);
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const vehicleId = Number(url.searchParams.get("vehicleId") || "0");
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const sourceIdentifier = String(url.searchParams.get("sourceIdentifier") || "").trim().toUpperCase();

    const { results } = await env.DB.prepare(`
    SELECT fe.id, fe.vehicle_id as vehicleId, v.code as vehicleCode, v.plate, v.model,
      fe.refuel_at as refuelAt, fe.odometer_km as odometerKm, fe.liters, fe.amount,
      fe.source_type as sourceType, fe.source_identifier as sourceIdentifier, fs.assigned_to as sourceAssignedTo, fe.receipt_key as receiptKey,
      CASE WHEN (fe.odometer_km - prev.odometer_km) > 0 AND fe.liters > 0 THEN (fe.odometer_km - prev.odometer_km) / fe.liters ELSE NULL END as consumptionKmL,
      CASE WHEN (fe.odometer_km - prev.odometer_km) > 0 AND fe.liters > 0 THEN (fe.liters * 100.0) / (fe.odometer_km - prev.odometer_km) ELSE NULL END as consumptionL100km
    FROM fuel_events fe
    JOIN vehicles v ON v.id = fe.vehicle_id
    LEFT JOIN fuel_sources fs ON fs.identifier = fe.source_identifier
    LEFT JOIN fuel_events prev ON prev.id = (
      SELECT p.id FROM fuel_events p
      WHERE p.vehicle_id = fe.vehicle_id AND p.refuel_at < fe.refuel_at
      ORDER BY p.refuel_at DESC
      LIMIT 1
    )
    WHERE (? = 0 OR fe.vehicle_id = ?)
      AND (? = '' OR fe.refuel_at >= ?)
      AND (? = '' OR fe.refuel_at <= ?)
      AND (? = '' OR UPPER(COALESCE(fe.source_identifier,'')) = ?)
    ORDER BY fe.refuel_at DESC
  `).bind(vehicleId, vehicleId, from, from, to, to, sourceIdentifier, sourceIdentifier).all();

    return Response.json({ ok: true, data: results });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Errore caricamento rifornimenti" }, { status: 500 });
  }
};

export const onRequestPost: PagesFunction<{ DB: D1Database; PHOTOS: R2Bucket }> = async ({ request, env }) => {
  try {
    await ensureSeedData(env.DB);
    await ensureCoreTables(env.DB);
    const auth = await requireAuth(request, env.DB);
    if (auth instanceof Response) return auth;
    const denied = requireRole(auth, ["admin"]);
    if (denied) return denied;

    const form = await request.formData();
  const vehicleId = Number(form.get("vehicleId") || 0);
  const refuelAt = normalizeRefuelDate(String(form.get("refuelAt") || ""));
  const odometerKm = Number(form.get("odometerKm") || 0);
  const liters = Number(form.get("liters") || 0);
  const amount = Number(form.get("amount") || 0);
  const sourceType = form.get("sourceType") === "tank" ? "tank" : "card";
  const sourceIdentifier = String(form.get("sourceIdentifier") || "").trim().toUpperCase() || "N/D";
  const receipt = form.get("receipt");

  if (!vehicleId || !refuelAt || !sourceIdentifier || liters <= 0 || amount < 0) {
    return Response.json({ ok: false, error: "Dati rifornimento non validi" }, { status: 400 });
  }

  const prev = await env.DB.prepare(`
    SELECT odometer_km as km
    FROM fuel_events
    WHERE vehicle_id = ? AND refuel_at < ?
    ORDER BY refuel_at DESC
    LIMIT 1
  `).bind(vehicleId, refuelAt).first<{ km: number }>();
  if (prev && odometerKm < prev.km) {
    return Response.json({ ok: false, error: "Il chilometraggio non può essere inferiore al rifornimento precedente" }, { status: 400 });
  }

  const next = await env.DB.prepare(`
    SELECT odometer_km as km
    FROM fuel_events
    WHERE vehicle_id = ? AND refuel_at > ?
    ORDER BY refuel_at ASC
    LIMIT 1
  `).bind(vehicleId, refuelAt).first<{ km: number }>();
  if (next && odometerKm > next.km) {
    return Response.json({ ok: false, error: "Il chilometraggio non può superare il rifornimento successivo" }, { status: 400 });
  }

  let receiptKey: string | null = null;
  if (isUploadFile(receipt) && receipt.size > 0 && env.PHOTOS) {
    const ext = extFromFilename(receipt.name || "receipt.bin");
    receiptKey = `receipts/${vehicleId}/${Date.now()}.${ext}`;
    await env.PHOTOS.put(receiptKey, await receipt.arrayBuffer(), {
      httpMetadata: { contentType: receipt.type || "application/octet-stream" },
    });
  }

  const cols = await fuelEventsColumns(env.DB);
  const insertCols = [
    "vehicle_id",
    "refuel_at",
    ...(cols.has("date") ? ["date"] : []),
    "odometer_km",
    "liters",
    "amount",
    ...(cols.has("source") ? ["source"] : []),
    ...(cols.has("station") ? ["station"] : []),
    ...(cols.has("site") ? ["site"] : []),
    "source_type",
    "source_identifier",
    "receipt_key",
    "created_by",
  ];

  const values = [
    vehicleId,
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
    receiptKey,
    auth.userId,
  ];

  const placeholders = insertCols.map(() => "?").join(", ");
  await env.DB.prepare(`INSERT INTO fuel_events(${insertCols.join(", ")}) VALUES (${placeholders})`).bind(...values).run();

    return Response.json({ ok: true });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Errore salvataggio rifornimento" }, { status: 500 });
  }
};
