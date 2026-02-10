import * as XLSX from "xlsx";

function isLikelyPlate(sheetName: string) {
  const s = sheetName.trim().toUpperCase();

  // Ignora fogli “template” o non targhe (aggiungi qui se ne hai altri)
  const blacklist = ["SCHEDA", "TEMPLATE", "FOGLIO", "NOTE", "RIEPILOGO"];
  if (blacklist.some((b) => s.includes(b))) return false;

  // Targhe IT moderne: AA123BB (7 char alfanumerici)
  // Nel tuo file vedo proprio questo formato (es. GV677AG).
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(s)) return true;

  // Fallback: se un domani hai targhe “strane”, accetta 6-8 alfanumerici
  // (volendo lo togliamo se vuoi rigidità totale)
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

  // Inserimento “idempotente”: se già esiste, salta
  // D1 (SQLite) supporta INSERT OR IGNORE
  for (const plate of plates) {
    const res = await env.DB.prepare(
      "INSERT OR IGNORE INTO vehicles (plate, name, type, notes) VALUES (?, NULL, NULL, NULL)"
    )
      .bind(plate)
      .run();

    // res.changes = 1 se ha inserito, 0 se già esisteva
    if ((res as any).changes === 1) inserted++;
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
