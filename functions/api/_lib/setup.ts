export async function ensureCoreTables(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      plate TEXT NOT NULL,
      model TEXT NOT NULL,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS fuel_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      identifier TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS fuel_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      refuel_at TEXT NOT NULL,
      odometer_km REAL NOT NULL,
      liters REAL NOT NULL,
      amount REAL NOT NULL,
      source_type TEXT NOT NULL,
      source_identifier TEXT NOT NULL,
      receipt_key TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    )
  `).run();

  const seeded = await db.prepare("SELECT COUNT(*) as count FROM fuel_sources").first<{ count: number }>();
  if (!seeded?.count) {
    await db.prepare("INSERT INTO fuel_sources(source_type, identifier, active) VALUES ('card','CARD-001',1),('tank','TANK-CENTRALE',1)").run();
  }
}
