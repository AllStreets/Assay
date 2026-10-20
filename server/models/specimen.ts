import { promises as fs } from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { HOME } from "../paths.js";

// Assay's test specimen, in the spirit of the EICAR antivirus test file: a PyTorch-format
// file whose pickle imports os.system, the exact pattern malicious models use. Its command
// only prints a line, so even loading it does no harm. It exists so anyone can watch Assay
// catch a code-on-load model without hunting for a real one.

const MESSAGE = "echo 'Assay test specimen: a real malicious model would have run a command here.'";

function payload() {
  const cmd = Buffer.from(MESSAGE, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(cmd.length);
  return Buffer.concat([
    Buffer.from([0x80, 0x02]),
    Buffer.from("cposix\nsystem\n", "latin1"), // GLOBAL posix.system
    Buffer.from([0x58]), len, cmd, // BINUNICODE command
    Buffer.from([0x85, 0x52, 0x2e]), // TUPLE1, REDUCE, STOP
  ]);
}

export function specimenBytes() {
  const data = payload();
  const comp = deflateRawSync(data);
  const name = Buffer.from("assay-test-specimen/data.pkl");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const cd = Buffer.concat([central, name]);
  // Zero bytes stand in for tensor storage, keeping the file past the 1 MB floor Assay uses
  // to skip tiny non-model files. They sit before the directory, which zip offsets allow.
  const pad = Buffer.alloc(1_100_000);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(local.length + name.length + comp.length + pad.length, 16);
  return Buffer.concat([local, name, comp, pad, cd, end]);
}

export async function writeSpecimen(dir = path.join(HOME, "Downloads")) {
  const file = path.join(dir, "assay-test-specimen.pt");
  await fs.writeFile(file, specimenBytes());
  return file;
}
