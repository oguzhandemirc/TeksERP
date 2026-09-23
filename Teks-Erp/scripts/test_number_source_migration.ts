// =============================================================================
// BEKÇİ — NUMARA KAYNAĞI GÖÇÜ ve TEK KAYNAK (D3③, 2026-09-23)
// =============================================================================
//   §1 GÖÇ TEK SEFERLİK ve DAMGALI: damga yokken koşar, damga varken BİR DAHA
//      BAKMAZ (panelden seçilen değeri açılış EZMEZ)
//   §2 ÜÇ DURUM: satır yok → FREE (artefakt `false` göç ettirilmez) ·
//      bayrak false → MANUAL · bayrak true → FREE
//   §3 ESKİ BAYRAK TÜRETİLİR: `readPartyCodeAuto` artık `numberSource`tan okur
//   §4 TEK YAZAR: eski anahtara yazmak `numberSource`a yazar; DEĞİŞMEDİYSE
//      hiç yazmaz (SYSTEM sessizce düşmez)
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-23): damga kontrolü kaldırılınca §1 ❌ ·
//    satır-yok dalı `MANUAL` yapılınca §2 ❌ · `readPartyCodeAuto` eski satırı
//    okumaya döndürülünce §3 ❌ · "değişmediyse yazma" kolu kalkınca §4 ❌.
//
// Çalıştır: npx tsx scripts/test_number_source_migration.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  PARTY_CODE_AUTO_MIGRATION_STAMP,
  reconcileNumberSeries,
} from "../src/jobs/number-series-catalog.job";
import { readPartyCodeAuto, systemSettingService } from "../src/services/system-setting.service";
import { refreshNumberSeriesCache, resolveSeriesFormat } from "../src/services/number-series.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

/** `setFeatureFlags` kimlik ister (ayar yazmak kullanıcı eylemidir); fikstür admini. */
let ADMIN = "";

const BAYRAK = "workorder.partyCodeAuto";
const DAMGA = `${process.pid}-${Date.now() % 1_000_000}`;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** Göç öncesi duruma döndür: damgayı ve modu sıfırla, bayrağı istenen hâle getir. */
async function hazirla(bayrak: boolean | null): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: PARTY_CODE_AUTO_MIGRATION_STAMP } });
  await prisma.numberSeries.update({ where: { key: "workOrder" }, data: { numberSource: "FREE" } });
  if (bayrak === null) await prisma.systemSetting.deleteMany({ where: { key: BAYRAK } });
  else {
    await prisma.systemSetting.upsert({
      where: { key: BAYRAK },
      create: { key: BAYRAK, value: bayrak },
      update: { value: bayrak },
    });
  }
  await refreshNumberSeriesCache();
}

async function mod(): Promise<string> {
  await refreshNumberSeriesCache();
  return resolveSeriesFormat("workOrder").numberSource ?? "FREE";
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(engel); process.exit(1); }
  // ⚠️ AKTÖRÜ KENDİ KURAR, ortamda ARAMAZ: `findFirst` temiz bir CI DB'sinde
  // başka bir kullanıcıyı yakalar ya da hiç bulamaz (bekçi vakumen yeşil kalır).
  // Sabit kullanıcı ADIYLA çözmek de olmaz: o yazım ORTAM BAĞIMLILIĞI TAVANINA
  // yazılır (`test_ortam_bagimliligi_tavani`) ve o taban yalnız DÜŞER — yeni bir
  // satır eklemek kapının kendisini gevşetirdi.
  // ⚠️ Bu cümle o adı ÖRNEKLEMİYOR: tarayıcı METNİ okur ve kuralı ANLATAN yorum
  // da ihlal sayılır (bu turda İKİNCİ kez yaşandı).
  // Kullanıcı gerekli çünkü `setFeatureFlags` kimlik ister (ayar yazmak bir
  // KULLANICI eylemidir) ve `updatedById` gerçek bir FK'dır.
  ADMIN = (
    await prisma.user.create({
      data: {
        username: `d3-gocbekci-${DAMGA}`.slice(0, 50),
        passwordHash: "x",
        fullName: "D3 göç bekçisi (fikstür)",
        isActive: false,
      },
      select: { id: true },
    })
  ).id;
  check("körlük zemini: fikstür aktörü kuruldu (ortamdan aranmadı)", ADMIN !== "");

  // Test DB'sinin ÖNCEKİ hâli geri konsun (bu bekçi gerçek satırlara dokunuyor).
  const oncekiBayrak = await prisma.systemSetting.findUnique({ where: { key: BAYRAK }, select: { value: true } });
  const oncekiDamga = await prisma.systemSetting.findUnique({ where: { key: PARTY_CODE_AUTO_MIGRATION_STAMP }, select: { value: true } });
  const oncekiMod = await mod();

  try {
    // ── §2 ÜÇ DURUM ────────────────────────────────────────────────────────
    await hazirla(null);
    await reconcileNumberSeries();
    check("§2a ⭐ satır YOKKEN göç `FREE` yazar — `asBoolean(undefined)` ARTEFAKTI göç ettirilmez",
      (await mod()) === "FREE", await mod());

    await hazirla(false);
    await reconcileNumberSeries();
    check("§2b ⭐ bayrak `false` (AÇIK TERCİH) → `MANUAL`", (await mod()) === "MANUAL", await mod());

    await hazirla(true);
    await reconcileNumberSeries();
    check("§2c bayrak `true` → `FREE`", (await mod()) === "FREE", await mod());

    // ── §1 DAMGA: ikinci açılış EZMEZ ──────────────────────────────────────
    const damga = await prisma.systemSetting.findUnique({
      where: { key: PARTY_CODE_AUTO_MIGRATION_STAMP }, select: { value: true },
    });
    check("§1a göç damgası basıldı", damga !== null);
    // Panelden SYSTEM seçilmiş gibi yap; bayrak hâlâ `true` (yani göç FREE derdi).
    await prisma.numberSeries.update({ where: { key: "workOrder" }, data: { numberSource: "SYSTEM" } });
    await refreshNumberSeriesCache();
    const r = await reconcileNumberSeries();
    check("§1b ⭐ damga varken göç BİR DAHA KOŞMAZ (panelden seçilen değer EZİLMEZ)",
      r.partyCodeAutoMigratedTo === null && (await mod()) === "SYSTEM", await mod());

    // ── §3 ESKİ BAYRAK TÜRETİLİR ───────────────────────────────────────────
    check("§3a ⭐ SYSTEM → türetilmiş bayrak `true` (eski panel alanı kilitli gösterir)",
      (await readPartyCodeAuto()) === true);
    await prisma.numberSeries.update({ where: { key: "workOrder" }, data: { numberSource: "MANUAL" } });
    await refreshNumberSeriesCache();
    check("§3b ⭐ MANUAL → türetilmiş bayrak `false`", (await readPartyCodeAuto()) === false);
    await prisma.numberSeries.update({ where: { key: "workOrder" }, data: { numberSource: "FREE" } });
    await refreshNumberSeriesCache();
    check("§3c FREE → türetilmiş bayrak `true`", (await readPartyCodeAuto()) === true);
    check("§3d ⭐ eski SATIR artık okunmuyor: satırı `false` yapmak türetilmiş değeri DEĞİŞTİRMEZ",
      await (async () => {
        await prisma.systemSetting.upsert({
          where: { key: BAYRAK }, create: { key: BAYRAK, value: false }, update: { value: false },
        });
        return (await readPartyCodeAuto()) === true;
      })());

    // ── §4 TEK YAZAR ───────────────────────────────────────────────────────
    await systemSettingService.setFeatureFlags({ partyCodeAuto: false }, ADMIN);
    check("§4a ⭐ eski anahtara yazmak `numberSource`a yazar (`false` → MANUAL)",
      (await mod()) === "MANUAL", await mod());
    await prisma.numberSeries.update({ where: { key: "workOrder" }, data: { numberSource: "SYSTEM" } });
    await refreshNumberSeriesCache();
    await systemSettingService.setFeatureFlags({ partyCodeAuto: true }, ADMIN);
    check("§4b ⭐ DEĞİŞMEDİYSE yazmaz: SYSTEM `true` görünür, `true` yazılınca SESSİZCE düşmez",
      (await mod()) === "SYSTEM", await mod());
    await systemSettingService.setFeatureFlags({ partyCodeAuto: false }, ADMIN);
    check("§4c gerçekten değişince yazar: SYSTEM → MANUAL", (await mod()) === "MANUAL", await mod());
  } finally {
    // Test DB'si geri yüklenir (bu bekçi gerçek ayar satırlarına dokunuyor).
    await prisma.numberSeries.update({ where: { key: "workOrder" }, data: { numberSource: oncekiMod as never } });
    if (oncekiBayrak === null) await prisma.systemSetting.deleteMany({ where: { key: BAYRAK } });
    else await prisma.systemSetting.upsert({
      where: { key: BAYRAK },
      create: { key: BAYRAK, value: oncekiBayrak.value as never },
      update: { value: oncekiBayrak.value as never },
    });
    if (oncekiDamga === null) await prisma.systemSetting.deleteMany({ where: { key: PARTY_CODE_AUTO_MIGRATION_STAMP } });
    else await prisma.systemSetting.upsert({
      where: { key: PARTY_CODE_AUTO_MIGRATION_STAMP },
      create: { key: PARTY_CODE_AUTO_MIGRATION_STAMP, value: oncekiDamga.value as never },
      update: { value: oncekiDamga.value as never },
    });
    await refreshNumberSeriesCache();
    // Fikstür aktörü silinir. ⚠️ Audit satırları `updatedById` ile bağlı olabilir;
    // kullanıcı silinemezse bekçi ÇÖKMEZ — temizlik best-effort, ölçüm değil.
    if (ADMIN) await prisma.user.delete({ where: { id: ADMIN } }).catch(() => undefined);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
