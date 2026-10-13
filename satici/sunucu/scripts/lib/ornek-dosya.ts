// Bekçi fikstürü: içerik denetiminden (B7) geçen ya da bilinçli bozuk örnek dosyalar. Zip yazıcısı bağımlılıksız;
// `yalan` alanı merkez dizinine gerçek dışı boyut yazar (bomba/örtüşme sondası).
import { randomBytes } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipGirdisi {
  readonly ad: string;
  readonly veri: Buffer;
  readonly sikistir?: boolean;
  /** Merkez dizinine yazılacak sahte açık/sıkışık boyut. */
  readonly yalan?: { readonly acik?: number; readonly sikisik?: number };
}

export function ornekZip(girdiler: readonly ZipGirdisi[], zip64 = false): Buffer {
  const yerel: Buffer[] = [];
  const merkez: Buffer[] = [];
  let konum = 0;
  for (const g of girdiler) {
    const ad = Buffer.from(g.ad, "utf8");
    const veri = g.sikistir ? deflateRawSync(g.veri) : g.veri;
    const crc = crc32(g.veri);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(g.sikistir ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(veri.length, 18);
    lh.writeUInt32LE(g.veri.length, 22);
    lh.writeUInt16LE(ad.length, 26);
    yerel.push(lh, ad, veri);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(g.sikistir ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(g.yalan?.sikisik ?? veri.length, 20);
    ch.writeUInt32LE(g.yalan?.acik ?? g.veri.length, 24);
    ch.writeUInt16LE(ad.length, 28);
    ch.writeUInt32LE(konum, 42);
    merkez.push(ch, ad);
    konum += 30 + ad.length + veri.length;
  }
  const cd = Buffer.concat(merkez);
  const z64 = zip64 || girdiler.length > 0xfffe;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(z64 ? 0xffff : girdiler.length, 8);
  eocd.writeUInt16LE(z64 ? 0xffff : girdiler.length, 10);
  eocd.writeUInt32LE(z64 ? 0xffffffff : cd.length, 12);
  eocd.writeUInt32LE(z64 ? 0xffffffff : konum, 16);
  if (!z64) return Buffer.concat([...yerel, cd, eocd]);
  // zip64 dizin sonu (56) + konum kaydı (20): sayı/boyut/konum 64 bit.
  const z = Buffer.alloc(56);
  z.writeUInt32LE(0x06064b50, 0);
  z.writeBigUInt64LE(44n, 4);
  z.writeUInt16LE(45, 12);
  z.writeUInt16LE(45, 14);
  z.writeBigUInt64LE(BigInt(girdiler.length), 24);
  z.writeBigUInt64LE(BigInt(girdiler.length), 32);
  z.writeBigUInt64LE(BigInt(cd.length), 40);
  z.writeBigUInt64LE(BigInt(konum), 48);
  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(0x07064b50, 0);
  loc.writeBigUInt64LE(BigInt(konum + cd.length), 8);
  loc.writeUInt32LE(1, 16);
  return Buffer.concat([...yerel, cd, z, loc, eocd]);
}

/** Tek girdili (sıkıştırmasız, rastgele) geçerli zip; toplam boyut ≈ n. */
export function rastgeleZip(n: number, ad = "veri.bin"): Buffer {
  return ornekZip([{ ad, veri: randomBytes(Math.max(1, n - 100 - 2 * ad.length)) }]);
}

/** `%PDF-` imzalı rastgele gövde (içerik denetimi yalnız imzaya bakar). */
export function rastgelePdf(n: number): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(Math.max(1, n - 9))]);
}
