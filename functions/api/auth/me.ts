import { ensureSeedData, requireAuth } from "../_lib/auth";
import { ensureCoreTables } from "../_lib/setup";

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  return Response.json({ ok: true, user: auth });
};
