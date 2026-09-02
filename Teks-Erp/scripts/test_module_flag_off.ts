// =============================================================================
// MODÜL KAPALIYKEN — DÖRT KAPININ ORTAK SÖZLEŞMESİ (tek dosya, parametrik)
// =============================================================================
// `test_finance_flag_off.ts` tek modül için yazılmıştı. Dört modül için dört
// kopya çıkarmak yerine tablo parametrik: yeni bir modül kapısı eklendiğinde
// `MODULLER` dizisine BİR satır yazılır ve tüm kontroller onu kapsar.
//
// İKİ AYAK, İKİSİ DE GEREKLİ ve ROLLERİ FARKLI:
//   • STATİK (her zaman koşar, DB/HTTP gerektirmez) → asıl güvence.
//     `test_demo_mode.ts:57-101` kalıbı: middleware sözleşmesi (403 + kod +
//     önbeleksiz + KENDİ bayrağını okuma) · kapı `verifyToken`dan SONRA · o
//     router'ın HER ucu kapıdan SONRA (Express kayıt sırası sızıntısı).
//   • HTTP (sunucu ayakta değilse ATLANIR) → ek kanıt; bayrak TAKASINI yalnız
//     o görebilir (§7 tek-tek turu).
//
// ⚠️ ASIL ÖLÇÜM NEDEN STATİK: HTTP kısmı CI'da (sunucusuz) hiç koşmaz. "403
// dönüyor" iddiasını yalnız HTTP'ye bağlamak, bekçiyi CI'da SÜSE çevirirdi.
//
// ⚠️ `test_finance_flag_off` §1'in "satır yok → false" TOLERANSI BURAYA
// KOPYALANMADI. Modül anahtarları grandfathering migration'ıyla DAMGALANIR
// (`20260902230000`) — yani geçmişi olan bir kurulumda satırın VARLIĞI da bir
// sözleşmedir. Kontrol, migration'ın kendi koşuluyla AYNI yüklemle (geçmiş var
// mı: `rolls` dolu mu) çalışır; boş bir kurulumda satır BEKLENMEZ (bkz. §3).
//
// ⚠️⚠️ BU BEKÇİ GLOBAL DURUM YAZAR (modül bayraklarını açıp kapatır) —
// EŞZAMANLI KOŞMAZ. Aynı veritabanına karşı ikinci bir koşum (ya da paralel
// çalışan başka bir ajan/test) sondaların ortasında bayrağı değiştirir ve
// kırmızı, sebebi hakkında YANLIŞ bir hikâye anlatır. §7/§4/§6 turlarının her
// biri sondadan SONRA bayrağı DB'den tekrar okur ve değişmişse turu ATLAR
// (kırmızı vermez) — bu, "yanlış teşhis"i "eksik ölçüm"e çevirir; ikisi
// arasındaki fark, eksik ölçümün kendini SÖYLEMESİDİR.
//
// Koşum: npx tsx scripts/test_module_flag_off.ts
//        (HTTP ayağı için: PORT=4101 … npx tsx src/server.ts &)
//
// NEGATİF SONDALAR — 2026-09-02 (çıkış kodu ölçüldü, cp+md5 ile geri alındı):
//   ① 403 gövdesindeki kod silinirse:
//      sed -i '' 's/code: "MODULE_DISABLED", //' src/middlewares/module.middleware.ts → SONDA-13
//   ② okuma ÖNBELLEĞE alınırsa (acil kapatma anahtarı ölür) — "cache" sözcüğü
//      HİÇ geçmeden: dosyaya `let ticaretBellegi …` + `Date.now()` TTL       → SONDA-14
//   ③ kapı `verifyToken`dan ÖNCEYE alınırsa (kimliksiz istek 403 alır):
//      sed -i '' 's/router.use(verifyToken, requireIplikEnabled)/router.use(requireIplikEnabled)/' \
//        src/routes/yarn.routes.ts                                            → SONDA-15
//   ④ kapı YANLIŞ bayrağı okursa (`requireTicaretEnabled` içinde
//      `readTicaretEnabled()` → `readIplikEnabled()`)                          → SONDA-20
//   ⑤ `code` bir seviye derine sarılırsa (`{ details: { code … } }`)           → SONDA-21
//   ⑥ 403 gövdesi YANLIŞ modülü söylerse (`requireProductionEnabled` içinde
//      `modulKapali("ticaret", "Ticaret")`)                                    → SONDA-22
// SONDA TABLOSU — 2026-09-03'te ÖLÇÜLDÜ (taban: 86 geçti / 0 başarısız, çıkış 0;
// her sondadan sonra cp + `md5 -q` ile birebir geri alındı):
//   SONDA-13  → çıkış 1 · 2 ❌ · §1d ×2 (403 gövdesinden `code` silindi → code="—")
//   SONDA-14  → çıkış 1 · 3 ❌ · §1c + §1f(durum) + §1f(zaman)
//                (`let ticaretBellegi` + 30 sn `Date.now()` TTL — "cache" sözcüğü YOK)
//   SONDA-15  → çıkış 1 · 3 ❌ · §2a + §2b + §2c (kapı `verifyToken`dan ÖNCEYE alındı)
//   SONDA-20  → çıkış 1 · 2 ❌ · §1c + §1e
//                (`requireTicaretEnabled` içinde `readTicaretEnabled` → `readIplikEnabled`)
//   SONDA-21  → çıkış 1 · 2 ❌ · §1d ×2 (`AppError.forbidden` 2. argümanı `details` sarmalı)
//   SONDA-21b → çıkış 1 · 1 ❌ · §1d — AYNI bozulma, SUNUCUSUZ koşum
//                (`TEST_API_URL=:4999`; "71 geçti, 1 başarısız, 14 atlandı"). D2'nin
//                ölçtüğü kör nokta buydu: eski sürüm bu durumda 64/0 YEŞİL kalıyordu.
//   SONDA-22  → çıkış 1 · 4 ❌ · §4(production) + §7 ×3
//                (`requireProductionEnabled` içinde `modulKapali("ticaret","Ticaret")`)
//   SONDA-22b → çıkış 1 · 1 ❌ · §1h(production) — AYNI bozulma, SUNUCUSUZ koşum
//                ("75 geçti, 1 başarısız, 14 atlandı"). V minor #1 kapandı: eski sürümde
//                statik ayak bu durumda 76/0 YEŞİL kalıyordu.
//   SONDA-22c → çıkış 1 · 1 ❌ · §1h(iplik) — `requireIplikEnabled`in doğrudan
//                `AppError.forbidden`ındaki `modul: "ticaret"` → `"depoMulti"` (ön koşul
//                dışı kod) — sunucusuz.
// ⚠️ SONDA-13/14/15/20/21/22b/22c sunucuyu YENİDEN BAŞLATMADAN da kırmızı verir —
//    kırmızıyı STATİK ayak üretir. Bu, "asıl güvence statiktir" kararının canlı kanıtıdır.
//    SONDA-22'nin HTTP kanıtı ek hattır (gövde alanı çalışma anında doğar; sunucuyu
//    BOZUK kodla yeniden başlatmadan vakumen yeşil kalır) — statik §1h asıl kapıdır.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { systemSettingService } from "../src/services/system-setting.service";
import { AuthService } from "../src/services/auth.service";
import { MODULE_DEPENDENCIES, MODULE_LABELS } from "../src/constants/module-flags";
import {
  dosyaDuzeyiDurumTasiyicilari,
  forbiddenCagrilari,
  middlewareGovdeAnalizi,
  modulKoduIzleri,
  routerKapiOlcumu,
  yorumlariSok,
} from "./lib/regime-gate-scan";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4101";
const SRC = join(__dirname, "..", "src");
const MW_YOL = join(SRC, "middlewares", "module.middleware.ts");

// ⚠️ Hedef DB kapısı ORTAK dosyada (`lib/hedef-db-kapisi.ts`) — fixture üzerinden
// bayrak yazan dört test de aynı kapıdan geçer; küme burada KOPYALANMAZ.

let pass = 0;
let fail = 0;
let atlanan = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function atla(label: string, sebep: string): void {
  atlanan++;
  console.log(`⏭️  ATLANDI ${label} — ${sebep}`);
}

type ModulAlani = "ticaretEnabled" | "iplikEnabled" | "depoMultiEnabled" | "productionEnabled";

interface ModulTanimi {
  /** `FeatureFlags` alanı (PATCH gövdesinde kullanılan ad). */
  alan: ModulAlani;
  /** `system_settings.key`. */
  dbAnahtari: string;
  middleware: string;
  okuyucu: string;
  /** 403 gövdesindeki `details.modul` değeri. */
  modulKodu: string;
  /** Kapı satırının ölçüleceği route dosyaları (`src/` göreli). */
  routeDosyalari: string[];
  /** HTTP sondaları — bayrak kapalıyken 403, açıkken 2xx beklenir. */
  sondalar: string[];
  /**
   * Bağımlı modül ise: kapı ÖNCE ön koşulu ölçer, yani ön koşul kapalıyken
   * 403 gövdesi ÖN KOŞULUN adını taşır (operatör doğru toggle'a gitsin).
   */
  onKosul?: { alan: ModulAlani; beklenenModulKodu: string };
}

const MODULLER: ModulTanimi[] = [
  {
    alan: "ticaretEnabled",
    dbAnahtari: "ticaret.enabled",
    middleware: "requireTicaretEnabled",
    okuyucu: "readTicaretEnabled",
    modulKodu: "ticaret",
    routeDosyalari: [
      "routes/purchase-order.routes.ts",
      "routes/item-price.routes.ts",
      "routes/stock-count.routes.ts",
      "routes/goods-receipt.routes.ts",
    ],
    sondalar: ["/api/stock-counts", "/api/item-prices", "/api/purchase-orders", "/api/goods-receipts"],
  },
  {
    alan: "iplikEnabled",
    dbAnahtari: "iplik.enabled",
    middleware: "requireIplikEnabled",
    okuyucu: "readIplikEnabled",
    modulKodu: "iplik",
    routeDosyalari: ["routes/yarn.routes.ts"],
    sondalar: ["/api/yarn/stocks"],
    onKosul: { alan: "ticaretEnabled", beklenenModulKodu: "ticaret" },
  },
  {
    alan: "depoMultiEnabled",
    dbAnahtari: "depo.multiEnabled",
    middleware: "requireDepoMultiEnabled",
    okuyucu: "readDepoMultiEnabled",
    modulKodu: "depoMulti",
    routeDosyalari: ["routes/warehouse-transfer.routes.ts"],
    sondalar: ["/api/warehouse-transfers"],
  },
  {
    alan: "productionEnabled",
    dbAnahtari: "production.enabled",
    middleware: "requireProductionEnabled",
    okuyucu: "readProductionEnabled",
    modulKodu: "production",
    routeDosyalari: [
      "routes/route.routes.ts",
      "routes/product-recipe.routes.ts",
      "routes/workorder.routes.ts",
      "routes/production-balance.routes.ts",
      "routes/tambur.routes.ts",
      "routes/kursun-qc.routes.ts",
      "routes/kursun-bypass.routes.ts",
      "routes/traveler-card.routes.ts",
      "routes/batch.routes.ts",
      "routes/station-capability.routes.ts",
    ],
    sondalar: ["/api/routes", "/api/product-recipes", "/api/work-orders", "/api/production-balance"],
  },
];

/**
 * BEKÇİNİN YÖNETTİĞİ BAYRAKLAR = tablodakiler + onlara BAĞIMLI yer tutucular.
 *
 * ⚠️ YER TUTUCU DA KAPATILIR ve bu ölçülmüş bir çöküşün düzeltmesidir: `tezgah`
 * (üretime bağımlı) DB'de AÇIK bırakılmış bir kurulumda `{productionEnabled:
 * false}` yazmak `assertModuleDependencies`e takılıp 400 verir; bekçi "Sonuç"
 * satırını hiç basmadan çöker (paralel bir ajan tezgahı açtığında birebir
 * yaşandı). Liste `MODULE_DEPENDENCIES`ten TÜRETİLİR — bağımlılık tablosu
 * genişlediği gün bekçi kendiliğinden uyar.
 */
const YONETILEN: string[] = (() => {
  const tabloAlanlari = MODULLER.map((m) => m.alan as string);
  const bagimliYerTutucular = Object.entries(MODULE_DEPENDENCIES)
    .filter(([bagimli, onKosul]) => tabloAlanlari.includes(onKosul) && !tabloAlanlari.includes(bagimli))
    .map(([bagimli]) => bagimli);
  return [...tabloAlanlari, ...bagimliYerTutucular];
})();

/** camelCase alan → `system_settings.key` (yer tutucular dahil). */
const ALAN_DB_ANAHTARI: Record<string, string> = {
  ticaretEnabled: "ticaret.enabled",
  iplikEnabled: "iplik.enabled",
  depoMultiEnabled: "depo.multiEnabled",
  productionEnabled: "production.enabled",
  kumasTeknikEnabled: "kumasTeknik.enabled",
  tezgahEnabled: "tezgah.enabled",
};

/** HTTP sondalarının 200 alabilmesi için gereken izinler. */
const SONDA_IZINLERI = [
  "warehouse:read",
  "warehouse:transfer",
  "item:read",
  "goods-receipt:read",
  "purchase-order:read",
  "station:read",
  "workorder:read",
  "order:read",
  "quality:read",
];

const TEST_USERNAME = `bekci.modul.${process.pid}`;
const TEST_PASSWORD = "test123456";
let testUserId: string | null = null;
const ilkDegerler = new Map<string, boolean>();

async function serverUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Bayrakları DB'DEN HAM okur — `getFeatureFlags` DEĞİL.
 *
 * ⚠️ `getFeatureFlags` 30 sn önbellekli (panel yanıtına ait). Bekçi kendi
 * yazdığını onunla geri okusaydı, "bayrak dışarıdan değişti mi" kontrolü
 * (C4) bayat veriyle çalışır ve tam da yakalaması gereken durumu kaçırırdı.
 * `production` için satır-yok sigortası (`true`) burada da uygulanır.
 */
async function dbBayraklariOku(): Promise<Map<string, boolean>> {
  const anahtarlar = YONETILEN.map((a) => ALAN_DB_ANAHTARI[a]!);
  const satirlar = await prisma.systemSetting.findMany({
    where: { key: { in: anahtarlar } },
    select: { key: true, value: true },
  });
  const byKey = new Map(satirlar.map((s) => [s.key, s.value]));
  const out = new Map<string, boolean>();
  for (const alan of YONETILEN) {
    const v = byKey.get(ALAN_DB_ANAHTARI[alan]!);
    if (v === undefined) {
      out.set(alan, alan === "productionEnabled");
      continue;
    }
    out.set(alan, v === true || v === "true");
  }
  return out;
}

/**
 * Hedef bayrak durumunu YAZAR — bağımlılık sırasına uyarak.
 *
 * Sıra: ÖNCE kapatılacaklar (bağımlı, ön koşulunun kapanmasını engellemesin),
 * SONRA açılacaklar (ön koşul, bağımlıdan önce). İki ayrı gövdeye bölmek
 * yeterli: `setFeatureFlags` doğrulaması gövdeyi bir BÜTÜN olarak görür, yani
 * aynı gövdede "ticaret aç + iplik aç" ya da "ticaret kapat + iplik kapat"
 * tutarlıdır (ölçüldü).
 */
async function bayraklariUygula(hedef: Record<string, boolean>): Promise<void> {
  const kapali = Object.fromEntries(Object.entries(hedef).filter(([, v]) => !v));
  const acik = Object.fromEntries(Object.entries(hedef).filter(([, v]) => v));
  if (Object.keys(kapali).length) {
    await systemSettingService.setFeatureFlags(kapali, testUserId ?? undefined);
  }
  if (Object.keys(acik).length) {
    await systemSettingService.setFeatureFlags(acik, testUserId ?? undefined);
  }
}

/** Tüm yönetilen bayraklar için hedef durum kur (verilmeyen alan `false`). */
function hedefKur(acikOlanlar: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const a of YONETILEN) out[a] = acikOlanlar.includes(a);
  return out;
}

/** Bir modülü açmak için gereken tüm ön koşullar (bağımlılık kapanışı). */
function onKosulKapanisi(alan: string): string[] {
  const out = [alan];
  let cur: string | undefined = MODULE_DEPENDENCIES[alan];
  while (cur) {
    out.push(cur);
    cur = MODULE_DEPENDENCIES[cur];
  }
  return out;
}

async function main(): Promise<void> {
  console.log("=== MODÜL KAPALI-REJİM BEKÇİSİ (ticaret · iplik · çoklu depo · üretim) ===\n");

  // ── §0 HEDEF VERİTABANI BANDI (yazan bekçi, yanlış DB'ye YAZMAZ) ─────────
  const dbAdi = hedefDbAdi();
  console.log(`   Hedef veritabanı: ${dbAdi}\n`);
  const dbEngeli = hedefDbEngeli();
  if (dbEngeli) {
    console.error(`❌ DURDURULDU: ${dbEngeli}`);
    fail++;
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    return;
  }

  const mwHam = readFileSync(MW_YOL, "utf8");
  const mw = yorumlariSok(mwHam);

  // ── §1 MIDDLEWARE SÖZLEŞMESİ (statik) ────────────────────────────────────
  check("§1 Körlük zemini: middleware dosyası okundu", mw.length > 500, `${mw.length} karakter`);
  for (const m of MODULLER) {
    const analiz = middlewareGovdeAnalizi(MW_YOL, m.middleware);
    check(`§1a ${m.middleware} tanımlı`, analiz.bulundu);
    if (!analiz.bulundu) continue;

    const idx = mw.indexOf(`export async function ${m.middleware}(`);
    check(
      `§1b ${m.middleware} 403 döner (404 DEĞİL — kaynak var, kurulum bu modülü kullanmıyor)`,
      idx >= 0 && (mw.includes("forbidden(") || mw.includes("function modulKapali(")),
    );

    // ⭐ §1c — KAPI KENDİ BAYRAĞINI, HER İSTEKTE, ARGÜMANSIZ OKUYOR MU?
    // Gövde sınırı AST'den gelir. Ölçülmüş hata: sabit 1600 karakterlik pencere
    // bir sonraki fonksiyona taşıyor ve `requireTicaretEnabled`in penceresi
    // alttaki `requireIplikEnabled`in `readTicaretEnabled()` çağrısını görüp
    // YEŞİL veriyordu — kapı yanlış bayrağı okusa bile.
    const kendi = analiz.okuyucular.filter((o) => o.ad === m.okuyucu);
    check(
      `§1c ⭐ ${m.middleware} KENDİ bayrağını okuyor (${m.okuyucu}) ve okuma KOŞULSUZ + ARGÜMANSIZ`,
      kendi.length > 0 && kendi.every((o) => !o.kosullu && !o.argumanli),
      kendi.length === 0
        ? `${m.okuyucu}() çağrısı YOK — kapı başka bir bayrağa bakıyor olabilir`
        : kendi.some((o) => o.kosullu)
          ? "çağrı bir if/?:/&& altında — önbellek eklemenin TEK yolu budur, acil kapatma ölür"
          : kendi.some((o) => o.argumanli)
            ? "çağrıya argüman geçilmiş (tx/cache) — bayrak bayat okunabilir"
            : "her istekte doğrudan DB",
    );

    // ⭐ §1e — İKİ YÖNLÜ: gövde YABANCI bir bayrak okumamalı.
    // Yalnız bağımlılık ön koşulu meşrudur (`MODULE_DEPENDENCIES`ten türetilir).
    const izinli = new Set<string>([m.okuyucu]);
    const onKosulAlani = MODULE_DEPENDENCIES[m.alan];
    if (onKosulAlani) {
      izinli.add(`read${onKosulAlani.charAt(0).toUpperCase()}${onKosulAlani.slice(1)}`);
    }
    const yabanci = [...new Set(analiz.okuyucular.map((o) => o.ad))].filter((a) => !izinli.has(a));
    check(
      `§1e ⭐ ${m.middleware} YABANCI bayrak okumuyor (izinli: ${[...izinli].join(", ")})`,
      yabanci.length === 0,
      yabanci.length
        ? `yabancı okuyucu: ${yabanci.join(", ")} — kapı YANLIŞ şalteri ölçerse fabrika ` +
          "modülü açar, panel açık gösterir, uçlar kapalı der"
        : "",
    );

    // ⭐ §1h — 403 GÖVDESİNDEKİ `modul` KODU STATİK OLARAK DOĞRU MU?
    // Dört gövde birbirinin kopyası; `modulKapali("production")` yerine
    // `modulKapali("ticaret")` gerçekçi bir kopyala-yapıştır hatası ve ölçüldü:
    // §4/§7 (HTTP) yalnız sunucu BOZUK kodla yeniden başlatılınca görüyordu,
    // CI'da koşan statik ayak KÖRDÜ (SONDA-22). Bağımlı modülde doğrudan
    // `AppError.forbidden` çağrısının `modul`u yalnız ÖN KOŞULUN kodu olabilir.
    const izler = modulKoduIzleri(MW_YOL, m.middleware);
    const kendiKodlari = [...new Set(izler.modulKapali)];
    const izinliOnKosul = m.onKosul?.beklenenModulKodu;
    const yabanciForbidden = izler.forbiddenModul.filter((k) => k !== izinliOnKosul);
    check(
      `§1h ⭐ ${m.middleware} 403 gövdesinde KENDİ modül kodunu söylüyor (${m.modulKodu})`,
      kendiKodlari.length === 1 && kendiKodlari[0] === m.modulKodu && yabanciForbidden.length === 0,
      kendiKodlari.length !== 1 || kendiKodlari[0] !== m.modulKodu
        ? `modulKapali kodları: [${kendiKodlari.join(", ")}] — operatörü YANLIŞ şaltere gönderir`
        : yabanciForbidden.length
          ? `forbidden modul: ${yabanciForbidden.join(", ")} (izinli ön koşul: ${izinliOnKosul ?? "yok"})`
          : izinliOnKosul
            ? `ön koşul kodu ${izinliOnKosul}, kendi kodu ${m.modulKodu}`
            : "",
    );
  }

  // ⭐ §1d — 403 GÖVDESİ AST İLE ÖLÇÜLÜR, METİNLE DEĞİL.
  // `{ details: { code: "MODULE_DISABLED" } }` yazımı metin aramasını YEŞİL
  // bırakır (dize hâlâ dosyada) ama gövde `details.details.code` olur ve
  // istemcinin okuma kalıbı (`e?.details?.code`) `undefined` görür.
  const forbiddenler = forbiddenCagrilari(MW_YOL);
  check(
    "§1d Körlük zemini: `AppError.forbidden(` çağrısı bulundu",
    forbiddenler.length >= 1,
    `n=${forbiddenler.length}`,
  );
  for (const [i, f] of forbiddenler.entries()) {
    check(
      `§1d ⭐ forbidden #${i + 1}: 2. argüman DOĞRUDAN \`code: "MODULE_DISABLED"\` taşıyor (details sarması YOK)`,
      f.nesneLiterali && f.kod === "MODULE_DISABLED" && !f.detailsSarmasi,
      !f.nesneLiterali
        ? "2. argüman nesne literali değil"
        : f.detailsSarmasi
          ? "`details` sarmalayıcısı var → gövde `details.details.code` olur, istemci `undefined` okur"
          : f.kod !== "MODULE_DISABLED"
            ? `code="${f.kod ?? "—"}"`
            : `modul="${f.modul ?? "—"}"`,
    );
  }

  // ⭐ §1f — ÖNBELLEK **YAPISI** (kelime değil).
  // Ölçüldü: "cache" sözcüğünü hiç kullanmayan gerçek bir 30 sn TTL önbelleği
  // (`let ticaretBellegi` + `Date.now()`) tüm kontrolleri geçiyordu ve bayrak
  // kapatıldıktan sonra kapı ~24 sn daha AÇIK kalıyordu.
  const durum = dosyaDuzeyiDurumTasiyicilari(MW_YOL);
  check(
    "§1f ⭐ Dosya düzeyinde DURUM taşıyıcısı yok (önbellek yazmanın tek yolu)",
    durum.durumBildirimleri.length === 0,
    durum.durumBildirimleri.length
      ? `${durum.durumBildirimleri.join(", ")} — modül düzeyi mutable durum = önbellek; ` +
        "acil kapatma anahtarı bir SONRAKİ istekte etkili olmalı"
      : "",
  );
  check(
    "§1f ⭐ Zaman tabanlı TTL izi yok (`Date.now(`/`setTimeout(`/`performance.now(`)",
    durum.zamanIzleri.length === 0,
    durum.zamanIzleri.join(", "),
  );
  check(
    "§1g İkinci hat: dosyada 'cache' sözcüğü de yok (yapı kontrolünün okunaklı ikizi)",
    !/\bcache\b/i.test(mw),
    "yalnız bu kontrol kalsaydı Türkçe adlı bir önbellek (`ticaretBellegi`) görünmezdi",
  );

  // ── §2 KAPI SIRASI (statik) ──────────────────────────────────────────────
  for (const m of MODULLER) {
    for (const rel of m.routeDosyalari) {
      const o = routerKapiOlcumu(join(SRC, rel), m.middleware);
      check(
        `§2a ${rel} → \`use(verifyToken, ${m.middleware})\` (kimliksiz istek 401 alır, 403 değil)`,
        o.kapiVar,
        o.kapiVar ? `router=${o.routerAdi}` : "kapı satırı YOK ya da verifyToken'sız",
      );
      check(`§2b ${rel} → körlük zemini: uç sayıldı`, o.ucSayisi >= 1, `uç=${o.ucSayisi}`);
      check(
        `§2c ⭐ ${rel} → HER uç kapıdan SONRA (Express kayıt sırası)`,
        o.hepsiKapidanSonra,
        "kapıdan ÖNCE tanımlı uç kapıyı HİÇ görmez; hata da log da üretmez",
      );
    }
  }

  // ── §3 AYAR SATIRININ VARLIĞI (DB — migration'ın kendi koşuluyla) ────────
  const topVar = (await prisma.roll.count({ take: 1 })) > 0;
  const satirlar = await prisma.systemSetting.findMany({
    where: { key: { in: MODULLER.map((m) => m.dbAnahtari) } },
    select: { key: true, value: true },
  });
  const bulunan = new Set(satirlar.map((s) => s.key));
  if (topVar) {
    const eksik = MODULLER.filter((m) => !bulunan.has(m.dbAnahtari)).map((m) => m.dbAnahtari);
    check(
      "§3 ⭐ Geçmişi olan kurulumda HER modül anahtarının satırı VAR (grandfathering damgası)",
      eksik.length === 0,
      eksik.length
        ? `satırsız: ${eksik.join(", ")} — migration 20260902230000 bu DB'de koşmamış olabilir`
        : `${bulunan.size}/${MODULLER.length} satır`,
    );
  } else {
    check(
      "§3 Boş kurulumda modül satırı BEKLENMEZ (damga koşullu — profil job'ının işi)",
      bulunan.size === 0,
      `bulunan=${[...bulunan].join(", ") || "(yok)"}`,
    );
  }

  // ── HTTP AYAĞI ───────────────────────────────────────────────────────────
  // Kaç kontrol ölçülmemiş olacak? Sayıyı BASMAK zorundayız: 64 ile 78 arasındaki
  // farkı yalnız toplam sayıya bakan biri göremez (ölçüldü: giriş kilidi
  // devredeyken bekçi 10 kontrolü sessizce kaybediyordu).
  const httpKontrolSayisi =
    MODULLER.length + MODULLER.filter((m) => m.onKosul).length + 1 + MODULLER.length + MODULLER.length;

  if (!(await serverUp())) {
    console.log(
      `\n   ⏭️  HTTP ayağı KOŞMADI — ${BASE} ayakta değil (TEST_API_URL ile değiştirilebilir).\n` +
        `      ${httpKontrolSayisi} kontrol ÖLÇÜLMEDİ (§4/§4b/§5/§6/§7).\n`,
    );
    atlanan += httpKontrolSayisi;
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız, ${atlanan} atlandı ===`);
    return;
  }

  // ⚠️ İZİNLİ kullanıcı ŞART: izinsiz kullanıcı zaten 403 alır ve rejim kapısı
  // hiç ölçülmemiş olurdu (yeşil ama kör).
  const perms = await prisma.permission.findMany({
    where: { code: { in: SONDA_IZINLERI } },
    select: { id: true },
  });
  testUserId = (
    await prisma.user.create({
      data: {
        username: TEST_USERNAME,
        fullName: "Modül Bayrağı Bekçisi",
        passwordHash: await AuthService.hashPassword(TEST_PASSWORD),
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
      select: { id: true },
    })
  ).id;

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD, clientType: "electron" }),
  });
  if (!login.ok) {
    // ⚠️ `fail++` YOK — bu bir SÖZLEŞME ihlali değil, ÖLÇÜM YAPILAMAMASIDIR.
    // Giriş kilidi (login-lockout) IP başına ve bellek içidir; art arda koşumda
    // devreye girer. Gerçek kırmızı sayılsaydı geliştirici kendi ürettiği
    // kırmızıyı görmezden gelmeyi öğrenirdi — bekçinin en pahalı kaybı budur.
    const govde = (await login.json().catch(() => ({}))) as { message?: string };
    console.log(
      `\n   ⏭️  HTTP ayağı KOŞMADI — bekçi kullanıcısı giriş yapamadı (durum=${login.status}` +
        `${govde.message ? `, "${govde.message}"` : ""}).\n` +
        `      ${httpKontrolSayisi} kontrol ÖLÇÜLMEDİ. 429/401 tipik sebep: giriş kilidi ` +
        "(IP başına, bellek içi) — sunucuyu yeniden başlat ya da birkaç dakika bekle.\n",
    );
    atlanan += httpKontrolSayisi;
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız, ${atlanan} atlandı ===`);
    return;
  }
  const token = ((await login.json()) as { data: { token: string } }).data.token;
  const auth = { Authorization: `Bearer ${token}` };

  // Orijinal değerleri sakla (finally geri yazar) — HAM DB okuması.
  for (const [alan, deger] of await dbBayraklariOku()) ilkDegerler.set(alan, deger);

  interface SondaSonucu {
    durum: number;
    kod?: string;
    modul?: string;
    mesaj?: string;
  }
  const sonda = async (yol: string): Promise<SondaSonucu> => {
    const r = await fetch(`${BASE}${yol}`, { headers: auth });
    const g = (await r.json().catch(() => ({}))) as {
      message?: string;
      details?: { code?: string; modul?: string };
    };
    return { durum: r.status, kod: g.details?.code, modul: g.details?.modul, mesaj: g.message };
  };

  /**
   * Tur bittikten sonra bayraklar HÂLÂ bizim yazdığımız değerde mi?
   * Değilse ölçüm penceresinde başkası yazmış demektir — turu ATLA.
   */
  const durumKorundu = async (hedef: Record<string, boolean>): Promise<string | null> => {
    const simdi = await dbBayraklariOku();
    const sapan = Object.entries(hedef)
      .filter(([a, v]) => simdi.get(a) !== v)
      .map(([a, v]) => `${a}: bekleniyordu ${v}, bulundu ${simdi.get(a)}`);
    return sapan.length ? sapan.join(" · ") : null;
  };

  // ── §4 KAPALIYKEN 403 + MODULE_DISABLED + DOĞRU MODÜL ADI ────────────────
  const hepsiKapali = hedefKur([]);
  await bayraklariUygula(hepsiKapali);
  {
    const sonuclar = new Map<ModulAlani, SondaSonucu[]>();
    for (const m of MODULLER) {
      const liste: SondaSonucu[] = [];
      for (const yol of m.sondalar) liste.push(await sonda(yol));
      sonuclar.set(m.alan, liste);
    }
    const sapma = await durumKorundu(hepsiKapali);
    for (const m of MODULLER) {
      if (sapma) {
        atla(`§4 ${m.alan}`, `ölçüm penceresinde bayrak dışarıdan değişti (${sapma})`);
        continue;
      }
      // ⚠️ Bağımlı modülde ön koşul DA kapalı olduğu için gövde ÖN KOŞULUN
      // adını taşır — mesaj EKSİK OLANI söylemeli.
      const beklenenModul = m.onKosul?.beklenenModulKodu ?? m.modulKodu;
      const beklenenEtiket = MODULE_LABELS[m.onKosul?.alan ?? m.alan]!;
      const kotu = m.sondalar
        .map((yol, i) => ({ yol, s: sonuclar.get(m.alan)![i]! }))
        .filter(
          ({ s }) =>
            s.durum !== 403 ||
            s.kod !== "MODULE_DISABLED" ||
            s.modul !== beklenenModul ||
            !(s.mesaj ?? "").includes(beklenenEtiket),
        )
        .map(({ yol, s }) => `${yol}→${s.durum}/${s.kod ?? "kodsuz"}/modul=${s.modul ?? "—"}`);
      check(
        `§4 ⭐ ${m.alan} KAPALIYKEN 403 + code=MODULE_DISABLED + modul="${beklenenModul}" + mesajda "${beklenenEtiket}"`,
        kotu.length === 0,
        kotu.length
          ? `${kotu.join(", ")} — YANLIŞ modül adı operatörü YANLIŞ toggle'a gönderir`
          : `${m.sondalar.length} uç kapalı`,
      );
    }

    // ── §4b BAĞIMLILIK: eksik olan anahtarın adı 403 gövdesinde ────────────
    for (const m of MODULLER) {
      if (!m.onKosul) continue;
      if (sapma) {
        atla(`§4b ${m.alan}`, "ölçüm penceresinde bayrak dışarıdan değişti");
        continue;
      }
      const s = sonuclar.get(m.alan)![0]!;
      check(
        `§4b ⭐ ${m.alan}: ön koşul (${m.onKosul.alan}) kapalıyken 403 EKSİK OLANI söylüyor`,
        s.modul === m.onKosul.beklenenModulKodu,
        `modul=${s.modul ?? "—"} — yanlış anahtarı söylemek operatörü yanlış toggle'a gönderir`,
      );
    }
  }

  // ── §5 KİMLİKSİZ İSTEK 401 (403 DEĞİL) ───────────────────────────────────
  const anonKotu: string[] = [];
  for (const m of MODULLER) {
    const r = await fetch(`${BASE}${m.sondalar[0]}`);
    if (r.status !== 401) anonKotu.push(`${m.sondalar[0]}→${r.status}`);
  }
  check(
    "§5 ⭐ Kimliksiz istek 401 (kapı verifyToken'dan SONRA)",
    anonKotu.length === 0,
    anonKotu.length
      ? anonKotu.join(", ")
      : "403 dönseydi istemci kullanıcıyı login'e YÖNLENDİRMEZDİ (oturum düşünce ekranda kalırdı)",
  );

  // ── §6 KÖRLÜK ZEMİNİ: HEPSİ AÇIKKEN 2xx ──────────────────────────────────
  const hepsiAcik = hedefKur(MODULLER.map((m) => m.alan));
  await bayraklariUygula(hepsiAcik);
  {
    const sonuclar = new Map<ModulAlani, number[]>();
    for (const m of MODULLER) {
      const liste: number[] = [];
      for (const yol of m.sondalar) liste.push((await sonda(yol)).durum);
      sonuclar.set(m.alan, liste);
    }
    const sapma = await durumKorundu(hepsiAcik);
    for (const m of MODULLER) {
      if (sapma) {
        atla(`§6 ${m.alan}`, `ölçüm penceresinde bayrak dışarıdan değişti (${sapma})`);
        continue;
      }
      const kotu = m.sondalar
        .map((yol, i) => ({ yol, d: sonuclar.get(m.alan)![i]! }))
        .filter(({ d }) => d < 200 || d >= 300)
        .map(({ yol, d }) => `${yol}→${d}`);
      check(
        `§6 KÖRLÜK ZEMİNİ: ${m.alan} AÇIKKEN sondalar 2xx`,
        kotu.length === 0,
        kotu.length ? kotu.join(", ") : `${m.sondalar.length} uç açık`,
      );
    }
  }

  // ── §7 ⭐ TEK-TEK TUR: BAYRAK TAKASINI YALNIZ BU GÖRÜR ────────────────────
  // Toplu aç/kapa turu (§4 + §6) ticaret ile ipliği HER ZAMAN birlikte oynatır;
  // ikisi TAKAS edilse bile (kapı yanlış bayrağı okusa bile) iki tur da aynı
  // cevabı verir. Burada her modül için "YALNIZ bu modül (ve ön koşulu) açık"
  // durumu kurulur: o modülün sondaları 2xx, DİĞERLERİ 403 + beklenen `modul`
  // olmak zorundadır.
  for (const hedefModul of MODULLER) {
    const acik = onKosulKapanisi(hedefModul.alan);
    const hedef = hedefKur(acik);
    await bayraklariUygula(hedef);

    const gozlem: Array<{ alan: string; yol: string; s: SondaSonucu }> = [];
    for (const m of MODULLER) {
      // Açık modüllerin HEPSİ sondalanır (2xx), kapalıların ilk ucu yeter.
      const yollar = acik.includes(m.alan) ? m.sondalar : [m.sondalar[0]!];
      for (const yol of yollar) gozlem.push({ alan: m.alan, yol, s: await sonda(yol) });
    }
    const sapma = await durumKorundu(hedef);
    if (sapma) {
      atla(`§7 ${hedefModul.alan} turu`, `ölçüm penceresinde bayrak dışarıdan değişti (${sapma})`);
      continue;
    }

    const kotu: string[] = [];
    for (const g of gozlem) {
      const m = MODULLER.find((x) => x.alan === g.alan)!;
      if (acik.includes(m.alan)) {
        if (g.s.durum < 200 || g.s.durum >= 300) kotu.push(`AÇIK ${g.yol}→${g.s.durum}`);
        continue;
      }
      // Kapalı modül: ön koşulu AÇIKSA kendi adını, kapalıysa ön koşulun adını söyler.
      const onKosulAcik = m.onKosul ? acik.includes(m.onKosul.alan) : true;
      const beklenenModul = onKosulAcik ? m.modulKodu : m.onKosul!.beklenenModulKodu;
      if (g.s.durum !== 403 || g.s.kod !== "MODULE_DISABLED" || g.s.modul !== beklenenModul) {
        kotu.push(
          `KAPALI ${g.yol}→${g.s.durum}/${g.s.kod ?? "kodsuz"}/modul=${g.s.modul ?? "—"} ` +
            `(beklenen 403/MODULE_DISABLED/${beklenenModul})`,
        );
      }
    }
    check(
      `§7 ⭐ YALNIZ ${hedefModul.alan} açıkken (${acik.join("+")}) kapılar birbirine karışmıyor`,
      kotu.length === 0,
      kotu.length
        ? kotu.join(" · ") +
          " — kapı YANLIŞ bayrağı okuyorsa yalnız bu tur görür (toplu aç/kapa turu takası göremez)"
        : `${gozlem.length} sonda beklendiği gibi`,
    );
  }

  const toplamBandi = atlanan ? `, ${atlanan} atlandı` : "";
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${toplamBandi} ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // ⚠️ BAYRAKLARI BULDUĞU DEĞERE GERİ YAZ — ve SIRA load-bearing.
    // İlk yazımda sıra yanlıştı ve ölçüldü: `{ticaretEnabled:false}` yazması,
    // iplik hâlâ AÇIKKEN `assertModuleDependencies`e takılıp 400 veriyordu
    // ("önce İplik modülünü kapatın"); catch bloğu yuttuğu için geri kalan
    // hiçbir bayrak da geri yazılmıyordu ve test DB'si ÜÇ modül AÇIK kalıyordu.
    // `bayraklariUygula` bu sırayı (önce kapat, sonra aç) mekanik uygular.
    try {
      if (ilkDegerler.size > 0) {
        await bayraklariUygula(Object.fromEntries(ilkDegerler));
      }
    } catch (e) {
      // ⚠️ Sessizce yutma: geri yazma düşerse bir SONRAKİ bekçi (grandfathering)
      // yanlış kırmızı verir ve teşhis buraya kadar geri izlenmek zorunda kalır.
      console.error("   ⚠️  bayraklar geri yazılamadı:", (e as Error).message);
      fail++;
    }
    if (testUserId) {
      // ⚠️ SERT SİLME DEĞİL, PASİFLEŞTİRME (evin kuralı: yalnız soft delete).
      // Ölçüldü: `user.delete` HER koşumda P2003 ile düşüyordu — bekçinin kendi
      // `setFeatureFlags` yazmaları o kullanıcı adına audit satırı üretiyor ve
      // `system_logs_userId_fkey` silmeyi reddediyor. `.catch(() => undefined)`
      // bunu sessizce yutuyordu, yani başlıktaki "test kullanıcısını siler"
      // iddiası YALANDI ve DB'de 27 bekçi kullanıcısı birikmişti.
      await prisma.userPermission.deleteMany({ where: { userId: testUserId } });
      await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => undefined);
      await prisma.user
        .update({ where: { id: testUserId }, data: { isActive: false } })
        .catch((e: Error) => console.error("   ⚠️  bekçi kullanıcısı pasifleştirilemedi:", e.message));
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
