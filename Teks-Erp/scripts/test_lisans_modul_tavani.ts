// =============================================================================
// BEKÇİ — LİSANS MODÜL TAVANI (`readX = readXRaw ∧ tavan`, yazma tavanı, panel bloğu)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_modul_tavani   (kendi _test DB'si;
// modül satırlarını try İÇİNDE yazar, finally'de önceki hâline döndürür; audit bellekte yutulur)
//
// NE ÖLÇER:
//   §1 on modül anahtarının her biri için ham ↔ enforcement çifti: ham gövde DB anahtarını
//      okur ve tavansızdır, enforcement AYNI anahtarla tavandan geçirir.
//   §2 ⭐ `src/**`teki HER çağıran doğru varyantta (AST): ham okuyucu yalnız beyanlı ham
//      çağıranlarda (panel geri-okuması `getFeatureFlags`, bağımlılık doğrulaması
//      `effectiveModuleValue`); enforcement okuyucusu ham çağıranda yok; çağrı dışı anılış yok;
//      ölü beyan yok. Yedi adlı kapıda okunan her modülün `licenseModuleError` eşi var.
//   §3 ⭐ DB'ye elle bayrak + geçerli HAK (modül yok) → okuyucu kapalı, kapı 403 LICENSE_MODULE,
//      yazma tavanı 403, panel ham değeri + lisans bloğunu görür; kapatmak serbest.
//   §4 belirsizlikte (ölçülemedi) ham değer · §5 ⭐ K2 dondurması ek sürede de, belirsizlikte de
//      kapalı; HAK tavanı ek sürede SÜRER · §6 gözlemde ham değer + "reddederdim" sayacı.
//
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile birebir geri alındı; sonuçlar commit
// mesajında): T1 bir enforcement çağıranı ham varyanta · T2 `getFeatureFlags` enforcement'a ·
// T3 enforcement gövdesinde yanlış anahtar · T4 bir kapıdan `licenseModuleError` kaldırılır ·
// T5 tavan HAK'ı ek sürede gevşetir · T6 yazma tavanı kaldırılır.
// =============================================================================
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { AuthService } from "../src/services/auth.service";
import {
  SETTING_KEYS,
  invalidateFeatureFlagsCache,
  readFinanceEnabled,
  readFinanceEnabledRaw,
  readProductionEnabled,
  readTicaretEnabled,
  systemSettingService,
} from "../src/services/system-setting.service";
import { MODULE_SETTING_KEYS } from "../src/constants/module-flags";
import { requireFinanceEnabled } from "../src/middlewares/finance.middleware";
import { peekObservationCounters, resetObservationCounters } from "../src/lib/license/runtime";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { SERVIS, SRC_KOKU, anilislar, kapiGovdesi, okuyucuCiftleri } from "./lib/modul-okuyucu-tarama";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

/** Ham okuyucunun MEŞRU olduğu yerler — her biri gerekçeli; ölü beyan kırmızı. */
const HAM_CAGIRANLAR: Record<string, string> = {
  "services/system-setting.service.ts#getFeatureFlags": "panel geri-okuması: şalter kendi yazdığını okur (lisans ayrı blokta)",
  "services/system-setting.service.ts#effectiveModuleValue": "bağımlılık doğrulaması: yazılan gövdeyle DB'nin ham birleşimi",
};

/** Yedi adlı modül kapısı (dosya → fonksiyon). */
const ADLI_KAPILAR: ReadonlyArray<[string, string]> = [
  ["middlewares/module.middleware.ts", "requireTicaretEnabled"],
  ["middlewares/module.middleware.ts", "requireIplikEnabled"],
  ["middlewares/module.middleware.ts", "requireDevereEnabled"],
  ["middlewares/module.middleware.ts", "requireDepoMultiEnabled"],
  ["middlewares/module.middleware.ts", "requireProductionEnabled"],
  ["middlewares/module.middleware.ts", "requireDokumaEnabled"],
  ["middlewares/finance.middleware.ts", "requireFinanceEnabled"],
];

function statikAyak(): void {
  console.log("\n§1 — ham ↔ enforcement çiftleri");
  const ciftler = okuyucuCiftleri();
  const anahtarlar = new Set(ciftler.map((c) => (SETTING_KEYS as Record<string, string>)[c.sabit]));
  check("§1a ⭐ her modül anahtarı için tam bir çift (on)", ciftler.length === MODULE_SETTING_KEYS.size && [...MODULE_SETTING_KEYS].every((k) => anahtarlar.has(k)), `${ciftler.length} çift`);
  for (const c of ciftler) {
    check(`§1b ${c.ad}: ham ${c.sabit} okur ve tavansız; enforcement aynı anahtarla hamdan geçer`, c.hamOkur && c.hamTavansiz && c.tavanAyniSabit && c.hamdanGecer);
  }

  console.log("\n§2 — her çağıran doğru varyantta (AST)");
  const hamAdlar = new Set(ciftler.map((c) => `${c.ad}Raw`));
  const tavanAdlar = new Set(ciftler.map((c) => c.ad));
  const hepsi = anilislar(new Set([...hamAdlar, ...tavanAdlar]));
  const yer = (a: { dosya: string; fonksiyon: string }): string => `${a.dosya}#${a.fonksiyon}`;
  const hamMesru = (a: { ad: string; fonksiyon: string; dosya: string }): boolean =>
    yer(a) in HAM_CAGIRANLAR || (a.dosya === path.relative(SRC_KOKU, SERVIS) && `${a.fonksiyon}Raw` === a.ad);
  const cagriDisi = hepsi.filter((a) => !a.cagri);
  check("§2a çağrı dışı anılış yok (okuyucu değer olarak dolaştırılmıyor)", cagriDisi.length === 0, cagriDisi.map((a) => `${yer(a)}:${a.ad}`).join(" | "));
  const yanlisHam = hepsi.filter((a) => hamAdlar.has(a.ad) && !hamMesru(a));
  check("§2b ⭐ ham okuyucu yalnız beyanlı ham çağıranlarda (enforcement ham değer okumaz)", yanlisHam.length === 0, yanlisHam.map((a) => `${yer(a)}:${a.ad}`).join(" | "));
  const yanlisTavan = hepsi.filter((a) => tavanAdlar.has(a.ad) && yer(a) in HAM_CAGIRANLAR);
  check("§2c ⭐ ham çağıranda enforcement okuyucusu yok (panel tavanlı değeri geri okumaz)", yanlisTavan.length === 0, yanlisTavan.map((a) => `${yer(a)}:${a.ad}`).join(" | "));
  for (const [beyan, neden] of Object.entries(HAM_CAGIRANLAR)) {
    const okunan = new Set(hepsi.filter((a) => yer(a) === beyan && hamAdlar.has(a.ad)).map((a) => a.ad));
    check(`§2d ölü beyan yok ve on hamın hepsi okunuyor: ${beyan} (${neden})`, okunan.size === hamAdlar.size, `${okunan.size}/${hamAdlar.size}`);
  }
  const tavanCagri = hepsi.filter((a) => tavanAdlar.has(a.ad) && a.cagri && !(yer(a) in HAM_CAGIRANLAR));
  const dosyalar = new Set(tavanCagri.map((a) => a.dosya));
  check("§2e körlük zemini: ≥ 45 enforcement çağrısı, ≥ 15 dosya", tavanCagri.length >= 45 && dosyalar.size >= 15, `${tavanCagri.length} çağrı · ${dosyalar.size} dosya`);
  const sabitOf = new Map(ciftler.map((c) => [c.ad, c.sabit] as const));
  for (const [dosya, fonk] of ADLI_KAPILAR) {
    const g = kapiGovdesi(path.join(SRC_KOKU, dosya), fonk);
    const okunan = [...new Set(g.okuyucular.map((o) => sabitOf.get(o) ?? `?${o}`))].sort();
    const lisans = [...new Set(g.lisansSabitleri)].sort();
    check(`§2f ${fonk}: okunan her modülün LICENSE_MODULE eşi var`, okunan.length > 0 && okunan.join() === lisans.join(), `okunan=${okunan.join()} lisans=${lisans.join()}`);
  }
}

async function kapiKodu(): Promise<string | undefined> {
  let hata: unknown;
  await requireFinanceEnabled({} as Request, {} as Response, ((e?: unknown) => {
    hata = e;
  }) as NextFunction);
  return (hata as { details?: { code?: string } } | undefined)?.details?.code;
}

/** Yazan: bekçinin kendi geçici kullanıcısı (`updatedById` FK'si); satır ve kullanıcı teardown'da geri alınır. */
let yazanId = "";

async function yazmaKodu(input: Record<string, unknown>): Promise<string> {
  try {
    await systemSettingService.setFeatureFlags(input, yazanId);
    return "YAZDI";
  } catch (e) {
    return (e as { details?: { code?: string } }).details?.code ?? String(e);
  }
}

async function bayrakYaz(anahtar: string, deger: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key: anahtar }, create: { key: anahtar, value: deger }, update: { value: deger } });
  invalidateFeatureFlagsCache();
}

async function davranisAyagi(): Promise<void> {
  console.log("\n§3 — DB'ye elle bayrak + geçerli HAK (modül lisansta yok)");
  lisansKipKur({ zorlama: true, moduller: ["production.enabled", "ticaret.enabled"] });
  await bayrakYaz(SETTING_KEYS.FINANCE_ENABLED, true);
  check("§3a zemin: ham değer AÇIK", (await readFinanceEnabledRaw()) === true);
  check("§3b ⭐ enforcement okuyucusu KAPALI", (await readFinanceEnabled()) === false);
  check("§3c ⭐ adlı kapı 403 LICENSE_MODULE", (await kapiKodu()) === "LICENSE_MODULE");
  check("§3d lisanstaki modül açık (üretim: satır yok → açık)", (await readProductionEnabled()) === true);
  const ff = (await systemSettingService.getFeatureFlags()).data;
  const kapali = ff.license.kapaliModuller.map((k) => `${k.anahtar}:${k.neden}`);
  check("§3e panel HAM şalteri + lisans bloğunu görür", ff.financeEnabled === true && ff.license.kip === "zorla" && kapali.includes("finance.enabled:LISANSTA_YOK") && !kapali.some((k) => k.startsWith("production")), kapali.join(","));
  check("§3f ⭐ yazma tavanı: lisansta olmayan modül AÇILAMAZ", (await yazmaKodu({ financeEnabled: true })) === "LICENSE_MODULE");
  check("§3g kapatmak serbest", (await yazmaKodu({ financeEnabled: false })) === "YAZDI" && (await readFinanceEnabledRaw()) === false);
  lisansKipKur({ zorlama: true });
  check("§3h lisanstaki modül kapalıysa kod MODULE_DISABLED (lisans suçlanmaz)", (await kapiKodu()) === "MODULE_DISABLED");

  console.log("\n§4 — belirsizlik (ölçülemedi) ham değeri geçirir");
  await bayrakYaz(SETTING_KEYS.FINANCE_ENABLED, true);
  lisansKipKur({ zorlama: true, moduller: ["production.enabled"], parmakIziOlculdu: false });
  check("§4 ⭐ ÖLÇÜLEMEDİ'de HAK tavanı uygulanmaz", (await readFinanceEnabled()) === true && (await kapiKodu()) === undefined);

  console.log("\n§5 — K2 dondurması ek sürede ve belirsizlikte kalıcı");
  await bayrakYaz(SETTING_KEYS.TICARET_ENABLED, true);
  const { snap } = lisansKipKur({ zorlama: true, kiraBitti: true, kademe: "K2", donmus: ["finance.enabled"], moduller: ["production.enabled", "finance.enabled"] });
  check("§5a zemin: kademe EK_SURE", snap.state.uygulananKademe === "EK_SURE", snap.state.uygulananKademe);
  check("§5b ⭐ dondurulan modül ek sürede KAPALI (DONDURULDU)", (await readFinanceEnabled()) === false && (await kapiKodu()) === "LICENSE_MODULE");
  check("§5c ⭐ HAK tavanı ek sürede SÜRER (ticaret lisansta yok)", (await readTicaretEnabled()) === false);
  lisansKipKur({ zorlama: true, kiraBitti: true, kademe: "K2", donmus: ["finance.enabled"], parmakIziOlculdu: false });
  check("§5d ⭐ dondurma belirsizlikte de kalıcı", (await readFinanceEnabled()) === false);

  console.log("\n§6 — gözlem: ham değer + sayaç");
  lisansKipKur({ zorlama: false, kademe: "K2", donmus: ["finance.enabled"] });
  resetObservationCounters();
  check("§6a ⭐ gözlemde ham değer (sıfır fark)", (await readFinanceEnabled()) === true && (await kapiKodu()) === undefined);
  check("§6b 'reddederdim' sayacı arttı", peekObservationCounters().reddedilecekModul >= 1);
  check("§6c gözlemde panel lisans bloğu boş", (await systemSettingService.getFeatureFlags()).data.license.kapaliModuller.length === 0);
}

async function main(): Promise<void> {
  console.log("=== Lisans modül tavanı ===");
  // Audit bellekte yutulur (gerçek imzayla atanır — tip kapısı menzilde kalır).
  AuditService.log = async () => undefined;
  AuditService.logEvent = async () => undefined;
  statikAyak();
  const izlenen = [SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.TICARET_ENABLED];
  const once = await prisma.systemSetting.findMany({ where: { key: { in: izlenen } } });
  const yazan = await prisma.user.create({
    data: { username: `TEST-lisans-tavan-${Date.now()}`, passwordHash: await AuthService.hashPassword("Deneme-12345"), fullName: "TEST Lisans Tavanı" },
    select: { id: true },
  });
  yazanId = yazan.id;
  try {
    await davranisAyagi();
  } finally {
    await temizleBayraklar(izlenen, once);
    await prisma.user.deleteMany({ where: { id: yazan.id } });
    temizleLisansKipDizini();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

type AyarSatiri = { key: string; value: unknown; description: string | null; updatedById: string | null };

/** Satırı yazımdan önceki hâline döndürür (yazan kullanıcı dahil — geçici kullanıcı ardından silinir). */
async function temizleBayraklar(anahtarlar: string[], once: AyarSatiri[]): Promise<void> {
  for (const k of anahtarlar) {
    const eski = once.find((r) => r.key === k);
    if (eski) {
      await prisma.systemSetting.update({
        where: { key: k },
        data: { value: eski.value as never, description: eski.description, updatedById: eski.updatedById },
      });
    } else await prisma.systemSetting.deleteMany({ where: { key: k } });
  }
  invalidateFeatureFlagsCache();
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
