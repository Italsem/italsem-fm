import { ensureSeedData, requireAuth, requireRole } from "../_lib/auth";
import { ensureCoreTables } from "../_lib/setup";

type DeadlineRow = {
  code: string;
  plate: string;
  deadlineType: string;
  dueDate: string;
  daysLeft: number;
};

type Env = {
  DB: D1Database;
  ALERT_EMAIL_TO?: string;
  ALERT_EMAIL_FROM?: string;
  ALERT_EMAIL_SUBJECT?: string;
};

function parseRecipients(raw?: string): string[] {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function sanitize(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildHtml(rows: DeadlineRow[], windowDays: number) {
  const generatedAt = new Date().toLocaleString("it-IT");
  const bodyRows = rows
    .map((r) => {
      const stato = r.daysLeft < 0 ? "Scaduta" : r.daysLeft <= 30 ? "In scadenza" : "Programmabile";
      return `<tr>
        <td>${sanitize(r.code)}</td>
        <td>${sanitize(r.plate)}</td>
        <td>${sanitize(r.deadlineType)}</td>
        <td>${sanitize(new Date(r.dueDate).toLocaleDateString("it-IT"))}</td>
        <td>${r.daysLeft}</td>
        <td>${stato}</td>
      </tr>`;
    })
    .join("");

  return `
    <h2>Alert scadenze mezzi (finestra ${windowDays} giorni)</h2>
    <p>Generato il ${generatedAt}.</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse;">
      <thead>
        <tr>
          <th>Codice</th>
          <th>Targa</th>
          <th>Tipo</th>
          <th>Scadenza</th>
          <th>Giorni alla scadenza</th>
          <th>Stato</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || '<tr><td colspan="6">Nessuna scadenza nel periodo.</td></tr>'}
      </tbody>
    </table>
  `;
}

async function loadDeadlines(db: D1Database, windowDays: number) {
  const query = await db
    .prepare(`
      SELECT
        v.code as code,
        v.plate as plate,
        vd.deadline_type as deadlineType,
        vd.due_date as dueDate,
        CAST(ROUND(julianday(vd.due_date) - julianday('now')) AS INTEGER) as daysLeft
      FROM vehicle_deadlines vd
      JOIN vehicles v ON v.id = vd.vehicle_id
      WHERE COALESCE(v.active, 1) = 1
        AND julianday(vd.due_date) <= julianday('now') + ?
      ORDER BY vd.due_date ASC, v.code ASC
    `)
    .bind(windowDays)
    .all<DeadlineRow>();

  return query.results || [];
}

async function sendMailChannels(from: string, to: string[], subject: string, html: string) {
  const response = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: to.map((email) => ({ email })) }],
      from: { email: from, name: "Italsem FM Alert" },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Invio email fallito (${response.status}): ${err.slice(0, 300)}`);
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureSeedData(env.DB);
    await ensureCoreTables(env.DB);

    const auth = await requireAuth(request, env.DB);
    if (auth instanceof Response) return auth;
    const denied = requireRole(auth, ["admin"]);
    if (denied) return denied;

    const url = new URL(request.url);
    const windowDays = Number(url.searchParams.get("days") || "30");
    if (!Number.isFinite(windowDays) || windowDays <= 0 || windowDays > 365) {
      return Response.json({ ok: false, error: "Parametro days non valido (1-365)" }, { status: 400 });
    }

    const recipients = parseRecipients(env.ALERT_EMAIL_TO);
    if (!recipients.length) {
      return Response.json({ ok: false, error: "Configura ALERT_EMAIL_TO (lista email separata da virgola)" }, { status: 400 });
    }

    const rows = await loadDeadlines(env.DB, windowDays);
    const html = buildHtml(rows, windowDays);
    const from = env.ALERT_EMAIL_FROM || "alert@italsem-fm.local";
    const subject = env.ALERT_EMAIL_SUBJECT || `Italsem FM - Alert scadenze (${rows.length})`;

    await sendMailChannels(from, recipients, subject, html);

    return Response.json({ ok: true, sentTo: recipients, rows: rows.length, windowDays });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Errore invio alert scadenze" }, { status: 500 });
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await ensureSeedData(env.DB);
    await ensureCoreTables(env.DB);

    const auth = await requireAuth(request, env.DB);
    if (auth instanceof Response) return auth;
    const denied = requireRole(auth, ["admin"]);
    if (denied) return denied;

    const url = new URL(request.url);
    const windowDays = Number(url.searchParams.get("days") || "30");
    if (!Number.isFinite(windowDays) || windowDays <= 0 || windowDays > 365) {
      return Response.json({ ok: false, error: "Parametro days non valido (1-365)" }, { status: 400 });
    }

    const rows = await loadDeadlines(env.DB, windowDays);
    return Response.json({ ok: true, windowDays, count: rows.length, data: rows });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Errore lettura alert scadenze" }, { status: 500 });
  }
};
