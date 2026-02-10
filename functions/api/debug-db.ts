export const onRequestGet: PagesFunction<{ DB?: D1Database }> = async ({ env }) => {
  try {
    if (!env.DB) {
      return Response.json({
        ok: false,
        error: "DB binding missing",
        hint: "Pages → Settings → Functions → Bindings: variable name MUST be DB",
      }, { status: 500 });
    }

    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();

    return Response.json({
      ok: true,
      tables: tables.results,
    });
  } catch (e: any) {
    return Response.json({
      ok: false,
      error: e?.message || "Unknown error",
      where: "debug-db",
    }, { status: 500 });
  }
};
