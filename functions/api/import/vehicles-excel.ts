import * as XLSX from "xlsx";

type D1RunResult = { changes?: number };

function isLikelyPlate(sheetName: string) {
  const s = sheetName.trim().toUpperCase();

  const blacklist = ["SCHEDA", "TEMPLATE", "FOGLIO", "NOTE", "RIEPILOGO"];
  if (blacklist.some((b) => s.includes(b))) return false;

  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(s)) return true;

  if (/^[A-Z0-9]{6,8}$/.test(s)) return true;

  return false;
}

export const onRequest: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "file is required (multipart/form-data)" }, { status: 400 });
  }

  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array" });

  const allSheets = workbook.SheetNames.map((n) => n.trim().toUpperCase());
  const plates = allSheets.filter(isLikelyPlate);

  let inserted = 0;
  let skipped = 0;

  for (const plate of plates) {
    const res = (await env.DB.prepare(
      "INSERT OR IGNORE INTO vehicles (code, plate, model, description, active) VALUES (?, ?, 'Senza modello', NULL, 1)"
    )
      .bind(plate, plate)
      .run()) as D1RunResult;

    if (res.changes === 1) inserted++;
    else skipped++;
  }

  return Response.json({
    ok: true,
    totalSheets: workbook.SheetNames.length,
    detectedPlates: plates.length,
    inserted,
    skipped,
    plates,
  });
};
