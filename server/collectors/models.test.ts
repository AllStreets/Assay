import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { merge, readWeights } from "./models.js";

// A pickle the scanner can't follow to the end must never be called safe.
test("an unreadable pickle fails closed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "assay-"));
  const file = path.join(dir, "broken.pt");
  // Protocol 2 header, then an opcode that doesn't exist.
  await fs.writeFile(file, Buffer.concat([Buffer.from([0x80, 0x02, 0xff]), Buffer.alloc(2_000_000)]));
  const r = await readWeights(file);
  assert.ok(r.file.error, "the scan reports an error");
  assert.equal(r.file.format, "pickle");
  assert.equal(merge([r]).safeToLoad, false);
  await fs.rm(dir, { recursive: true, force: true });
});
