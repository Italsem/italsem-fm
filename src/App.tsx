import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

type Role = "admin" | "technician" | "accounting";
type User = { userId: number; username: string; role: Role };
type Vehicle = {
  id: number;
  code: string;
  plate: string;
  model: string;
  description?: string;
  photo_key?: string | null;
  active: number;
};
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
type DeadlineType = "bollo" | "revisione" | "rca";

type VehicleDetail = {
  vehicle: Vehicle;
  deadlines: Array<{ deadlineType: DeadlineType; dueDate: string }>;
  history: Array<{ id: number; refuelAt: string; odometerKm: number; liters: number; amount: number; sourceType: string; consumptionL100km?: number }>;
};

type Dashboard = {
  totalLiters: number;
  totalAmount: number;
  avgConsumption: number;
  highConsumption: Array<{ code: string; plate: string; model: string; avgConsumption: number }>;
  monthly: Array<{ month: string; liters: number; amount: number }>;
  compare: Array<{ code: string; plate: string; avgConsumption: number }>;
};

type DeadlineSummary = { valid: number; warning: number; expired: number; total: number };

type ApiErr = { ok?: boolean; error?: string; token?: string };

const TABS = ["Dashboard", "Mezzi", "Rifornimenti", "Utenti"] as const;
type Tab = (typeof TABS)[number];

function parseApiJsonOrThrow(raw: string, url: string): ApiErr {
  try {
    return JSON.parse(raw) as ApiErr;
  } catch {
    const snippet = raw.slice(0, 140).replace(/\s+/g, " ");
    if (snippet.toLowerCase().includes("<!doctype") || snippet.toLowerCase().includes("<html")) {
      throw new Error(`L'Endpoint ${url} Non Risponde JSON. Verifica Le Route /Api/* E Le Functions Cloudflare.`);
    }
    throw new Error(`Risposta Non JSON Da ${url}: ${snippet}`);
  }
}

async function api<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
  });
  const data = parseApiJsonOrThrow(await res.text(), url);
  if (!res.ok || !data.ok) throw new Error(data.error || `Errore API (${res.status})`);
  return data as T;
}

function daysTo(dueDate: string) {
  const now = new Date();
  const due = new Date(`${dueDate}T23:59:59`);
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function deadlineState(dueDate?: string) {
  if (!dueDate) return { color: "bg-slate-500", label: "Non Impostata" };
  const d = daysTo(dueDate);
  if (d < 0) return { color: "bg-red-500", label: "Scaduta" };
  if (d <= 30) return { color: "bg-orange-500", label: "In Scadenza" };
  return { color: "bg-green-500", label: "Valida" };
}

function quickDate(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function MiniBars({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label}>
          <div className="mb-1 flex justify-between text-xs"><span>{d.label}</span><span>{d.value.toFixed(2)}</span></div>
          <div className="h-2 rounded bg-slate-700"><div className="h-2 rounded bg-orange-500" style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [error, setError] = useState("");

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [sources, setSources] = useState<FuelSource[]>([]);
  const [refuelings, setRefuelings] = useState<Refueling[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [users, setUsers] = useState<UserAdmin[]>([]);
  const [deadlineSummary, setDeadlineSummary] = useState<DeadlineSummary>({ valid: 0, warning: 0, expired: 0, total: 0 });

  const [search, setSearch] = useState("");
  const [filterVehicleId, setFilterVehicleId] = useState<number>(0);
  const [fromDate, setFromDate] = useState(quickDate(30));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "cons_desc">("date_desc");

  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin123" });
  const [vehicleForm, setVehicleForm] = useState({ code: "", plate: "", model: "", description: "" });
  const [sourceForm, setSourceForm] = useState({ sourceType: "card", identifier: "" });
  const [passwordForm, setPasswordForm] = useState({ userId: 0, password: "" });

  const [modalOpen, setModalOpen] = useState(false);
  const [vehicleDetail, setVehicleDetail] = useState<VehicleDetail | null>(null);
  const [editVehicleForm, setEditVehicleForm] = useState({ model: "", description: "" });
  const [deadlineForm, setDeadlineForm] = useState<Record<DeadlineType, string>>({ bollo: "", revisione: "", rca: "" });

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
      const [v, s, d, ds] = await Promise.all([
        api<{ data: Vehicle[] }>(`/api/vehicles?search=${encodeURIComponent(search)}&active=all`, currentToken),
        api<{ data: FuelSource[] }>("/api/fuel-sources", currentToken),
        api<{ data: Dashboard }>("/api/dashboard", currentToken),
        api<{ data: DeadlineSummary }>("/api/deadlines/summary", currentToken),
      ]);
      setVehicles(v.data);
      setSources(s.data.filter((x) => x.active));
      setDashboard(d.data);
      setDeadlineSummary(ds.data);
      await loadRefuelings(currentToken);
      if (me.user.role === "admin") {
        const u = await api<{ data: UserAdmin[] }>("/api/users", currentToken);
        setUsers(u.data);
      }
      setError("");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Errore";
      if (message.toLowerCase().includes("/api/") && message.toLowerCase().includes("html")) {
        localStorage.removeItem("token");
        setToken("");
        setUser(null);
      }
      setError(message);
    }
  }, [token, search, loadRefuelings]);

  useEffect(() => { loadAll(); }, [loadAll]);

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

  async function openVehicleModal(id: number) {
    const d = await api<{ data: VehicleDetail }>(`/api/vehicles/${id}`, token);
    setVehicleDetail(d.data);
    setEditVehicleForm({ model: d.data.vehicle.model, description: d.data.vehicle.description || "" });
    const map = { bollo: "", revisione: "", rca: "" } as Record<DeadlineType, string>;
    d.data.deadlines.forEach((x) => { map[x.deadlineType] = x.dueDate; });
    setDeadlineForm(map);
    setModalOpen(true);
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(loginForm) });
      const data = parseApiJsonOrThrow(await res.text(), "/api/auth/login");
      if (!res.ok || !data.ok || !data.token) throw new Error(data.error || "Login Fallito");
      localStorage.setItem("token", data.token);
      setToken(data.token);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Errore"); }
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
    await api("/api/users", token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, role, active }) });
    await loadAll();
  }
  async function updatePassword(e: FormEvent) {
    e.preventDefault();
    await api(`/api/users/${passwordForm.userId}/password`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: passwordForm.password }) });
    setPasswordForm({ userId: 0, password: "" });
    setError("Password Aggiornata Correttamente");
  }
  async function submitRefueling(form: FormData) {
    await api("/api/refuelings", token, { method: "POST", body: form });
    await loadAll();
  }
  async function addRefueling(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const form = new FormData(e.currentTarget); await submitRefueling(form); e.currentTarget.reset(); }
  async function saveVehicleDetails(e: FormEvent) {
    e.preventDefault();
    if (!vehicleDetail) return;
    await api(`/api/vehicles/${vehicleDetail.vehicle.id}`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editVehicleForm) });
    await api(`/api/vehicles/${vehicleDetail.vehicle.id}/deadlines`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(deadlineForm) });
    await openVehicleModal(vehicleDetail.vehicle.id);
    await loadAll();
  }

  async function uploadVehiclePhoto(file: File) {
    if (!vehicleDetail) return;
    const form = new FormData();
    form.append("photo", file);
    await api(`/api/vehicles/${vehicleDetail.vehicle.id}/photo`, token, { method: "POST", body: form });
    await openVehicleModal(vehicleDetail.vehicle.id);
    await loadAll();
  }

  function exportVehicleHistoryPdf() {
    if (!vehicleDetail) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const rows = vehicleDetail.history.map((h) => `<tr><td>${new Date(h.refuelAt).toLocaleString()}</td><td>${h.odometerKm}</td><td>${h.liters.toFixed(2)}</td><td>${h.amount.toFixed(2)}</td><td>${(h.consumptionL100km || 0).toFixed(2)}</td></tr>`).join("");
    w.document.write(`<html><body><h1>Storico Rifornimenti ${vehicleDetail.vehicle.code}</h1><table border='1' cellpadding='6' cellspacing='0'><tr><th>Data</th><th>Km</th><th>Litri</th><th>Importo</th><th>Consumo</th></tr>${rows}</table></body></html>`);
    w.document.close();
    w.print();
  }

  if (!token || !user) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <form onSubmit={onLogin} className="mx-auto mt-20 max-w-md space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
          <h1 className="text-2xl font-bold">Accesso</h1>
          <input className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2" placeholder="Username" autoComplete="username" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
          <input type="password" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2" placeholder="Password" autoComplete="current-password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
          <button className="rounded-lg bg-orange-500 px-4 py-2 font-semibold text-black">Login</button>
          {error && <p className="text-sm text-red-300">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h1 className="text-2xl font-bold">Italsem FM - {user.role}</h1>
        <div className="space-x-2">{TABS.filter((t) => !(t === "Utenti" && user.role !== "admin")).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === t ? "bg-orange-500 text-black" : "bg-slate-800"}`}>{t}</button>)}<button onClick={() => { localStorage.removeItem("token"); setToken(""); setUser(null); }} className="rounded-lg bg-slate-700 px-3 py-2">Logout</button></div>
      </header>
      {error && <div className="rounded border border-red-700 bg-red-950 p-2 text-red-300">{error}</div>}

      {error && <div className="mb-4 rounded-lg border border-red-600 bg-red-900/40 p-2 text-red-200">{error}</div>}

      {tab === "Dashboard" && dashboard && (
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">Litri Totali: <b>{dashboard.totalLiters.toFixed(2)}</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">Spesa Totale: <b>EUR {dashboard.totalAmount.toFixed(2)}</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">Consumo Medio: <b>{dashboard.avgConsumption.toFixed(2)} L/100Km</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 md:col-span-3">
            <h3 className="mb-2 font-semibold">Riepilogo Scadenze</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-green-500" />Valide: {deadlineSummary.valid}</span>
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-orange-500" />In Scadenza: {deadlineSummary.warning}</span>
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-red-500" />Scadute: {deadlineSummary.expired}</span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="mb-2 font-semibold">Litri Mensili</h3><MiniBars data={dashboard.monthly.map((m) => ({ label: m.month, value: m.liters }))} /></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 md:col-span-2"><h3 className="mb-2 font-semibold">Confronto Consumi Mezzi</h3><MiniBars data={dashboard.compare.map((c) => ({ label: `${c.code}/${c.plate}`, value: c.avgConsumption }))} /></div>
        </section>
      )}

      {tab === "Mezzi" && (
        <section className="space-y-4">
          <input className="rounded-lg border border-slate-700 bg-slate-900 p-2" placeholder="Ricerca Mezzi" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filteredVehicles.map((v) => (
              <button key={v.id} onClick={() => openVehicleModal(v.id)} className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-left hover:border-orange-500">
                <div className="mb-2 flex items-center gap-3">
                  {v.photo_key ? <img src={`/api/photo?key=${encodeURIComponent(v.photo_key)}`} className="h-12 w-12 rounded-full object-cover" /> : <div className="h-12 w-12 rounded-full bg-slate-700" />}
                  <div>
                    <div className="font-semibold">{v.code} ({v.plate})</div>
                    <div className="text-sm text-slate-300">{v.model}</div>
                  </div>
                </div>
                <div className="text-xs text-slate-400">{v.description || "Nessuna Descrizione"}</div>
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {user.role === "admin" && <form onSubmit={addVehicle} className="space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Nuovo Mezzo</h3><input required className="w-full rounded bg-slate-950 p-2" placeholder="Codice" value={vehicleForm.code} onChange={(e) => setVehicleForm({ ...vehicleForm, code: e.target.value })} /><input required className="w-full rounded bg-slate-950 p-2" placeholder="Targa" value={vehicleForm.plate} onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value })} /><input required className="w-full rounded bg-slate-950 p-2" placeholder="Modello" value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })} /><input className="w-full rounded bg-slate-950 p-2" placeholder="Descrizione" value={vehicleForm.description} onChange={(e) => setVehicleForm({ ...vehicleForm, description: e.target.value })} /><button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black">Aggiungi Mezzo</button></form>}
            {user.role === "admin" && <form onSubmit={addSource} className="space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Nuova Carta/Cisterna</h3><select className="w-full rounded bg-slate-950 p-2" value={sourceForm.sourceType} onChange={(e) => setSourceForm({ ...sourceForm, sourceType: e.target.value })}><option value="card">Carta Carburante</option><option value="tank">Cisterna</option></select><input className="w-full rounded bg-slate-950 p-2" placeholder="Identificativo" value={sourceForm.identifier} onChange={(e) => setSourceForm({ ...sourceForm, identifier: e.target.value })} /><button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black">Salva</button></form>}
          </div>
        </section>
      )}

      {tab === "Rifornimenti" && (
        <section className="space-y-4">
          <div className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-4"><select value={filterVehicleId} onChange={(e) => setFilterVehicleId(Number(e.target.value))} className="rounded bg-slate-950 p-2"><option value={0}>Tutti I Mezzi</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.code} - {v.plate}</option>)}</select><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded bg-slate-950 p-2" /><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded bg-slate-950 p-2" /><button onClick={() => loadRefuelings(token, filterVehicleId)} className="rounded-lg bg-slate-700 px-3 py-2">Filtra</button></div>
          {(user.role === "admin" || user.role === "technician") && <form onSubmit={addRefueling} className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-2"><select name="vehicleId" required className="rounded bg-slate-950 p-2"><option value="">Seleziona Mezzo</option>{vehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.code} - {v.plate}</option>)}</select><input name="refuelAt" type="datetime-local" required className="rounded bg-slate-950 p-2" /><input name="odometerKm" type="number" min="0" required className="rounded bg-slate-950 p-2" placeholder="Chilometraggio" /><input name="liters" type="number" min="0.01" step="0.01" required className="rounded bg-slate-950 p-2" placeholder="Litri" /><input name="amount" type="number" min="0" step="0.01" required className="rounded bg-slate-950 p-2" placeholder="Importo" /><select name="sourceType" className="rounded bg-slate-950 p-2"><option value="card">Carta Carburante</option><option value="tank">Cisterna</option></select><input name="sourceIdentifier" required list="sources" className="rounded bg-slate-950 p-2" placeholder="ID Carta/Cisterna" /><input name="receipt" type="file" className="rounded bg-slate-950 p-2" /><datalist id="sources">{sources.map((s) => <option key={s.id} value={s.identifier} />)}</datalist><button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black md:col-span-2">Registra Rifornimento</button></form>}
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><select value={sortBy} onChange={(e) => setSortBy(e.target.value as "date_desc" | "date_asc" | "cons_desc")} className="rounded bg-slate-950 p-2"><option value="date_desc">Data Desc</option><option value="date_asc">Data Asc</option><option value="cons_desc">Consumo Alto</option></select><div className="mt-2 overflow-auto"><table className="min-w-full text-sm"><thead><tr><th className="text-left">Data</th><th className="text-left">Mezzo</th><th className="text-left">Km</th><th className="text-left">Litri</th><th className="text-left">Importo</th><th className="text-left">Consumo</th></tr></thead><tbody>{sortedRefuelings.map((r) => <tr key={r.id} className="border-t border-slate-800"><td>{new Date(r.refuelAt).toLocaleString()}</td><td>{r.vehicleCode}</td><td>{r.odometerKm}</td><td>{r.liters.toFixed(2)}</td><td>EUR {r.amount.toFixed(2)}</td><td>{r.consumptionL100km ? r.consumptionL100km.toFixed(2) : "-"}</td></tr>)}</tbody></table></div></div>
        </section>
      )}

      {tab === "Utenti" && user.role === "admin" && <section className="space-y-4"><div className="rounded-xl border border-slate-700 bg-slate-900 p-4">{users.map((u) => <div key={u.id} className="mb-2 grid gap-2 border-b border-slate-800 pb-2 md:grid-cols-5"><div>{u.username}</div><select defaultValue={u.role} onChange={(e) => saveUser(u, e.target.value as Role, u.active === 1)} className="rounded bg-slate-950 p-2"><option value="admin">Admin</option><option value="technician">Technician</option><option value="accounting">Accounting</option></select><button onClick={() => saveUser(u, u.role, u.active !== 1)} className="rounded bg-slate-700 px-2 py-1">{u.active ? "Disattiva" : "Attiva"}</button><div>{new Date(u.created_at).toLocaleDateString()}</div><div>{u.active ? "Attivo" : "Disattivo"}</div></div>)}</div><form onSubmit={updatePassword} className="max-w-xl space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4"><h4 className="font-semibold">Modifica Password Utente</h4><select value={passwordForm.userId} onChange={(e) => setPasswordForm({ ...passwordForm, userId: Number(e.target.value) })} className="w-full rounded bg-slate-950 p-2"><option value={0}>Seleziona Utente</option>{users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}</select><input type="password" minLength={6} required value={passwordForm.password} onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value })} className="w-full rounded bg-slate-950 p-2" placeholder="Nuova Password (Min 6)" /><button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black">Aggiorna Password</button></form></section>}

      {modalOpen && vehicleDetail && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-bold">Dettaglio Mezzo {vehicleDetail.vehicle.code} ({vehicleDetail.vehicle.plate})</h2><button className="rounded bg-slate-700 px-3 py-1" onClick={() => setModalOpen(false)}>Chiudi</button></div>
            <form onSubmit={saveVehicleDetails} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm">Modello</label>
                <input className="w-full rounded bg-slate-950 p-2" value={editVehicleForm.model} onChange={(e) => setEditVehicleForm({ ...editVehicleForm, model: e.target.value })} />
                <label className="text-sm">Descrizione</label>
                <textarea className="w-full rounded bg-slate-950 p-2" value={editVehicleForm.description} onChange={(e) => setEditVehicleForm({ ...editVehicleForm, description: e.target.value })} />
                <div className="rounded border border-slate-700 p-3">
                  <h3 className="mb-2 font-semibold">Scadenze</h3>
                  {(["bollo", "revisione", "rca"] as DeadlineType[]).map((t) => {
                    const st = deadlineState(deadlineForm[t]);
                    return (
                      <div key={t} className="mb-2 flex items-center gap-2">
                        <span className={`h-3 w-3 rounded-full ${st.color}`} />
                        <label className="w-24 capitalize">{t}</label>
                        <input type="date" className="rounded bg-slate-950 p-2" value={deadlineForm[t]} onChange={(e) => setDeadlineForm({ ...deadlineForm, [t]: e.target.value })} />
                        <span className="text-xs text-slate-300">{st.label}</span>
                      </div>
                    );
                  })}
                </div>
                {user.role === "admin" && <button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black">Salva Dati Mezzo</button>}
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">Foto Mezzo</h3>
                {vehicleDetail.vehicle.photo_key ? <img src={`/api/photo?key=${encodeURIComponent(vehicleDetail.vehicle.photo_key)}`} className="h-44 w-full rounded object-cover" /> : <div className="h-44 rounded bg-slate-800" />}
                {user.role === "admin" && <input type="file" accept="image/*" className="w-full rounded bg-slate-950 p-2" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVehiclePhoto(f); }} />}

                <div className="mt-3 rounded border border-slate-700 p-3">
                  <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Storico Rifornimenti</h3><button type="button" onClick={exportVehicleHistoryPdf} className="rounded bg-orange-500 px-2 py-1 text-sm font-semibold text-black">Export PDF</button></div>
                  <div className="max-h-52 overflow-auto text-sm">
                    <table className="min-w-full"><thead><tr><th className="text-left">Data</th><th className="text-left">Litri</th><th className="text-left">Importo</th><th className="text-left">Consumo</th></tr></thead><tbody>{vehicleDetail.history.map((h) => <tr key={h.id} className="border-t border-slate-800"><td>{new Date(h.refuelAt).toLocaleDateString()}</td><td>{h.liters.toFixed(2)}</td><td>EUR {h.amount.toFixed(2)}</td><td>{(h.consumptionL100km || 0).toFixed(2)}</td></tr>)}</tbody></table>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
