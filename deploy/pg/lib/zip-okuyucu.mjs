// =============================================================================
// Bağımlılıksız ZIP okuyucu (yalnız okuma) + PE Authenticode dizini sondası
// =============================================================================
// EDB zip'i 371 MB / 21 bin girdi: `unzip` her makinede aynı sürümle yok, npm paketi
// eklenmez. Merkezî dizin okunur, girdi konumsal okumayla açılır (tüm arşiv belleğe
// alınmaz). ZIP64 ve şifreli girdi desteklenmez → Olculemedi (sessiz yanlış okuma yok).
// =============================================================================

import fs from 'node:fs';
import zlib from 'node:zlib';

import { Olculemedi } from './pg-ornegi.mjs';

const EOCD = 0x06054b50;
const ZIP64_KONUMLAYICI = 0x07064b50;
const MERKEZI = 0x02014b50;
const YEREL = 0x04034b50;

function tamOku(fd, uzunluk, konum) {
  const b = Buffer.alloc(uzunluk);
  let okunan = 0;
  while (okunan < uzunluk) {
    const n = fs.readSync(fd, b, okunan, uzunluk - okunan, konum + okunan);
    if (n === 0) throw new Olculemedi(`dosya beklenenden kısa (konum ${konum + okunan})`);
    okunan += n;
  }
  return b;
}

/** Arşivi açar; `girdiler` merkezî dizindeki sırayla, `oku(g)` girdinin açılmış baytları. */
export function zipAc(yol) {
  let fd;
  try {
    fd = fs.openSync(yol, 'r');
  } catch (e) {
    throw new Olculemedi(`zip açılamadı: ${e.message}`);
  }
  try {
    const boyut = fs.fstatSync(fd).size;
    const kuyrukBoy = Math.min(boyut, 22 + 0xffff);
    const kuyruk = tamOku(fd, kuyrukBoy, boyut - kuyrukBoy);
    let i = -1;
    for (let p = kuyruk.length - 22; p >= 0; p--) if (kuyruk.readUInt32LE(p) === EOCD) { i = p; break; }
    if (i < 0) throw new Olculemedi('ZIP sonu (EOCD) bulunamadı — dosya zip değil ya da kesik');
    if (i >= 20 && kuyruk.readUInt32LE(i - 20) === ZIP64_KONUMLAYICI) throw new Olculemedi('ZIP64 arşiv — okuyucu desteklemiyor');
    const girdiSayisi = kuyruk.readUInt16LE(i + 10);
    const cdBoyut = kuyruk.readUInt32LE(i + 12);
    const cdOfset = kuyruk.readUInt32LE(i + 16);
    const cd = tamOku(fd, cdBoyut, cdOfset);
    const girdiler = [];
    let p = 0;
    for (let n = 0; n < girdiSayisi; n++) {
      if (cd.readUInt32LE(p) !== MERKEZI) throw new Olculemedi(`merkezî dizin bozuk (girdi ${n})`);
      const bayrak = cd.readUInt16LE(p + 8);
      const adU = cd.readUInt16LE(p + 28);
      const ekU = cd.readUInt16LE(p + 30);
      const yorumU = cd.readUInt16LE(p + 32);
      const g = {
        ad: cd.toString(bayrak & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + adU),
        yontem: cd.readUInt16LE(p + 10),
        sikisik: cd.readUInt32LE(p + 20),
        acik: cd.readUInt32LE(p + 24),
        yerelOfset: cd.readUInt32LE(p + 42),
        sifreli: (bayrak & 1) === 1,
      };
      if (g.sikisik === 0xffffffff || g.acik === 0xffffffff || g.yerelOfset === 0xffffffff) throw new Olculemedi(`ZIP64 girdi: ${g.ad}`);
      girdiler.push(g);
      p += 46 + adU + ekU + yorumU;
    }
    const oku = (g) => {
      if (g.sifreli) throw new Olculemedi(`şifreli girdi: ${g.ad}`);
      const yerel = tamOku(fd, 30, g.yerelOfset);
      if (yerel.readUInt32LE(0) !== YEREL) throw new Olculemedi(`yerel başlık bozuk: ${g.ad}`);
      const ham = tamOku(fd, g.sikisik, g.yerelOfset + 30 + yerel.readUInt16LE(26) + yerel.readUInt16LE(28));
      let veri;
      if (g.yontem === 0) veri = ham;
      else if (g.yontem === 8) veri = zlib.inflateRawSync(ham);
      else throw new Olculemedi(`desteklenmeyen sıkıştırma yöntemi ${g.yontem}: ${g.ad}`);
      if (veri.length !== g.acik) throw new Olculemedi(`açılan boyut merkezî dizinle uyuşmuyor: ${g.ad}`);
      return veri;
    };
    return { boyut, girdiler, oku, kapat: () => fs.closeSync(fd) };
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
}

/**
 * PE dosyasında Authenticode sertifika dizini VAR MI (geçerliliği değil — onu Windows'ta
 * Get-AuthenticodeSignature ölçer). İmzalayan adı yalnız bilgi amaçlı, blob'dan okunur.
 */
export function peImzasi(buf) {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return { pe: false };
  const off = buf.readUInt32LE(0x3c);
  if (off + 24 > buf.length || buf.readUInt32LE(off) !== 0x00004550) return { pe: false };
  const opt = off + 24;
  const dizinler = opt + (buf.readUInt16LE(opt) === 0x20b ? 112 : 96);
  const konum = buf.readUInt32LE(dizinler + 32);
  const boyut = buf.readUInt32LE(dizinler + 36);
  if (!boyut) return { pe: true, imzali: false };
  const blob = buf.subarray(konum, konum + boyut).toString('latin1');
  const m = /EnterpriseDB Corporation|Microsoft Corporation/.exec(blob);
  return { pe: true, imzali: true, imzalayan: m ? m[0] : null };
}
