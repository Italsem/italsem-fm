type TableInfo = { name: string };

async function ensureVehicleColumns(db: D1Database) {
  const info = await db.prepare("PRAGMA table_info(vehicles)").all<TableInfo>();
  const cols = new Set((info.results || []).map((c) => c.name));

  if (!cols.has("code")) {
    await db.prepare("ALTER TABLE vehicles ADD COLUMN code TEXT").run();
  }
  if (!cols.has("model")) {
    await db.prepare("ALTER TABLE vehicles ADD COLUMN model TEXT").run();
  }
  if (!cols.has("description")) {
    await db.prepare("ALTER TABLE vehicles ADD COLUMN description TEXT").run();
  }
  if (!cols.has("active")) {
    await db.prepare("ALTER TABLE vehicles ADD COLUMN active INTEGER NOT NULL DEFAULT 1").run();
  }
  if (!cols.has("photo_key")) {
    await db.prepare("ALTER TABLE vehicles ADD COLUMN photo_key TEXT").run();
  }
  if (!cols.has("created_at")) {
    await db.prepare("ALTER TABLE vehicles ADD COLUMN created_at TEXT DEFAULT (datetime('now'))").run();
  }
  if (!cols.has("ideal_consumption_km_l")) {
    await db.prepare("ALTER TABLE vehicles ADD COLUMN ideal_consumption_km_l REAL").run();
  }

  const nameExpr = cols.has("name") ? "NULLIF(TRIM(name), '')" : "NULL";
  await db.prepare(`
    UPDATE vehicles
    SET
      code = COALESCE(NULLIF(TRIM(code), ''), UPPER(TRIM(plate))),
      model = COALESCE(NULLIF(TRIM(model), ''), ${nameExpr}, 'Senza modello'),
      description = COALESCE(NULLIF(TRIM(description), ''), ${nameExpr}),
      active = COALESCE(active, 1),
      ideal_consumption_km_l = CASE
        WHEN ideal_consumption_km_l IS NOT NULL AND ideal_consumption_km_l > 0 THEN ideal_consumption_km_l
        ELSE NULL
      END
  `).run();
}

async function ensureFuelEventColumns(db: D1Database) {
  const info = await db.prepare("PRAGMA table_info(fuel_events)").all<TableInfo>();
  const cols = new Set((info.results || []).map((c) => c.name));

  if (!cols.has("refuel_at")) {
    await db.prepare("ALTER TABLE fuel_events ADD COLUMN refuel_at TEXT").run();
  }
  if (!cols.has("source_type")) {
    await db.prepare("ALTER TABLE fuel_events ADD COLUMN source_type TEXT").run();
  }
  if (!cols.has("source_identifier")) {
    await db.prepare("ALTER TABLE fuel_events ADD COLUMN source_identifier TEXT").run();
  }
  if (!cols.has("receipt_key")) {
    await db.prepare("ALTER TABLE fuel_events ADD COLUMN receipt_key TEXT").run();
  }
  if (!cols.has("created_by")) {
    await db.prepare("ALTER TABLE fuel_events ADD COLUMN created_by INTEGER DEFAULT 1").run();
  }

  const oldDateExpr = cols.has("date") ? "date" : "NULL";
  const oldSourceExpr = cols.has("source") ? "source" : "NULL";
  const oldStationExpr = cols.has("station") ? "station" : "NULL";
  const oldSiteExpr = cols.has("site") ? "site" : "NULL";

  await db.prepare(`
    UPDATE fuel_events
    SET
      refuel_at = COALESCE(NULLIF(TRIM(refuel_at), ''), ${oldDateExpr}, datetime('now')),
      source_type = COALESCE(NULLIF(TRIM(source_type), ''), ${oldSourceExpr}, 'card'),
      source_identifier = COALESCE(NULLIF(TRIM(source_identifier), ''), NULLIF(TRIM(${oldStationExpr}), ''), NULLIF(TRIM(${oldSiteExpr}), ''), 'N/A'),
      created_by = COALESCE(created_by, 1)
  `).run();
}


async function ensureFuelSourceColumns(db: D1Database) {
  const info = await db.prepare("PRAGMA table_info(fuel_sources)").all<TableInfo>();
  const cols = new Set((info.results || []).map((c) => c.name));

  if (!cols.has("assigned_to")) {
    await db.prepare("ALTER TABLE fuel_sources ADD COLUMN assigned_to TEXT").run();
  }

  await db.prepare("UPDATE fuel_sources SET assigned_to = COALESCE(NULLIF(TRIM(assigned_to), ''), NULL)").run();
}

export async function ensureCoreTables(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      plate TEXT NOT NULL,
      model TEXT NOT NULL,
      description TEXT,
      ideal_consumption_km_l REAL,
      photo_key TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await ensureVehicleColumns(db);

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS fuel_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      identifier TEXT NOT NULL UNIQUE,
      assigned_to TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await ensureFuelSourceColumns(db);

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

  await ensureFuelEventColumns(db);

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS vehicle_deadlines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      deadline_type TEXT NOT NULL,
      due_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),
      UNIQUE(vehicle_id, deadline_type)
    )
  `).run();

  await db.prepare("CREATE INDEX IF NOT EXISTS idx_vehicle_deadlines_due ON vehicle_deadlines(due_date)").run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS vehicle_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_key TEXT NOT NULL,
      mime_type TEXT,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY(uploaded_by) REFERENCES users(id)
    )
  `).run();

  await db.prepare("CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_id)").run();

  const seeded = await db.prepare("SELECT COUNT(*) as count FROM fuel_sources").first<{ count: number }>();
  if (!seeded?.count) {
    await db.prepare("INSERT INTO fuel_sources(source_type, identifier, active) VALUES ('card','CARD-001',1),('tank','TANK-CENTRALE',1)").run();
  }
}
