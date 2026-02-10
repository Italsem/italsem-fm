export const onRequest: PagesFunction<{ DB: D1Database; PHOTOS: R2Bucket }> = async ({
  request,
  env,
}) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const form = await request.formData();
  const vehicleId = Number(form.get("vehicleId"));
  const file = form.get("photo");

  if (!Number.isFinite(vehicleId)) {
    return Response.json({ ok: false, error: "vehicleId required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "photo required" }, { status: 400 });
  }

  // Piccolo controllo: accettiamo solo immagini
  if (!file.type.startsWith("image/")) {
    return Response.json({ ok: false, error: "Only image files allowed" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const key = `vehicles/${vehicleId}/${Date.now()}.${ext}`;

  await env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  // Salviamo la key sul veicolo
  await env.DB.prepare(
    "UPDATE vehicles SET photo_key=?, updated_at=datetime('now') WHERE id=?"
  )
    .bind(key, vehicleId)
    .run();

  return Response.json({ ok: true, key });
};
