import { ensureSeedData, requireAuth, requireRole } from "../_lib/auth";
import { ensureCoreTables } from "../_lib/setup";

type VehicleDocument = {
  id: number;
  docType: "libretto" | "rca" | "revisione" | "bollo" | "altro";
  fileName: string;
  fileKey: string;
  mimeType: string | null;
  createdAt: string;
};

type VehicleRow = {
  id: number;
  code: string;
  plate: string;
  model: string;
  description: string | null;
  active: number;
  photo_key: string | null;
  idealConsumptionMinKmL: number | null;
  idealConsumptionMaxKmL: number | null;
};

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;

  const id = Number(params.id);
  if (!id) return Response.json({ ok: false, error: "ID Non Valido" }, { status: 400 });

  const vehicle = await env.DB
    .prepare("SELECT id, code, plate, model, description, active, photo_key, ideal_consumption_min_km_l as idealConsumptionMinKmL, ideal_consumption_max_km_l as idealConsumptionMaxKmL FROM vehicles WHERE id = ?")
    .bind(id)
    .first<VehicleRow>();

  if (!vehicle) return Response.json({ ok: false, error: "Mezzo Non Trovato" }, { status: 404 });

  const deadlines = await env.DB
    .prepare("SELECT deadline_type as deadlineType, due_date as dueDate FROM vehicle_deadlines WHERE vehicle_id = ? ORDER BY deadline_type")
    .bind(id)
    .all<{ deadlineType: "bollo" | "revisione" | "rca" | "tachigrafo" | "periodica_gru" | "strutturale"; dueDate: string }>();

  const history = await env.DB
    .prepare(`
      SELECT fe.id, fe.refuel_at as refuelAt, fe.odometer_km as odometerKm, fe.liters, fe.amount,
        fe.source_type as sourceType, fe.source_identifier as sourceIdentifier,
        CASE WHEN (fe.odometer_km - prev.odometer_km) > 0 THEN (fe.odometer_km - prev.odometer_km) ELSE NULL END as distanceKm,
        CASE WHEN (fe.odometer_km - prev.odometer_km) > 0 AND fe.liters > 0 THEN (fe.odometer_km - prev.odometer_km) / fe.liters ELSE NULL END as consumptionKmL,
        CASE WHEN (fe.odometer_km - prev.odometer_km) > 0 AND fe.liters > 0 THEN (fe.liters * 100.0) / (fe.odometer_km - prev.odometer_km) ELSE NULL END as consumptionL100km
      FROM fuel_events fe
      LEFT JOIN fuel_events prev ON prev.id = (
        SELECT p.id FROM fuel_events p
        WHERE p.vehicle_id = fe.vehicle_id
          AND (
            p.refuel_at < fe.refuel_at
            OR (p.refuel_at = fe.refuel_at AND p.odometer_km < fe.odometer_km)
            OR (p.refuel_at = fe.refuel_at AND p.odometer_km = fe.odometer_km AND p.id < fe.id)
          )
        ORDER BY p.refuel_at DESC, p.odometer_km DESC, p.id DESC
        LIMIT 1
      )
      WHERE fe.vehicle_id = ?
      ORDER BY fe.refuel_at DESC, fe.odometer_km DESC, fe.id DESC
    `)
    .bind(id)
    .all();


  const lastRefueling = await env.DB
    .prepare(`
      SELECT odometer_km as lastOdometerKm
      FROM fuel_events
      WHERE vehicle_id = ?
      ORDER BY refuel_at DESC, odometer_km DESC, id DESC
      LIMIT 1
    `)
    .bind(id)
    .first<{ lastOdometerKm: number }>();

  const documents = await env.DB
    .prepare(`
      SELECT id,
        doc_type as docType,
        file_name as fileName,
        file_key as fileKey,
        mime_type as mimeType,
        created_at as createdAt
      FROM vehicle_documents
      WHERE vehicle_id = ?
      ORDER BY created_at DESC
    `)
    .bind(id)
    .all<VehicleDocument>();

  return Response.json({ ok: true, data: { vehicle: { ...vehicle, lastOdometerKm: lastRefueling?.lastOdometerKm ?? null }, deadlines: deadlines.results, history: history.results, documents: documents.results } });
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

  const body = (await request.json().catch(() => null)) as { code?: string; plate?: string; model?: string; description?: string; idealConsumptionMinKmL?: number | string | null; idealConsumptionMaxKmL?: number | string | null } | null;
  const code = String(body?.code || "").trim().toUpperCase();
  const plate = String(body?.plate || "").trim().toUpperCase();
  const model = String(body?.model || "").trim();
  const description = String(body?.description || "").trim();
  const idealConsumptionMinRaw = Number(body?.idealConsumptionMinKmL);
  const idealConsumptionMaxRaw = Number(body?.idealConsumptionMaxKmL);
  const idealConsumptionMinKmL = Number.isFinite(idealConsumptionMinRaw) && idealConsumptionMinRaw > 0 ? idealConsumptionMinRaw : null;
  const idealConsumptionMaxKmL = Number.isFinite(idealConsumptionMaxRaw) && idealConsumptionMaxRaw > 0 ? idealConsumptionMaxRaw : null;

  if ((idealConsumptionMinKmL === null) !== (idealConsumptionMaxKmL === null)) {
    return Response.json({ ok: false, error: "Inserisci sia minimo che massimo del consumo ideale" }, { status: 400 });
  }
  if (idealConsumptionMinKmL !== null && idealConsumptionMaxKmL !== null && idealConsumptionMaxKmL < idealConsumptionMinKmL) {
    return Response.json({ ok: false, error: "Il consumo ideale massimo deve essere maggiore o uguale al minimo" }, { status: 400 });
  }

  if (!code || !plate || !model) {
    return Response.json({ ok: false, error: "Campi obbligatori: Codice, Targa, Modello" }, { status: 400 });
  }

  const existing = await env.DB.prepare("SELECT id FROM vehicles WHERE id = ?").bind(id).first<{ id: number }>();
  if (!existing) {
    return Response.json({ ok: false, error: "Mezzo Non Trovato" }, { status: 404 });
  }

  await env.DB.prepare("UPDATE vehicles SET code = ?, plate = ?, model = ?, description = ?, ideal_consumption_min_km_l = ?, ideal_consumption_max_km_l = ? WHERE id = ?")
    .bind(code, plate, model, description || null, idealConsumptionMinKmL, idealConsumptionMaxKmL, id)
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

  const docs = await env.DB.prepare("SELECT file_key as fileKey FROM vehicle_documents WHERE vehicle_id = ?").bind(id).all<{ fileKey: string }>();

  await env.DB.prepare("DELETE FROM vehicle_deadlines WHERE vehicle_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM fuel_events WHERE vehicle_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM vehicle_documents WHERE vehicle_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM vehicles WHERE id = ?").bind(id).run();

  if (env.PHOTOS) {
    if (vehicle.photoKey) {
      await env.PHOTOS.delete(vehicle.photoKey).catch(() => undefined);
    }
    for (const doc of docs.results || []) {
      await env.PHOTOS.delete(doc.fileKey).catch(() => undefined);
    }
  }

  return Response.json({ ok: true });
};
