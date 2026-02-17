export const onRequestPost: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }
  return Response.json({ ok: true });
};
