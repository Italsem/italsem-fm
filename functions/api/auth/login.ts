import { createSession, ensureSeedData, sha256Hex } from "../_lib/auth";
import { ensureCoreTables } from "../_lib/setup";

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async ({ request, env }) => {
  try {
    await ensureSeedData(env.DB);
    await ensureCoreTables(env.DB);
    const body = await request.json().catch(() => null) as { username?: string; password?: string } | null;
    const username = String(body?.username || "").trim().toLowerCase();
    const password = String(body?.password || "").trim();

    if (!username || !password) {
      return Response.json({ ok: false, error: "Username e password obbligatori" }, { status: 400 });
    }

    const user = await env.DB.prepare("SELECT id, username, role, password_hash as hash, active FROM users WHERE username = ?")
      .bind(username)
      .first<{ id: number; username: string; role: string; hash: string; active: number }>();

    if (!user || user.active !== 1) {
      return Response.json({ ok: false, error: "Credenziali non valide" }, { status: 401 });
    }

    const hash = await sha256Hex(password);
    if (hash !== user.hash) {
      return Response.json({ ok: false, error: "Credenziali non valide" }, { status: 401 });
    }

    const session = await createSession(env.DB, user.id);
    return Response.json({ ok: true, token: session.token, expiresAt: session.expiresAt, user: { id: user.id, username: user.username, role: user.role } });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Errore login" }, { status: 500 });
  }
};
