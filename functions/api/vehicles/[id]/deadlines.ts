import { ensureSeedData, requireAuth, requireRole } from "../../_lib/auth";
import { ensureCoreTables } from "../../_lib/setup";

type DeadlineType = "bollo" | "revisione" | "rca" | "tachigrafo" | "periodica_gru" | "strutturale";

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async ({ request, env, params }) => {
  await ensureSeedData(env.DB);
  await ensureCoreTables(env.DB);
  const auth = await requireAuth(request, env.DB);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, ["admin"]);
  if (denied) return denied;

  const vehicleId = Number(params.id);
  if (!vehicleId) return Response.json({ ok: false, error: "ID Non Valido" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Partial<Record<DeadlineType, string>> | null;
  const types: DeadlineType[] = ["bollo", "revisione", "rca", "tachigrafo", "periodica_gru", "strutturale"];

  for (const t of types) {
    const dueDate = String(body?.[t] || "").trim();
    if (!dueDate) {
      await env.DB.prepare("DELETE FROM vehicle_deadlines WHERE vehicle_id = ? AND deadline_type = ?").bind(vehicleId, t).run();
      continue;
    }
    await env.DB
      .prepare("INSERT INTO vehicle_deadlines(vehicle_id, deadline_type, due_date) VALUES (?, ?, ?) ON CONFLICT(vehicle_id, deadline_type) DO UPDATE SET due_date=excluded.due_date")
      .bind(vehicleId, t, dueDate)
      .run();
  }

  return Response.json({ ok: true });
};
