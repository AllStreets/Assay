import { execFile } from "node:child_process";
import { parse as parsePlist } from "plist";

export interface RunResult {
  stdout: string;
  stderr: string;
  ok: boolean;
}

// Runs a command without a shell. Never rejects: probes fail soft.
export function run(cmd: string, args: string[], timeout = 20_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", ok: !err });
    });
  });
}

// Reads any plist (binary, XML or JSON-incompatible) by normalising through plutil.
export async function readPlist(file: string): Promise<Record<string, unknown> | undefined> {
  const r = await run("plutil", ["-convert", "xml1", "-o", "-", file], 5_000);
  if (!r.ok || !r.stdout) return undefined;
  try {
    return parsePlist(r.stdout) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function parsePlistXml(xml: string): Record<string, unknown> | undefined {
  const start = xml.indexOf("<?xml");
  if (start < 0) return undefined;
  try {
    return parsePlist(xml.slice(start)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// Runs async work over items with bounded concurrency.
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
