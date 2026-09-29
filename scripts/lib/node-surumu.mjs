// =============================================================================
// TeksERP — KORUMALI PAKET ÇALIŞMA ZAMANI (deploy/node-surumu.json) — TEK YÜKLEM
// =============================================================================
// Korumalı paketin taşıdığı node ikilisinin sürümü, indirme adresi ve SHA256'sı
// TEK yerde (deploy/node-surumu.json) yaşar. build-korumali.mjs, CI iş akışı,
// bekçi ve (PowerShell tarafında) kur.ps1/paketle.ps1 hep bu kaydı okur; ikinci
// kopya yoktur.
//
// ⚠️ ÜÇ SONUÇ, İKİ DEĞİL: yeşil · kırmızı · ÖLÇÜLEMEDİ. Okunamayan/bozuk kayıt
// "hedef Node yok" DEMEK DEĞİLDİR — `Olculemedi` fırlatılır, çağıran DURUR.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KAYIT_REL = 'deploy/node-surumu.json';

/** Okunamadı / çözülemedi — "hedef yok" ile karışmasın diye ayrı tip. */
export class Olculemedi extends Error {}

export const HEDEFLER = ['win-x64', 'linux-x64'];
const SHA256_DESENI = /^[0-9a-f]{64}$/;
const SURUM_DESENI = /^\d+\.\d+\.\d+$/;
const V8_TABAN_DESENI = /^\d+\.\d+\.\d+\.\d+$/;

export function kayitOku(kok = KOK) {
  let metin;
  try {
    metin = fs.readFileSync(path.join(kok, KAYIT_REL), 'utf8');
  } catch (e) {
    throw new Olculemedi(`${KAYIT_REL} okunamadı: ${e.message}`);
  }
  try {
    return JSON.parse(metin);
  } catch (e) {
    throw new Olculemedi(`${KAYIT_REL} JSON olarak ayrıştırılamadı: ${e.message}`);
  }
}

/** Kaydın iç tutarlılığı (dosyaya/ağa bakmaz). Boş dizi = temiz. */
export function kayitHatalari(kayit) {
  const h = [];
  if (!kayit || typeof kayit !== 'object' || Array.isArray(kayit)) return ['node-surumu kaydı bir nesne değil'];
  if (typeof kayit.surum !== 'string' || !SURUM_DESENI.test(kayit.surum)) h.push(`surum "${kayit.surum}" X.Y.Z değil`);
  if (typeof kayit.cizgi !== 'string' || !/^\d+$/.test(kayit.cizgi)) h.push(`cizgi "${kayit.cizgi}" sayı değil`);
  else if (typeof kayit.surum === 'string' && !kayit.surum.startsWith(`${kayit.cizgi}.`)) {
    h.push(`cizgi "${kayit.cizgi}" surum "${kayit.surum}" ile uyuşmuyor`);
  }
  if (typeof kayit.v8Taban !== 'string' || !V8_TABAN_DESENI.test(kayit.v8Taban)) h.push(`v8Taban "${kayit.v8Taban}" major.minor.build.patch değil`);
  const y = kayit.yayin;
  if (!y || typeof y !== 'object') {
    h.push('yayin bloğu yok');
    return h;
  }
  const kayitliHedefler = Object.keys(y);
  for (const hedef of HEDEFLER) if (!kayitliHedefler.includes(hedef)) h.push(`yayin.${hedef} yok`);
  for (const hedef of kayitliHedefler) {
    if (!HEDEFLER.includes(hedef)) h.push(`yayin.${hedef} tanınmayan hedef (${HEDEFLER.join(' | ')})`);
    const b = y[hedef];
    if (!b || typeof b !== 'object') {
      h.push(`yayin.${hedef} bir nesne değil`);
      continue;
    }
    for (const alan of ['dosya', 'url', 'sha256', 'arsivKok', 'runtimeAlt']) {
      if (typeof b[alan] !== 'string' || !b[alan].trim()) h.push(`yayin.${hedef}.${alan} boş ya da metin değil`);
    }
    if (typeof b.sha256 === 'string' && !SHA256_DESENI.test(b.sha256)) h.push(`yayin.${hedef}.sha256 64 haneli hex değil: "${b.sha256}"`);
    if (typeof kayit.surum === 'string' && typeof b.url === 'string' && !b.url.includes(`/v${kayit.surum}/`)) {
      h.push(`yayin.${hedef}.url sürümü taşımıyor (/v${kayit.surum}/ bekleniyor): "${b.url}"`);
    }
    if (typeof b.dosya === 'string' && typeof b.arsivKok === 'string' && !b.dosya.startsWith(b.arsivKok)) {
      h.push(`yayin.${hedef}.dosya "${b.dosya}" arsivKok "${b.arsivKok}" ile başlamıyor`);
    }
  }
  return h;
}

/** Geçerli kayıt + tek hedef. Geçersizse fırlatır. */
export function hedefCoz(hedef, { kok = KOK, kayit } = {}) {
  const k = kayit ?? kayitOku(kok);
  const hatalar = kayitHatalari(k);
  if (hatalar.length) {
    const e = new Error('NODE SÜRÜM KAYDI KIRMIZI');
    e.satirlar = [...hatalar, 'Önce düzelt: node scripts/test_node_surumu.mjs'];
    throw e;
  }
  if (!HEDEFLER.includes(hedef) || !k.yayin[hedef]) {
    const e = new Error(`BİLİNMEYEN HEDEF: "${hedef ?? ''}"`);
    e.satirlar = [`Kayıtlı hedefler: ${HEDEFLER.join(', ')}`];
    throw e;
  }
  return { kayit: k, surum: k.surum, v8Taban: k.v8Taban, hedef: k.yayin[hedef] };
}

/** node --version çıktısı ("v24.18.0") ↔ kayıt. Boş dizi = eşit. */
export function surumFarki(nodeVersion, kayit) {
  const g = String(nodeVersion ?? '').trim().replace(/^v/, '');
  if (g !== kayit.surum) return [`node sürümü "${g}" — kayıt "${kayit.surum}" bekliyor`];
  return [];
}

/** process.versions.v8'in taban üçlüsü (-node.N atılır). */
export function v8Taban(v8Surum) {
  const r = /^(\d+\.\d+\.\d+\.\d+)/.exec(String(v8Surum ?? ''));
  return r ? r[1] : null;
}
