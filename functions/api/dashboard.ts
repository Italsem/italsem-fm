import { ensureSeedData, requireAuth } from "./_lib/auth";
import { ensureCoreTables } from "./_lib/setup";

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  try {
    await ensureSeedData(env.DB);
    await ensureCoreTables(env.DB);
    const auth = await requireAuth(request, env.DB);
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";

    const totals = await env.DB.prepare(`
      SELECT
        COALESCE(SUM(sub.liters), 0) as totalLiters,
        COALESCE(SUM(sub.amount), 0) as totalAmount,
        COALESCE(SUM(sub.distanceKm), 0) as totalDistanceKm,
        COALESCE(AVG(sub.kmPerLiter), 0) as avgConsumptionKmL
      FROM (
        SELECT fe.liters, fe.amount,
          CASE WHEN prev.id IS NOT NULL THEN fe.odometer_km - prev.odometer_km ELSE 0 END as distanceKm,
          CASE WHEN prev.id IS NOT NULL AND fe.liters > 0 AND (fe.odometer_km - prev.odometer_km) > 0
            THEN (fe.odometer_km - prev.odometer_km) / fe.liters
            ELSE NULL
          END as kmPerLiter
        FROM fuel_events fe
        LEFT JOIN fuel_events prev ON prev.id = (
          SELECT p.id FROM fuel_events p
          WHERE p.vehicle_id = fe.vehicle_id
            AND (
              p.refuel_at < fe.refuel_at
              OR (p.refuel_at = fe.refuel_at AND p.odometer_km < fe.odometer_km)
              OR (p.refuel_at = fe.refuel_at AND p.odometer_km = fe.odometer_km AND p.id < fe.id)
            )
          ORDER BY p.refuel_at DESC, p.odometer_km DESC, p.id DESC
          LIMIT 1
        )
        WHERE (? = '' OR fe.refuel_at >= ?)
          AND (? = '' OR fe.refuel_at <= ?)
      ) sub
    `).bind(from, from, to, to).first<{ totalLiters: number; totalAmount: number; totalDistanceKm: number; avgConsumptionKmL: number }>();

    const highConsumption = await env.DB.prepare(`
      SELECT v.id, v.code, v.plate, v.model, AVG(sub.kmPerLiter) as avgConsumption
      FROM (
        SELECT fe.vehicle_id,
          CASE WHEN prev.id IS NOT NULL AND fe.liters > 0 AND (fe.odometer_km - prev.odometer_km) > 0
            THEN (fe.odometer_km - prev.odometer_km) / fe.liters
            ELSE NULL
          END as kmPerLiter
        FROM fuel_events fe
        LEFT JOIN fuel_events prev ON prev.id = (
          SELECT p.id FROM fuel_events p
          WHERE p.vehicle_id = fe.vehicle_id
            AND (
              p.refuel_at < fe.refuel_at
              OR (p.refuel_at = fe.refuel_at AND p.odometer_km < fe.odometer_km)
              OR (p.refuel_at = fe.refuel_at AND p.odometer_km = fe.odometer_km AND p.id < fe.id)
            )
          ORDER BY p.refuel_at DESC, p.odometer_km DESC, p.id DESC
          LIMIT 1
        )
        WHERE (? = '' OR fe.refuel_at >= ?)
          AND (? = '' OR fe.refuel_at <= ?)
      ) sub
      JOIN vehicles v ON v.id = sub.vehicle_id
      WHERE sub.kmPerLiter IS NOT NULL
      GROUP BY v.id, v.code, v.plate, v.model
      ORDER BY avgConsumption DESC
      LIMIT 8
    `).bind(from, from, to, to).all();

    const monthly = await env.DB.prepare(`
      SELECT substr(fe.refuel_at,1,7) as month,
        SUM(fe.liters) as liters,
        SUM(fe.amount) as amount,
        COALESCE(SUM(CASE WHEN prev.id IS NOT NULL THEN fe.odometer_km - prev.odometer_km ELSE 0 END), 0) as distanceKm
      FROM fuel_events fe
      LEFT JOIN fuel_events prev ON prev.id = (
        SELECT p.id FROM fuel_events p
        WHERE p.vehicle_id = fe.vehicle_id
          AND (
            p.refuel_at < fe.refuel_at
            OR (p.refuel_at = fe.refuel_at AND p.odometer_km < fe.odometer_km)
            OR (p.refuel_at = fe.refuel_at AND p.odometer_km = fe.odometer_km AND p.id < fe.id)
          )
        ORDER BY p.refuel_at DESC, p.odometer_km DESC, p.id DESC
        LIMIT 1
      )
      WHERE (? = '' OR fe.refuel_at >= ?)
        AND (? = '' OR fe.refuel_at <= ?)
      GROUP BY substr(fe.refuel_at,1,7)
      ORDER BY month
    `).bind(from, from, to, to).all();

    const compare = await env.DB.prepare(`
      SELECT v.code, v.plate, AVG(sub.kmPerLiter) as avgConsumption
      FROM (
        SELECT fe.vehicle_id,
          CASE WHEN prev.id IS NOT NULL AND fe.liters > 0 AND (fe.odometer_km - prev.odometer_km) > 0
            THEN (fe.odometer_km - prev.odometer_km) / fe.liters
            ELSE NULL
          END as kmPerLiter
        FROM fuel_events fe
        LEFT JOIN fuel_events prev ON prev.id = (
          SELECT p.id FROM fuel_events p
          WHERE p.vehicle_id = fe.vehicle_id
            AND (
              p.refuel_at < fe.refuel_at
              OR (p.refuel_at = fe.refuel_at AND p.odometer_km < fe.odometer_km)
              OR (p.refuel_at = fe.refuel_at AND p.odometer_km = fe.odometer_km AND p.id < fe.id)
            )
          ORDER BY p.refuel_at DESC, p.odometer_km DESC, p.id DESC
          LIMIT 1
        )
        WHERE (? = '' OR fe.refuel_at >= ?)
          AND (? = '' OR fe.refuel_at <= ?)
      ) sub
      JOIN vehicles v ON v.id = sub.vehicle_id
      WHERE sub.kmPerLiter IS NOT NULL
      GROUP BY v.id, v.code, v.plate
      ORDER BY avgConsumption DESC
    `).bind(from, from, to, to).all();

    return Response.json({
      ok: true,
      data: {
        totalLiters: totals?.totalLiters || 0,
        totalAmount: totals?.totalAmount || 0,
        totalDistanceKm: totals?.totalDistanceKm || 0,
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
