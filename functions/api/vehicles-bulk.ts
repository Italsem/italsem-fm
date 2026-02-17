type BulkBody = { plates?: unknown[] };

type D1RunResult = { changes?: number };

function parseBody(raw: string): BulkBody | null {
  try {
    return JSON.parse(raw) as BulkBody;
  } catch {
    return null;
  }
}

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  try {
    if (!env.DB) {
      return Response.json(
        { ok: false, error: "DB binding not found (controlla Pages → Settings → Bindings: DB)" },
        { status: 500 }
      );
    }

    const body = parseBody(await request.text());

    const plates = (body?.plates || [])
      .map((plate) => String(plate).trim().toUpperCase())
      .filter((plate) => plate.length > 0);

    if (plates.length === 0) {
      return Response.json({ ok: false, error: "plates[] required" }, { status: 400 });
    }

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

    return Response.json({ ok: true, inserted, skipped });
  } catch (error: unknown) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error", where: "vehicles-bulk" },
      { status: 500 }
    );
  }
};

export const onRequestGet: PagesFunction = async () => {
  return Response.json({ ok: false, error: "Use POST" }, { status: 405 });
};
