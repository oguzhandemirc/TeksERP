// =============================================================================
// SÜRÜM NOTU MODAL TAVANI — paketleme anında "kaç tur birden çıkıyor" uyarısı
// =============================================================================
// Panel ve tablet açılış modali en fazla MODAL_TAVAN yayın gösterir; fazlası
// "gizlenen" sayısıyla arşive düşer (Electron/src/lib/surum-notlari.ts,
// mobil/src/services/surumNotlari.ts). Yayınlanmamış turlar birikirse sahadaki
// makine ilk güncellemede bazı turların notunu modalde okumaz. Bunu yalnız
// paketleme bilir (saha sürümü + hedef sürüm orada yan yana) — kapı değil.
// UYARIDIR, blok değil: operatör bilerek çıkarabilir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { karsilastir } from './surum.mjs';

/** İki istemcideki sabitle AYNI olmalı — `check-surum-notlari.mjs` §7 ölçer. */
export const MODAL_TAVAN = 5;

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function surumNotlariniOku(kok = KOK) {
  const d = JSON.parse(fs.readFileSync(path.join(kok, 'surum-notlari.json'), 'utf8'));
  return Array.isArray(d.yayinlar) ? d.yayinlar : [];
}

/**
 * Sahadaki sürümden (hariç) hedef sürüme (dahil) kadar bu ürünü ilgilendiren
 * turlar — istemcinin "sürüm atlayan makine aradaki TÜM yayınları görür"
 * kuralının paketleme tarafındaki ikizi. `sahaSurum` null ise (yayın hiç yok /
 * okunamadı) tüm turlar aday sayılır.
 */
export function bekleyenTurlar(yayinlar, urun, sahaSurum, hedefSurum) {
  return yayinlar.filter((y) => {
    const s = y?.surumler?.[urun];
    if (!s) return false;
    if (hedefSurum && karsilastir(s, hedefSurum) > 0) return false;
    if (sahaSurum && karsilastir(s, sahaSurum) <= 0) return false;
    return (y.maddeler ?? []).some((m) => m.kapsam === urun || m.kapsam === 'her-ikisi');
  });
}

/** Tavan aşılıyorsa uyarı metni, aşılmıyorsa null. */
export function tavanUyarisi(yayinlar, urun, sahaSurum, hedefSurum) {
  const turlar = bekleyenTurlar(yayinlar, urun, sahaSurum, hedefSurum);
  if (turlar.length <= MODAL_TAVAN) return null;
  const gizlenen = turlar.length - MODAL_TAVAN;
  // İstemci en yeni önce sıralı listeyi `slice(0, TAVAN)` ile keser → en ESKİLER gizlenir.
  const eskiler = [...turlar].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, gizlenen).map((y) => y.id);
  return (
    `${urun} ${sahaSurum ?? '(yayın yok)'} → ${hedefSurum}: ${turlar.length} yayınlanmamış tur, ` +
    `açılış modali en fazla ${MODAL_TAVAN} gösterir. ${gizlenen} tur (${eskiler.join(', ')}) modalde ` +
    `GÖRÜNMEYECEK; operatör onları Ayarlar → Sürüm Notları arşivinden okuyabilir. Uyarıdır, blok değil.`
  );
}
