// =============================================================================
// Test: Saha #20 — top adı format şablonu
// Çalıştır: npx tsx scripts/test_roll_name_template.ts
// Doğrulananlar:
//   1. renderRollName tüm token'ları doldurur
//   2. Boş renk (renksiz) atlanır, boşluk sadeleşir
//   3. Özel şablon ("{item} {color} {width}cm {quality}")
//   4. width sayı/0 davranışı
//   5. setFeatureFlags geçerli şablonu kaydeder + token'sız/uzun şablon reddedilir
// =============================================================================
import prisma from "../src/lib/prisma";
import { renderRollName } from "../src/services/helpers/roll-name.helper";
import {
  systemSettingService,
  readRollNameTemplate,
  DEFAULT_ROLL_NAME_TEMPLATE,
} from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

async function main() {
  const D = DEFAULT_ROLL_NAME_TEMPLATE;

  check(
    "Tüm token'lar dolu",
    renderRollName(D, { item: "PATOS", color: "055-BEYAZ", width: 150 }) === "PATOS 055-BEYAZ 150",
    renderRollName(D, { item: "PATOS", color: "055-BEYAZ", width: 150 }),
  );
  check(
    "Renksiz → renk atlanır, boşluk sadeleşir",
    renderRollName(D, { item: "PATOS", color: null, width: 150 }) === "PATOS 150",
    renderRollName(D, { item: "PATOS", color: null, width: 150 }),
  );
  check(
    "Özel şablon {width}cm + {quality}",
    renderRollName("{item} {color} {width}cm {quality}", {
      item: "POLAR",
      color: "SİYAH",
      width: 180,
      quality: "A",
    }) === "POLAR SİYAH 180cm A",
    renderRollName("{item} {color} {width}cm {quality}", { item: "POLAR", color: "SİYAH", width: 180, quality: "A" }),
  );
  check("width null atlanır", renderRollName(D, { item: "KRİNKLE", color: "MAVİ", width: null }) === "KRİNKLE MAVİ");
  check(
    "Sadece item (hepsi boş)",
    renderRollName(D, { item: "SÜET" }) === "SÜET",
    renderRollName(D, { item: "SÜET" }),
  );

  // setFeatureFlags doğrulama
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("admin kullanıcı yok (npm run seed)");

  const original = await readRollNameTemplate();
  try {
    await systemSettingService.setFeatureFlags({ rollNameTemplate: "{item}/{color}/{width}" }, admin.id);
    check("Geçerli şablon kaydedildi", (await readRollNameTemplate()) === "{item}/{color}/{width}");

    let rejected = false;
    try {
      await systemSettingService.setFeatureFlags({ rollNameTemplate: "token yok" }, admin.id);
    } catch (e) {
      rejected = (e as { statusCode?: number }).statusCode === 400;
    }
    check("Token'sız şablon 400 ile reddedildi", rejected);

    let tooLong = false;
    try {
      await systemSettingService.setFeatureFlags({ rollNameTemplate: "{item}".repeat(30) }, admin.id);
    } catch (e) {
      tooLong = (e as { statusCode?: number }).statusCode === 400;
    }
    check("100+ karakter şablon reddedildi", tooLong);
  } finally {
    // Orijinali geri yaz (default'sa key'i sil).
    await systemSettingService.setFeatureFlags({ rollNameTemplate: original }, admin.id).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
