// =============================================================================
// DEVERE REJİM KAPISI BEKÇİSİ — `devere.enabled` kapısı ZİNCİRİ ölçüyor mu?
// =============================================================================
// Devere (çözgü hazırlama / levent) iplik kg defterini TÜKETİR: levent doğarken
// `WARP_ISSUE` hareketi yazılır. Bu yüzden bağımlılık üç halkadır —
// devere → iplik → ticaret — ve `MODULE_DEPENDENCIES` TEK ön koşul taşır, yani
// geçişli kapanışı KENDİ ÜRETMEZ.
//
// ⚠️ BU BEKÇİNİN ASIL SORUSU: okuma kapısı zinciri ELLE ölçüyor mu? Yazma yolu
// (`setFeatureFlags`) çiftleri ayrı ayrı doğruladığı için tutarlı bir DB'de
// zincir dolaylı korunur; ama gövdenin dokunmadığı çift atlanır (ölçüldü:
// `assertModuleDependencies` yalnız input'un dokunduğu çifti bakar). Elle SQL,
// eski dump ya da yarım bir profil uygulaması "ticaret KAPALI + iplik AÇIK +
// devere AÇIK" üretebilir; kapı yalnız kendi anahtarına baksaydı levent doğar
// ve kapalı ticaret rejiminde iplik defterine satır yazılırdı.
//
// ⚠️ FAZ 1a ZEMİNİ: bugün devere'nin yüzeyi YOK (route · servis · Prisma modeli
// yok; Çözgü Kartları ekranı aynı fazın son adımında geliyor). §6 bunu POZİTİF
// olarak ölçer — yüzey doğduğu gün kırmızı verir ve bekçi genişletilmek ZORUNDA
// kalır ("0 bulgu ≠ hiç bakılmadı" körlük zemini).
//
// Salt-okunur: DB'ye dokunmaz, HTTP atmaz, sunucu istemez.
// Koşum: npx tsx scripts/run-all-tests.ts devere_regime
//
// NEGATİF SONDALAR (yazılırken koşuldu, dosya sha256 ile geri yüklendi):
//   ① `requireDevereEnabled` gövdesinden `readTicaretEnabled` dalı silindi
//      → §2a + §3a kırmızı (zincirin en dış halkası ölçülmüyor).
//   ② İplik dalı ile ticaret dalının SIRASI değiştirildi
//      → §2b kırmızı (operatör "iplik kapalı" diye yanlış anahtara gönderilirdi).
//   ③ `MODULE_DEPENDENCIES.devereEnabled` silindi → §4a + §4b kırmızı.
//   ④ `readDevereEnabled`in `asBoolean` varsayılanı `true`ya çevrildi → §5 kırmızı.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import {
  MODULE_DEPENDENCIES,
  MODULE_FLAG_KEYS,
  MODULE_LABELS,
  MODULE_SETTING_KEYS,
} from "../src/constants/module-flags";
import { readDevereEnabled } from "../src/services/system-setting.service";
import prisma from "../src/lib/prisma";
import { yorumlariSok } from "./lib/regime-gate-scan";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const SRC = path.resolve(__dirname, "../src");
const MIDDLEWARE = path.join(SRC, "middlewares/module.middleware.ts");
const KAPI = "requireDevereEnabled";

/** `export async function requireDevereEnabled(...)` gövdesini kaba ama YETERLİ
 *  biçimde keser: bir sonraki `export async function` başlığına kadar. */
function kapiGovdesi(kod: string): string {
  const bas = kod.indexOf(`export async function ${KAPI}`);
  if (bas < 0) return "";
  const sonrasi = kod.slice(bas + 10);
  const son = sonrasi.indexOf("export async function");
  return son < 0 ? kod.slice(bas) : kod.slice(bas, bas + 10 + son);
}

async function main(): Promise<void> {
  console.log("=== DEVERE REJİM KAPISI BEKÇİSİ (devere.enabled) ===\n");

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  check("§1a Körlük zemini: middleware dosyası okunabildi", fs.existsSync(MIDDLEWARE), MIDDLEWARE);
  const ham = fs.readFileSync(MIDDLEWARE, "utf8");
  // Yorumlar SÖKÜLÜR: bu dosyanın başlığı kapı adlarını ve gerekçeleri ANLATIR;
  // sökülmezse gövde kontrolleri yorumda eşleşip vakumen yeşil kalırdı
  // (`test_module_grandfathering` §1a2'nin dersi).
  const kod = yorumlariSok(ham);
  const govde = kapiGovdesi(kod);
  check("§1b Körlük zemini: kapı gövdesi ayrıştırıldı", govde.length > 200, `${govde.length} karakter`);

  // ── §2 ⭐ ZİNCİR ELLE ÖLÇÜLÜYOR ve SIRA DOĞRU ─────────────────────────────
  const iTicaret = govde.indexOf("readTicaretEnabled");
  const iIplik = govde.indexOf("readIplikEnabled");
  const iDevere = govde.indexOf("readDevereEnabled");
  check(
    "§2a ⭐ Kapı ÜÇ halkayı da okuyor (ticaret · iplik · devere)",
    iTicaret >= 0 && iIplik >= 0 && iDevere >= 0,
    `ticaret=${iTicaret} iplik=${iIplik} devere=${iDevere}`,
  );
  check(
    "§2b ⭐ Sıra EN DIŞTAN içe (ticaret → iplik → devere)",
    iTicaret >= 0 && iIplik > iTicaret && iDevere > iIplik,
    "ters sıra operatörü yanlış anahtara gönderir: eksik olan TİCARET iken 'iplik kapalı' denirdi",
  );

  // ── §3 ⭐ MESAJ EKSİK OLANI SÖYLÜYOR ──────────────────────────────────────
  check(
    '§3a ⭐ Ticaret dalı `modul:"ticaret"` + `dependent:"devere"` döndürüyor',
    /modul:\s*"ticaret"[\s\S]{0,60}dependent:\s*"devere"/.test(govde),
    "403 gövdesi hangi modülün kapalı olduğunu SÖYLEMELİ (iplik kapısının dersi)",
  );
  check(
    '§3b ⭐ İplik dalı `modul:"iplik"` + `dependent:"devere"` döndürüyor',
    /modul:\s*"iplik"[\s\S]{0,60}dependent:\s*"devere"/.test(govde),
  );
  check(
    '§3c Kendi dalı ortak `modulKapali("devere", …)` kullanıyor (403 + MODULE_DISABLED)',
    /modulKapali\(\s*"devere"/.test(govde),
  );
  check(
    "§3d Kapı `requirePermission`ın YERİNE geçmiyor (dosyada izin kontrolü yok)",
    !/requirePermission|hasPermission/.test(govde),
    "bayrak ve izin iki AYRI sorudur",
  );

  // ── §4 ⭐ BAĞIMLILIK TABLOSU ve DÖRT TABLO HİZASI ─────────────────────────
  check(
    "§4a ⭐ `MODULE_DEPENDENCIES.devereEnabled === iplikEnabled`",
    MODULE_DEPENDENCIES["devereEnabled"] === "iplikEnabled",
    `bugün: ${MODULE_DEPENDENCIES["devereEnabled"] ?? "YOK"}`,
  );
  check(
    "§4b ⭐ Zincir ÜÇ halka: iplik de ticarete bağlı",
    MODULE_DEPENDENCIES["iplikEnabled"] === "ticaretEnabled",
    `bugün: ${MODULE_DEPENDENCIES["iplikEnabled"] ?? "YOK"}`,
  );
  check("§4c Anahtar dört tabloda da var (alan)", MODULE_FLAG_KEYS.has("devereEnabled"));
  check("§4d Anahtar dört tabloda da var (DB)", MODULE_SETTING_KEYS.has("devere.enabled"));
  check(
    "§4e Türkçe adı yazılı",
    (MODULE_LABELS["devereEnabled"] ?? "").length > 3,
    MODULE_LABELS["devereEnabled"] ?? "YOK",
  );

  // ── §5 ⭐ VARSAYILAN KAPALI (satır yokken) ────────────────────────────────
  // Ortam verisinden BAĞIMSIZ: satır YOK diyen sahte istemci. Canlı DB'ye
  // bakmak, birinin panelden açtığı bir kurulumda sahte kırmızı verirdi.
  const bosIstemci = {
    systemSetting: { findUnique: () => Promise.resolve(null) },
  } as unknown as Pick<typeof prisma, "systemSetting">;
  check(
    "§5 ⭐ Satır yokken devere KAPALI (dünkü davranış: devere yoktu)",
    (await readDevereEnabled(bosIstemci)) === false,
    "üretim modülünün 'satır yoksa TRUE' sigortası buraya KOPYALANMAZ",
  );

  // ── §6 ⭐ DEVERE MODELİNE DOKUNAN HER ROUTER KAPILI MI ────────────────────
  // Faz 1a'nın yüzeyi doğdu (çözgü kartı). Bundan sonra devere tablolarına
  // dokunan bir router kapısız doğarsa bu bölüm kırmızı verir — "modül kapalı"
  // cümlesi yalnız kapı TAKILI olduğu sürece doğrudur.
  const routerDizin = path.join(SRC, "routes");
  const routerlar = fs.readdirSync(routerDizin).filter((f) => f.endsWith(".ts"));
  check("§6a Körlük zemini: router dizini tarandı", routerlar.length >= 40, `n=${routerlar.length}`);

  /** Devere-ÖZEL Prisma model erişimcileri (Faz 1b'de `warpBeam`/`warpBeamEvent` eklenir). */
  const DEVERE_MODELLERI = ["warpSpec"];
  const dokunanlar: string[] = [];
  const kapisizlar: string[] = [];
  for (const f of routerlar) {
    const metin = yorumlariSok(fs.readFileSync(path.join(routerDizin, f), "utf8"));
    const dokunuyor =
      DEVERE_MODELLERI.some((m) => new RegExp(`\\b(prisma|tx)\\.${m}\\b`).test(metin)) ||
      /WarpSpecService|warpSpecService/.test(metin);
    if (!dokunuyor) continue;
    dokunanlar.push(f);
    if (!metin.includes(KAPI)) kapisizlar.push(f);
  }
  check(
    "§6b Körlük zemini: devere yüzeyi BULUNDU (yoksa §6c vakumen yeşil kalırdı)",
    dokunanlar.length >= 1,
    dokunanlar.join(", ") || "devere router'ı yok — yüzey silindiyse bekçi daraltılmalı",
  );
  check(
    "§6c ⭐ Devere modeline dokunan HER router `requireDevereEnabled` taşıyor",
    kapisizlar.length === 0,
    kapisizlar.length === 0
      ? `${dokunanlar.length} router kapılı`
      : `KAPISIZ: ${kapisizlar.join(", ")}`,
  );
  check(
    "§6d Kapı ölü değil: middleware dışa aktarılmış",
    new RegExp(`export async function ${KAPI}`).test(kod),
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("BEKÇİ ÇÖKTÜ:", e);
  await prisma.$disconnect();
  process.exit(1);
});
