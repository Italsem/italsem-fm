import { ensureSeedData, requireAuth } from "./_lib/auth";

export const onRequestGet: PagesFunction<{ DB: D1Database; PHOTOS: R2Bucket }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!key) return Response.json({ ok: false, error: "key mancante" }, { status: 400 });

  const obj = await env.PHOTOS.get(key);
  if (!obj) return Response.json({ ok: false, error: "File non trovato" }, { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
};
