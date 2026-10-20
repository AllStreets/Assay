import type { TensorGroup } from "../../shared/types.js";
import { FileReader } from "./reader.js";

// GGUF, the format llama.cpp and Ollama use: a header of typed key-value metadata, then a
// table of tensors. Everything Assay reports comes from these two sections.

const enum T { U8, I8, U16, I16, U32, I32, F32, BOOL, STRING, ARRAY, U64, I64, F64 }

// llama.cpp's general.file_type values.
const FILE_TYPES: Record<number, string> = {
  0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 7: "Q8_0", 8: "Q5_0", 9: "Q5_1",
  10: "Q2_K", 11: "Q3_K_S", 12: "Q3_K_M", 13: "Q3_K_L", 14: "Q4_K_S", 15: "Q4_K_M",
  16: "Q5_K_S", 17: "Q5_K_M", 18: "Q6_K", 19: "IQ2_XXS", 20: "IQ2_XS", 21: "Q2_K_S",
  22: "IQ3_XS", 23: "IQ3_XXS", 24: "IQ1_S", 25: "IQ4_NL", 26: "IQ3_S", 27: "IQ3_M",
  28: "IQ2_S", 29: "IQ2_M", 30: "IQ4_XS", 31: "IQ1_M", 32: "BF16", 36: "TQ1_0", 37: "TQ2_0", 38: "MXFP4",
};

// ggml tensor types, used when file_type is missing.
const TENSOR_TYPES: Record<number, string> = {
  0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0", 7: "Q5_1", 8: "Q8_0", 9: "Q8_1",
  10: "Q2_K", 11: "Q3_K", 12: "Q4_K", 13: "Q5_K", 14: "Q6_K", 15: "Q8_K", 16: "IQ2_XXS",
  17: "IQ2_XS", 18: "IQ3_XXS", 19: "IQ1_S", 20: "IQ4_NL", 21: "IQ3_S", 22: "IQ2_S", 23: "IQ4_XS",
  24: "I8", 25: "I16", 26: "I32", 27: "I64", 28: "F64", 29: "IQ1_M", 30: "BF16", 34: "TQ1_0", 35: "TQ2_0", 39: "MXFP4",
};

export interface GgufReport {
  version: number;
  metadata: Record<string, string | number | boolean>;
  architecture?: string;
  name?: string;
  parameters: number;
  quantization?: string;
  contextLength?: number;
  layers?: number;
  license?: string;
  chatTemplate?: string;
  tensorCount: number;
  groups: TensorGroup[];
}

async function str(r: FileReader) {
  const len = await r.u64();
  if (len > 64 * 1024 * 1024) throw new Error("String too long for a GGUF header");
  return (await r.bytes(len)).toString("utf8");
}

async function value(r: FileReader, type: number, keep: boolean): Promise<string | number | boolean | undefined> {
  switch (type) {
    case T.U8: return r.u8();
    case T.I8: return (await r.bytes(1)).readInt8(0);
    case T.U16: return r.u16();
    case T.I16: return (await r.bytes(2)).readInt16LE(0);
    case T.U32: return r.u32();
    case T.I32: return r.i32();
    case T.F32: return r.f32();
    case T.BOOL: return (await r.u8()) !== 0;
    case T.STRING: return str(r);
    case T.U64: return r.u64();
    case T.I64: return r.i64();
    case T.F64: return r.f64();
    case T.ARRAY: {
      const inner = await r.u32();
      const n = await r.u64();
      // Arrays are tokenizer vocabularies and scores: skip them, keep only their length.
      const fixed: Record<number, number> = { [T.U8]: 1, [T.I8]: 1, [T.U16]: 2, [T.I16]: 2, [T.U32]: 4, [T.I32]: 4, [T.F32]: 4, [T.BOOL]: 1, [T.U64]: 8, [T.I64]: 8, [T.F64]: 8 };
      if (fixed[inner] !== undefined) await r.skip(fixed[inner] * n);
      else for (let i = 0; i < n; i++) await value(r, inner, false);
      return keep ? `[${n} items]` : undefined;
    }
    default:
      throw new Error(`Unknown GGUF value type ${type}`);
  }
}

export async function isGguf(head: Buffer) {
  return head.length >= 4 && head.toString("latin1", 0, 4) === "GGUF";
}

export async function readGguf(path: string): Promise<GgufReport> {
  const r = await FileReader.open(path);
  try {
    if ((await r.bytes(4)).toString("latin1") !== "GGUF") throw new Error("Not a GGUF file");
    const version = await r.u32();
    if (version < 2 || version > 3) throw new Error(`Unsupported GGUF version ${version}`);
    const tensorCount = await r.u64();
    const kvCount = await r.u64();
    const metadata: Record<string, string | number | boolean> = {};
    for (let i = 0; i < kvCount; i++) {
      const key = await str(r);
      const type = await r.u32();
      const v = await value(r, type, true);
      if (v !== undefined) metadata[key] = v;
    }

    let parameters = 0;
    const byGroup = new Map<string, { count: number; params: number }>();
    const types = new Map<string, number>();
    for (let i = 0; i < tensorCount; i++) {
      const name = await str(r);
      const dims = await r.u32();
      let n = 1;
      for (let d = 0; d < dims; d++) n *= await r.u64();
      const type = await r.u32();
      await r.u64(); // data offset
      parameters += n;
      const t = TENSOR_TYPES[type] ?? `type ${type}`;
      types.set(t, (types.get(t) ?? 0) + n);
      const block = name.match(/^blk\.(\d+)\./);
      const group = block ? `layer ${block[1]}` : name.split(".")[0];
      const g = byGroup.get(group) ?? { count: 0, params: 0 };
      g.count++;
      g.params += n;
      byGroup.set(group, g);
    }

    const arch = metadata["general.architecture"] as string | undefined;
    const ft = metadata["general.file_type"];
    const dominant = [...types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const groups = [...byGroup.entries()].map(([name, g]) => ({ name, ...g }));
    groups.sort((a, b) => order(a.name) - order(b.name));
    return {
      version,
      metadata,
      architecture: arch,
      name: metadata["general.name"] as string | undefined,
      parameters,
      quantization: typeof ft === "number" ? FILE_TYPES[ft] ?? dominant : dominant,
      contextLength: arch ? (metadata[`${arch}.context_length`] as number | undefined) : undefined,
      layers: arch ? (metadata[`${arch}.block_count`] as number | undefined) : undefined,
      license: (metadata["general.license"] as string | undefined) ?? (metadata["general.license.name"] as string | undefined),
      chatTemplate: metadata["tokenizer.chat_template"] as string | undefined,
      tensorCount,
      groups,
    };
  } finally {
    await r.close();
  }
}

function order(name: string) {
  const m = name.match(/^layer (\d+)$/);
  if (m) return 1000 + Number(m[1]);
  if (/embd|embed/.test(name)) return 0;
  if (/output|lm_head/.test(name)) return 100000;
  return 500;
}
