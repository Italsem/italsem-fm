import { ensureSeedData, requireAuth, requireRole } from "../../_lib/auth";
import { ensureCoreTables } from "../../_lib/setup";

function extFromFilename(name: string) {
  const raw = name.split(".").pop()?.toLowerCase() || "bin";
  return raw.replace(/[^a-z0-9]/g, "") || "bin";
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value
    && typeof value === "object"
    && "size" in value
    && "name" in value
    && "type" in value
    && "arrayBuffer" in value,
  );
}

export const onRequestPost: PagesFunction<{ DB: D1Database; PHOTOS: R2Bucket }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const vehicleId = Number(params.id);
  if (!vehicleId) return Response.json({ ok: false, error: "ID Non Valido" }, { status: 400 });

  const form = await request.formData();
  const file = form.get("file");
  const docType = String(form.get("docType") || "altro").trim().toLowerCase();

  if (!isUploadFile(file) || file.size <= 0) {
    return Response.json({ ok: false, error: "File non valido" }, { status: 400 });
  }

  const allowedTypes = new Set(["libretto", "rca", "revisione", "bollo", "altro"]);
  const normalizedDocType = allowedTypes.has(docType) ? docType : "altro";
  const ext = extFromFilename(file.name || "documento.bin");
  const key = `vehicle-documents/${vehicleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  await env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  await env.DB.prepare(`
    INSERT INTO vehicle_documents(vehicle_id, doc_type, file_name, file_key, mime_type, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(vehicleId, normalizedDocType, file.name || "documento", key, file.type || "application/octet-stream", auth.userId).run();

  return Response.json({ ok: true, key });
};

export const onRequestDelete: PagesFunction<{ DB: D1Database; PHOTOS?: R2Bucket }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const vehicleId = Number(params.id);
  const url = new URL(request.url);
  const docId = Number(url.searchParams.get("docId") || "0");

  if (!vehicleId || !docId) return Response.json({ ok: false, error: "Parametri non validi" }, { status: 400 });

  const doc = await env.DB.prepare("SELECT id, file_key as fileKey FROM vehicle_documents WHERE id = ? AND vehicle_id = ?")
    .bind(docId, vehicleId)
    .first<{ id: number; fileKey: string }>();

  if (!doc) return Response.json({ ok: false, error: "Documento non trovato" }, { status: 404 });

  await env.DB.prepare("DELETE FROM vehicle_documents WHERE id = ? AND vehicle_id = ?").bind(docId, vehicleId).run();
  if (env.PHOTOS) {
    await env.PHOTOS.delete(doc.fileKey).catch(() => undefined);
  }

  return Response.json({ ok: true });
};
