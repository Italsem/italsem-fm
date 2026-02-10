export const onRequest: PagesFunction<{ PHOTOS: R2Bucket }> = async ({ request, env }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) return new Response("Missing key", { status: 400 });

  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=86400"); // 1 giorno cache

  return new Response(obj.body, { headers });
};
