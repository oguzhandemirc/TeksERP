#!/usr/bin/env node
// =============================================================================
// BEKÇİ — PANEL ORTAK KİMLİĞİ (tek ortak paket O5) · zero-dep, DB'siz, ağsız
// =============================================================================
// Yüklemler `scripts/lib/panel-kimlik.mjs`te yaşar (paketleme CLI'si AYNI fonksiyonları çağırır); bu dosya onları
// BELLEKTEKİ kopyalara karşı sınar — dosyaya yazılmaz.
//   P  dinlenme: ağaç ortak kimlikte (package.json tabanı · işaretçi yok · ana süreç literalsiz · çözücü kayıttan okur)
//   N  negatif sondalar: her ihlal KIRMIZI verir (appId eski · işaretçi geri · publish/output eski kanal · ana süreçte literal · çözücü izi yok)
//   O  ölçülemedi: kayıt bozuk / dosya yok → Olculemedi (sessiz yeşil değil)
//   A  paket geri okuma farkı: sağlam sentetik paket temiz; url · appId · exe · başlık · yabancı kimlik → kırmızı
//   K  kablo: commit kapısı + CI + paketleme betiği bu ölçümü çağırır; tetik okunan her dosyayı kapsar
// Cırcır değil (taban yok). Sonuç: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ.
//   node scripts/test_panel_kimlik.mjs
// =============================================================================

import { ESKI_KAYIT_REL, KAYIT_REL, Olculemedi, dosyalariOku } from './lib/dagitim.mjs';
import {
  PANEL_DINLENME_DOSYALARI, PANEL_ISARETCI_REL, PANEL_KIMLIK_BEKCI_DOSYALARI, PANEL_KIMLIK_COZUCU_REL, PANEL_MAIN_REL, PANEL_PAKET_REL,
  ortakKimlik, panelDinlenmeFarki, panelKimlikTetigi, panelOrtakArtefaktFarki,
} from './lib/panel-kimlik.mjs';

let kotu = 0;
const ol = (ad, kosul, detay = '') => {
  console.log(`${kosul ? '✅' : '❌'} ${ad}`);
  if (!kosul) {
    kotu++;
    if (detay) console.log(`     ${String(detay).slice(0, 500)}`);
  }
};
const ozel = (fn) => {
  try {
    return { f: fn() };
  } catch (e) {
    return { hata: e };
  }
};

const taban = dosyalariOku([...new Set([...PANEL_DINLENME_DOSYALARI, ...PANEL_KIMLIK_BEKCI_DOSYALARI, '.github/workflows/ci.yml'])]);
const kopya = () => ({ ...taban });
const paketDegistir = (d, fn) => {
  const p = JSON.parse(d[PANEL_PAKET_REL]);
  fn(p);
  d[PANEL_PAKET_REL] = JSON.stringify(p);
};
const eskiKayit = JSON.parse(taban[ESKI_KAYIT_REL]);

console.log('test_panel_kimlik — panel ortak kimliği (dinlenme · sondalar · paket farkı · kablo)\n');
const k = ortakKimlik(taban);
const eskiKod = Object.keys(eskiKayit.kanallar)[0];
const eski = eskiKayit.kanallar[eskiKod];

// ---- P ----
{
  const r = ozel(() => panelDinlenmeFarki(taban));
  ol('P0 dinlenme: ağaç ortak kimlikte (fark yok)', r.f?.length === 0, r.hata?.message ?? r.f?.join(' | '));
}

// ---- N: negatif sondalar (her biri KIRMIZI vermeli, mesaj ilgili yeri göstermeli) ----
const negatifler = [
  ['N1 package.json appId eski kanalınki', (d) => paketDegistir(d, (p) => { p.build.appId = eski.panel.appId; }), /build\.appId/],
  ['N2 package.json productName eski kanalınki', (d) => paketDegistir(d, (p) => { p.productName = eski.panel.urunAdi; }), /productName/],
  ['N3 müşteri işaretçisi (musteri.json) geri geldi', (d) => { d[PANEL_ISARETCI_REL] = '{"kod":"adnansahin"}'; }, /VAR/],
  ['N4 publish adresi eski kanalın adresi', (d) => paketDegistir(d, (p) => { p.build.publish[0].url = eski.yayin.panelFeed; }), /publish/],
  ['N5 çıktı dizini eski kanal düzeninde', (d) => paketDegistir(d, (p) => { p.build.directories.output = 'release/adnansahin/${version}'; }), /directories\.output/],
  ['N6 ana süreçte ortak appId literali', (d) => { d[PANEL_MAIN_REL] += `\nsetAppUserModelId("${k.appId}");\n`; }, /literalini/],
  ['N7 kimlik çözücü kayıt izini taşımıyor', (d) => { d[PANEL_KIMLIK_COZUCU_REL] = d[PANEL_KIMLIK_COZUCU_REL].replaceAll('panelKimligi', 'xx'); }, /izini/],
  ['N8 paket adı (updater önbelleği kökü) eski', (d) => paketDegistir(d, (p) => { p.name = 'adnan-sahin-erp-admin'; }), /name/],
];
for (const [ad, mut, desen] of negatifler) {
  const d = kopya();
  mut(d);
  const r = ozel(() => panelDinlenmeFarki(d));
  ol(`${ad} → KIRMIZI`, Boolean(r.f?.length) && r.f.some((s) => desen.test(s)), r.hata?.message ?? JSON.stringify(r.f));
}

// ---- O: ölçülemedi ----
for (const [ad, mut] of [
  ['O1 kayıt bozuk JSON', (d) => { d[KAYIT_REL] = '{'; }],
  ['O2 kayıt okunamadı', (d) => { d[KAYIT_REL] = undefined; }],
  ['O3 package.json okunamadı', (d) => { d[PANEL_PAKET_REL] = undefined; }],
  ['O4 ana süreç dosyası okunamadı', (d) => { d[PANEL_MAIN_REL] = undefined; }],
  ['O5 kimlik çözücü okunamadı', (d) => { d[PANEL_KIMLIK_COZUCU_REL] = undefined; }],
]) {
  const d = kopya();
  mut(d);
  const r = ozel(() => panelDinlenmeFarki(d));
  ol(`${ad} → ÖLÇÜLEMEDİ (yeşil/kırmızı değil)`, r.hata instanceof Olculemedi, r.hata?.message ?? 'istisna yok');
}

// ---- A: paket geri okuma farkı ----
const sagPaket = () => ({
  url: k.feed,
  updaterCacheDirName: `${k.paketAdi}-updater`,
  exeler: [`${k.urunAdi}.exe`],
  paket: { name: k.paketAdi, productName: k.urunAdi },
  anaSurec: `const appId = "${k.appId}"; const updateFeedUrl = "${k.feed}"; const windowTitle = "${k.urunAdi}";`,
  arayuz: 'const erpUrl = null; const label = null;',
  arayuzBasligi: k.urunAdi,
});
{
  const r = ozel(() => panelOrtakArtefaktFarki(k, eskiKayit, sagPaket()));
  ol('A0 sağlam sentetik ortak paket → fark yok', r.f?.length === 0, r.hata?.message ?? r.f?.join(' | '));
}
const artNegatif = [
  ['A1 app-update.yml url eski kanalın', (a) => { a.url = eski.yayin.panelFeed; }, /güncelleme adresi/],
  ['A2 ana süreçte eski kanalın appId\'si (ortak appId yok)', (a) => { a.anaSurec = a.anaSurec.replace(k.appId, eski.panel.appId); }, /ortak kimliğin appId/],
  ['A3 ana süreçte ortak appId var AMA eski kanalın appId\'si de gömülü', (a) => { a.anaSurec += ` const x = "${eski.panel.appId}";`; }, /eski ".+" kanalının appId/],
  ['A4 exe adı eski kanalın', (a) => { a.exeler = [`${eski.panel.urunAdi}.exe`]; }, /\.exe/],
  ['A5 arayüz başlığı eski kanal ürün adlı', (a) => { a.arayuzBasligi = `${eski.panel.urunAdi}`; }, /title/],
  ['A6 paketin package.json adı eski', (a) => { a.paket.name = 'adnan-sahin-erp-admin'; }, /package\.json name/],
  ['A7 arayüzde eski kanalın varsayılan sunucusu', (a) => { if (!eski.panel.erpAdresi) throw new Error('eski kayıtta erpAdresi yok — sonda kurulamaz'); a.arayuz += ` const e = "${eski.panel.erpAdresi}";`; }, /varsayılan sunucu/],
];
for (const [ad, mut, desen] of artNegatif) {
  const a = sagPaket();
  mut(a);
  const r = ozel(() => panelOrtakArtefaktFarki(k, eskiKayit, a));
  ol(`${ad} → KIRMIZI`, Boolean(r.f?.length) && r.f.some((s) => desen.test(s)), r.hata?.message ?? JSON.stringify(r.f));
}
{
  const r = ozel(() => panelOrtakArtefaktFarki(k, {}, sagPaket()));
  ol('A8 eski kanal kaydı okunamıyor → ÖLÇÜLEMEDİ (yabancı kimlik kontrolü atlanmaz)', r.hata instanceof Olculemedi, r.hata?.message ?? 'istisna yok');
}

// ---- K: kablo (yüklemler bellekte de sınanır: kablo sökülünce kırmızı vermeli) ----
const kablo = {
  hook: (m) => /panelKimlikTetigi/.test(m) && /test_panel_kimlik\.mjs/.test(m),
  ci: (m) => /node scripts\/test_panel_kimlik\.mjs(?![\w-])/.test(m),
  sh: (m) => /panel-kimlik-kapisi\.mjs" dinlenme/.test(m) && /panel-kimlik-kapisi\.mjs" paket/.test(m),
};
const kaynak = { hook: taban['scripts/hooks/pre-commit.mjs'] ?? '', ci: taban['.github/workflows/ci.yml'] ?? '', sh: taban['deploy/electron-paketle.sh'] ?? '' };
const sok = { hook: (m) => m.replaceAll('panelKimlikTetigi', 'x'), ci: (m) => m.replaceAll('test_panel_kimlik.mjs', 'x.mjs'), sh: (m) => m.replaceAll('panel-kimlik-kapisi.mjs" paket', 'x') };
for (const [ad, aciklama] of [['hook', 'commit kapısı panelKimlikTetigi ile bu bekçiyi koşturur'], ['ci', 'CI bu bekçiyi koşturur'], ['sh', 'paketleme betiği dinlenme + paket kapısını çağırır']]) {
  ol(`K-${ad} ${aciklama}`, kablo[ad](kaynak[ad]));
  ol(`K-${ad} ⭐ SONDA: kablo sökülünce KIRMIZI verir`, kablo[ad](sok[ad](kaynak[ad])) === false && sok[ad](kaynak[ad]) !== kaynak[ad]);
}
ol('K4 tetik okunan her dosyayı kapsar (okunandan dar olamaz)', PANEL_DINLENME_DOSYALARI.every(panelKimlikTetigi) && panelKimlikTetigi('scripts/test_panel_kimlik.mjs'));
ol('K5 tetik ilgisiz dosyada susar', !panelKimlikTetigi('Electron/src/App.tsx'));

console.log(kotu === 0 ? '\nSonuç: yeşil' : `\nSonuç: ${kotu} başarısız`);
process.exit(kotu === 0 ? 0 : 1);
