import { ensureSeedData, requireAuth } from "./_lib/auth";
import { ensureCoreTables } from "./_lib/setup";

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  try {
    await ensureSeedData(env.DB);
    await ensureCoreTables(env.DB);
    const auth = await requireAuth(request, env.DB);
    if (auth instanceof Response) return auth;

    const totals = await env.DB.prepare(`
      SELECT
        COALESCE(SUM(liters), 0) as totalLiters,
        COALESCE(SUM(amount), 0) as totalAmount,
        COALESCE(AVG(consumption), 0) as avgConsumptionKmL
      FROM (
        SELECT fe.liters, fe.amount,
        (
          SELECT (NULLIF((fe.odometer_km - prev.odometer_km),0) / NULLIF(fe.liters,0))
          FROM fuel_events prev
          WHERE prev.vehicle_id = fe.vehicle_id AND prev.refuel_at < fe.refuel_at
          ORDER BY prev.refuel_at DESC LIMIT 1
        ) as consumption
        FROM fuel_events fe
      )
    `).first<{ totalLiters: number; totalAmount: number; avgConsumptionKmL: number }>();

    const highConsumption = await env.DB.prepare(`
      SELECT v.id, v.code, v.plate, v.model, AVG(sub.c) as avgConsumption
      FROM (
        SELECT fe.vehicle_id,
        (
          SELECT (NULLIF((fe.odometer_km - prev.odometer_km),0) / NULLIF(fe.liters,0))
          FROM fuel_events prev
          WHERE prev.vehicle_id = fe.vehicle_id AND prev.refuel_at < fe.refuel_at
          ORDER BY prev.refuel_at DESC LIMIT 1
        ) as c
        FROM fuel_events fe
      ) sub
      JOIN vehicles v ON v.id = sub.vehicle_id
      WHERE sub.c IS NOT NULL
      GROUP BY v.id, v.code, v.plate, v.model
      ORDER BY avgConsumption DESC
      LIMIT 5
    `).all();

    const monthly = await env.DB.prepare(`
      SELECT substr(refuel_at,1,7) as month, SUM(liters) as liters, SUM(amount) as amount
      FROM fuel_events
      GROUP BY substr(refuel_at,1,7)
      ORDER BY month
    `).all();

    const compare = await env.DB.prepare(`
      SELECT v.code, v.plate, AVG(sub.c) as avgConsumption
      FROM (
        SELECT fe.vehicle_id,
        (
          SELECT (NULLIF((fe.odometer_km - prev.odometer_km),0) / NULLIF(fe.liters,0))
          FROM fuel_events prev
          WHERE prev.vehicle_id = fe.vehicle_id AND prev.refuel_at < fe.refuel_at
          ORDER BY prev.refuel_at DESC LIMIT 1
        ) as c
        FROM fuel_events fe
      ) sub
      JOIN vehicles v ON v.id = sub.vehicle_id
      WHERE sub.c IS NOT NULL
      GROUP BY v.id, v.code, v.plate
      ORDER BY avgConsumption DESC
    `).all();

    return Response.json({
      ok: true,
      data: {
        totalLiters: totals?.totalLiters || 0,
        totalAmount: totals?.totalAmount || 0,
        avgConsumption: totals?.avgConsumptionKmL || 0,
        highConsumption: highConsumption.results,
        monthly: monthly.results,
        compare: compare.results,
      },
    });
  } catch (error: unknown) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Errore dashboard" },
      { status: 500 }
    );
  }
};
