export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-xl"
              style={{ background: "var(--card)", border: `1px solid var(--border)` }}
            />
            <div>
              <div className="text-lg font-semibold leading-tight">Italsem FM</div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Fleet Management
              </div>
            </div>
          </div>

          <button
            className="rounded-xl px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#111" }}
          >
            + Nuovo mezzo
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div
          className="rounded-2xl border p-5"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold">Mezzi</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                Anagrafica flotta, rifornimenti, scadenze e report.
              </p>
            </div>

            <input
              placeholder="Cerca targa o nome..."
              className="w-72 rounded-xl border px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--bg)",
                borderColor: "var(--border)",
                color: "var(--text)",
              }}
            />
          </div>

          <div className="mt-5 grid gap-3">
            {/* Card esempio */}
            <div
              className="flex items-center justify-between rounded-2xl border p-4"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="h-12 w-12 rounded-xl border"
                  style={{ background: "var(--bg)", borderColor: "var(--border)" }}
                />
                <div>
                  <div className="font-semibold">GV677AG</div>
                  <div className="text-sm" style={{ color: "var(--muted)" }}>
                    Iveco Daily — attivo
                  </div>
                </div>
              </div>

              <button
                className="rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              >
                Apri →
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
