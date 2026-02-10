export const onRequestPost: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  try {
    if (!env.DB) {
      return Response.json(
        { ok: false, error: "DB binding not found (controlla Pages → Settings → Bindings: DB)" },
        { status: 500 }
      );
    }

    const raw = await request.text();
    let body: any = null;
    try { body = JSON.parse(raw); } catch {}

    const plates = (body?.plates || [])
      .map((p: any) => String(p).trim().toUpperCase())
      .filter((p: string) => p.length > 0);

    if (plates.length === 0) {
      return Response.json({ ok: false, error: "plates[] required" }, { status: 400 });
    }

    let inserted = 0;
    let skipped = 0;

    for (const plate of plates) {
      const res = await env.DB.prepare(
        "INSERT OR IGNORE INTO vehicles (plate, name, type, notes) VALUES (?, NULL, NULL, NULL)"
      ).bind(plate).run();

      if ((res as any).changes === 1) inserted++;
      else skipped++;
    }

    return Response.json({ ok: true, inserted, skipped });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message || "Unknown error", where: "vehicles-bulk" },
      { status: 500 }
    );
  }
};

export const onRequestGet: PagesFunction = async () => {
  return Response.json({ ok: false, error: "Use POST" }, { status: 405 });
};
