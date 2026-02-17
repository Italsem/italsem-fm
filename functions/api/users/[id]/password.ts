import { ensureSeedData, requireAuth, requireRole, sha256Hex } from "../../_lib/auth";
import { ensureCoreTables } from "../../_lib/setup";

export const onRequestPatch: PagesFunction<{ DB: D1Database }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const userId = Number(params.id);
  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  const password = String(body?.password || "").trim();

  if (!userId || password.length < 6) {
    return Response.json({ ok: false, error: "Password minima 6 caratteri" }, { status: 400 });
  }

  const hash = await sha256Hex(password);
  await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(hash, userId).run();
  return Response.json({ ok: true });
};
