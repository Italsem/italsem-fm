import { useCallback, useEffect, useMemo, useState } from "react";
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
type UserAdmin = { id: number; username: string; role: Role; active: number; created_at: string };

type Dashboard = {
  totalLiters: number;
  totalAmount: number;
  avgConsumption: number;
  highConsumption: Array<{ code: string; plate: string; model: string; avgConsumption: number }>;
  monthly: Array<{ month: string; liters: number; amount: number }>;
  compare: Array<{ code: string; plate: string; avgConsumption: number }>;
};

type ApiErr = { ok?: boolean; error?: string };

const TABS = ["dashboard", "mezzi", "rifornimenti", "utenti"] as const;
type Tab = (typeof TABS)[number];

async function api<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
  });

  const raw = await res.text();
  let data: ApiErr | null = null;
  try {
    data = JSON.parse(raw) as ApiErr;
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
          <div className="flex justify-between text-xs">
            <span>{d.label}</span>
            <span>{d.value.toFixed(2)}</span>
          </div>
          <div className="h-2 rounded bg-slate-700">
            <div className="h-2 rounded bg-orange-500" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function quickDate(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
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
  const [users, setUsers] = useState<UserAdmin[]>([]);

  const [search, setSearch] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<number>(0);
  const [filterVehicleId, setFilterVehicleId] = useState<number>(0);
  const [fromDate, setFromDate] = useState(quickDate(30));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "cons_desc">("date_desc");

  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin123" });
  const [vehicleForm, setVehicleForm] = useState({ code: "", plate: "", model: "", description: "" });
  const [sourceForm, setSourceForm] = useState({ sourceType: "card", identifier: "" });
  const [passwordForm, setPasswordForm] = useState({ userId: 0, password: "" });

  const loadRefuelings = useCallback(async (currentToken: string, vehicleId = filterVehicleId) => {
    const params = new URLSearchParams();
    if (vehicleId > 0) params.set("vehicleId", String(vehicleId));
    if (fromDate) params.set("from", `${fromDate}T00:00`);
    if (toDate) params.set("to", `${toDate}T23:59`);
    const r = await api<{ data: Refueling[] }>(`/api/refuelings?${params.toString()}`, currentToken);
    setRefuelings(r.data);
  }, [filterVehicleId, fromDate, toDate]);

  const loadAll = useCallback(async (currentToken = token) => {
    if (!currentToken) return;
    try {
      const me = await api<{ user: User }>("/api/auth/me", currentToken);
      setUser(me.user);

      const [v, s, d] = await Promise.all([
        api<{ data: Vehicle[] }>(`/api/vehicles?search=${encodeURIComponent(search)}&active=all`, currentToken),
        api<{ data: FuelSource[] }>("/api/fuel-sources", currentToken),
        api<{ data: Dashboard }>("/api/dashboard", currentToken),
      ]);
      setVehicles(v.data);
      setSources(s.data.filter((x) => x.active));
      setDashboard(d.data);

      await loadRefuelings(currentToken);

      if (me.user.role === "admin") {
        const u = await api<{ data: UserAdmin[] }>("/api/users", currentToken);
        setUsers(u.data);
      } else {
        setUsers([]);
      }
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore");
    }
  }, [token, search, loadRefuelings]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return vehicles;
    return vehicles.filter((v) => `${v.code} ${v.plate} ${v.model} ${v.description || ""}`.toUpperCase().includes(q));
  }, [vehicles, search]);

  const sortedRefuelings = useMemo(() => {
    const rows = [...refuelings];
    if (sortBy === "date_asc") rows.sort((a, b) => a.refuelAt.localeCompare(b.refuelAt));
    if (sortBy === "date_desc") rows.sort((a, b) => b.refuelAt.localeCompare(a.refuelAt));
    if (sortBy === "cons_desc") rows.sort((a, b) => (b.consumptionL100km || 0) - (a.consumptionL100km || 0));
    return rows;
  }, [refuelings, sortBy]);

  const reportStats = useMemo(() => {
    const totalLiters = sortedRefuelings.reduce((acc, r) => acc + r.liters, 0);
    const totalAmount = sortedRefuelings.reduce((acc, r) => acc + r.amount, 0);
    const validCons = sortedRefuelings.map((r) => r.consumptionL100km || 0).filter((v) => v > 0);
    const avgCons = validCons.length ? validCons.reduce((a, b) => a + b, 0) / validCons.length : 0;
    return { totalLiters, totalAmount, avgCons };
  }, [sortedRefuelings]);

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

  async function saveUser(u: UserAdmin, role: Role, active: boolean) {
    await api("/api/users", token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, role, active }),
    });
    await loadAll();
  }

  async function updatePassword(e: FormEvent) {
    e.preventDefault();
    await api(`/api/users/${passwordForm.userId}/password`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordForm.password }),
    });
    setPasswordForm({ userId: 0, password: "" });
    setError("Password aggiornata correttamente");
  }

  async function submitRefueling(form: FormData) {
    await api("/api/refuelings", token, { method: "POST", body: form });
    await loadAll();
  }

  async function addRefueling(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await submitRefueling(form);
    e.currentTarget.reset();
  }

  async function addRefuelingFromVehicle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedVehicleId) {
      setError("Seleziona un mezzo");
      return;
    }
    const form = new FormData(e.currentTarget);
    form.set("vehicleId", String(selectedVehicleId));
    await submitRefueling(form);
    e.currentTarget.reset();
    setTab("rifornimenti");
  }

  function openPrintableReport() {
    const vehicleName = filterVehicleId
      ? vehicles.find((v) => v.id === filterVehicleId)?.code || String(filterVehicleId)
      : "Tutti i mezzi";
    const htmlRows = sortedRefuelings
      .map(
        (r) => `<tr>
      <td>${new Date(r.refuelAt).toLocaleString()}</td>
      <td>${r.vehicleCode} (${r.plate})</td>
      <td>${r.odometerKm.toFixed(0)}</td>
      <td>${r.liters.toFixed(2)}</td>
      <td>€ ${r.amount.toFixed(2)}</td>
      <td>${(r.consumptionL100km || 0).toFixed(2)}</td>
    </tr>`
      )
      .join("");

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>Report rifornimenti</title>
      <style>
        body{font-family:Arial;padding:24px} table{width:100%;border-collapse:collapse}
        th,td{border:1px solid #ccc;padding:6px;font-size:12px} h1{margin-bottom:0}
      </style></head>
      <body>
        <h1>Report rifornimenti</h1>
        <p>Mezzo: ${vehicleName} | Periodo: ${fromDate} - ${toDate}</p>
        <p>Totale litri: <b>${reportStats.totalLiters.toFixed(2)}</b> | Totale spesa: <b>€ ${reportStats.totalAmount.toFixed(2)}</b> | Consumo medio: <b>${reportStats.avgCons.toFixed(2)} l/100km</b></p>
        <table><thead><tr><th>Data</th><th>Mezzo</th><th>Km</th><th>Litri</th><th>Importo</th><th>Consumo l/100km</th></tr></thead><tbody>${htmlRows}</tbody></table>
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
  }

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
          {TABS.filter((t) => !(t === "utenti" && user.role !== "admin")).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 ${tab === t ? "bg-orange-500 text-black" : "bg-slate-800"}`}>
              {t}
            </button>
          ))}
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

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
              <h3 className="mb-2 font-semibold">Selezione mezzo per rifornimento rapido</h3>
              <select value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(Number(e.target.value))} className="mb-3 w-full rounded bg-slate-950 p-2">
                <option value={0}>Seleziona mezzo</option>
                {vehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.code} - {v.plate}</option>)}
              </select>
              {(user.role === "admin" || user.role === "technician") && (
                <form onSubmit={addRefuelingFromVehicle} className="grid gap-2">
                  <input name="refuelAt" type="datetime-local" required className="rounded bg-slate-950 p-2" />
                  <input name="odometerKm" type="number" min="0" required className="rounded bg-slate-950 p-2" placeholder="Chilometraggio" />
                  <input name="liters" type="number" min="0.01" step="0.01" required className="rounded bg-slate-950 p-2" placeholder="Litri" />
                  <input name="amount" type="number" min="0" step="0.01" required className="rounded bg-slate-950 p-2" placeholder="Importo" />
                  <select name="sourceType" className="rounded bg-slate-950 p-2"><option value="card">Carta carburante</option><option value="tank">Cisterna</option></select>
                  <input name="sourceIdentifier" required list="sourcesQuick" className="rounded bg-slate-950 p-2" placeholder="ID carta/cisterna" />
                  <input name="receipt" type="file" className="rounded bg-slate-950 p-2" />
                  <datalist id="sourcesQuick">{sources.map((s) => <option key={s.id} value={s.identifier} />)}</datalist>
                  <button className="rounded bg-orange-500 px-3 py-2 font-semibold text-black">Salva rifornimento rapido</button>
                </form>
              )}
            </div>

            {user.role === "admin" && (
              <form onSubmit={addVehicle} className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-4">
                <h3 className="font-semibold">Nuovo mezzo</h3>
                <input required placeholder="Codice" value={vehicleForm.code} onChange={(e) => setVehicleForm({ ...vehicleForm, code: e.target.value })} className="rounded bg-slate-950 p-2" />
                <input required placeholder="Targa" value={vehicleForm.plate} onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value })} className="rounded bg-slate-950 p-2" />
                <input required placeholder="Modello" value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })} className="rounded bg-slate-950 p-2" />
                <input placeholder="Descrizione" value={vehicleForm.description} onChange={(e) => setVehicleForm({ ...vehicleForm, description: e.target.value })} className="rounded bg-slate-950 p-2" />
                <button className="rounded bg-orange-500 px-3 py-2 font-semibold text-black">Aggiungi mezzo</button>
              </form>
            )}
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            {filteredVehicles.map((v) => <div key={v.id} className="border-b border-slate-800 py-2 text-sm">{v.code} • {v.model} ({v.plate}) {v.active ? "" : "[DISATTIVO]"}</div>)}
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
          <div className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-4">
            <select value={filterVehicleId} onChange={(e) => setFilterVehicleId(Number(e.target.value))} className="rounded bg-slate-950 p-2">
              <option value={0}>Tutti i mezzi</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.code} - {v.plate}</option>)}
            </select>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded bg-slate-950 p-2" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded bg-slate-950 p-2" />
            <div className="flex gap-2">
              <button onClick={() => loadRefuelings(token, filterVehicleId)} className="rounded bg-slate-700 px-3 py-2">Filtra</button>
              <button onClick={openPrintableReport} className="rounded bg-orange-500 px-3 py-2 font-semibold text-black">Export PDF</button>
            </div>
          </div>

          {(user.role === "admin" || user.role === "technician") && (
            <form onSubmit={addRefueling} className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-2">
              <select name="vehicleId" required className="rounded bg-slate-950 p-2"><option value="">Seleziona mezzo</option>{vehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.code} - {v.plate}</option>)}</select>
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
        </section>
      )}

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm">
            Totale litri: <b>{reportStats.totalLiters.toFixed(2)}</b> • Spesa: <b>€ {reportStats.totalAmount.toFixed(2)}</b> • Consumo medio: <b>{reportStats.avgCons.toFixed(2)} l/100km</b>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "date_desc" | "date_asc" | "cons_desc")} className="ml-3 rounded bg-slate-950 p-1">
              <option value="date_desc">Ordinamento: data desc</option>
              <option value="date_asc">Ordinamento: data asc</option>
              <option value="cons_desc">Ordinamento: consumo alto</option>
            </select>
          </div>

          <div className="overflow-auto rounded-xl border border-slate-700 bg-slate-900 p-2">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left"><th>Data</th><th>Mezzo</th><th>Km</th><th>Litri</th><th>Importo</th><th>Consumo</th><th>Ricevuta</th></tr></thead>
              <tbody>
                {sortedRefuelings.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td>{new Date(r.refuelAt).toLocaleString()}</td><td>{r.vehicleCode} ({r.plate})</td><td>{r.odometerKm}</td><td>{r.liters.toFixed(2)}</td><td>€ {r.amount.toFixed(2)}</td><td>{r.consumptionL100km ? r.consumptionL100km.toFixed(2) : "-"}</td>
                    <td>{r.receiptKey ? <a className="text-orange-400" target="_blank" rel="noreferrer" href={`/api/receipt?key=${encodeURIComponent(r.receiptKey)}`}>Apri</a> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "utenti" && user.role === "admin" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h3 className="mb-3 font-semibold">Admin panel utenti</h3>
            {users.map((u) => (
              <div key={u.id} className="mb-2 grid gap-2 border-b border-slate-800 pb-2 md:grid-cols-5">
                <div className="text-sm">{u.username}</div>
                <select defaultValue={u.role} onChange={(e) => saveUser(u, e.target.value as Role, u.active === 1)} className="rounded bg-slate-950 p-2 text-sm">
                  <option value="admin">admin</option>
                  <option value="technician">technician</option>
                  <option value="accounting">accounting</option>
                </select>
                <button onClick={() => saveUser(u, u.role, u.active !== 1)} className="rounded bg-slate-700 px-2 py-1 text-sm">{u.active ? "Disattiva" : "Attiva"}</button>
                <div className="text-xs text-slate-400">Creato: {new Date(u.created_at).toLocaleDateString()}</div>
                <div className="text-xs">stato: {u.active ? "attivo" : "disattivo"}</div>
              </div>
            ))}
          </div>

          <form onSubmit={updatePassword} className="max-w-xl space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h4 className="font-semibold">Modifica password utente</h4>
            <select value={passwordForm.userId} onChange={(e) => setPasswordForm({ ...passwordForm, userId: Number(e.target.value) })} className="w-full rounded bg-slate-950 p-2">
              <option value={0}>Seleziona utente</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
            <input type="password" minLength={6} required value={passwordForm.password} onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value })} className="w-full rounded bg-slate-950 p-2" placeholder="Nuova password (min 6)" />
            <button className="rounded bg-orange-500 px-3 py-2 font-semibold text-black">Aggiorna password</button>
          </form>
        </section>
      )}
    </main>
  );
}
