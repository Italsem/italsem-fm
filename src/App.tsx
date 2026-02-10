import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Vehicle = {
  id: number;
  plate: string;
  name: string | null;
};

type ImportResult = {
  ok: boolean;
  totalSheets?: number;
  detectedPlates?: number;
  inserted?: number;
  skipped?: number;
  error?: string;
};

async function fetchVehicles(): Promise<Vehicle[]> {
  const res = await fetch("/api/vehicles");
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error("Errore caricamento mezzi");
  return data.data || [];
}

function isLikelyPlate(name: string) {
  const s = name.trim().toUpperCase();
  const blacklist = ["SCHEDA", "TEMPLATE", "FOGLIO", "NOTE", "RIEPILOGO"];
  if (blacklist.some((b) => s.includes(b))) return false;
  return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(s);
}

export default function App() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      setVehicles(await fetchVehicles());
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return vehicles;
    return vehicles.filter(
      (v) =>
        v.plate.includes(q) ||
        (v.name || "").toUpperCase().includes(q)
    );
  }, [vehicles, search]);

  async function onImportExcel(file: File) {
    setImporting(true);
    setImportResult(null);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });

      const plates = wb.SheetNames
        .map((n) => n.trim().toUpperCase())
        .filter(isLikelyPlate);

      if (plates.length === 0) {
        throw new Error("Nessuna targa trovata nei nomi dei fogli.");
      }

      const res = await fetch("/api/vehicles-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plates }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Import fallito");
      }

      setImportResult({
        ok: true,
        totalSheets: wb.SheetNames.length,
        detectedPlates: plates.length,
        inserted: data.inserted,
        skipped: data.skipped,
      });

      await load();
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
            <div className="text-lg font-semibold">Italsem FM</div>
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Import targhe da Excel
            </div>
          </div>

          <label
            className="cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold"
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
            <h1 className="text-xl font-semibold">Mezzi</h1>

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
              className="mt-4 rounded-xl border p-3 text-sm"
              style={{
                borderColor: "var(--border)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              {importResult.ok ? (
                <>
                  <div style={{ color: "var(--accent)" }}>
                    Import completato ✅
                  </div>
                  <div>
                    Fogli: {importResult.totalSheets} — Targhe:{" "}
                    {importResult.detectedPlates}
                  </div>
                  <div>
                    Inserite: <b>{importResult.inserted}</b> — Già presenti:{" "}
                    <b>{importResult.skipped}</b>
                  </div>
                </>
              ) : (
                <div style={{ color: "#ff8a8a" }}>
                  Import fallito ❌ — {importResult.error}
                </div>
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
                  className="rounded-xl border p-3"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    borderColor: "var(--border)",
                  }}
                >
                  <div className="font-semibold">{v.plate}</div>
                  <div className="text-sm" style={{ color: "var(--muted)" }}>
                    {v.name || "—"}
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
