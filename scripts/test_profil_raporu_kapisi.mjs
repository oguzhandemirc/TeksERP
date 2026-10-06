#!/usr/bin/env node
// =============================================================================
// BEKÇİ — PROFİL MATRİSİ YAYIN KAPISI (TEK-ORTAK-PAKET §6.4, O13b) · zero-dep, DB'siz, ağsız
// =============================================================================
// Yüklem `scripts/lib/profil-raporu.mjs`, CLI `scripts/profil-matrisi-kapisi.mjs`.
//   §1 rapor denetimi: yok/bozuk/başka commit = ÖLÇÜLEMEDİ · kirli ağaç, kırmızı, eksik/değişmiş/fazla
//      profil = İHLAL · hepsi yeşil = GEÇTİ (her kol geçici dizindeki sahte raporla sondalanır)
//   §2 kapı: kök grup muaf · bilinmeyen grup / kısa commit / bozuk kayıt ÖLÇÜLEMEDİ · kaçış cümlesi
//      kısa ya da kalıp dışıysa İHLAL, geçerliyse ATLANDI (cümle döner)
//   §3 bağlantı: dağıtım kaydını okuyan her yayın betiği (TUKETICILER ∩ YAYIN_BETIGI_DESENI) kapıyı
//      çağırır; sahte betikle negatif sonda
//   §4 rapor yazarı (profil-matrisi.ts) özet ve yolu kapıyla aynı kaynaktan alır, `agacTemiz` yazar
//   §5 CLI çıkış kodları (kök grup 0 · raporsuz commit 2 · geçerli kaçış 0 + ATLANDI satırı)
// ÇIKIŞ: 0 yeşil · 1 KIRMIZI.   node scripts/test_profil_raporu_kapisi.mjs
// =============================================================================
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { KAYIT_REL, KOK, TUKETICILER, kayitAyristir } from './lib/dagitim.mjs';
import {
  baglantiEksikleri,
  profilMatrisiKapisi,
  profilOzeti,
  raporDenetle,
  raporYolu,
  YAYIN_BETIGI_DESENI,
} from './lib/profil-raporu.mjs';

let gecti = 0;
let basarisiz = 0;
function kontrol(etiket, ok, ayrinti = '') {
  if (ok) gecti++;
  else basarisiz++;
  console[ok ? 'log' : 'error'](`${ok ? '✅' : '❌'} ${etiket}${ayrinti ? ` — ${ayrinti}` : ''}`);
}

const kayit = kayitAyristir(fs.readFileSync(path.join(KOK, KAYIT_REL), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'profil-raporu-kapisi-'));
const profilDizini = path.join(tmp, 'profiller');
const raporDizini = path.join(tmp, 'raporlar');
fs.mkdirSync(profilDizini);
fs.mkdirSync(raporDizini);
const PROFILLER = { kapali: '{"ad":"kapali"}\n', f9: '{"ad":"f9"}\n' };
for (const [ad, metin] of Object.entries(PROFILLER)) fs.writeFileSync(path.join(profilDizini, `${ad}.json`), metin);
const ozetler = Object.fromEntries(Object.entries(PROFILLER).map(([ad, m]) => [ad, profilOzeti(m)]));
const COMMIT = randomBytes(20).toString('hex');

const yesilRapor = () => ({
  commit: COMMIT,
  agacTemiz: true,
  sonuc: 'YESIL',
  profiller: Object.entries(ozetler).map(([ad, profilOzeti]) => ({ ad, sonuc: 'YESIL', profilOzeti })),
});
const denet = (r) => raporDenetle(r, COMMIT, ozetler).sonuc;

try {
  // ── §1 rapor denetimi ──────────────────────────────────────────────────────
  kontrol('§1 hepsi yeşil rapor GEÇER', denet(yesilRapor()) === 'gecti');
  kontrol('§1 sonda: rapor yok → ÖLÇÜLEMEDİ', denet(null) === 'olculemedi');
  kontrol("§1 sonda: başka commit'in raporu → ÖLÇÜLEMEDİ", denet({ ...yesilRapor(), commit: 'a'.repeat(40) }) === 'olculemedi');
  kontrol('§1 sonda: kirli ağaçta üretilmiş → İHLAL', denet({ ...yesilRapor(), agacTemiz: false }) === 'ihlal' && denet({ ...yesilRapor(), agacTemiz: undefined }) === 'ihlal');
  kontrol('§1 sonda: matris KIRMIZI → İHLAL', denet({ ...yesilRapor(), sonuc: 'KIRMIZI' }) === 'ihlal');
  const tek = yesilRapor();
  tek.profiller[1].sonuc = 'KIRMIZI';
  kontrol('§1 sonda: bir profil KIRMIZI (üst sonuç yeşil yazılmış olsa da) → İHLAL', denet(tek) === 'ihlal');
  const eksik = yesilRapor();
  eksik.profiller.pop();
  kontrol('§1 sonda: profil raporda yok → İHLAL', denet(eksik) === 'ihlal');
  const degismis = yesilRapor();
  degismis.profiller[0].profilOzeti = '0'.repeat(16);
  kontrol('§1 sonda: profil rapordan sonra değişmiş → İHLAL', denet(degismis) === 'ihlal');
  const fazla = yesilRapor();
  fazla.profiller.push({ ad: 'silinmis', sonuc: 'YESIL', profilOzeti: 'x' });
  kontrol('§1 sonda: raporda dizinde olmayan profil → İHLAL', denet(fazla) === 'ihlal');
  kontrol('§1 sonda: profil dizini boş → ÖLÇÜLEMEDİ', raporDenetle(yesilRapor(), COMMIT, {}).sonuc === 'olculemedi');

  // ── §2 kapı ────────────────────────────────────────────────────────────────
  const kapi = (ek) => profilMatrisiKapisi({ grup: 'oncu', commit: COMMIT, kayit, raporDizini, profilDizini, ...ek });
  const kok = kayit.gruplar.find((g) => g.terfiKaynagi === null)?.kod;
  const kokDisi = kayit.gruplar.filter((g) => g.terfiKaynagi !== null).map((g) => g.kod);
  kontrol('§2 kayıtta kök grup ve en az bir kök dışı grup var (körlük zemini)', !!kok && kokDisi.length > 0, `${kok} · ${kokDisi.join(', ')}`);
  kontrol(`§2 kök grup ("${kok}") MUAF`, kapi({ grup: kok }).sonuc === 'muaf');
  for (const g of kokDisi) kontrol(`§2 sonda: "${g}" raporsuz → ÖLÇÜLEMEDİ`, kapi({ grup: g }).sonuc === 'olculemedi');
  fs.writeFileSync(raporYolu(COMMIT, raporDizini), '{bozuk');
  kontrol('§2 sonda: bozuk rapor dosyası → ÖLÇÜLEMEDİ', kapi().sonuc === 'olculemedi');
  fs.writeFileSync(raporYolu(COMMIT, raporDizini), JSON.stringify(yesilRapor()));
  for (const g of kokDisi) kontrol(`§2 "${g}" yeşil raporla GEÇER`, kapi({ grup: g }).sonuc === 'gecti');
  kontrol('§2 sonda: kayıtlı olmayan grup → ÖLÇÜLEMEDİ', kapi({ grup: 'yok-boyle' }).sonuc === 'olculemedi');
  kontrol('§2 sonda: kısa commit → ÖLÇÜLEMEDİ', kapi({ commit: COMMIT.slice(0, 12) }).sonuc === 'olculemedi');
  kontrol('§2 sonda: bozuk dağıtım kaydı → ÖLÇÜLEMEDİ', kapi({ kayit: { gruplar: [] } }).sonuc === 'olculemedi' && kapi({ kayit: null }).sonuc === 'olculemedi');
  kontrol('§2 kaçış verilse de rapor yeşilse GEÇTİ kalır (kaçış iz bırakmaz)', kapi({ atla: 'kullanıcı bugün acil yayın istedi' }).sonuc === 'gecti');
  const baskaCommit = randomBytes(20).toString('hex');
  kontrol('§2 sonda: kısa kaçış cümlesi → İHLAL', kapi({ commit: baskaCommit, atla: 'evet' }).sonuc === 'ihlal' && kapi({ commit: baskaCommit, atla: '' }).sonuc === 'ihlal');
  kontrol('§2 sonda: yer tutucu kaçış cümlesi → İHLAL', kapi({ commit: baskaCommit, atla: '<kullanıcının cümlesi> buraya yazılır' }).sonuc === 'ihlal');
  const atlandi = kapi({ commit: baskaCommit, atla: 'kullanıcı bugün acil yayın istedi' });
  kontrol('§2 geçerli kaçış → ATLANDI + cümle döner', atlandi.sonuc === 'atlandi' && atlandi.cumle === 'kullanıcı bugün acil yayın istedi', atlandi.sebep);

  // ── §3 bağlantı ────────────────────────────────────────────────────────────
  const oku = (rel) => {
    try {
      return fs.readFileSync(path.join(KOK, rel), 'utf8');
    } catch {
      return undefined;
    }
  };
  const yayinTuketicileri = TUKETICILER.filter((f) => YAYIN_BETIGI_DESENI.test(f));
  const eksikler = baglantiEksikleri(TUKETICILER, oku);
  kontrol('§3 dağıtım kaydını okuyan her yayın betiği kapıyı çağırır', eksikler.length === 0, eksikler.join(' | ') || `${yayinTuketicileri.length} yayın betiği tüketici`);
  const sahte = { 'deploy/ornek-yayinla.sh': 'kapısız yayın\n', 'deploy/ornek-kapili-yayinla.mjs': "node scripts/profil-matrisi-kapisi.mjs --grup=$g\n", 'scripts/lib/terfi.mjs': 'x' };
  const sahteEksik = baglantiEksikleri(Object.keys(sahte), (r) => sahte[r]);
  kontrol('§3 sonda: kapıyı çağırmayan yayın betiği KIRMIZI, çağıran ve desen dışı olan sayılmaz', sahteEksik.length === 1 && sahteEksik[0].startsWith('deploy/ornek-yayinla.sh'), sahteEksik.join(' | '));
  kontrol('§3 sonda: okunamayan tüketici KIRMIZI', baglantiEksikleri(['deploy/backend-yayinla.mjs'], () => undefined).length === 1);

  // ── §4 rapor yazarı ────────────────────────────────────────────────────────
  const matris = oku('Teks-Erp/scripts/profil-matrisi.ts') ?? '';
  kontrol(
    '§4 profil-matrisi.ts özet/yolu kapının kitaplığından alır ve agacTemiz yazar',
    /import \{[^}]*profilOzeti[^}]*raporYolu[^}]*\} from "\.\.\/\.\.\/scripts\/lib\/profil-raporu\.mjs"/.test(matris) && /agacTemiz:/.test(matris) && !/createHash/.test(matris),
  );

  // ── §5 CLI ─────────────────────────────────────────────────────────────────
  const cli = (args) => spawnSync(process.execPath, [path.join(KOK, 'scripts/profil-matrisi-kapisi.mjs'), ...args], { cwd: KOK, encoding: 'utf8' });
  const r0 = cli([`--grup=${kok}`]);
  kontrol('§5 CLI: kök grup → çıkış 0 (MUAF)', r0.status === 0 && /\tmuaf\t/.test(r0.stdout), `çıkış ${r0.status}`);
  const yokCommit = randomBytes(20).toString('hex');
  const r2 = cli([`--grup=${kokDisi[0]}`, `--commit=${yokCommit}`]);
  kontrol('§5 sonda: CLI raporsuz commit → çıkış 2 (ÖLÇÜLEMEDİ = DUR)', r2.status === 2 && /\tolculemedi\t/.test(r2.stdout), `çıkış ${r2.status}`);
  const r3 = cli([`--grup=${kokDisi[0]}`, `--commit=${yokCommit}`, '--profil-matrisi-atla=kullanıcı bugün acil yayın istedi']);
  kontrol('§5 CLI: geçerli kaçış → çıkış 0 + ATLANDI satırı cümleyi taşır', r3.status === 0 && /\tatlandi\t.*\tkullanıcı bugün acil yayın istedi$/m.test(r3.stdout), `çıkış ${r3.status}`);
  const r4 = cli([`--grup=${kokDisi[0]}`, `--commit=${yokCommit}`, '--profil-matrisi-atla=evet']);
  kontrol('§5 sonda: CLI kısa kaçış → çıkış 1', r4.status === 1, `çıkış ${r4.status}`);
  const r5 = cli([`--grup=${kokDisi[0]}`, '--bilinmeyen=1']);
  kontrol('§5 sonda: CLI tanınmayan argüman → çıkış 2', r5.status === 2, `çıkış ${r5.status}`);
  kontrol('§5 CLI hiçbir rapor dosyası yazmadı', !fs.existsSync(raporYolu(yokCommit)));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== Sonuç: ${gecti} geçti, ${basarisiz} başarısız ===`);
process.exit(basarisiz === 0 ? 0 : 1);
