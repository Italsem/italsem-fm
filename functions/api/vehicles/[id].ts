import { ensureSeedData, requireAuth, requireRole } from "../_lib/auth";
import { ensureCoreTables } from "../_lib/setup";

type VehicleRow = {
  id: number;
  code: string;
  plate: string;
  model: string;
  description: string | null;
  active: number;
  photo_key: string | null;
};

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;

  const id = Number(params.id);
  if (!id) return Response.json({ ok: false, error: "ID Non Valido" }, { status: 400 });

  const vehicle = await env.DB
    .prepare("SELECT id, code, plate, model, description, active, photo_key FROM vehicles WHERE id = ?")
    .bind(id)
    .first<VehicleRow>();

  if (!vehicle) return Response.json({ ok: false, error: "Mezzo Non Trovato" }, { status: 404 });

  const deadlines = await env.DB
    .prepare("SELECT deadline_type as deadlineType, due_date as dueDate FROM vehicle_deadlines WHERE vehicle_id = ? ORDER BY deadline_type")
    .bind(id)
    .all<{ deadlineType: "bollo" | "revisione" | "rca" | "tachigrafo" | "periodica_gru" | "strutturale"; dueDate: string }>();

  const history = await env.DB
    .prepare(`
      SELECT id, refuel_at as refuelAt, odometer_km as odometerKm, liters, amount, source_type as sourceType,
        (
          SELECT ((fe.liters * 100.0) / NULLIF((fe.odometer_km - prev.odometer_km), 0))
          FROM fuel_events prev
          WHERE prev.vehicle_id = fe.vehicle_id AND prev.refuel_at < fe.refuel_at
          ORDER BY prev.refuel_at DESC
          LIMIT 1
        ) as consumptionL100km
      FROM fuel_events fe
      WHERE vehicle_id = ?
      ORDER BY refuel_at DESC
    `)
    .bind(id)
    .all();

  return Response.json({ ok: true, data: { vehicle, deadlines: deadlines.results, history: history.results } });
};

export const onRequestPatch: PagesFunction<{ DB: D1Database }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const id = Number(params.id);
  if (!id) return Response.json({ ok: false, error: "ID Non Valido" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { code?: string; plate?: string; model?: string; description?: string } | null;
  const code = String(body?.code || "").trim().toUpperCase();
  const plate = String(body?.plate || "").trim().toUpperCase();
  const model = String(body?.model || "").trim();
  const description = String(body?.description || "").trim();

  if (!code || !plate || !model) {
    return Response.json({ ok: false, error: "Campi obbligatori: Codice, Targa, Modello" }, { status: 400 });
  }

  const existing = await env.DB.prepare("SELECT id FROM vehicles WHERE id = ?").bind(id).first<{ id: number }>();
  if (!existing) {
    return Response.json({ ok: false, error: "Mezzo Non Trovato" }, { status: 404 });
  }

  await env.DB.prepare("UPDATE vehicles SET code = ?, plate = ?, model = ?, description = ? WHERE id = ?")
    .bind(code, plate, model, description || null, id)
    .run();
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
  if (!id) return Response.json({ ok: false, error: "ID Non Valido" }, { status: 400 });

  const vehicle = await env.DB.prepare("SELECT id, photo_key as photoKey FROM vehicles WHERE id = ?").bind(id).first<{ id: number; photoKey: string | null }>();
  if (!vehicle) {
    return Response.json({ ok: false, error: "Mezzo Non Trovato" }, { status: 404 });
  }

  await env.DB.prepare("DELETE FROM vehicle_deadlines WHERE vehicle_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM fuel_events WHERE vehicle_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM vehicles WHERE id = ?").bind(id).run();

  if (vehicle.photoKey && env.PHOTOS) {
    await env.PHOTOS.delete(vehicle.photoKey).catch(() => undefined);
  }

  return Response.json({ ok: true });
};
