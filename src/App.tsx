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

type ImportResult = {
  ok: boolean;
  totalSheets?: number;
  detectedPlates?: number;
  inserted?: number;
  skipped?: number;
  plates?: string[];
  error?: string;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `POST ${path} failed: ${res.status}`);
  return data;
}

export default function App() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [search, setSearch] = useState("");
  const
