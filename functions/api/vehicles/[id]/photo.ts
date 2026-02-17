import { ensureSeedData, requireAuth, requireRole } from "../../_lib/auth";
import { ensureCoreTables } from "../../_lib/setup";

export const onRequestPost: PagesFunction<{ DB: D1Database; PHOTOS: R2Bucket }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const vehicleId = Number(params.id);
  const form = await request.formData();
  const file = form.get("photo");

  if (!vehicleId || !(file instanceof File)) {
    return Response.json({ ok: false, error: "Dati Non Validi" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return Response.json({ ok: false, error: "Solo Immagini" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const key = `vehicles/${vehicleId}/${Date.now()}.${ext}`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await env.DB.prepare("UPDATE vehicles SET photo_key = ? WHERE id = ?").bind(key, vehicleId).run();

  return Response.json({ ok: true, key });
};
