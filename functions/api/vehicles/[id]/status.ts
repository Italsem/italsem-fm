import { ensureSeedData, requireAuth, requireRole } from "../../_lib/auth";
import { ensureCoreTables } from "../../_lib/setup";

export const onRequestPatch: PagesFunction<{ DB: D1Database }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return Response.json({ ok: false, error: "ID non valido" }, { status: 400 });
  }

  const body = await request.json().catch(() => null) as { active?: boolean } | null;
  const active = body?.active ? 1 : 0;
  await env.DB.prepare("UPDATE vehicles SET active = ? WHERE id = ?").bind(active, id).run();
  return Response.json({ ok: true });
};
