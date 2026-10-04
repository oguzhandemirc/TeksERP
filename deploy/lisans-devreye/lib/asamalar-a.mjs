// Aşama 1–4 kontrolleri (runbook docs/ops/LISANS-DEVREYE-ALMA-TESTFABRIKA.md ile aynı numara). Hepsi SALT OKUMA.
// Kontrol: { no, ad, yerel(g) } (ağsız, yalnız stat/JSON anahtarı) ya da { no, ad, kos(ag, g), degerlendir(r, g) }.
import fs from 'node:fs';
import path from 'node:path';
import { evYolu } from './ag.mjs';
import {
  GUNCELLEME_KOK, I, O, PS_GUC, SATICI_KONTEYNER, U, birlestir, gucDegerlendir, httpSonuc, izin600, s, satirlar,
  traefikDegerlendir, uzakSonuc, VDS_DOGRULA, VDS_TABAN_DOSYALARI, vdsDogrulaDegerlendir, vdsDogrulaKos,
} from './ortak.mjs';

export const A2_GOCLERI = ['20260930120000_tasima_kodu_kimliksiz', '20261001090000_dagitim_dosya', '20261001090000_modul_anahtari_kasasi'];
export const ANAHTAR_DOSYALARI = ['hazirlik-2026-1.kok.json', 'alt-hazirlik-2026-1.anahtar.json', 'ind-hazirlik-2026.anahtar.json',
  'portal-totp.key', 'etkinlestirme-kodu.pepper', 'modul-kasasi.key'];
export const SATICI_ORTAM_ADLARI = ['DOSYA_DIZINI', 'DERLEME_DIZINI', 'YAYIN_DIZINI', 'GENEL_KOK_ADRESI', 'IC_API_BELIRTEC_DOSYASI'];

const vdsDogrula = (no) => ({ no, ad: 'vds-dogrula: adnansahin AYNI', kos: vdsDogrulaKos, degerlendir: vdsDogrulaDegerlendir });
const traefik = (no) => ({ no, ad: 'Traefik yeniden başlatılmamış', kos: (ag) => ag.ssh('docker inspect traefik --format "{{.State.StartedAt}} {{.RestartCount}}"'), degerlendir: traefikDegerlendir });
const guc = (no) => ({ no, ad: 'thinkpad-1 prizde (PowerOnline) + pwsh 7', kos: (ag) => ag.tp(PS_GUC), degerlendir: gucDegerlendir });
const listede = (r, adlar) => {
  const u = uzakSonuc(r);
  if (u) return u;
  const var_ = new Set(`${r.cikti}`.split(/\s+/).filter(Boolean));
  const eksik = adlar.filter((a) => !var_.has(a));
  return eksik.length ? s(I, `eksik: ${eksik.join(', ')}`) : s(U);
};

export const ASAMA_1 = [
  { no: '1.1', ad: 'vds-dogrula ve üç taban dosyası yerinde', yerel: (g) => {
    const eksik = [VDS_DOGRULA, ...VDS_TABAN_DOSYALARI.map((f) => path.join(evYolu(g.vdsTaban), f))].filter((f) => !fs.existsSync(f));
    return eksik.length ? s(O, `eksik: ${eksik.join(', ')}`) : s(U);
  } },
  { no: '1.2', ad: 'portal yönetici + kök parola dosyaları 0600 (içerik okunmaz)', yerel: () =>
    birlestir(['~/.tekserp/sirlar/portal-yonetici-hazirlik.txt', '~/.tekserp/sirlar/hazirlik-kok-parolasi.txt'].map(izin600)) },
  guc('1.3'),
  { no: '1.4', ad: 'satıcı konteynerleri ayakta', kos: (ag) => ag.ssh('docker ps --format "{{.Names}}={{.Status}}"'), degerlendir: (r) => {
    const u = uzakSonuc(r);
    if (u) return u;
    const m = satirlar(r.cikti);
    const kotu = [SATICI_KONTEYNER, `${SATICI_KONTEYNER}-db`, `${SATICI_KONTEYNER}-yedek`].filter((k) => !/^Up\b/.test(m[k] ?? '') || /unhealthy/.test(m[k]));
    return kotu.length ? s(I, `ayakta değil: ${kotu.join(', ')}`) : s(U);
  } },
  traefik('1.5'),
  { no: '1.6', ad: 'vds-dogrula tabanı son adnansahin yayınından yeni', kos: (ag) => ag.ssh(`find ${GUNCELLEME_KOK}/html/adnansahin ${GUNCELLEME_KOK}/defter -type f -printf "%T@\\n" | sort -n | tail -1`), degerlendir: (r, g) => {
    const u = uzakSonuc(r);
    if (u) return u;
    const enYeni = Number(`${r.cikti}`.trim()) * 1000;
    const taban = path.join(evYolu(g.vdsTaban), 'adnansahin.sha');
    if (!Number.isFinite(enYeni) || !fs.existsSync(taban)) return s(O, 'yayın zamanı ya da taban okunamadı');
    const tabanMs = fs.statSync(taban).mtimeMs;
    return enYeni <= tabanMs ? s(U) : s(O, `taban bayat: adnansahin'e ${new Date(enYeni).toISOString()} yayını tabandan (${new Date(tabanMs).toISOString()}) yeni — önce taban tazele (runbook §1.2)`);
  } },
  vdsDogrula('1.7'),
];

export const ASAMA_2 = [
  { no: '2.1', ad: 'satıcı imajı beklenen sha + sağlıklı', kos: (ag) => ag.ssh(`docker inspect ${SATICI_KONTEYNER} --format "{{.Config.Image}} {{.State.Health.Status}}"`), degerlendir: (r, g) => {
    const u = uzakSonuc(r);
    if (u) return u;
    const [imaj, saglik] = `${r.cikti}`.trim().split(/\s+/);
    if (!g.saticiSha) return s(O, `beklenen sha verilmedi (--satici-sha); çalışan: ${imaj}`);
    if (imaj !== `tekserp-satici:${g.saticiSha}`) return s(I, `çalışan ${imaj}, beklenen tekserp-satici:${g.saticiSha}`);
    return saglik === 'healthy' ? s(U, imaj) : s(I, `sağlık: ${saglik}`);
  } },
  { no: '2.2', ad: 'anahtar birimi: kök · ALT · İNDİRME · TOTP · pepper · modül kasası (adlar)', kos: (ag) => ag.ssh(`docker exec ${SATICI_KONTEYNER} ls -1 /anahtarlar`), degerlendir: (r) => listede(r, ANAHTAR_DOSYALARI) },
  { no: '2.3', ad: 'A2 göçleri uygulanmış', kos: (ag) => ag.ssh(`docker exec ${SATICI_KONTEYNER}-db psql -U satici -d satici -tAc "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null"`), degerlendir: (r) => listede(r, A2_GOCLERI) },
  { no: '2.4', ad: 'ortam: 3d-1 dizinleri + genel kök + iç API sırrı (yalnız ADLAR)', kos: (ag) => ag.ssh(`docker inspect ${SATICI_KONTEYNER} --format "{{range .Config.Env}}{{println .}}{{end}}" | cut -d= -f1`), degerlendir: (r) => listede(r, SATICI_ORTAM_ADLARI) },
  { no: '2.5', ad: 'bağlar: anahtar/yayın/derleme SALT OKUNUR, dosyalar yazılır', kos: (ag) => ag.ssh(`docker inspect ${SATICI_KONTEYNER} --format "{{range .Mounts}}{{.Destination}}={{.RW}}{{println}}{{end}}"`), degerlendir: (r) => {
    const u = uzakSonuc(r);
    if (u) return u;
    const m = satirlar(r.cikti);
    const bek = { '/anahtarlar': 'false', '/yayin': 'false', '/derlemeler': 'false', '/dosyalar': 'true' };
    const kotu = Object.entries(bek).filter(([k, v]) => m[k] !== v).map(([k, v]) => `${k}=${m[k] ?? 'yok'} (beklenen ${v})`);
    return kotu.length ? s(I, kotu.join(', ')) : s(U);
  } },
  { no: '2.6', ad: 'dinleyiciler: genel · iç API açık, tünel dinleyicisi YOK', kos: (ag) => ag.ssh(`docker logs --tail 300 ${SATICI_KONTEYNER}`), degerlendir: (r) => {
    const u = uzakSonuc(r);
    if (u) return u;
    const satir = `${r.cikti}\n${r.hata}`.split('\n').filter((l) => l.includes('SATICI_DINLIYOR')).pop();
    if (!satir) return s(O, 'SATICI_DINLIYOR satırı son 300 satırda yok');
    if (/tailnet=/.test(satir)) return s(I, `tünel dinleyicisi açık (eski imaj): ${satir.trim()}`);
    return /ic=4612/.test(satir) ? s(U, satir.trim()) : s(I, `iç API kapalı: ${satir.trim()}`);
  } },
  { no: '2.7', ad: 'internetten /saglik 200', kos: (ag, g) => ag.http(`${g.saticiKok}/saglik`), degerlendir: (r) => httpSonuc(r) ?? (r.json?.success === true ? s(U) : s(I, 'gövde success:true değil')) },
  { no: '2.8', ad: 'internetten portal YOK (404)', kos: (ag, g) => ag.http(`${g.saticiKok}/portal/saglik`), degerlendir: (r) => httpSonuc(r, 404) ?? s(U) },
  { no: '2.9', ad: '/d satıcıya ulaşıyor (Traefik değil; no-store)', kos: (ag, g) => ag.http(`${g.saticiKok}/d/olmayan-belirtec`), degerlendir: (r) => {
    if (r.durum === null || r.durum === undefined) return s(O, `bağlantı yok (${r.hata})`);
    return /no-store/.test(r.basliklar?.['cache-control'] ?? '') ? s(U, `HTTP ${r.durum}`) : s(I, `HTTP ${r.durum} no-store yok — yol satıcıya ulaşmıyor`);
  } },
  { no: '2.10', ad: `yayın kökü bağı var (${GUNCELLEME_KOK})`, kos: (ag) => ag.ssh(`docker exec ${SATICI_KONTEYNER} ls -1 /yayin`), degerlendir: (r) => listede(r, ['html', 'defter']) },
  traefik('2.11'),
  vdsDogrula('2.12'),
];
