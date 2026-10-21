import type { ActionResult, AssayResult, Progress, QuarantineRecord, Settings } from "../../shared/types";

export type Result = AssayResult & { actions: Record<string, string[]> };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with ${r.status}`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

const post = <T,>(url: string, body?: unknown) =>
  call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  result: () => call<Result | null>("/api/assay"),
  run: () => post<Progress>("/api/assay/run"),
  progress: (from = 0) => call<Progress>(`/api/progress?from=${from}`),
  settings: () => call<Settings>("/api/settings"),
  saveSettings: (s: Partial<Settings>) => call<Settings>("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) }),
  quarantined: () => call<QuarantineRecord[]>("/api/quarantine"),
  quarantine: (itemId: string) => post<ActionResult>("/api/actions/quarantine", { itemId }),
  release: (recordId: string) => post<ActionResult>("/api/actions/release", { recordId }),
  trash: (itemId: string) => post<ActionResult>("/api/actions/trash", { itemId }),
  update: (itemId: string) => post<ActionResult>("/api/actions/update", { itemId }),
  reveal: (itemId: string) => post<void>("/api/actions/reveal", { itemId }),
  open: (itemId: string) => post<void>("/api/actions/open", { itemId }),
  specimen: () => post<{ path: string }>("/api/specimen"),
  teardown: () => call<{ installed: boolean }>("/api/teardown"),
  openInTeardown: (itemId: string | null, page?: "permissions" | "changes") => post<ActionResult>("/api/actions/teardown", { itemId, page }),
  openData: () => post<void>("/api/open-data"),
  about: () => call<{ version: string; dataDir: string }>("/api/about"),
  icon: (path: string) => `/api/icon?path=${encodeURIComponent(path)}`,
};
