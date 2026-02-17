import { ensureSeedData, requireAuth, requireRole } from "./_lib/auth";
import { ensureCoreTables } from "./_lib/setup";

function extFromFilename(name: string) {
  const raw = name.split(".").pop()?.toLowerCase() || "bin";
  return raw.replace(/[^a-z0-9]/g, "") || "bin";
}

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const vehicleId = Number(url.searchParams.get("vehicleId") || "0");
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";

  const { results } = await env.DB.prepare(`
    SELECT fe.id, fe.vehicle_id as vehicleId, v.code as vehicleCode, v.plate, v.model,
      fe.refuel_at as refuelAt, fe.odometer_km as odometerKm, fe.liters, fe.amount,
      fe.source_type as sourceType, fe.source_identifier as sourceIdentifier, fe.receipt_key as receiptKey,
      (
        SELECT ((fe.liters * 100.0) / NULLIF((fe.odometer_km - prev.odometer_km), 0))
        FROM fuel_events prev
        WHERE prev.vehicle_id = fe.vehicle_id AND prev.refuel_at < fe.refuel_at
        ORDER BY prev.refuel_at DESC
        LIMIT 1
      ) as consumptionL100km
    FROM fuel_events fe
    JOIN vehicles v ON v.id = fe.vehicle_id
    WHERE (? = 0 OR fe.vehicle_id = ?)
      AND (? = '' OR fe.refuel_at >= ?)
      AND (? = '' OR fe.refuel_at <= ?)
    ORDER BY fe.refuel_at DESC
  `).bind(vehicleId, vehicleId, from, from, to, to).all();

  return Response.json({ ok: true, data: results });
};

export const onRequestPost: PagesFunction<{ DB: D1Database; PHOTOS: R2Bucket }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin", "technician"]);
  if (denied) return denied;

  const form = await request.formData();
  const vehicleId = Number(form.get("vehicleId") || 0);
  const refuelAt = String(form.get("refuelAt") || "");
  const odometerKm = Number(form.get("odometerKm") || 0);
  const liters = Number(form.get("liters") || 0);
  const amount = Number(form.get("amount") || 0);
  const sourceType = form.get("sourceType") === "tank" ? "tank" : "card";
  const sourceIdentifier = String(form.get("sourceIdentifier") || "").trim().toUpperCase();
  const receipt = form.get("receipt");

  if (!vehicleId || !refuelAt || !sourceIdentifier || liters <= 0 || amount < 0) {
    return Response.json({ ok: false, error: "Dati rifornimento non validi" }, { status: 400 });
  }

  const prev = await env.DB.prepare("SELECT odometer_km as km FROM fuel_events WHERE vehicle_id = ? ORDER BY refuel_at DESC LIMIT 1").bind(vehicleId).first<{ km: number }>();
  if (prev && odometerKm < prev.km) {
    return Response.json({ ok: false, error: "Il chilometraggio non può essere decrescente" }, { status: 400 });
  }

  let receiptKey: string | null = null;
  if (receipt instanceof File && receipt.size > 0 && env.PHOTOS) {
    const ext = extFromFilename(receipt.name || "receipt.bin");
    receiptKey = `receipts/${vehicleId}/${Date.now()}.${ext}`;
    await env.PHOTOS.put(receiptKey, await receipt.arrayBuffer(), {
      httpMetadata: { contentType: receipt.type || "application/octet-stream" },
    });
  }

  await env.DB.prepare(`
    INSERT INTO fuel_events(vehicle_id, refuel_at, odometer_km, liters, amount, source_type, source_identifier, receipt_key, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(vehicleId, refuelAt, odometerKm, liters, amount, sourceType, sourceIdentifier, receiptKey, auth.userId).run();

  return Response.json({ ok: true });
};
