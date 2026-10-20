import { inflateRawSync } from "node:zlib";
import type { PickleImport } from "../../shared/types.js";
import { FileReader } from "./reader.js";

// Python's pickle format is a small stack machine. Loading a pickle runs it, and any
// GLOBAL / STACK_GLOBAL / INST instruction imports a Python object that REDUCE can then
// call. That is how a model file can run code the moment it is loaded. Assay walks the
// instructions without executing anything and reports every import.

// Imports PyTorch, NumPy and the standard library use to rebuild tensors and containers.
const SAFE: Record<string, Set<string> | "*"> = {
  "collections": new Set(["OrderedDict", "defaultdict"]),
  "torch._utils": new Set([
    "_rebuild_tensor", "_rebuild_tensor_v2", "_rebuild_tensor_v3", "_rebuild_parameter", "_rebuild_parameter_with_state",
    "_rebuild_qtensor", "_rebuild_sparse_tensor", "_rebuild_device_tensor_from_numpy", "_rebuild_meta_tensor_no_storage",
    "_rebuild_wrapper_subclass", "_rebuild_nested_tensor",
  ]),
  "torch": new Set([
    "FloatStorage", "HalfStorage", "BFloat16Storage", "DoubleStorage", "LongStorage", "IntStorage", "ShortStorage",
    "CharStorage", "ByteStorage", "BoolStorage", "ComplexFloatStorage", "ComplexDoubleStorage", "QInt8Storage", "QUInt8Storage",
    "Size", "device", "float16", "float32", "float64", "bfloat16", "int8", "int16", "int32", "int64", "uint8", "bool",
    "complex64", "complex128", "per_tensor_affine", "per_channel_affine",
  ]),
  "torch.storage": new Set(["UntypedStorage", "TypedStorage"]),
  "torch.nn.parameter": new Set(["Parameter"]),
  "numpy": new Set(["ndarray", "dtype", "float32", "float64", "int64", "int32", "uint8", "bool_"]),
  "numpy.core.multiarray": new Set(["_reconstruct", "scalar"]),
  "numpy._core.multiarray": new Set(["_reconstruct", "scalar"]),
  "numpy.dtypes": "*",
  "builtins": new Set(["set", "frozenset", "slice", "bytearray", "complex", "range", "tuple", "list", "dict", "int", "float", "str", "bytes", "bool", "object"]),
  "__builtin__": new Set(["set", "frozenset", "slice", "bytearray", "complex"]),
  "_codecs": new Set(["encode"]),
};

// Modules (or module.name pairs) that give a pickle a way to run commands, open files or
// reach the network. Finding any of them is a critical finding.
const DANGEROUS_MODULES = [
  "os", "posix", "nt", "subprocess", "sys", "runpy", "socket", "shutil", "pty", "commands", "webbrowser",
  "importlib", "ctypes", "platform", "code", "codeop", "pdb", "timeit", "multiprocessing", "asyncio",
  "requests", "urllib", "urllib2", "httplib", "http", "aiohttp", "ftplib", "smtplib", "telnetlib", "pip",
  "marshal", "types", "functools", "operator", "pickle", "_pickle", "dill", "cloudpickle", "torch.hub", "torch.load",
];
const DANGEROUS_NAMES: Record<string, Set<string>> = {
  builtins: new Set(["eval", "exec", "compile", "open", "getattr", "setattr", "delattr", "__import__", "globals", "locals", "vars", "input", "breakpoint", "memoryview"]),
  __builtin__: new Set(["eval", "exec", "compile", "open", "getattr", "setattr", "execfile", "file", "__import__", "apply", "input", "reload"]),
  torch: new Set(["load", "save"]),
  "torch.serialization": new Set(["load"]),
  numpy: new Set(["load", "fromfile"]),
};

export function judge(module: string, name: string): PickleImport["verdict"] {
  const safe = SAFE[module];
  if (safe === "*" || safe?.has(name)) return "safe";
  if (DANGEROUS_NAMES[module]?.has(name)) return "dangerous";
  if (DANGEROUS_MODULES.some((m) => module === m || module.startsWith(m + "."))) return "dangerous";
  return "unknown";
}

// Opcode argument shapes. Values are byte counts; negative means a length prefix of that
// many bytes; "line" means newline-terminated.
type Arg = number | "line" | "line2";
const OPS: Record<number, Arg> = {
  0x28: 0, 0x2e: 0, 0x30: 0, 0x31: 0, 0x32: 0, // ( . 0 1 2
  0x46: "line", 0x49: "line", 0x4a: 4, 0x4b: 1, 0x4c: "line", 0x4d: 2, 0x4e: 0, 0x50: "line", 0x51: 0, 0x52: 0,
  0x53: "line", 0x54: -4, 0x55: -1, 0x56: "line", 0x58: -4, 0x61: 0, 0x62: 0, 0x63: "line2", 0x64: 0, 0x7d: 0,
  0x65: 0, 0x67: "line", 0x68: 1, 0x69: "line2", 0x6a: 4, 0x6c: 0, 0x5d: 0, 0x6f: 0, 0x70: "line", 0x71: 1,
  0x72: 4, 0x73: 0, 0x74: 0, 0x29: 0, 0x75: 0, 0x47: 8,
  0x80: 1, 0x81: 0, 0x82: 1, 0x83: 2, 0x84: 4, 0x85: 0, 0x86: 0, 0x87: 0, 0x88: 0, 0x89: 0, 0x8a: -1, 0x8b: -4,
  0x42: -4, 0x43: -1,
  0x8c: -1, 0x8d: -8, 0x8e: -8, 0x8f: 0, 0x90: 0, 0x91: 0, 0x92: 0, 0x93: 0, 0x94: 0, 0x95: 8,
  0x96: -8, 0x97: 0, 0x98: 0,
};
const STRING_OPS = new Set([0x8c, 0x8d, 0x58, 0x56, 0x55, 0x54, 0x53]);

interface Source {
  byte(): Promise<number | undefined>;
  take(n: number): Promise<Buffer>;
  line(): Promise<string>;
  skip(n: number): Promise<void>;
}

function bufferSource(buf: Buffer): Source {
  let i = 0;
  return {
    async byte() { return i < buf.length ? buf[i++] : undefined; },
    async take(n) { if (i + n > buf.length) throw new Error("Truncated pickle"); const b = buf.subarray(i, i + n); i += n; return b; },
    async line() { const j = buf.indexOf(0x0a, i); if (j < 0) throw new Error("Truncated pickle"); const s = buf.toString("latin1", i, j); i = j + 1; return s; },
    async skip(n) { if (i + n > buf.length) throw new Error("Truncated pickle"); i += n; },
  };
}

function readerSource(r: FileReader, end: number): Source {
  return {
    async byte() { return r.pos < end ? r.u8() : undefined; },
    async take(n) { return r.bytes(n); },
    async line() {
      let s = "";
      for (;;) {
        const b = await r.u8();
        if (b === 0x0a) return s;
        s += String.fromCharCode(b);
        if (s.length > 4096) throw new Error("Line too long in pickle");
      }
    },
    async skip(n) { await r.skip(n); },
  };
}

// Walks one or more consecutive pickles and returns every import they would perform.
async function walk(src: Source, maxPickles: number): Promise<{ imports: PickleImport[]; pickles: number }> {
  const found = new Map<string, PickleImport>();
  const add = (module: string, name: string) => {
    const key = `${module}.${name}`;
    if (!found.has(key)) found.set(key, { module, name, verdict: judge(module, name) });
  };
  let pickles = 0;
  let recent: (string | undefined)[] = [];
  const memo = new Map<number, string | undefined>();
  let memoNext = 0;

  while (pickles < maxPickles) {
    const op = await src.byte();
    if (op === undefined) break;
    const arg = OPS[op];
    if (arg === undefined) throw new Error(`Unknown pickle opcode 0x${op.toString(16)}`);
    let str: string | undefined;
    if (arg === "line") {
      const s = await src.line();
      if (STRING_OPS.has(op)) str = op === 0x53 ? s.replace(/^['"]|['"]$/g, "") : s;
      if (op === 0x67) str = memo.get(Number(s));
      if (op === 0x70) memo.set(Number(s), recent.at(-1));
    } else if (arg === "line2") {
      const module = await src.line();
      const name = await src.line();
      add(module, name);
    } else if (arg < 0) {
      const lenBytes = await src.take(-arg);
      const len = arg === -1 ? lenBytes[0] : arg === -4 ? lenBytes.readUInt32LE(0) : Number(lenBytes.readBigUInt64LE(0));
      if (STRING_OPS.has(op) && len < 4096) str = (await src.take(len)).toString(op === 0x55 || op === 0x54 ? "latin1" : "utf8");
      else await src.skip(len);
    } else if (arg > 0) {
      const b = await src.take(arg);
      if (op === 0x68) str = memo.get(b[0]);
      if (op === 0x6a) str = memo.get(b.readUInt32LE(0));
      if (op === 0x71) memo.set(b[0], recent.at(-1));
      if (op === 0x72) memo.set(b.readUInt32LE(0), recent.at(-1));
    }
    if (op === 0x94) memo.set(memoNext++, recent.at(-1));
    if (op === 0x93) {
      const [module, name] = recent.slice(-2);
      add(module ?? "?", name ?? "?");
    }
    // Remember the last two string values for STACK_GLOBAL; other pushes break the pair.
    if (str !== undefined) recent = [...recent.slice(-1), str];
    else if (![0x94, 0x71, 0x72, 0x70, 0x95].includes(op)) recent = [...recent.slice(-1), undefined];
    if (op === 0x2e) {
      pickles++;
      recent = [];
    }
  }
  return { imports: [...found.values()], pickles };
}

export function scanPickleBuffer(buf: Buffer, maxPickles = 8) {
  return walk(bufferSource(buf), maxPickles);
}

// ---------- files ----------

interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

async function zipEntries(path: string): Promise<{ r: FileReader; entries: ZipEntry[] }> {
  const r = await FileReader.open(path, 0, 1 << 16);
  const tail = Math.min(r.size, 65_557);
  r.pos = r.size - tail;
  const buf = Buffer.from(await r.bytes(tail));
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("No zip directory");
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    // Zip64: the locator sits just before the end record.
    const loc = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
    if (loc < 0) throw new Error("Zip64 locator missing");
    r.pos = Number(buf.readBigUInt64LE(loc + 8));
    const rec = Buffer.from(await r.bytes(56));
    count = Number(rec.readBigUInt64LE(32));
    cdOffset = Number(rec.readBigUInt64LE(48));
  }
  r.pos = cdOffset;
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const h = Buffer.from(await r.bytes(46));
    if (h.readUInt32LE(0) !== 0x02014b50) break;
    const method = h.readUInt16LE(10);
    let compressed = h.readUInt32LE(20);
    let size = h.readUInt32LE(24);
    const nameLen = h.readUInt16LE(28);
    const extraLen = h.readUInt16LE(30);
    const commentLen = h.readUInt16LE(32);
    let offset = h.readUInt32LE(42);
    const name = (await r.bytes(nameLen)).toString("utf8");
    const extra = Buffer.from(await r.bytes(extraLen));
    await r.skip(commentLen);
    for (let p = 0; p + 4 <= extra.length;) {
      const id = extra.readUInt16LE(p);
      const len = extra.readUInt16LE(p + 2);
      if (id === 0x0001) {
        let q = p + 4;
        if (size === 0xffffffff) { size = Number(extra.readBigUInt64LE(q)); q += 8; }
        if (compressed === 0xffffffff) { compressed = Number(extra.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(extra.readBigUInt64LE(q)); }
      }
      p += 4 + len;
    }
    entries.push({ name, method, compressed, size, offset });
  }
  return { r, entries };
}

export async function isZip(head: Buffer) {
  return head.length >= 4 && head.readUInt32LE(0) === 0x04034b50;
}

// A pickle stream starts with PROTO (0x80) and a protocol number, or with an old opcode.
export function looksLikePickle(head: Buffer) {
  return head.length >= 2 && ((head[0] === 0x80 && head[1] >= 2 && head[1] <= 5) || head[0] === 0x28 || head[0] === 0x7d || head[0] === 0x5d);
}

export async function scanPickleFile(path: string): Promise<{ format: "pickle" | "pytorch-zip"; imports: PickleImport[] }> {
  const head = Buffer.alloc(4);
  const fh = await (await import("node:fs")).promises.open(path, "r");
  await fh.read(head, 0, 4, 0);
  await fh.close();

  if (await isZip(head)) {
    const { r, entries } = await zipEntries(path);
    try {
      const pkls = entries.filter((e) => e.name.endsWith(".pkl"));
      if (!pkls.length) throw new Error("A zip with no pickle inside");
      const imports = new Map<string, PickleImport>();
      for (const e of pkls) {
        r.pos = e.offset;
        const lh = Buffer.from(await r.bytes(30));
        r.pos = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
        if (e.compressed > 256 * 1024 * 1024) throw new Error("Pickle inside the zip is too large to scan");
        const raw = Buffer.from(await r.bytes(e.compressed));
        const data = e.method === 8 ? inflateRawSync(raw) : raw;
        for (const i of (await scanPickleBuffer(data)).imports) imports.set(`${i.module}.${i.name}`, i);
      }
      return { format: "pytorch-zip", imports: [...imports.values()] };
    } finally {
      await r.close();
    }
  }

  // Legacy torch.save files are several pickles in a row (magic, protocol, sys info, the
  // object, storage keys) followed by raw tensor bytes. The first five are all that matter.
  const r = await FileReader.open(path);
  try {
    const { imports } = await walk(readerSource(r, r.size), 5);
    return { format: "pickle", imports };
  } finally {
    await r.close();
  }
}

// ---------- safetensors ----------

export async function readSafetensors(path: string) {
  const r = await FileReader.open(path, 0, 1 << 20);
  try {
    const n = await r.u64();
    if (n <= 0 || n > 100 * 1024 * 1024) throw new Error("Not a safetensors header");
    const header = JSON.parse((await r.bytes(n)).toString("utf8")) as Record<string, { dtype: string; shape: number[] } | Record<string, string>>;
    let parameters = 0;
    let tensors = 0;
    const dtypes = new Map<string, number>();
    const byGroup = new Map<string, { count: number; params: number }>();
    for (const [name, t] of Object.entries(header)) {
      if (name === "__metadata__") continue;
      const info = t as { dtype: string; shape: number[] };
      const p = info.shape.reduce((a, b) => a * b, 1);
      parameters += p;
      tensors++;
      dtypes.set(info.dtype, (dtypes.get(info.dtype) ?? 0) + p);
      const layer = name.match(/(?:layers?|h|blocks?)\.(\d+)\./);
      const group = layer ? `layer ${layer[1]}` : name.split(".").slice(0, 2).join(".");
      const g = byGroup.get(group) ?? { count: 0, params: 0 };
      g.count++;
      g.params += p;
      byGroup.set(group, g);
    }
    return {
      parameters,
      tensors,
      dtype: [...dtypes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
      metadata: (header.__metadata__ as Record<string, string> | undefined) ?? {},
      groups: [...byGroup.entries()].map(([name, g]) => ({ name, ...g })),
    };
  } finally {
    await r.close();
  }
}
