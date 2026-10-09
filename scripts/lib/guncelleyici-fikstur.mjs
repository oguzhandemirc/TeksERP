// =============================================================================
// BEKÇİ FİKSTÜRÜ — Windows paketinin güncelleyici ikilisi (R15, `Teks-Erp/scripts/lib/guncelleyici-blok.ts`)
// =============================================================================
// Sahte ikili PE32+ x64 başlığı taşır (çalıştırılmaz) ve BELİRLENİMLİDİR: yayıncının ölçtüğü blok
// (`native/test-vektorleri/guncelleme-yayinci.json`) her koşumda aynı çıkar. Künye `deploy/paketle.ps1`in
// `PAKET.json` `hizmetIkilileri` biçimidir (paketleyici ikiliyi koşturup ölçer; fikstür onu taklit eder).
// =============================================================================
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const FIKSTUR_GUNCELLEYICI_SURUMU = '1.4.0';

/** PE32+ x64 başlıklı 1024 baytlık sahte güncelleyici (`etiket` farklı ikili üretir). */
export function sahteWindowsGuncelleyici(etiket = 'tekserp-guncelleyici bekci fikstur') {
  const b = Buffer.alloc(1024);
  b.write('MZ', 0, 'latin1');
  b.writeInt32LE(0x40, 0x3c);
  b.write('PE\0\0', 0x40, 'latin1');
  b.writeUInt16LE(0x8664, 0x44);
  b.write(etiket, 0x100, 'latin1');
  return b;
}

/** ELF64 x86-64 başlıklı sahte ikili (Windows paketine yanlış hedef sondası). */
export function sahteLinuxGuncelleyici() {
  const b = Buffer.alloc(1024);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(b, 0);
  b.writeUInt16LE(0x3e, 18);
  return b;
}

export const sha256Hex = (b) => createHash('sha256').update(b).digest('hex');

/** `<kok>/runtime/tekserp-guncelleyici.exe` yazar; PAKET.json `hizmetIkilileri` değerini döner. */
export function fiksturGuncelleyiciYaz(kok, { surum = FIKSTUR_GUNCELLEYICI_SURUMU, ikili = sahteWindowsGuncelleyici() } = {}) {
  fs.mkdirSync(path.join(kok, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'runtime', 'tekserp-guncelleyici.exe'), ikili);
  return { 'tekserp-guncelleyici.exe': { surum, boyut: ikili.length, sha256: sha256Hex(ikili) } };
}
