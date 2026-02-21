import { ensureSeedData, requireAuth, requireRole } from "./_lib/auth";
import { ensureCoreTables } from "./_lib/setup";

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  try {
    await ensureSeedData(env.DB);
    await ensureCoreTables(env.DB);
    const auth = await requireAuth(request, env.DB);
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const search = `%${(url.searchParams.get("search") || "").trim().toUpperCase()}%`;
    const activeOnly = url.searchParams.get("active") !== "all";

    const { results } = await env.DB
      .prepare(`
        SELECT id,
          COALESCE(NULLIF(code,''), UPPER(plate)) as code,
          plate,
          COALESCE(NULLIF(model,''), 'Senza modello') as model,
          description,
          ideal_consumption_km_l as idealConsumptionKmL,
          photo_key as photo_key,
          (
            SELECT COUNT(*)
            FROM vehicle_deadlines vd
            WHERE vd.vehicle_id = vehicles.id AND julianday(vd.due_date) >= julianday('now') + 30
          ) as deadlineValid,
          (
            SELECT COUNT(*)
            FROM vehicle_deadlines vd
            WHERE vd.vehicle_id = vehicles.id AND julianday(vd.due_date) >= julianday('now') AND julianday(vd.due_date) < julianday('now') + 30
          ) as deadlineWarning,
          (
            SELECT COUNT(*)
            FROM vehicle_deadlines vd
            WHERE vd.vehicle_id = vehicles.id AND julianday(vd.due_date) < julianday('now')
          ) as deadlineExpired,
          COALESCE(active,1) as active
        FROM vehicles
        WHERE (
          UPPER(COALESCE(code,'')) LIKE ?
          OR UPPER(COALESCE(plate,'')) LIKE ?
          OR UPPER(COALESCE(model,'')) LIKE ?
          OR UPPER(COALESCE(description,'')) LIKE ?
        )
        AND (? = 0 OR COALESCE(active,1) = 1)
        ORDER BY COALESCE(code, plate)
      `)
      .bind(search, search, search, search, activeOnly ? 1 : 0)
      .all();

    return Response.json({ ok: true, data: results });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Errore caricamento mezzi" }, { status: 500 });
  }
};

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  try {
    await ensureSeedData(env.DB);
    await ensureCoreTables(env.DB);
    const auth = await requireAuth(request, env.DB);
    if (auth instanceof Response) return auth;
    const denied = requireRole(auth, ["admin"]);
    if (denied) return denied;

    const body = (await request.json().catch(() => null)) as { code?: string; plate?: string; model?: string; description?: string; idealConsumptionKmL?: number | string | null } | null;
    const code = String(body?.code || "").trim().toUpperCase();
    const plate = String(body?.plate || "").trim().toUpperCase();
    const model = String(body?.model || "").trim();
    const description = String(body?.description || "").trim();
    const idealConsumptionRaw = Number(body?.idealConsumptionKmL);
    const idealConsumptionKmL = Number.isFinite(idealConsumptionRaw) && idealConsumptionRaw > 0 ? idealConsumptionRaw : null;

    if (!code || !plate || !model) {
      return Response.json({ ok: false, error: "Campi obbligatori: code, plate, model" }, { status: 400 });
    }

    await env.DB.prepare("INSERT INTO vehicles(code, plate, model, description, ideal_consumption_km_l, active) VALUES (?, ?, ?, ?, ?, 1)")
      .bind(code, plate, model, description || null, idealConsumptionKmL)
      .run();

    return Response.json({ ok: true });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Errore creazione mezzo" }, { status: 500 });
  }
};
