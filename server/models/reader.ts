import { promises as fs } from "node:fs";

// Sequential reads over a file without loading it: model files run to tens of gigabytes,
// and Assay only ever needs their headers.
export class FileReader {
  private buf = Buffer.alloc(0);
  private bufStart = 0;
  pos: number;

  private constructor(private fh: fs.FileHandle, readonly size: number, start: number, private chunk: number) {
    this.pos = start;
  }

  static async open(path: string, start = 0, chunk = 1 << 20) {
    const fh = await fs.open(path, "r");
    const { size } = await fh.stat();
    return new FileReader(fh, size, start, chunk);
  }

  close() {
    return this.fh.close();
  }

  private async ensure(n: number) {
    const end = this.pos + n;
    if (this.pos >= this.bufStart && end <= this.bufStart + this.buf.length) return;
    if (end > this.size) throw new Error("Unexpected end of file");
    const len = Math.max(n, this.chunk);
    const buf = Buffer.alloc(Math.min(len, this.size - this.pos));
    await this.fh.read(buf, 0, buf.length, this.pos);
    this.buf = buf;
    this.bufStart = this.pos;
  }

  async bytes(n: number): Promise<Buffer> {
    await this.ensure(n);
    const off = this.pos - this.bufStart;
    this.pos += n;
    return this.buf.subarray(off, off + n);
  }

  async skip(n: number) {
    if (this.pos + n > this.size) throw new Error("Unexpected end of file");
    this.pos += n;
  }

  async u8() { return (await this.bytes(1))[0]; }
  async u16() { return (await this.bytes(2)).readUInt16LE(0); }
  async u32() { return (await this.bytes(4)).readUInt32LE(0); }
  async i32() { return (await this.bytes(4)).readInt32LE(0); }
  async u64() { return Number((await this.bytes(8)).readBigUInt64LE(0)); }
  async i64() { return Number((await this.bytes(8)).readBigInt64LE(0)); }
  async f32() { return (await this.bytes(4)).readFloatLE(0); }
  async f64() { return (await this.bytes(8)).readDoubleLE(0); }
}

export async function readHead(path: string, n: number): Promise<Buffer> {
  const fh = await fs.open(path, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}
