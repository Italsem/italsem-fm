export const onRequestPost: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  const body = (await request.json().catch(() => null)) as { plates?: string[] } | null;

  const plates = (body?.plates || [])
    .map((p) => String(p).trim().toUpperCase())
    .filter((p) => p.length > 0);

  if (plates.length === 0) {
    return Response.json({ ok: false, error: "plates[] required" }, { status: 400 });
  }

  let inserted = 0;
  let skipped = 0;

  for (const plate of plates) {
    const res = await env.DB.prepare(
      "INSERT OR IGNORE INTO vehicles (plate, name, type, notes) VALUES (?, NULL, NULL, NULL)"
    )
      .bind(plate)
      .run();

    if ((res as any).changes === 1) inserted++;
    else skipped++;
  }

  return Response.json({ ok: true, inserted, skipped, count: plates.length });
};

// Per evitare che Cloudflare risponda con HTML su metodi diversi:
export const onRequestGet: PagesFunction = async () => {
  return Response.json({ ok: false, error: "Use POST" }, { status: 405 });
};
