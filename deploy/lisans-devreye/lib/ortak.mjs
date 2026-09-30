// Aşama doğrulayıcı ve T4 gözleminin ortak parçaları: üç sonuçlu değerlendirme ve ölçüm çıktısı ayrıştırıcıları.
// Üç sonuç ayrıdır — "araç yok/erişilemedi" (OLCULEMEDI) "uyumsuz" (IHLAL) sayılmaz, "uyumlu" da sayılmaz.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evYolu } from './ag.mjs';

export const U = 'UYUMLU';
export const I = 'IHLAL';
export const O = 'OLCULEMEDI';
export const s = (sonuc, not = '') => ({ sonuc, not });

export const VARSAYILAN = Object.freeze({
  saticiKok: 'https://lisans-test.etkiliyazilim.com',
  tpKok: 'http://100.70.47.46:4000',
  portalKok: 'http://127.0.0.1:14611',
  kanal: 'testfabrika',
  /** vds-dogrula tabanı: sahaya özgü veri, repo DIŞI (betiğin varsayılanıyla aynı; `--vds-taban=` ezer). */
  vdsTaban: '~/.tekserp/vds-taban',
  traefikBaslangic: '2026-09-01T09:47:37',
});
export const SATICI_KONTEYNER = 'tekserp-satici-hazirlik';
export const GUNCELLEME_KOK = '/opt/stack/apps/tekserp-guncelleme';
/** Repodaki VDS salt-okuma betiği (deploy/vds-dogrula.sh) ve üç taban dosyası. */
export const VDS_DOGRULA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../vds-dogrula.sh');
export const VDS_TABAN_DOSYALARI = Object.freeze(['adnansahin.sha', 'kok.sha', 'diger.sha']);
/** vds-dogrula koşumu: taban dizini açıkça verilir (betiğin ortam varsayılanına güvenilmez). */
export const vdsDogrulaKos = (ag, g) => ag.yerelBetik(VDS_DOGRULA, [`--taban=${evYolu(g.vdsTaban)}`]);

/** Birden çok sonucun en kötüsü: IHLAL > OLCULEMEDI > UYUMLU. */
export function birlestir(sonuclar) {
  const agirlik = { [U]: 0, [O]: 1, [I]: 2 };
  const kotu = sonuclar.reduce((a, b) => (agirlik[b.sonuc] > agirlik[a.sonuc] ? b : a), s(U));
  return s(kotu.sonuc, sonuclar.filter((x) => x.not).map((x) => x.not).join(' · '));
}

/** Dosya var ve grup/diğerine kapalı mı (içerik OKUNMAZ). */
export function izin600(dosya) {
  const f = evYolu(dosya);
  if (!fs.existsSync(f)) return s(I, `yok: ${f}`);
  const m = fs.statSync(f).mode & 0o777;
  return m & 0o077 ? s(I, `izin ${m.toString(8)} (600 olmalı): ${f}`) : s(U);
}

/** ssh/tp sonucu: bağlantı kurulamadıysa OLCULEMEDI; tp kimlik kapısı (99) yanlış makinedir → IHLAL. */
export function uzakSonuc(r) {
  if (r.kod === 99) return s(I, 'kimlik kapısı: yanlış makine');
  if (r.kod === null || r.kod === 255) return s(O, `bağlantı yok (${(r.hata || '').trim().split('\n')[0] || 'zaman aşımı'})`);
  return null;
}

/** `ad=deger` satırları (tp betiklerinin çıktı biçimi). */
export function satirlar(cikti) {
  const m = {};
  for (const l of `${cikti}`.split(/\r?\n/)) {
    const i = l.indexOf('=');
    if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return m;
}

/** HTTP sonucu: bağlantı yoksa OLCULEMEDI; 401/403 belirteç sorunu (ölçülemedi — sistem hakkında hüküm yok). */
export function httpSonuc(r, beklenen = 200) {
  if (r.durum === null || r.durum === undefined) return s(O, `bağlantı yok (${r.hata ?? '?'})`);
  if ((r.durum === 401 || r.durum === 403) && beklenen !== r.durum) return s(O, `belirteç reddedildi (${r.durum}) — yeni belirteç yaz`);
  if (r.durum !== beklenen) return s(I, `HTTP ${r.durum} (beklenen ${beklenen})`);
  return null;
}

export const PS_GUC = [
  "$b = Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1",
  "'guc=' + [string]$b.PowerOnline",
  "$p = Get-Command pwsh -ErrorAction SilentlyContinue",
  "'pwsh=' + [string]($null -ne $p)",
].join('\n');

export function gucDegerlendir(r) {
  const u = uzakSonuc(r);
  if (u) return u;
  const m = satirlar(r.cikti);
  if (m.guc === undefined) return s(O, 'güç durumu okunamadı');
  if (m.guc !== 'True') return s(I, 'PİLDE — uzun iş başlatılmaz (prize tak)');
  return m.pwsh === 'True' ? s(U) : s(I, 'pwsh 7 yok (paketle.ps1 -Korumali 7 ister)');
}

/** vds-dogrula.sh: 0 aynı · 1 fark · 2 ölçülemedi (betiğin kendi sözleşmesi). */
export function vdsDogrulaDegerlendir(r) {
  const ozet = `${r.cikti}`.trim().split('\n')[0] ?? '';
  if (r.kod === 0) return s(U, ozet);
  if (r.kod === 1) return s(I, `adnansahin FARK — DUR: ${ozet}`);
  return s(O, ozet || 'vds-dogrula koşmadı');
}

export function traefikDegerlendir(r, g) {
  const u = uzakSonuc(r);
  if (u) return u;
  const [basla, sayi] = `${r.cikti}`.trim().split(/\s+/);
  if (!basla || sayi === undefined) return s(O, 'Traefik okunamadı');
  if (sayi !== '0') return s(I, `Traefik RestartCount=${sayi}`);
  return basla.startsWith(g.traefikBaslangic) ? s(U, `StartedAt ${basla}`) : s(I, `Traefik yeniden başlamış: StartedAt ${basla} (taban ${g.traefikBaslangic})`);
}
