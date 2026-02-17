export type Role = "admin" | "technician" | "accounting";

export type AuthContext = {
  userId: number;
  username: string;
  role: Role;
};

const SESSION_TTL_HOURS = 12;

function jsonError(message: string, status = 401) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ensureSeedData(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `).run();

  const { count } = await db.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>() ?? { count: 0 };
  if (count > 0) return;

  const defaults: Array<{ username: string; password: string; role: Role }> = [
    { username: "admin", password: "admin123", role: "admin" },
    { username: "tecnico", password: "tecnico123", role: "technician" },
    { username: "contabilita", password: "conta123", role: "accounting" },
  ];

  for (const user of defaults) {
    const hash = await sha256Hex(user.password);
    await db
      .prepare("INSERT INTO users(username, password_hash, role, active) VALUES (?, ?, ?, 1)")
      .bind(user.username, hash, user.role)
      .run();
  }
}

export async function createSession(db: D1Database, userId: number) {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  await db.prepare("INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, userId, expiresAt).run();
  return { token, expiresAt };
}

export async function requireAuth(request: Request, db: D1Database): Promise<AuthContext | Response> {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return jsonError("Token non fornito", 401);

  const row = await db
    .prepare(`
      SELECT u.id as userId, u.username, u.role, s.expires_at as expiresAt
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND u.active = 1
    `)
    .bind(token)
    .first<{ userId: number; username: string; role: Role; expiresAt: string }>();

  if (!row) return jsonError("Sessione non valida", 401);
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return jsonError("Sessione scaduta", 401);
  }

  return { userId: row.userId, username: row.username, role: row.role };
}

export function requireRole(ctx: AuthContext, roles: Role[]): Response | null {
  if (!roles.includes(ctx.role)) {
    return jsonError("Permessi insufficienti", 403);
  }
  return null;
}
