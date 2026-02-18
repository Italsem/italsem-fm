import { ensureSeedData, requireAuth, requireRole } from "../_lib/auth";
import { ensureCoreTables } from "../_lib/setup";

export const onRequestDelete: PagesFunction<{ DB: D1Database }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const id = Number(params.id);
  if (!id) return Response.json({ ok: false, error: "ID non valido" }, { status: 400 });

  const source = await env.DB
    .prepare("SELECT id, identifier FROM fuel_sources WHERE id = ?")
    .bind(id)
    .first<{ id: number; identifier: string }>();

  if (!source) return Response.json({ ok: false, error: "Fonte non trovata" }, { status: 404 });

  const used = await env.DB
    .prepare("SELECT COUNT(*) as count FROM fuel_events WHERE source_identifier = ?")
    .bind(source.identifier)
    .first<{ count: number }>();

  if ((used?.count || 0) > 0) {
    return Response.json({ ok: false, error: "Fonte già usata in rifornimenti: impossibile rimuovere" }, { status: 400 });
  }

  await env.DB.prepare("DELETE FROM fuel_sources WHERE id = ?").bind(id).run();
  return Response.json({ ok: true });
};
