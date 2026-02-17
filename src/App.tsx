import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

type Role = "admin" | "technician" | "accounting";
type User = { userId: number; username: string; role: Role };
type Vehicle = { id: number; code: string; plate: string; model: string; description?: string; active: number };
type FuelSource = { id: number; source_type: "card" | "tank"; identifier: string; active: number };
type Refueling = {
  id: number;
  vehicleId: number;
  vehicleCode: string;
  plate: string;
  model: string;
  refuelAt: string;
  odometerKm: number;
  liters: number;
  amount: number;
  sourceType: "card" | "tank";
  sourceIdentifier: string;
  receiptKey?: string;
  consumptionL100km?: number;
};

type Dashboard = {
  totalLiters: number;
  totalAmount: number;
  avgConsumption: number;
  highConsumption: Array<{ code: string; plate: string; model: string; avgConsumption: number }>;
  monthly: Array<{ month: string; liters: number; amount: number }>;
  compare: Array<{ code: string; plate: string; avgConsumption: number }>;
};

const TABS = ["dashboard", "mezzi", "rifornimenti"] as const;

type Tab = (typeof TABS)[number];

async function api<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
  });

  const raw = await res.text();
  let data: { ok?: boolean; error?: string } | null = null;
  try {
    data = JSON.parse(raw) as { ok?: boolean; error?: string };
  } catch {
    throw new Error(`Risposta non JSON da ${url}: ${raw.slice(0, 160)}`);
  }

  if (!res.ok || !data?.ok) throw new Error(data?.error || `Errore API (${res.status})`);
  return data as T;
}

function MiniBars({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex justify-between text-xs"><span>{d.label}</span><span>{d.value.toFixed(2)}</span></div>
          <div className="h-2 rounded bg-slate-700">
            <div className="h-2 rounded bg-orange-500" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [error, setError] = useState("");

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [sources, setSources] = useState<FuelSource[]>([]);
  const [refuelings, setRefuelings] = useState<Refueling[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [search, setSearch] = useState("");

  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin123" });
  const [vehicleForm, setVehicleForm] = useState({ code: "", plate: "", model: "", description: "" });
  const [sourceForm, setSourceForm] = useState({ sourceType: "card", identifier: "" });

  async function loadAll(currentToken = token) {
    if (!currentToken) return;
    try {
      const me = await api<{ user: User }>("/api/auth/me", currentToken);
      setUser(me.user);
      const [v, s, r, d] = await Promise.all([
        api<{ data: Vehicle[] }>(`/api/vehicles?search=${encodeURIComponent(search)}`, currentToken),
        api<{ data: FuelSource[] }>("/api/fuel-sources", currentToken),
        api<{ data: Refueling[] }>("/api/refuelings", currentToken),
        api<{ data: Dashboard }>("/api/dashboard", currentToken),
      ]);
      setVehicles(v.data);
      setSources(s.data.filter((x) => x.active));
      setRefuelings(r.data);
      setDashboard(d.data);
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore");
    }
  }

  useEffect(() => {
    loadAll();
  }, [token]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const raw = await res.text();
      let data: { ok?: boolean; error?: string; token?: string } | null = null;
      try {
        data = JSON.parse(raw) as { ok?: boolean; error?: string; token?: string };
      } catch {
        throw new Error(`Risposta login non JSON: ${raw.slice(0, 160)}`);
      }
      if (!res.ok || !data.ok || !data.token) throw new Error(data?.error || "Login fallito");
      localStorage.setItem("token", data.token);
      setToken(data.token);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore");
    }
  }

  async function addVehicle(e: FormEvent) {
    e.preventDefault();
    await api("/api/vehicles", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vehicleForm) });
    setVehicleForm({ code: "", plate: "", model: "", description: "" });
    await loadAll();
  }

  async function addSource(e: FormEvent) {
    e.preventDefault();
    await api("/api/fuel-sources", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sourceForm) });
    setSourceForm({ sourceType: "card", identifier: "" });
    await loadAll();
  }

  async function addRefueling(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await api("/api/refuelings", token, { method: "POST", body: form });
    e.currentTarget.reset();
    await loadAll();
  }

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return vehicles;
    return vehicles.filter((v) => `${v.code} ${v.plate} ${v.model}`.toUpperCase().includes(q));
  }, [vehicles, search]);

  if (!token || !user) {
    return (
      <main className="min-h-screen p-6">
        <form onSubmit={onLogin} className="mx-auto mt-24 max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 text-left space-y-3">
          <h1 className="text-xl font-bold">Accesso</h1>
          <input className="w-full rounded border border-slate-700 bg-slate-950 p-2" placeholder="Username" autoComplete="username" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
          <input type="password" className="w-full rounded border border-slate-700 bg-slate-950 p-2" placeholder="Password" autoComplete="current-password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
          <button className="rounded bg-orange-500 px-3 py-2 font-semibold text-black">Login</button>
          <p className="text-xs text-slate-400">Demo: admin/admin123, tecnico/tecnico123, contabilita/conta123</p>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Italsem FM • {user.role}</h1>
        <div className="space-x-2">
          {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 ${tab === t ? "bg-orange-500 text-black" : "bg-slate-800"}`}>{t}</button>)}
          <button onClick={() => { localStorage.removeItem("token"); setToken(""); setUser(null); }} className="rounded bg-slate-700 px-3 py-1">Logout</button>
        </div>
      </header>
      {error && <div className="rounded border border-red-700 bg-red-950 p-2 text-red-300">{error}</div>}

      {tab === "dashboard" && dashboard && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">Litri totali: <b>{dashboard.totalLiters.toFixed(2)}</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">Spesa totale: <b>€ {dashboard.totalAmount.toFixed(2)}</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">Consumo medio: <b>{dashboard.avgConsumption.toFixed(2)} l/100km</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h3 className="font-semibold mb-2">Mezzi con consumi più alti</h3>
            {dashboard.highConsumption.map((m) => <div key={m.code} className="text-sm">{m.code} {m.plate} • {m.avgConsumption.toFixed(2)} l/100km</div>)}
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h3 className="font-semibold mb-2">Litri mensili</h3>
            <MiniBars data={dashboard.monthly.map((m) => ({ label: m.month, value: m.liters }))} />
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h3 className="font-semibold mb-2">Confronto consumi mezzi</h3>
            <MiniBars data={dashboard.compare.map((c) => ({ label: `${c.code}/${c.plate}`, value: c.avgConsumption }))} />
          </div>
        </section>
      )}

      {tab === "mezzi" && (
        <section className="space-y-3">
          <input className="rounded border border-slate-700 bg-slate-900 p-2" placeholder="Ricerca mezzi" value={search} onChange={(e) => setSearch(e.target.value)} />
          {user.role === "admin" && (
            <form onSubmit={addVehicle} className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-4">
              <input required placeholder="Codice" value={vehicleForm.code} onChange={(e) => setVehicleForm({ ...vehicleForm, code: e.target.value })} className="rounded bg-slate-950 p-2" />
              <input required placeholder="Targa" value={vehicleForm.plate} onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value })} className="rounded bg-slate-950 p-2" />
              <input required placeholder="Modello" value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })} className="rounded bg-slate-950 p-2" />
              <input placeholder="Descrizione" value={vehicleForm.description} onChange={(e) => setVehicleForm({ ...vehicleForm, description: e.target.value })} className="rounded bg-slate-950 p-2" />
              <button className="rounded bg-orange-500 px-3 py-2 font-semibold text-black md:col-span-4">Aggiungi mezzo</button>
            </form>
          )}
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            {filteredVehicles.map((v) => <div key={v.id} className="border-b border-slate-800 py-2 text-sm">{v.code} • {v.model} ({v.plate})</div>)}
          </div>

          {user.role === "admin" && (
            <form onSubmit={addSource} className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-2 max-w-xl">
              <h3 className="font-semibold">Aggiungi carta/cisterna</h3>
              <select value={sourceForm.sourceType} onChange={(e) => setSourceForm({ ...sourceForm, sourceType: e.target.value })} className="w-full rounded bg-slate-950 p-2">
                <option value="card">Carta carburante</option>
                <option value="tank">Cisterna</option>
              </select>
              <input placeholder="Identificativo" value={sourceForm.identifier} onChange={(e) => setSourceForm({ ...sourceForm, identifier: e.target.value })} className="w-full rounded bg-slate-950 p-2" />
              <button className="rounded bg-orange-500 px-3 py-2 font-semibold text-black">Salva</button>
            </form>
          )}
        </section>
      )}

      {tab === "rifornimenti" && (
        <section className="space-y-4">
          {(user.role === "admin" || user.role === "technician") && (
            <form onSubmit={addRefueling} className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-2">
              <select name="vehicleId" required className="rounded bg-slate-950 p-2"><option value="">Seleziona mezzo</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.code} - {v.plate}</option>)}</select>
              <input name="refuelAt" type="datetime-local" required className="rounded bg-slate-950 p-2" />
              <input name="odometerKm" type="number" min="0" required className="rounded bg-slate-950 p-2" placeholder="Chilometraggio" />
              <input name="liters" type="number" min="0.01" step="0.01" required className="rounded bg-slate-950 p-2" placeholder="Litri" />
              <input name="amount" type="number" min="0" step="0.01" required className="rounded bg-slate-950 p-2" placeholder="Importo" />
              <select name="sourceType" className="rounded bg-slate-950 p-2"><option value="card">Carta carburante</option><option value="tank">Cisterna</option></select>
              <input name="sourceIdentifier" required list="sources" className="rounded bg-slate-950 p-2" placeholder="ID carta/cisterna" />
              <input name="receipt" type="file" className="rounded bg-slate-950 p-2" />
              <datalist id="sources">{sources.map((s) => <option key={s.id} value={s.identifier} />)}</datalist>
              <button className="rounded bg-orange-500 px-3 py-2 font-semibold text-black md:col-span-2">Registra rifornimento</button>
            </form>
          )}

          <div className="overflow-auto rounded-xl border border-slate-700 bg-slate-900 p-2">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left"><th>Data</th><th>Mezzo</th><th>Km</th><th>Litri</th><th>Importo</th><th>Consumo</th><th>Ricevuta</th></tr></thead>
              <tbody>
                {refuelings.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td>{new Date(r.refuelAt).toLocaleString()}</td><td>{r.vehicleCode} ({r.plate})</td><td>{r.odometerKm}</td><td>{r.liters.toFixed(2)}</td><td>€ {r.amount.toFixed(2)}</td><td>{r.consumptionL100km ? r.consumptionL100km.toFixed(2) : "-"}</td>
                    <td>{r.receiptKey ? <a className="text-orange-400" target="_blank" href={`/api/receipt?key=${encodeURIComponent(r.receiptKey)}`}>Apri</a> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
