import { ensureSeedData, requireAuth, requireRole } from "./_lib/auth";
import { ensureCoreTables } from "./_lib/setup";

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const search = `%${(url.searchParams.get("search") || "").trim().toUpperCase()}%`;
  const activeOnly = url.searchParams.get("active") !== "all";

  const { results } = await env.DB
    .prepare(`
      SELECT id, code, plate, model, description, active
      FROM vehicles
      WHERE (UPPER(code) LIKE ? OR UPPER(plate) LIKE ? OR UPPER(model) LIKE ?)
      AND (? = 0 OR active = 1)
      ORDER BY code
    `)
    .bind(search, search, search, activeOnly ? 1 : 0)
    .all();

  return Response.json({ ok: true, data: results });
};

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const body = await request.json().catch(() => null) as { code?: string; plate?: string; model?: string; description?: string } | null;
  const code = String(body?.code || "").trim().toUpperCase();
  const plate = String(body?.plate || "").trim().toUpperCase();
  const model = String(body?.model || "").trim();
  const description = String(body?.description || "").trim();

  if (!code || !plate || !model) {
    return Response.json({ ok: false, error: "Campi obbligatori: code, plate, model" }, { status: 400 });
  }

  await env.DB.prepare("INSERT INTO vehicles(code, plate, model, description, active) VALUES (?, ?, ?, ?, 1)")
    .bind(code, plate, model, description || null)
    .run();

  return Response.json({ ok: true });
};
