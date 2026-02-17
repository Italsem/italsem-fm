import { ensureSeedData, requireAuth } from "../_lib/auth";
import { ensureCoreTables } from "../_lib/setup";

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;

  const rows = await env.DB
    .prepare("SELECT due_date as dueDate FROM vehicle_deadlines")
    .all<{ dueDate: string }>();

  const now = new Date();
  let valid = 0;
  let warning = 0;
  let expired = 0;

  for (const r of rows.results) {
    const due = new Date(r.dueDate + "T23:59:59");
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) expired++;
    else if (diffDays <= 30) warning++;
    else valid++;
  }

  return Response.json({ ok: true, data: { valid, warning, expired, total: rows.results.length } });
};
