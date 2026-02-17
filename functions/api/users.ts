import { ensureSeedData, requireAuth, requireRole } from "./_lib/auth";
import { ensureCoreTables } from "./_lib/setup";

type UserRow = {
  id: number;
  username: string;
  role: "admin" | "technician" | "accounting";
  active: number;
  created_at: string;
};

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const users = await env.DB
    .prepare("SELECT id, username, role, active, created_at FROM users ORDER BY username")
    .all<UserRow>();

  return Response.json({ ok: true, data: users.results });
};

export const onRequestPatch: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as
    | { id?: number; role?: "admin" | "technician" | "accounting"; active?: boolean }
    | null;

  const userId = Number(body?.id || 0);
  const role = body?.role;
  if (!userId || !role) {
    return Response.json({ ok: false, error: "id e role obbligatori" }, { status: 400 });
  }

  const active = body?.active === false ? 0 : 1;
  await env.DB.prepare("UPDATE users SET role = ?, active = ? WHERE id = ?").bind(role, active, userId).run();

  return Response.json({ ok: true });
};
