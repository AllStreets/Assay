import path from "node:path";
import { DATA_DIR } from "./paths.js";
import { readJson, writeJson } from "./store.js";

// Things Assay noticed on its own, for the menu bar to turn into macOS notifications.
export interface Notice { id: number; at: number; title: string; body: string; target: string }

const FILE = path.join(DATA_DIR, "notices.json");
let list: Notice[] | undefined;

async function all() {
  list ??= await readJson<Notice[]>(FILE, []);
  return list;
}

export async function notify(title: string, body: string, target: string) {
  const l = await all();
  const n: Notice = { id: (l.at(-1)?.id ?? 0) + 1, at: Date.now(), title, body, target };
  l.push(n);
  list = l.slice(-100);
  await writeJson(FILE, list);
  return n;
}

export async function noticesSince(id: number) {
  return (await all()).filter((n) => n.id > id);
}
