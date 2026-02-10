CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT NOT NULL UNIQUE,
  name TEXT,
  type TEXT,
  notes TEXT,
  photo_key TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fuel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  station TEXT,
  driver TEXT,
  site TEXT,
  odometer_km INTEGER NOT NULL,
  liters REAL NOT NULL,
  amount REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
);

CREATE INDEX IF NOT EXISTS idx_fuel_vehicle_date ON fuel_events(vehicle_id, date);

CREATE TABLE IF NOT EXISTS deadlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  due_date TEXT NOT NULL,
  provider TEXT,
  ref TEXT,
  notes TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
);

CREATE INDEX IF NOT EXISTS idx_deadlines_due ON deadlines(due_date);
