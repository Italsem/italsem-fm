import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import * as XLSX from "xlsx";

type Role = "admin" | "technician" | "accounting";
type User = { userId: number; username: string; role: Role };
type Vehicle = {
  id: number;
  code: string;
  plate: string;
  model: string;
  description?: string;
  photo_key?: string | null;
  deadlineValid?: number;
  deadlineWarning?: number;
  deadlineExpired?: number;
  active: number;
};
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
  sourceAssignedTo?: string | null;
  receiptKey?: string;
  consumptionKmL?: number | null;
  distanceKm?: number | null;
  consumptionL100km?: number;
};
type FuelSource = { id: number; sourceType: "card" | "tank"; identifier: string; assignedTo?: string | null; active: number };
type UserAdmin = { id: number; username: string; role: Role; active: number; created_at: string };
type DeadlineType = "bollo" | "revisione" | "rca" | "tachigrafo" | "periodica_gru" | "strutturale";
type VehicleDocumentType = "libretto" | "rca" | "revisione" | "bollo" | "altro";

const BASE_DEADLINE_TYPES: DeadlineType[] = ["bollo", "revisione", "rca"];
const OPTIONAL_DEADLINE_TYPES: DeadlineType[] = ["tachigrafo", "periodica_gru", "strutturale"];
const DEADLINE_LABELS: Record<DeadlineType, string> = {
  bollo: "Bollo",
  revisione: "Revisione",
  rca: "RCA",
  tachigrafo: "Tachigrafo",
  periodica_gru: "Periodica Gru",
  strutturale: "Strutturale",
};

const DOCUMENT_TYPE_LABELS: Record<VehicleDocumentType, string> = {
  libretto: "Libretto",
  rca: "RCA",
  revisione: "Revisione",
  bollo: "Bollo",
  altro: "Altro",
};

type VehicleDetail = {
  vehicle: Vehicle & { lastOdometerKm?: number | null };
  deadlines: Array<{ deadlineType: DeadlineType; dueDate: string }>;
  history: Array<{ id: number; refuelAt: string; odometerKm: number; liters: number; amount: number; sourceType: string; sourceIdentifier?: string; distanceKm?: number | null; consumptionKmL?: number | null; consumptionL100km?: number }>;
  documents: Array<{ id: number; docType: VehicleDocumentType; fileName: string; fileKey: string; mimeType?: string | null; createdAt: string }>;
};

type Dashboard = {
  totalLiters: number;
  totalAmount: number;
  avgConsumption: number;
  totalDistanceKm?: number;
  highConsumption: Array<{ code: string; plate: string; model: string; avgConsumption: number }>;
  monthly: Array<{ month: string; liters: number; amount: number; distanceKm?: number }>;
  compare: Array<{ code: string; plate: string; avgConsumption: number }>;
};

type DeadlineSummary = { valid: number; warning: number; expired: number; total: number };

type ApiErr = { ok?: boolean; error?: string; token?: string };

const TABS = ["Dashboard", "Mezzi", "Rifornimenti", "Carte", "Utenti"] as const;
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

function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseExcelDate(value: unknown): string {
  if (typeof value === "number") {
    const dateCode = XLSX.SSF.parse_date_code(value);
    if (!dateCode) return "";
    const y = String(dateCode.y).padStart(4, "0");
    const m = String(dateCode.m).padStart(2, "0");
    const d = String(dateCode.d).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return "";
}

function findExcelValue(row: Record<string, unknown>, aliases: string[]) {
  const keys = Object.keys(row);
  const map = new Map(keys.map((k) => [k.trim().toLowerCase(), k]));
  for (const alias of aliases) {
    const key = map.get(alias.toLowerCase());
    if (key) return row[key];
  }
  return "";
}

function parseNumberish(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function last4Digits(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-4);
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
  const [fuelSources, setFuelSources] = useState<FuelSource[]>([]);
  const [refuelings, setRefuelings] = useState<Refueling[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [users, setUsers] = useState<UserAdmin[]>([]);
  const [deadlineSummary, setDeadlineSummary] = useState<DeadlineSummary>({ valid: 0, warning: 0, expired: 0, total: 0 });

  const [search, setSearch] = useState("");
  const [filterVehicleId, setFilterVehicleId] = useState<number>(0);
  const [filterSourceIdentifier, setFilterSourceIdentifier] = useState("");
  const [fromDate, setFromDate] = useState(quickDate(30));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "cons_desc">("date_desc");

  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin123" });
  const [vehicleForm, setVehicleForm] = useState({ code: "", plate: "", model: "", description: "" });
  const [sourceForm, setSourceForm] = useState({ sourceType: "card", identifier: "", assignedTo: "" });
  const [passwordForm, setPasswordForm] = useState({ userId: 0, password: "" });
  const [newUserForm, setNewUserForm] = useState<{ username: string; password: string; role: "admin" | "technician" }>({ username: "", password: "", role: "technician" });

  const [modalOpen, setModalOpen] = useState(false);
  const [vehicleDetail, setVehicleDetail] = useState<VehicleDetail | null>(null);
  const [editVehicleForm, setEditVehicleForm] = useState({ code: "", plate: "", model: "", description: "" });
  const [deadlineForm, setDeadlineForm] = useState<Record<DeadlineType, string>>({ bollo: "", revisione: "", rca: "", tachigrafo: "", periodica_gru: "", strutturale: "" });
  const [enabledOptionalDeadlines, setEnabledOptionalDeadlines] = useState<DeadlineType[]>([]);
  const [excelImportFile, setExcelImportFile] = useState<File | null>(null);
  const [excelImporting, setExcelImporting] = useState(false);
  const [documentType, setDocumentType] = useState<VehicleDocumentType>("libretto");
  const [refuelSourceType, setRefuelSourceType] = useState<"card" | "tank">("card");
  const [refuelImportFile, setRefuelImportFile] = useState<File | null>(null);
  const [refuelImportVehicleId, setRefuelImportVehicleId] = useState<number>(0);
  const [refuelImporting, setRefuelImporting] = useState(false);

  const loadRefuelings = useCallback(async (currentToken: string, vehicleId = filterVehicleId) => {
    const params = new URLSearchParams();
    if (vehicleId > 0) params.set("vehicleId", String(vehicleId));
    if (filterSourceIdentifier) params.set("sourceIdentifier", filterSourceIdentifier);
    if (fromDate) params.set("from", `${fromDate}T00:00`);
    if (toDate) params.set("to", `${toDate}T23:59`);
    const r = await api<{ data: Refueling[] }>(`/api/refuelings?${params.toString()}`, currentToken);
    setRefuelings(r.data);
  }, [filterVehicleId, filterSourceIdentifier, fromDate, toDate]);

  const loadAll = useCallback(async (currentToken = token) => {
    if (!currentToken) return;
    try {
      const me = await api<{ user: User }>("/api/auth/me", currentToken);
      setUser(me.user);
      const [v, d, ds, s] = await Promise.all([
        api<{ data: Vehicle[] }>(`/api/vehicles?search=${encodeURIComponent(search)}&active=all`, currentToken),
        api<{ data: Dashboard }>(`/api/dashboard?from=${fromDate}T00:00&to=${toDate}T23:59`, currentToken),
        api<{ data: DeadlineSummary }>("/api/deadlines/summary", currentToken),
        api<{ data: FuelSource[] }>("/api/fuel-sources", currentToken),
      ]);
      setVehicles(v.data);
      setFuelSources(s.data);
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
  }, [token, search, fromDate, toDate, loadRefuelings]);

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
    if (sortBy === "cons_desc") rows.sort((a, b) => (b.consumptionKmL || 0) - (a.consumptionKmL || 0));
    return rows;
  }, [refuelings, sortBy]);

  const cards = useMemo(() => fuelSources.filter((x) => x.sourceType === "card"), [fuelSources]);
  const tanks = useMemo(() => fuelSources.filter((x) => x.sourceType === "tank"), [fuelSources]);

  async function openVehicleModal(id: number) {
    const d = await api<{ data: VehicleDetail }>(`/api/vehicles/${id}`, token);
    setVehicleDetail(d.data);
    setEditVehicleForm({ code: d.data.vehicle.code, plate: d.data.vehicle.plate, model: d.data.vehicle.model, description: d.data.vehicle.description || "" });
    const map = { bollo: "", revisione: "", rca: "", tachigrafo: "", periodica_gru: "", strutturale: "" } as Record<DeadlineType, string>;
    d.data.deadlines.forEach((x) => { map[x.deadlineType] = x.dueDate; });
    setDeadlineForm(map);
    setEnabledOptionalDeadlines(OPTIONAL_DEADLINE_TYPES.filter((t) => Boolean(map[t])));
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
    setSourceForm({ sourceType: "card", identifier: "", assignedTo: "" });
    await loadAll();
  }

  async function deleteSource(id: number) {
    if (user?.role !== "admin") return;
    if (!window.confirm("Confermi la rimozione di questa carta/cisterna?")) return;
    await api(`/api/fuel-sources/${id}`, token, { method: "DELETE" });
    await loadAll();
    setError("Fonte rimossa correttamente");
  }
  async function importDeadlinesFromExcel(file: File) {
    setExcelImporting(true);
    try {
      const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error("File Excel vuoto o non valido");

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
    if (!rows.length) throw new Error("Nessuna riga trovata nel file Excel");

    const vehiclesForImport = await api<{ data: Vehicle[] }>("/api/vehicles?search=&active=all", token);
    const byPlate = new Map(vehiclesForImport.data.map((v) => [normalizePlate(v.plate), v]));
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const plateRaw = String(findExcelValue(row, ["targa", "plate"]) || "").trim();
      const plate = normalizePlate(plateRaw);
      if (!plate) { skipped += 1; continue; }
      const vehicle = byPlate.get(plate);
      if (!vehicle) { skipped += 1; continue; }

      const payload: Partial<Record<DeadlineType, string>> = {};
      const bollo = parseExcelDate(findExcelValue(row, ["bollo"]));
      const revisione = parseExcelDate(findExcelValue(row, ["revisione"]));
      const rca = parseExcelDate(findExcelValue(row, ["assicurazione", "rca"]));
      const tachigrafo = parseExcelDate(findExcelValue(row, ["tachigrafo", "tachifgrafo"]));
      const periodicaGru = parseExcelDate(findExcelValue(row, ["periodica gru", "periodica_gru", "gru"]));
      const strutturale = parseExcelDate(findExcelValue(row, ["strutturale"]));

      if (bollo) payload.bollo = bollo;
      if (revisione) payload.revisione = revisione;
      if (rca) payload.rca = rca;
      if (tachigrafo) payload.tachigrafo = tachigrafo;
      if (periodicaGru) payload.periodica_gru = periodicaGru;
      if (strutturale) payload.strutturale = strutturale;

      if (!Object.keys(payload).length) { skipped += 1; continue; }

      await api(`/api/vehicles/${vehicle.id}/deadlines`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      updated += 1;
    }

    await loadAll();
    setError(`Importazione Excel completata. Mezzi aggiornati: ${updated}. Righe saltate: ${skipped}.`);
    } finally {
      setExcelImporting(false);
    }
  }

  async function saveUser(u: UserAdmin, role: Role, active: boolean) {
    await api("/api/users", token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, role, active }) });
    await loadAll();
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    await api("/api/users", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newUserForm) });
    setNewUserForm({ username: "", password: "", role: "technician" });
    await loadAll();
    setError("Utente creato correttamente");
  }

  async function updateSourceAssignedTo(id: number, current: string | null | undefined) {
    if (user?.role !== "admin") return;
    const assignedTo = window.prompt("Nuovo utilizzatore", current || "");
    if (assignedTo === null) return;
    await api(`/api/fuel-sources/${id}`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignedTo }) });
    await loadAll();
  }

  async function importRefuelingsFromExcel(file: File) {
    if (!refuelImportVehicleId) {
      throw new Error("Seleziona il mezzo per l'importazione");
    }
    setRefuelImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error("File Excel non valido");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
      if (!rows.length) throw new Error("Nessuna riga nel file");

      const sortedRows = [...rows].sort((a, b) => {
        const da = parseExcelDate(findExcelValue(a, ["data"]));
        const db = parseExcelDate(findExcelValue(b, ["data"]));
        const ka = parseNumberish(findExcelValue(a, ["chilometraggio", "chilometrag", "km"]));
        const kb = parseNumberish(findExcelValue(b, ["chilometraggio", "chilometrag", "km"]));
        if (da !== db) return da.localeCompare(db);
        return ka - kb;
      });

      const sourceByLast4 = new Map<string, FuelSource>();
      for (const src of fuelSources.filter((x) => x.active)) {
        const last4 = last4Digits(src.identifier);
        if (last4) sourceByLast4.set(last4, src);
      }

      const existing = await api<{ data: Refueling[] }>(`/api/refuelings?vehicleId=${refuelImportVehicleId}&from=2000-01-01T00:00&to=2100-12-31T23:59`, token);
      const existingKeys = new Set(existing.data.map((r) => `${r.vehicleId}|${r.refuelAt.slice(0, 10)}|${Math.round(r.odometerKm)}|${r.sourceIdentifier}`));

      let imported = 0;
      let skipped = 0;
      for (const row of sortedRows) {
        const cardRaw = String(findExcelValue(row, ["n° carta", "n carta", "numero carta", "carta", "n. carta"]) || "").trim();
        const date = parseExcelDate(findExcelValue(row, ["data"]));
        const amount = parseNumberish(findExcelValue(row, ["importo"]));
        const odometerKm = parseNumberish(findExcelValue(row, ["chilometraggio", "chilometrag", "km"]));
        const liters = parseNumberish(findExcelValue(row, ["quantità", "quantita", "qta"]));

        const source = sourceByLast4.get(last4Digits(cardRaw));
        if (!source || !date || liters <= 0 || odometerKm <= 0 || amount < 0) {
          skipped += 1;
          continue;
        }

        const key = `${refuelImportVehicleId}|${date}|${Math.round(odometerKm)}|${source.identifier}`;
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }

        const form = new FormData();
        form.append("vehicleId", String(refuelImportVehicleId));
        form.append("refuelAt", date);
        form.append("odometerKm", String(odometerKm));
        form.append("liters", String(liters));
        form.append("amount", String(amount));
        form.append("sourceType", source.sourceType);
        form.append("sourceIdentifier", source.identifier);

        await api("/api/refuelings", token, { method: "POST", body: form });
        existingKeys.add(key);
        imported += 1;
      }

      await loadAll();
      setError(`Importazione rifornimenti completata. Importati: ${imported}. Saltati: ${skipped}.`);
    } finally {
      setRefuelImporting(false);
    }
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
  async function addRefueling(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    try {
      await submitRefueling(form);
      formEl.reset();
      setError("Rifornimento registrato correttamente");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore salvataggio rifornimento");
    }
  }

  async function editRefueling(r: Refueling) {
    if (user?.role !== "admin") return;
    const refuelAt = window.prompt("Data (YYYY-MM-DD)", r.refuelAt.slice(0, 10));
    if (!refuelAt) return;
    const odometerKm = Number(window.prompt("Chilometri", String(r.odometerKm)));
    const liters = Number(window.prompt("Litri", String(r.liters)));
    const amount = Number(window.prompt("Importo €", String(r.amount)));
    const sourceTypeInput = window.prompt("Fonte (card/tank)", r.sourceType) || r.sourceType;
    const sourceIdentifier = (window.prompt("ID Carta/Cisterna", r.sourceIdentifier) || "").trim().toUpperCase();
    const sourceType = sourceTypeInput === "tank" ? "tank" : "card";
    await api(`/api/refuelings/${r.id}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refuelAt, odometerKm, liters, amount, sourceType, sourceIdentifier }),
    });
    await loadRefuelings(token, filterVehicleId);
    setError("Rifornimento aggiornato");
  }

  async function deleteRefueling(id: number) {
    if (user?.role !== "admin") return;
    if (!window.confirm("Confermi eliminazione rifornimento?")) return;
    await api(`/api/refuelings/${id}`, token, { method: "DELETE" });
    await loadRefuelings(token, filterVehicleId);
    setError("Rifornimento eliminato");
  }
  async function saveVehicleDetails(e: FormEvent) {
    e.preventDefault();
    if (!vehicleDetail) return;
    await api(`/api/vehicles/${vehicleDetail.vehicle.id}`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editVehicleForm) });
    await api(`/api/vehicles/${vehicleDetail.vehicle.id}/deadlines`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(deadlineForm) });
    await openVehicleModal(vehicleDetail.vehicle.id);
    await loadAll();
  }

  async function deleteVehicle() {
    if (!vehicleDetail || user?.role !== "admin") return;
    if (!window.confirm(`Confermi l'eliminazione del mezzo ${vehicleDetail.vehicle.code} (${vehicleDetail.vehicle.plate})?`)) return;
    await api(`/api/vehicles/${vehicleDetail.vehicle.id}`, token, { method: "DELETE" });
    setModalOpen(false);
    setVehicleDetail(null);
    await loadAll();
    setError("Mezzo eliminato correttamente");
  }

  async function uploadVehiclePhoto(file: File) {
    if (!vehicleDetail) return;
    const form = new FormData();
    form.append("photo", file);
    await api(`/api/vehicles/${vehicleDetail.vehicle.id}/photo`, token, { method: "POST", body: form });
    await openVehicleModal(vehicleDetail.vehicle.id);
    await loadAll();
  }

  async function uploadVehicleDocument(file: File) {
    if (!vehicleDetail || user?.role !== "admin") return;
    const form = new FormData();
    form.append("file", file);
    form.append("docType", documentType);
    await api(`/api/vehicles/${vehicleDetail.vehicle.id}/documents`, token, { method: "POST", body: form });
    await openVehicleModal(vehicleDetail.vehicle.id);
    setError("Documento caricato correttamente");
  }

  async function deleteVehicleDocument(docId: number) {
    if (!vehicleDetail || user?.role !== "admin") return;
    await api(`/api/vehicles/${vehicleDetail.vehicle.id}/documents?docId=${docId}`, token, { method: "DELETE" });
    await openVehicleModal(vehicleDetail.vehicle.id);
    setError("Documento eliminato");
  }

  async function downloadPdfDocument(title: string, rows: string) {
    const w = window.open("", "_blank");
    if (!w) return;

    let logoSrc = "/logo.png";
    try {
      const logoRes = await fetch("/logo.png");
      const logoBlob = await logoRes.blob();
      logoSrc = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || "/logo.png"));
        reader.readAsDataURL(logoBlob);
      });
    } catch {
      logoSrc = "/logo.png";
    }

    w.document.write(`<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title></head><body style="font-family:Arial,sans-serif;padding:18px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;"><img id="pdf-logo" src="${logoSrc}" alt="Italsem FM" style="height:42px" /><h1 style="margin:0;font-size:22px;">${title}</h1></div>${rows}</body></html>`);
    w.document.close();

    const triggerPrint = () => {
      w.focus();
      w.print();
    };

    const logo = w.document.getElementById("pdf-logo") as HTMLImageElement | null;
    if (!logo) {
      triggerPrint();
      return;
    }

    if (logo.complete) {
      triggerPrint();
      return;
    }

    logo.onload = () => triggerPrint();
    logo.onerror = () => triggerPrint();
  }

  function exportVehicleHistoryPdf() {
    if (!vehicleDetail) return;
    const rows = vehicleDetail.history.map((h) => `<tr><td>${new Date(h.refuelAt).toLocaleDateString()}</td><td>${h.odometerKm}</td><td>${h.liters.toFixed(2)}</td><td>${h.amount.toFixed(2)}</td><td>${h.sourceType === "tank" ? "Cisterna" : "Carta"}</td><td>${h.sourceIdentifier || "-"}</td><td>${h.distanceKm ? h.distanceKm.toFixed(0) : "-"}</td><td>${h.consumptionKmL ? h.consumptionKmL.toFixed(2) : "-"}</td><td>${h.consumptionL100km ? h.consumptionL100km.toFixed(2) : "-"}</td></tr>`).join("");
    void downloadPdfDocument(`Storico Rifornimenti ${vehicleDetail.vehicle.code}`, `<table border='1' cellpadding='6' cellspacing='0'><tr><th>Data</th><th>Km</th><th>Litri</th><th>Importo</th><th>Fonte</th><th>ID Fonte</th><th>Km Percorsi</th><th>Km/L</th><th>L/100Km</th></tr>${rows}</table>`);
  }

  function exportVehicleSheetPdf() {
    if (!vehicleDetail) return;
    const deadlineRows = Object.entries(deadlineForm).filter(([,v]) => v).map(([k,v]) => `<tr><td>${DEADLINE_LABELS[k as DeadlineType]}</td><td>${new Date(v).toLocaleDateString()}</td></tr>`).join("");
    const info = `<p><b>Codice:</b> ${vehicleDetail.vehicle.code}</p><p><b>Targa:</b> ${vehicleDetail.vehicle.plate}</p><p><b>Modello:</b> ${vehicleDetail.vehicle.model}</p><p><b>Descrizione:</b> ${vehicleDetail.vehicle.description || "-"}</p>${vehicleDetail.vehicle.photo_key ? `<img src='/api/photo?key=${encodeURIComponent(vehicleDetail.vehicle.photo_key)}' style='max-width:360px;max-height:240px;object-fit:cover;border:1px solid #ddd;'/>` : ""}`;
    const docsRows = vehicleDetail.documents.map((doc) => `<tr><td>${DOCUMENT_TYPE_LABELS[doc.docType]}</td><td>${doc.fileName}</td></tr>`).join("");
    const docsEmbedded = vehicleDetail.documents.map((d) => {
      const url = `/api/photo?key=${encodeURIComponent(d.fileKey)}`;
      if ((d.mimeType || "").startsWith("image/")) {
        return `<div style='page-break-inside:avoid;margin:12px 0'><h4 style='margin:0 0 6px 0'>${DOCUMENT_TYPE_LABELS[d.docType]} - ${d.fileName}</h4><img src='${url}' style='max-width:520px;max-height:680px;object-fit:contain;border:1px solid #ddd'/></div>`;
      }
      if ((d.mimeType || "").includes("pdf") || d.fileName.toLowerCase().endsWith(".pdf")) {
        return `<div style='page-break-before:always'><h4 style='margin:0 0 6px 0'>${DOCUMENT_TYPE_LABELS[d.docType]} - ${d.fileName}</h4><iframe src='${url}#toolbar=0&navpanes=0&scrollbar=0' style='width:100%;height:900px;border:1px solid #ddd'></iframe></div>`;
      }
      return `<div style='margin:8px 0'><b>${DOCUMENT_TYPE_LABELS[d.docType]}</b> - <a href='${url}' target='_blank'>${d.fileName}</a></div>`;
    }).join("");
    void downloadPdfDocument(`Scheda Veicolo ${vehicleDetail.vehicle.code}`, `${info}<h3>Scadenze</h3><table border='1' cellpadding='6' cellspacing='0'><tr><th>Tipo</th><th>Scadenza</th></tr>${deadlineRows}</table><h3>Documenti</h3><table border='1' cellpadding='6' cellspacing='0'><tr><th>Tipo</th><th>File</th></tr>${docsRows || "<tr><td colspan='2'>Nessun documento</td></tr>"}</table>${docsEmbedded}`);
  }

  function exportRefuelingsPdf() {
    const rows = sortedRefuelings.map((r) => `<tr><td>${new Date(r.refuelAt).toLocaleDateString()}</td><td>${r.vehicleCode} (${r.plate})</td><td>${r.odometerKm}</td><td>${r.liters.toFixed(2)}</td><td>${r.amount.toFixed(2)}</td><td>${r.sourceType === "tank" ? "Cisterna" : "Carta"}</td><td>${r.sourceIdentifier}</td><td>${r.sourceAssignedTo || "-"}</td><td>${r.distanceKm ? r.distanceKm.toFixed(0) : "-"}</td><td>${r.consumptionKmL ? r.consumptionKmL.toFixed(2) : "-"}</td><td>${r.consumptionL100km ? r.consumptionL100km.toFixed(2) : "-"}</td></tr>`).join("");
    void downloadPdfDocument("Export Rifornimenti", `<table border='1' cellpadding='6' cellspacing='0'><tr><th>Data</th><th>Mezzo</th><th>Km</th><th>Litri</th><th>Importo</th><th>Fonte</th><th>ID Fonte</th><th>Utilizzatore</th><th>Km Percorsi</th><th>Km/L</th><th>L/100Km</th></tr>${rows}</table>`);
  }

  if (!token || !user) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <form onSubmit={onLogin} className="mx-auto mt-20 max-w-md space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
          <div className="flex items-center gap-3"><img src="/logo-bianco.png" alt="Italsem FM" className="h-10 w-auto" /><h1 className="text-2xl font-bold">Accesso</h1></div>
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
        <div className="flex items-center gap-3"><img src="/logo-bianco.png" alt="Italsem FM" className="h-10 w-auto" /><h1 className="text-2xl font-bold">Italsem FM - {user.role}</h1></div>
        <div className="space-x-2">{TABS.filter((t) => !(t === "Utenti" && user.role !== "admin")).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === t ? "bg-orange-500 text-black" : "bg-slate-800"}`}>{t}</button>)}<button onClick={() => { localStorage.removeItem("token"); setToken(""); setUser(null); }} className="rounded-lg bg-slate-700 px-3 py-2">Logout</button></div>
      </header>
      {error && <div className="rounded border border-red-700 bg-red-950 p-2 text-red-300">{error}</div>}

      {error && <div className="mb-4 rounded-lg border border-red-600 bg-red-900/40 p-2 text-red-200">{error}</div>}

      {tab === "Dashboard" && dashboard && (
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">Litri Totali: <b>{dashboard.totalLiters.toFixed(2)}</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">Spesa Totale: <b>EUR {dashboard.totalAmount.toFixed(2)}</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">Consumo Medio: <b>{dashboard.avgConsumption.toFixed(2)} Km/L</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">Km Percorsi: <b>{(dashboard.totalDistanceKm || 0).toFixed(0)}</b></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 md:col-span-4">
            <h3 className="mb-2 font-semibold">Riepilogo Scadenze</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-green-500" />Valide: {deadlineSummary.valid}</span>
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-orange-500" />In Scadenza: {deadlineSummary.warning}</span>
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-red-500" />Scadute: {deadlineSummary.expired}</span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="mb-2 font-semibold">Litri Mensili</h3><MiniBars data={dashboard.monthly.map((m) => ({ label: m.month, value: m.liters }))} /></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="mb-2 font-semibold">Costi Mensili</h3><MiniBars data={dashboard.monthly.map((m) => ({ label: m.month, value: m.amount }))} /></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="mb-2 font-semibold">Km Mensili</h3><MiniBars data={dashboard.monthly.map((m) => ({ label: m.month, value: m.distanceKm || 0 }))} /></div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 md:col-span-3"><h3 className="mb-2 font-semibold">Confronto Consumi Mezzi (Km/L)</h3><MiniBars data={dashboard.compare.map((c) => ({ label: `${c.code}/${c.plate}`, value: c.avgConsumption }))} /></div>
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
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-500" />{v.deadlineValid || 0}</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" />{v.deadlineWarning || 0}</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />{v.deadlineExpired || 0}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {user.role === "admin" && <form onSubmit={addVehicle} className="space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Nuovo Mezzo</h3><input required className="w-full rounded bg-slate-950 p-2" placeholder="Codice" value={vehicleForm.code} onChange={(e) => setVehicleForm({ ...vehicleForm, code: e.target.value })} /><input required className="w-full rounded bg-slate-950 p-2" placeholder="Targa" value={vehicleForm.plate} onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value })} /><input required className="w-full rounded bg-slate-950 p-2" placeholder="Modello" value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })} /><input className="w-full rounded bg-slate-950 p-2" placeholder="Descrizione" value={vehicleForm.description} onChange={(e) => setVehicleForm({ ...vehicleForm, description: e.target.value })} /><button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black">Aggiungi Mezzo</button></form>}
            
            {user.role === "admin" && <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Importa Scadenze Da Excel</h3><p className="text-xs text-slate-400">Colonne supportate: Targa, Revisione, Assicurazione/RCA, Bollo, Tachigrafo, Periodica Gru, Strutturale</p><input type="file" accept=".xlsx,.xls,.csv" className="w-full rounded bg-slate-950 p-2" onChange={(e) => setExcelImportFile(e.target.files?.[0] || null)} /><button type="button" disabled={!excelImportFile || excelImporting} className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50" onClick={async () => { if (!excelImportFile) return; try { await importDeadlinesFromExcel(excelImportFile); setExcelImportFile(null); } catch (err: unknown) { setError(err instanceof Error ? err.message : "Errore import Excel"); } }}>IMPORTA EXCEL</button></div>}
          </div>
        </section>
      )}

      {tab === "Rifornimenti" && (
        <section className="space-y-4">
          <div className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-6"><select value={filterVehicleId} onChange={(e) => setFilterVehicleId(Number(e.target.value))} className="rounded bg-slate-950 p-2"><option value={0}>Tutti I Mezzi</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.code} - {v.plate}</option>)}</select><select value={filterSourceIdentifier} onChange={(e) => setFilterSourceIdentifier(e.target.value)} className="rounded bg-slate-950 p-2"><option value="">Tutte Le Fonti</option>{fuelSources.filter((x) => x.active).map((x) => <option key={x.id} value={x.identifier}>{x.identifier} {x.assignedTo ? `- ${x.assignedTo}` : ""}</option>)}</select><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded bg-slate-950 p-2" /><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded bg-slate-950 p-2" /><button onClick={() => loadRefuelings(token, filterVehicleId)} className="rounded-lg bg-slate-700 px-3 py-2">Filtra</button><button type="button" onClick={exportRefuelingsPdf} className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black">Export PDF</button></div>
          {user.role === "admin" && <form onSubmit={addRefueling} className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-2"><select name="vehicleId" required className="rounded bg-slate-950 p-2"><option value="">Seleziona Mezzo</option>{vehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.code} - {v.plate}</option>)}</select><input name="refuelAt" type="date" required className="rounded bg-slate-950 p-2" /><input name="odometerKm" type="number" min="0" required className="rounded bg-slate-950 p-2" placeholder="Chilometraggio" /><input name="liters" type="number" min="0.01" step="0.01" required className="rounded bg-slate-950 p-2" placeholder="Litri" /><input name="amount" type="number" min="0" step="0.01" required className="rounded bg-slate-950 p-2" placeholder="Importo in €" /><select name="sourceType" value={refuelSourceType} onChange={(e) => setRefuelSourceType(e.target.value as "card" | "tank")} className="rounded bg-slate-950 p-2"><option value="card">Carta Carburante</option><option value="tank">Cisterna</option></select><select name="sourceIdentifier" required className="rounded bg-slate-950 p-2"><option value="">Seleziona Carta/Cisterna</option>{fuelSources.filter((x) => x.active && x.sourceType === refuelSourceType).map((x) => <option key={x.id} value={x.identifier}>{x.identifier}{x.assignedTo ? ` - ${x.assignedTo}` : ""}</option>)}</select><input name="receipt" type="file" accept="image/*,.pdf" className="rounded bg-slate-950 p-2" /><span className="self-center text-xs text-slate-400">Scontrino facoltativo</span><button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black md:col-span-2">Registra Rifornimento</button></form>}
          {user.role === "admin" && <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-semibold">Importa Rifornimenti Da Excel</h3><p className="text-xs text-slate-400">Colonne: N° CARTA, DATA, IMPORTO, CHILOMETRAGGIO, PREZZO UNITARIO, QUANTITÀ. Associazione carta per ultime 4 cifre.</p><select className="w-full rounded bg-slate-950 p-2" value={refuelImportVehicleId} onChange={(e) => setRefuelImportVehicleId(Number(e.target.value))}><option value={0}>Seleziona Mezzo Per Import</option>{vehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.code} - {v.plate}</option>)}</select><input type="file" accept=".xlsx,.xls,.csv" className="w-full rounded bg-slate-950 p-2" onChange={(e) => setRefuelImportFile(e.target.files?.[0] || null)} /><button type="button" disabled={!refuelImportFile || !refuelImportVehicleId || refuelImporting} className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50" onClick={async () => { if (!refuelImportFile || !refuelImportVehicleId) return; try { await importRefuelingsFromExcel(refuelImportFile); setRefuelImportFile(null); } catch (err: unknown) { setError(err instanceof Error ? err.message : "Errore import rifornimenti"); } }}>IMPORTA RIFORNIMENTI</button></div>}

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4"><select value={sortBy} onChange={(e) => setSortBy(e.target.value as "date_desc" | "date_asc" | "cons_desc")} className="rounded bg-slate-950 p-2"><option value="date_desc">Data Desc</option><option value="date_asc">Data Asc</option><option value="cons_desc">Km/L Alto</option></select><div className="mt-2 overflow-auto"><table className="min-w-full text-sm"><thead><tr><th className="text-left">Data</th><th className="text-left">Mezzo</th><th className="text-left">Fonte</th><th className="text-left">Utilizzatore</th><th className="text-left">Km</th><th className="text-left">Litri</th><th className="text-left">Importo</th><th className="text-left">Km Percorsi</th><th className="text-left">Km/L</th><th className="text-left">L/100Km</th>{user.role === "admin" && <th className="text-left">Azioni</th>}</tr></thead><tbody>{sortedRefuelings.map((r) => <tr key={r.id} className="border-t border-slate-800"><td>{new Date(r.refuelAt).toLocaleDateString()}</td><td>{r.vehicleCode}</td><td>{r.sourceType === "tank" ? "Cisterna" : "Carta"} / {r.sourceIdentifier}</td><td>{r.sourceAssignedTo || "-"}</td><td>{r.odometerKm}</td><td>{r.liters.toFixed(2)}</td><td>EUR {r.amount.toFixed(2)}</td><td>{r.distanceKm ? r.distanceKm.toFixed(0) : "-"}</td><td>{r.consumptionKmL ? r.consumptionKmL.toFixed(2) : "-"}</td><td>{r.consumptionL100km ? r.consumptionL100km.toFixed(2) : "-"}</td>{user.role === "admin" && <td><div className="flex gap-1"><button type="button" onClick={() => { void editRefueling(r); }} className="rounded bg-slate-700 px-2 py-1 text-xs">Modifica</button><button type="button" onClick={() => { void deleteRefueling(r.id); }} className="rounded bg-red-700 px-2 py-1 text-xs">Elimina</button></div></td>}</tr>)}</tbody></table></div></div>
        </section>
      )}

      {tab === "Carte" && (
        <section className="space-y-4">
          {user.role === "admin" && (
            <form onSubmit={addSource} className="grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-4 md:grid-cols-4">
              <select className="rounded bg-slate-950 p-2" value={sourceForm.sourceType} onChange={(e) => setSourceForm({ ...sourceForm, sourceType: e.target.value as "card" | "tank" })}>
                <option value="card">Carta Carburante</option>
                <option value="tank">Cisterna</option>
              </select>
              <input className="rounded bg-slate-950 p-2" placeholder="Identificativo" value={sourceForm.identifier} onChange={(e) => setSourceForm({ ...sourceForm, identifier: e.target.value })} />
              <input className="rounded bg-slate-950 p-2" placeholder="Utilizzatore" value={sourceForm.assignedTo} onChange={(e) => setSourceForm({ ...sourceForm, assignedTo: e.target.value })} />
              <button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black">Aggiungi</button>
            </form>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
              <h3 className="mb-2 font-semibold">Carte Carburante</h3>
              <div className="space-y-2 text-sm">
                {cards.length === 0 && <div className="text-slate-400">Nessuna carta</div>}
                {cards.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded border border-slate-800 p-2">
                    <div>
                      <div className="font-medium">{c.identifier}</div>
                      <div className="text-xs text-slate-400">Utilizzatore: {c.assignedTo || "-"}</div>
                    </div>
                    {user.role === "admin" && (
                      <div className="flex gap-1">
                        <button type="button" className="rounded bg-slate-700 px-2 py-1 text-xs" onClick={() => { void updateSourceAssignedTo(c.id, c.assignedTo); }}>Modifica</button>
                        <button type="button" className="rounded bg-red-700 px-2 py-1 text-xs" onClick={() => { void deleteSource(c.id); }}>Rimuovi</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
              <h3 className="mb-2 font-semibold">Cisterne</h3>
              <div className="space-y-2 text-sm">
                {tanks.length === 0 && <div className="text-slate-400">Nessuna cisterna</div>}
                {tanks.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded border border-slate-800 p-2">
                    <div>
                      <div className="font-medium">{c.identifier}</div>
                      <div className="text-xs text-slate-400">Utilizzatore: {c.assignedTo || "-"}</div>
                    </div>
                    {user.role === "admin" && (
                      <div className="flex gap-1">
                        <button type="button" className="rounded bg-slate-700 px-2 py-1 text-xs" onClick={() => { void updateSourceAssignedTo(c.id, c.assignedTo); }}>Modifica</button>
                        <button type="button" className="rounded bg-red-700 px-2 py-1 text-xs" onClick={() => { void deleteSource(c.id); }}>Rimuovi</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "Utenti" && user.role === "admin" && <section className="space-y-4"><form onSubmit={createUser} className="max-w-xl space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4"><h4 className="font-semibold">Crea Nuovo Utente</h4><input required className="w-full rounded bg-slate-950 p-2" placeholder="Username" value={newUserForm.username} onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })} /><input type="password" minLength={6} required className="w-full rounded bg-slate-950 p-2" placeholder="Password (min 6)" value={newUserForm.password} onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })} /><select className="w-full rounded bg-slate-950 p-2" value={newUserForm.role} onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as "admin" | "technician" })}><option value="technician">Tecnico (consultazione/export)</option><option value="admin">Admin (tutto)</option></select><button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black">Crea Utente</button></form><div className="rounded-xl border border-slate-700 bg-slate-900 p-4">{users.map((u) => <div key={u.id} className="mb-2 grid gap-2 border-b border-slate-800 pb-2 md:grid-cols-5"><div>{u.username}</div><select defaultValue={u.role} onChange={(e) => saveUser(u, e.target.value as Role, u.active === 1)} className="rounded bg-slate-950 p-2"><option value="admin">Admin</option><option value="technician">Technician</option></select><button onClick={() => saveUser(u, u.role, u.active !== 1)} className="rounded bg-slate-700 px-2 py-1">{u.active ? "Disattiva" : "Attiva"}</button><div>{new Date(u.created_at).toLocaleDateString()}</div><div>{u.active ? "Attivo" : "Disattivo"}</div></div>)}</div><form onSubmit={updatePassword} className="max-w-xl space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4"><h4 className="font-semibold">Modifica Password Utente</h4><select value={passwordForm.userId} onChange={(e) => setPasswordForm({ ...passwordForm, userId: Number(e.target.value) })} className="w-full rounded bg-slate-950 p-2"><option value={0}>Seleziona Utente</option>{users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}</select><input type="password" minLength={6} required value={passwordForm.password} onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value })} className="w-full rounded bg-slate-950 p-2" placeholder="Nuova Password (Min 6)" /><button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black">Aggiorna Password</button></form></section>}

      {modalOpen && vehicleDetail && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-bold">Dettaglio Mezzo {vehicleDetail.vehicle.code} ({vehicleDetail.vehicle.plate}) - Ultimo Km: {vehicleDetail.vehicle.lastOdometerKm ?? "-"}</h2><button className="rounded bg-slate-700 px-3 py-1" onClick={() => setModalOpen(false)}>Chiudi</button></div>
            <form onSubmit={saveVehicleDetails} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm">Codice</label>
                <input className="w-full rounded bg-slate-950 p-2" value={editVehicleForm.code} onChange={(e) => setEditVehicleForm({ ...editVehicleForm, code: e.target.value.toUpperCase() })} />
                <label className="text-sm">Targa</label>
                <input className="w-full rounded bg-slate-950 p-2" value={editVehicleForm.plate} onChange={(e) => setEditVehicleForm({ ...editVehicleForm, plate: e.target.value.toUpperCase() })} />
                <label className="text-sm">Modello</label>
                <input className="w-full rounded bg-slate-950 p-2" value={editVehicleForm.model} onChange={(e) => setEditVehicleForm({ ...editVehicleForm, model: e.target.value })} />
                <label className="text-sm">Descrizione</label>
                <textarea className="w-full rounded bg-slate-950 p-2" value={editVehicleForm.description} onChange={(e) => setEditVehicleForm({ ...editVehicleForm, description: e.target.value })} />
                <div className="rounded border border-slate-700 p-3">
                  <h3 className="mb-2 font-semibold">Scadenze</h3>
                  {([...BASE_DEADLINE_TYPES, ...enabledOptionalDeadlines] as DeadlineType[]).map((t) => {
                    const st = deadlineState(deadlineForm[t]);
                    return (
                      <div key={t} className="mb-2 flex items-center gap-2">
                        <span className={`h-3 w-3 rounded-full ${st.color}`} />
                        <label className="w-32">{DEADLINE_LABELS[t]}</label>
                        <input type="date" className="rounded bg-slate-950 p-2" value={deadlineForm[t]} onChange={(e) => setDeadlineForm({ ...deadlineForm, [t]: e.target.value })} />
                        <span className="text-xs text-slate-300">{st.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded border border-slate-700 p-3">
                  <h3 className="mb-2 font-semibold">Scadenze opzionali</h3>
                  <div className="flex flex-wrap gap-2">
                    {OPTIONAL_DEADLINE_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setEnabledOptionalDeadlines((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
                          if (enabledOptionalDeadlines.includes(t)) setDeadlineForm((prev) => ({ ...prev, [t]: "" }));
                        }}
                        className={`rounded px-2 py-1 text-xs ${enabledOptionalDeadlines.includes(t) ? "bg-orange-500 text-black" : "bg-slate-800"}`}
                      >
                        {enabledOptionalDeadlines.includes(t) ? "Rimuovi" : "Aggiungi"} {DEADLINE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>
                {user.role === "admin" && (
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded-lg bg-orange-500 px-3 py-2 font-semibold text-black">Salva Dati Mezzo</button>
                    <button type="button" onClick={deleteVehicle} className="rounded-lg bg-red-600 px-3 py-2 font-semibold text-white">Elimina Mezzo</button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">Foto Mezzo</h3>
                {vehicleDetail.vehicle.photo_key ? <img src={`/api/photo?key=${encodeURIComponent(vehicleDetail.vehicle.photo_key)}`} className="h-44 w-full rounded object-cover" /> : <div className="h-44 rounded bg-slate-800" />}
                {user.role === "admin" && <input type="file" accept="image/*" className="w-full rounded bg-slate-950 p-2" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVehiclePhoto(f); }} />}

                <div className="rounded border border-slate-700 p-3">
                  <h3 className="mb-2 font-semibold">Documenti Mezzo</h3>
                  {user.role === "admin" && (
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <select value={documentType} onChange={(e) => setDocumentType(e.target.value as VehicleDocumentType)} className="rounded bg-slate-950 p-2 text-sm">
                        {(Object.keys(DOCUMENT_TYPE_LABELS) as VehicleDocumentType[]).map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}
                      </select>
                      <input type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" className="rounded bg-slate-950 p-2 text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadVehicleDocument(f); e.currentTarget.value = ""; }} />
                    </div>
                  )}
                  <div className="max-h-40 space-y-2 overflow-auto text-sm">
                    {vehicleDetail.documents.length === 0 && <div className="text-slate-400">Nessun documento caricato</div>}
                    {vehicleDetail.documents.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between gap-2 rounded border border-slate-800 p-2">
                        <div className="min-w-0">
                          <div className="font-medium">{DOCUMENT_TYPE_LABELS[doc.docType]}</div>
                          <a href={`/api/photo?key=${encodeURIComponent(doc.fileKey)}`} target="_blank" rel="noreferrer" className="block truncate text-orange-400 hover:underline">{doc.fileName}</a>
                        </div>
                        {user.role === "admin" && <button type="button" onClick={() => { void deleteVehicleDocument(doc.id); }} className="rounded bg-red-700 px-2 py-1 text-xs">Elimina</button>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 rounded border border-slate-700 p-3">
                  <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Storico Rifornimenti</h3><div className="flex gap-2"><button type="button" onClick={exportVehicleHistoryPdf} className="rounded bg-orange-500 px-2 py-1 text-sm font-semibold text-black">PDF Consumi</button><button type="button" onClick={exportVehicleSheetPdf} className="rounded bg-slate-700 px-2 py-1 text-sm font-semibold">PDF Scheda Mezzo</button></div></div>
                  <div className="max-h-52 overflow-auto text-sm">
                    <table className="min-w-full"><thead><tr><th className="text-left">Data</th><th className="text-left">Fonte</th><th className="text-left">Litri</th><th className="text-left">Importo</th><th className="text-left">Km Percorsi</th><th className="text-left">Km/L</th><th className="text-left">L/100Km</th></tr></thead><tbody>{vehicleDetail.history.map((h) => <tr key={h.id} className="border-t border-slate-800"><td>{new Date(h.refuelAt).toLocaleDateString()}</td><td>{h.sourceType === "tank" ? "Cisterna" : "Carta"} / {h.sourceIdentifier || "-"}</td><td>{h.liters.toFixed(2)}</td><td>EUR {h.amount.toFixed(2)}</td><td>{h.distanceKm ? h.distanceKm.toFixed(0) : "-"}</td><td>{h.consumptionKmL ? h.consumptionKmL.toFixed(2) : "-"}</td><td>{h.consumptionL100km ? h.consumptionL100km.toFixed(2) : "-"}</td></tr>)}</tbody></table>
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
