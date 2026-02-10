export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ env }) => {
  try {
    if (!env.DB) {
      return Response.json({ ok: false, error: "DB binding missing" }, { status: 500 });
    }

    const { results } = await env.DB.prepare(
      "SELECT id, plate, name FROM vehicles ORDER BY plate"
    ).all();

    return Response.json({ ok: true, data: results });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
};

// opzionale: se un giorno vuoi creare mezzi da UI con POST
export const onRequestPost: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  try {
    const body = (await request.json().catch(() => null)) as { plate?: string; name?: string | null } | null;
    const plate = String(body?.plate || "").trim().toUpperCase();
    const name = body?.name ? String(body.name).trim() : null;

    if (!plate) {
      return Response.json({ ok: false, error: "plate required" }, { status: 400 });
    }

    await env.DB.prepare(
      "INSERT OR IGNORE INTO vehicles (plate, name, type, notes) VALUES (?, ?, NULL, NULL)"
    ).bind(plate, name).run();

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
};
