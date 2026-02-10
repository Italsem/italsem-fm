import { useEffect, useMemo, useState } from "react";

type Vehicle = {
  id: number;
  plate: string;
  name: string | null;
  type: string | null;
  notes: string | null;
  photo_key: string | null;
  photo_url: string | null;
};

type VehiclesResponse = { ok: boolean; data: Vehicle[] };
type ImportResult = {
  ok: boolean;
  totalSheets?: number;
  detectedPlates?: number;
  inserted?: number;
  skipped?: number;
  plates?: string[];
  error?: string;
};

async function loadVehicles(): Promise<Vehicle[]> {
  const res = await fetch("/api/vehicles");
  const data = (await res.json()) as VehiclesResponse;
  if (!res.ok || !data.ok) throw new Error("Errore caricamento mezzi");
  return data.data || [];
}

export default function App() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setVehicles(await loadVehicles());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return vehicles;
    return vehicles.filter(
      (v) => v.plate.includes(q) || (v.name || "").toUpperCase().includes(q)
    );
  }, [vehicles, search]);

  async function onImportExcel(file: File) {
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/import/vehicles-excel", {
        method: "POST",
        body: fd,
      });

      const data = (await res.json()) as ImportResult;
      if (!res.ok || !data.ok) throw new Error(data.error || "Import fallito");

      setImportResult(data);
      setVehicles(await loadVehicles());
    } catch (e: any) {
      setImportResult({ ok: false, error: e?.message || "Errore" });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-10 border-b"
        style={{ borderColor: "var(--border)", background: "var(--bg)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <div className="text-lg font-semibold leading-tight">Italsem FM</div>
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Import targhe + lista mezzi
            </div>
          </div>

          <label
            className="inline-flex cursor-pointer items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#111" }}
          >
            {importing ? "Import..." : "📥 Importa Excel"}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportExcel(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div
          className="rounded-2xl border p-5"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-semibold">Mezzi</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                Carica l’Excel: i nomi dei fogli vengono salvati come targhe.
              </p>
            </div>

            <input
              placeholder="Cerca targa o nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full md:w-72 rounded-xl border px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--bg)",
                borderColor: "var(--border)",
                color: "var(--text)",
              }}
            />
          </div>

          {importResult && (
            <div
              className="mt-4 rounded-2xl border p-4 text-sm"
              style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.02)" }}
            >
              {importResult.ok ? (
                <>
                  <div className="font-semibold" style={{ color: "var(--accent)" }}>
                    Import completato ✅
                  </div>
                  <div className="mt-1" style={{ color: "var(--muted)" }}>
                    Fogli: {importResult.totalSheets} — Targhe: {importResult.detectedPlates}
                  </div>
                  <div className="mt-1">
                    Inserite: <b>{importResult.inserted}</b> — Già presenti:{" "}
                    <b>{importResult.skipped}</b>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-red-300">Import fallito ❌</div>
                  <div className="mt-1" style={{ color: "var(--muted)" }}>
                    {importResult.error}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="mt-5 grid gap-3">
            {loading ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Caricamento...
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Nessun mezzo. Importa l’Excel.
              </div>
            ) : (
              filtered.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between rounded-2xl border p-4"
                  style={{ background: "rgba(255,255,255,0.02)", borderColor: "var(--border)" }}
                >
                  <div>
                    <div className="font-semibold">{v.plate}</div>
                    <div className="text-sm" style={{ color: "var(--muted)" }}>
                      {v.name || "—"}
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    id: {v.id}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
