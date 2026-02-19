import { ensureSeedData, requireAuth, requireRole } from "./_lib/auth";
import { ensureCoreTables } from "./_lib/setup";

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare("SELECT id, source_type as sourceType, identifier, assigned_to as assignedTo, active FROM fuel_sources ORDER BY identifier").all();
  return Response.json({ ok: true, data: results });
};

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const body = await request.json().catch(() => null) as { sourceType?: string; identifier?: string; assignedTo?: string } | null;
  const sourceType = body?.sourceType === "tank" ? "tank" : "card";
  const identifier = String(body?.identifier || "").trim().toUpperCase();
  const assignedTo = String(body?.assignedTo || "").trim();
  if (!identifier) {
    return Response.json({ ok: false, error: "Identificativo obbligatorio" }, { status: 400 });
  }

  await env.DB.prepare("INSERT INTO fuel_sources(source_type, identifier, assigned_to, active) VALUES (?, ?, ?, 1)").bind(sourceType, identifier, assignedTo || null).run();
  return Response.json({ ok: true });
};
