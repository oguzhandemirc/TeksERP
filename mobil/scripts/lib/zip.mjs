// =============================================================================
// TeksERP Mobil — APK (=ZIP) içinden tek girdi okuma (TEK KAYNAK)
// =============================================================================
// `build-apk.mjs` (derleme sonrası doğrulama) ve `deploy/mobil-yayinla.mjs`
// (yayından önce artefakt kimliği) aynı soruyu soruyor; okuyucu tek.
// =============================================================================

// Buffer açıkça import ediliyor: mobil ESLint Node global'ini bilmez (no-undef).
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import zlib from 'node:zlib';

/**
 * APK (=ZIP) içinden tek bir girdiyi saf Node ile çıkarır.
 * `unzip` ikilisine bağımlı olmuyoruz: komut bulunamazsa doğrulama SESSİZCE
 * atlanmış olurdu — düzeltmeye çalıştığımız hatanın ta kendisi.
 * Merkezî dizinden okur: APK imza bloğu girdilerle dizin arasına girer ama
 * EOCD'deki dizin ofseti doğru kalır.
 */
export function zipGirdisiOku(zipYolu, girdiAdi) {
  const fd = fs.openSync(zipYolu, 'r');
  try {
    const boyut = fs.fstatSync(fd).size;
    // EOCD (End Of Central Directory) son 64KB + 22 bayt içinde olmak zorunda.
    const kuyrukUzunluk = Math.min(boyut, 0x10000 + 22);
    const kuyruk = Buffer.alloc(kuyrukUzunluk);
    fs.readSync(fd, kuyruk, 0, kuyrukUzunluk, boyut - kuyrukUzunluk);
    let eocd = -1;
    for (let i = kuyruk.length - 22; i >= 0; i--) {
      if (kuyruk.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return { hata: 'APK bir ZIP arşivi gibi okunamadı (EOCD bulunamadı).' };

    const girdiSayisi = kuyruk.readUInt16LE(eocd + 10);
    const cdBoyut = kuyruk.readUInt32LE(eocd + 12);
    const cdOfset = kuyruk.readUInt32LE(eocd + 16);
    if (cdOfset === 0xffffffff || cdBoyut === 0xffffffff) {
      return { hata: 'APK ZIP64 biçiminde — bu okuyucu desteklemiyor.' };
    }

    const cd = Buffer.alloc(cdBoyut);
    fs.readSync(fd, cd, 0, cdBoyut, cdOfset);

    let p = 0;
    for (let i = 0; i < girdiSayisi; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) break;
      const yontem = cd.readUInt16LE(p + 10);
      const sikBoyut = cd.readUInt32LE(p + 20);
      const adUzunluk = cd.readUInt16LE(p + 28);
      const ekUzunluk = cd.readUInt16LE(p + 30);
      const yorumUzunluk = cd.readUInt16LE(p + 32);
      const yerelOfset = cd.readUInt32LE(p + 42);
      const ad = cd.toString('utf8', p + 46, p + 46 + adUzunluk);

      if (ad === girdiAdi) {
        // Yerel başlıktaki ad/ek uzunlukları merkezî dizindekinden farklı olabilir.
        const yb = Buffer.alloc(30);
        fs.readSync(fd, yb, 0, 30, yerelOfset);
        if (yb.readUInt32LE(0) !== 0x04034b50) {
          return { hata: 'ZIP yerel başlığı bozuk.' };
        }
        const veriOfset = yerelOfset + 30 + yb.readUInt16LE(26) + yb.readUInt16LE(28);
        const ham = Buffer.alloc(sikBoyut);
        fs.readSync(fd, ham, 0, sikBoyut, veriOfset);
        if (yontem === 0) return { veri: ham };
        if (yontem === 8) return { veri: zlib.inflateRawSync(ham) };
        return { hata: `Desteklenmeyen ZIP sıkıştırma yöntemi: ${yontem}` };
      }
      p += 46 + adUzunluk + ekUzunluk + yorumUzunluk;
    }
    return { hata: `APK içinde "${girdiAdi}" bulunamadı.` };
  } finally {
    fs.closeSync(fd);
  }
}
