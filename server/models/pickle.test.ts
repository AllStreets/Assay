import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { judge, scanPickleBuffer, scanPickleFile } from "./pickle.js";

const str4 = (s: string) => Buffer.concat([Buffer.from([0x8c, s.length]), Buffer.from(s)]);

// Protocol 0: GLOBAL os.system, then REDUCE with a command. This is the classic payload.
const PROTO0_EVIL = Buffer.from("cos\nsystem\n(S'echo pwned'\ntR.", "latin1");

// Protocol 4: the module and name are pushed as strings, memoized, then STACK_GLOBAL.
const PROTO4_EVIL = Buffer.concat([
  Buffer.from([0x80, 0x04]),
  str4("posix"), Buffer.from([0x94]),
  str4("system"), Buffer.from([0x94]),
  Buffer.from([0x93, 0x94]),
  str4("id"), Buffer.from([0x94, 0x85, 0x94, 0x52, 0x94, 0x2e]),
]);

// Protocol 4 again, but the strings come back out of the memo (BINGET) before
// STACK_GLOBAL, the way real pickles reuse repeated names.
const PROTO4_MEMO = Buffer.concat([
  Buffer.from([0x80, 0x04]),
  str4("builtins"), Buffer.from([0x94]),
  str4("exec"), Buffer.from([0x94]),
  Buffer.from([0x30, 0x30]), // pop both
  Buffer.from([0x68, 0x00, 0x68, 0x01]), // BINGET 0, BINGET 1
  Buffer.from([0x93, 0x2e]),
]);

// A benign checkpoint shape: collections.OrderedDict and torch._utils._rebuild_tensor_v2.
const BENIGN = Buffer.concat([
  Buffer.from([0x80, 0x02]),
  Buffer.from("ccollections\nOrderedDict\nq\x00)Rq\x01", "latin1"),
  Buffer.from("ctorch._utils\n_rebuild_tensor_v2\nq\x02", "latin1"),
  Buffer.from([0x2e]),
]);

test("finds os.system in a protocol 0 pickle", async () => {
  const { imports } = await scanPickleBuffer(PROTO0_EVIL);
  assert.deepEqual(imports, [{ module: "os", name: "system", verdict: "dangerous" }]);
});

test("finds posix.system through STACK_GLOBAL", async () => {
  const { imports } = await scanPickleBuffer(PROTO4_EVIL);
  assert.deepEqual(imports, [{ module: "posix", name: "system", verdict: "dangerous" }]);
});

test("follows memo references into STACK_GLOBAL", async () => {
  const { imports } = await scanPickleBuffer(PROTO4_MEMO);
  assert.deepEqual(imports, [{ module: "builtins", name: "exec", verdict: "dangerous" }]);
});

test("passes a benign checkpoint", async () => {
  const { imports } = await scanPickleBuffer(BENIGN);
  assert.ok(imports.length === 2);
  assert.ok(imports.every((i) => i.verdict === "safe"));
});

test("judges the boundary cases", () => {
  assert.equal(judge("builtins", "set"), "safe");
  assert.equal(judge("builtins", "eval"), "dangerous");
  assert.equal(judge("subprocess.Popen", "x"), "dangerous");
  assert.equal(judge("transformers.training_args", "TrainingArguments"), "unknown");
});

// A minimal PyTorch-style zip: archive/data.pkl, deflated, so the zip path is exercised.
function zip(name: string, data: Buffer) {
  const comp = deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + comp.length;
  const cd = Buffer.concat([central, nameBuf]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, comp, cd, end]);
}

test("scans the pickle inside a PyTorch zip file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "assay-test-"));
  try {
    const file = path.join(dir, "model.pt");
    await fs.writeFile(file, zip("archive/data.pkl", PROTO4_EVIL));
    const r = await scanPickleFile(file);
    assert.equal(r.format, "pytorch-zip");
    assert.deepEqual(r.imports.map((i) => `${i.module}.${i.name}:${i.verdict}`), ["posix.system:dangerous"]);

    const legacy = path.join(dir, "model.bin");
    await fs.writeFile(legacy, Buffer.concat([BENIGN, BENIGN]));
    const l = await scanPickleFile(legacy);
    assert.equal(l.format, "pickle");
    assert.ok(l.imports.every((i) => i.verdict === "safe"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
