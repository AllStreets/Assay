import os from "node:os";
import path from "node:path";

export const HOME = os.homedir();
export const DATA_DIR = process.env.ASSAY_DATA ?? path.join(HOME, "Library", "Application Support", "Assay");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const QUARANTINE_DIR = path.join(DATA_DIR, "quarantine");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
export const RESULT_FILE = path.join(DATA_DIR, "last-assay.json");
export const QUARANTINE_FILE = path.join(DATA_DIR, "quarantine.json");
export const DIST_DIR = process.env.ASSAY_DIST ?? path.resolve(process.cwd(), "dist");
export const PORT = Number(process.env.ASSAY_PORT ?? 4720);
export const VERSION = "0.1.0";
