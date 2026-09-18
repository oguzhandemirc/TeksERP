// =============================================================================
// GÜZERGÂH SÜRÜCÜSÜ (TABLET) — kullanıcı testi tablet adımlarını GERÇEK cihazda/emülatörde koşar
// =============================================================================
// d9'un panel sürücüsüyle (Electron/e2e/guzergah) ORTAK sözleşme: aynı `id`, aynı `dogrula`,
// aynı `sonuc.json`. Adımlar `adimlar.mjs`de (id · rol · yol · gerektirir · yap · bekle · dogrula).
//
// Koşum (mobil/ içinden):
//   node scripts/surucu/guzergah.mjs                 # bütün T adımları
//   node scripts/surucu/guzergah.mjs A3 D1 D2        # seçili adımlar
//
// Ön koşul: d9'un ortamı — `cd Teks-Erp && npx tsx scripts/e2e-ortam.ts kur` + `… sunucu`
// (backend :4110). Bu sürücü `${os.tmpdir()}/tekserp-e2e-env.json`den okur. Cihaz emülatörse
// backend host 10.0.2.2'ye çevrilir (emülatör → Mac host). Uygulama A3 adımında "API Sunucusu"
// ekranından o adrese ayarlanır (kullanıcının 4000'ine istek gitmez).
//
// `--seri=<adb seri>` (yoksa tek cihaz), `--paket=<uygulama paketi>` (varsayılan test paketi),
// `--host=<backend host>` (varsayılan emülatörde 10.0.2.2, gerçek cihazda Mac LAN IP).
// =============================================================================
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { Cihaz, cihazlar } from './adb.mjs';
import { Surucu, kos } from './surucu.mjs';
import { Api } from './api.mjs';
import { ADIMLAR } from './adimlar.mjs';

const BURASI = join(fileURLToPath(import.meta.url), '..');
const BACKEND_KOK = join(BURASI, '../../../Teks-Erp');
const ORTAM_DOSYASI = join(os.tmpdir(), 'tekserp-e2e-env.json');

function dur(mesaj) {
  console.error(`⛔ ${mesaj}`);
  process.exit(2);
}

function arg(ad, varsayilan = null) {
  const p = process.argv.find((a) => a.startsWith(`--${ad}=`));
  return p ? p.slice(ad.length + 3) : varsayilan;
}

if (!existsSync(ORTAM_DOSYASI)) dur(`ortam dosyası yok: ${ORTAM_DOSYASI} — önce (Teks-Erp/) \`npx tsx scripts/e2e-ortam.ts kur\``);
const ortam = JSON.parse(readFileSync(ORTAM_DOSYASI, 'utf-8'));

// Cihaz seçimi
const seri = arg('seri') ?? cihazlar()[0]?.seri;
if (!seri) dur('bağlı cihaz yok (adb devices)');
const emu = seri.startsWith('emulator-');
const paket = arg('paket', 'com.teks.erp.mobil.test');

// Backend adresi: emülatör host'a 10.0.2.2 ile ulaşır; gerçek cihazda Mac LAN IP verilmeli.
const backendHost = arg('host', emu ? '10.0.2.2' : null);
if (!backendHost) dur('gerçek cihazda --host=<Mac LAN IP> gerekli (emülatörde 10.0.2.2 varsayılan)');
const backendPort = new URL(ortam.apiUrl).port || '4110';
const cihazApiUrl = `http://${backendHost}:${backendPort}`;

// Sağlık: bu sürücü doğrulamayı KENDİ makinesinden yapar (ortam.apiUrl, localhost); cihaz cihazApiUrl'e gider.
const saglik = await fetch(`${ortam.apiUrl}/health`).then((r) => r.json()).catch(() => null);
if (!saglik || saglik.db !== 'UP') dur(`E2E backend ayakta değil: ${ortam.apiUrl} — (Teks-Erp/) \`npx tsx scripts/e2e-ortam.ts sunucu\``);

// Backend `pg` (yeni paket YOK) — `sql` doğrulaması için.
const requireBackend = createRequire(join(BACKEND_KOK, 'package.json'));
const { Client: PgClient } = requireBackend('pg');
const pg = new PgClient({ connectionString: ortam.dbUrl.replace(/\?schema=public$/, '') });
await pg.connect();
const sql = async (q, params = []) => (await pg.query(q, params)).rows;

// Backend doğrulama istemcisi (operatör oturumu; panel yolu X-Client-Type web).
const api = new Api(ortam.apiUrl);
await api.giris(ortam.kullanicilar.operator.username, ortam.kullanicilar.operator.password);

// Seçili adımlar
const istenen = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const secili = istenen.length ? ADIMLAR.filter((a) => istenen.includes(a.id)) : ADIMLAR;
const bilinmeyen = istenen.filter((id) => !ADIMLAR.some((a) => a.id === id));
if (bilinmeyen.length) dur(`bilinmeyen adım id: ${bilinmeyen.join(', ')}`);
if (!secili.length) dur('koşacak adım yok');

const cihaz = new Cihaz(seri);
const zaman = new Date().toISOString().replace(/[:.]/g, '-');
const ciktiDizini = join(BURASI, 'out', zaman);
const s = new Surucu(cihaz, { ekranDizini: ciktiDizini, paket });

// A3 için: uygulamayı hedef backend adresine hazırlamak adımın kendi işidir (fiiller.git/tikla/yaz).
// Bu bağlamı adıma geçir (cihaz backend adresi + kullanıcı).
const sonuc = await kos(s, secili, {
  ciktiDizini,
  api,
  sql,
  apiUrl: ortam.apiUrl,
  dbName: ortam.dbName,
  ctx: { cihazApiUrl, backendHost, backendPort, paket, ortam },
});

await pg.end().catch(() => undefined);
process.exit(sonuc.ozet.kirmizi > 0 ? 1 : 0);
