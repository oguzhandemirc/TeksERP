// =============================================================================
// Test: StationCapabilityService — istasyon renk/özellik yetkinlik yönetimi
// Çalıştır: npx tsx scripts/test_station_capability.ts
// Doğrulananlar:
//   1. findByStation şekil + kategorisiz istasyonda canApplyColor/Property=true
//   2. setCapabilities renk + özellik ekler (replace semantics)
//   3. setCapabilities replace: yeni liste eskiyi tamamen değiştirir (ekle+sil)
//   4. setCapabilities boş liste → tüm yetkinlikleri siler
//   5. listAll sayaçları doğru (colorCount/propertyCount)
//   6. listAllDetailed detayı + kategori bayraklarını döner
//   7. pasif renk/özellik atanamaz (var-mı + isActive guard) → 400
//   8. olmayan renk id reddi → 400
//   9. olmayan istasyon reddi → 404 (findByStation + setCapabilities)
//  10. pasif istasyona yetkinlik atanamaz → 400
//  11. kategori-kapısı: appliesColor=false istasyona renk atanamaz → 400 (işlem yeteneği)
//
// NOT: Ayrı bir "işlem (operation) yeteneği" modeli YOK — istasyonun
// uygulayabileceği işlem kategorisi defaultCategory (SubcontractorCategory)
// üzerinden canApplyColor/canApplyProperty olarak türetilir. Test bu türetmeyi
// ve kategori-kapısı reddini doğrular.
// =============================================================================
import prisma from "../src/lib/prisma";
import { StationCapabilityService } from "../src/services/station-capability.service";

const svc = new StationCapabilityService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

async function main() {
  const ts = Date.now();

  // --- Seed master-data business-key ile çözülür ---
  // KURSUN_KK2 (PROCESS_QC, kategorisiz) → renk + özellik atanabilir.
  const kursun = await prisma.station.findUnique({ where: { code: "KURSUN_KK2" } });
  // ZIMPARA_FASON: defaultCategory ZIMPARA (appliesColor=false, appliesProperty=true)
  // → renk atanamaz; "işlem yeteneği" kapısını doğrulamak için kullanılır.
  const zimpara = await prisma.station.findUnique({ where: { code: "ZIMPARA_FASON" } });
  if (!kursun || !zimpara) throw new Error("Seed istasyonları eksik (npm run seed)");

  const beyaz = await prisma.color.findUnique({ where: { code: "BEYAZ" } });
  const siyah = await prisma.color.findUnique({ where: { code: "SIYAH" } });
  const lacivert = await prisma.color.findUnique({ where: { code: "LACIVERT" } });
  const propA = await prisma.fabricProperty.findUnique({ where: { code: "ANTIBAKTERIYEL" } });
  const propB = await prisma.fabricProperty.findUnique({ where: { code: "ZIMPARALI" } });
  if (!beyaz || !siyah || !lacivert || !propA || !propB) {
    throw new Error("Seed renk/özellikleri eksik (npm run seed)");
  }

  // --- TEST fixture: kendi istasyonumuz + kendi pasif renk/özelliğimiz ---
  // Kategorisiz INTERNAL istasyon → canApplyColor/Property türetimi true.
  const testStation = await prisma.station.create({
    data: {
      code: `TEST-STCAP-${ts}`,
      name: "TEST İstasyon Yetenek",
      type: "INTERNAL",
      kind: "OTHER",
    },
    select: { id: true, code: true },
  });
  const inactiveColor = await prisma.color.create({
    data: { code: `TEST-COL-${ts}`, name: "TEST Pasif Renk", isActive: false },
    select: { id: true },
  });
  const inactiveProp = await prisma.fabricProperty.create({
    data: { code: `TEST-PROP-${ts}`, name: "TEST Pasif Özellik", isActive: false },
    select: { id: true },
  });
  const inactiveStation = await prisma.station.create({
    data: {
      code: `TEST-STCAP-OFF-${ts}`,
      name: "TEST Pasif İstasyon",
      type: "INTERNAL",
      kind: "OTHER",
      isActive: false,
    },
    select: { id: true },
  });

  const NIL = "00000000-0000-0000-0000-000000000000";

  try {
    // 1) findByStation şekil + kategorisiz türetim
    const initial = await svc.findByStation(testStation.id);
    check(
      "findByStation şekil (boş yetkinlik, kategorisiz türetim)",
      initial.success === true &&
        initial.data.stationCode === testStation.code &&
        initial.data.hasDefaultCategory === false &&
        initial.data.canApplyColor === true &&
        initial.data.canApplyProperty === true &&
        initial.data.colors.length === 0 &&
        initial.data.properties.length === 0,
      `colors=${initial.data.colors.length} props=${initial.data.properties.length}`,
    );

    // 2) setCapabilities renk + özellik ekler
    const r1 = await svc.setCapabilities(
      testStation.id,
      { colorIds: [beyaz.id, siyah.id], propertyIds: [propA.id] },
      undefined,
    );
    const colorCodes1 = r1.data.colors.map((c) => c.code).sort();
    check(
      "setCapabilities renk+özellik ekledi",
      JSON.stringify(colorCodes1) === JSON.stringify(["BEYAZ", "SIYAH"]) &&
        r1.data.properties.length === 1 &&
        r1.data.properties[0].code === "ANTIBAKTERIYEL",
      `colors=${colorCodes1.join(",")} props=${r1.data.properties.map((p) => p.code).join(",")}`,
    );

    // 3) replace semantics: BEYAZ çıkar, LACIVERT gir; özellik aynı kalır
    const r2 = await svc.setCapabilities(
      testStation.id,
      { colorIds: [siyah.id, lacivert.id], propertyIds: [propA.id, propB.id] },
      undefined,
    );
    const colorCodes2 = r2.data.colors.map((c) => c.code).sort();
    const propCodes2 = r2.data.properties.map((p) => p.code).sort();
    check(
      "setCapabilities replace (ekle+sil, eski BEYAZ gitti)",
      JSON.stringify(colorCodes2) === JSON.stringify(["LACIVERT", "SIYAH"]) &&
        JSON.stringify(propCodes2) === JSON.stringify(["ANTIBAKTERIYEL", "ZIMPARALI"]),
      `colors=${colorCodes2.join(",")} props=${propCodes2.join(",")}`,
    );
    // DB satır sayısı da replace edilmiş olmalı (hayalet satır yok)
    const dbColorCount = await prisma.stationColor.count({ where: { stationId: testStation.id } });
    check("replace sonrası DB renk satırı = 2 (idempotent, çift yok)", dbColorCount === 2, `count=${dbColorCount}`);

    // 4) boş liste → hepsini siler
    const r3 = await svc.setCapabilities(
      testStation.id,
      { colorIds: [], propertyIds: [] },
      undefined,
    );
    check(
      "boş liste tüm yetkinlikleri sildi",
      r3.data.colors.length === 0 && r3.data.properties.length === 0,
    );

    // 5) listAll sayaçları — tekrar 2 renk + 1 özellik ver, sayaçları doğrula
    await svc.setCapabilities(
      testStation.id,
      { colorIds: [beyaz.id, lacivert.id], propertyIds: [propB.id] },
      undefined,
    );
    const all = await svc.listAll();
    const mine = all.data.find((s) => s.stationId === testStation.id);
    check(
      "listAll sayaçları doğru (colorCount=2, propertyCount=1)",
      !!mine && mine.colorCount === 2 && mine.propertyCount === 1,
      mine ? `colorCount=${mine.colorCount} propertyCount=${mine.propertyCount}` : "istasyon listede yok",
    );

    // 6) listAllDetailed detay + kategori bayrakları
    const detailed = await svc.listAllDetailed();
    const mineD = detailed.data.find((s) => s.stationId === testStation.id);
    const zimparaD = detailed.data.find((s) => s.stationId === zimpara.id);
    check(
      "listAllDetailed detayı döner (renk/özellik kodları)",
      !!mineD &&
        mineD.colors.map((c) => c.code).sort().join(",") === "BEYAZ,LACIVERT" &&
        mineD.properties.length === 1 &&
        mineD.properties[0].code === "ZIMPARALI",
      mineD ? `colors=${mineD.colors.map((c) => c.code).join(",")}` : "yok",
    );
    check(
      "listAllDetailed kategori bayrağı (ZIMPARA_FASON canApplyColor=false)",
      !!zimparaD && zimparaD.hasDefaultCategory === true && zimparaD.canApplyColor === false && zimparaD.canApplyProperty === true,
      zimparaD ? `canApplyColor=${zimparaD.canApplyColor} canApplyProperty=${zimparaD.canApplyProperty}` : "yok",
    );

    // 7) pasif renk/özellik atanamaz (isActive guard)
    await expectErr("pasif renk reddi → 400", "bulunamadı veya pasif", () =>
      svc.setCapabilities(testStation.id, { colorIds: [inactiveColor.id], propertyIds: [] }, undefined),
    );
    await expectErr("pasif özellik reddi → 400", "bulunamadı veya pasif", () =>
      svc.setCapabilities(testStation.id, { colorIds: [], propertyIds: [inactiveProp.id] }, undefined),
    );

    // 8) olmayan renk id reddi
    await expectErr("olmayan renk id reddi → 400", "bulunamadı veya pasif", () =>
      svc.setCapabilities(testStation.id, { colorIds: [NIL], propertyIds: [] }, undefined),
    );

    // başarısız atamalar mevcut yetkinliği BOZMAMALI (tx atomik)
    const afterErr = await svc.findByStation(testStation.id);
    check(
      "başarısız atama mevcut yetkinliği bozmadı",
      afterErr.data.colors.length === 2 && afterErr.data.properties.length === 1,
      `colors=${afterErr.data.colors.length} props=${afterErr.data.properties.length}`,
    );

    // 9) olmayan istasyon reddi → 404
    await expectErr("findByStation olmayan istasyon → 404", "İstasyon bulunamadı", () =>
      svc.findByStation(NIL),
    );
    await expectErr("setCapabilities olmayan istasyon → 404", "İstasyon bulunamadı", () =>
      svc.setCapabilities(NIL, { colorIds: [], propertyIds: [] }, undefined),
    );

    // 10) pasif istasyona yetkinlik atanamaz → 400
    await expectErr("pasif istasyona yetkinlik reddi → 400", "Pasif istasyona", () =>
      svc.setCapabilities(inactiveStation.id, { colorIds: [beyaz.id], propertyIds: [] }, undefined),
    );

    // 11) kategori-kapısı (işlem yeteneği): appliesColor=false istasyona renk atanamaz
    await expectErr("kategori-kapısı: ZIMPARA_FASON'a renk atanamaz → 400", "renk atanamaz", () =>
      svc.setCapabilities(zimpara.id, { colorIds: [beyaz.id], propertyIds: [] }, undefined),
    );
    // ama özellik atanabilir (appliesProperty=true) — kapı yön-bağımlı
    const zr = await svc.setCapabilities(zimpara.id, { colorIds: [], propertyIds: [propB.id] }, undefined);
    check(
      "kategori-kapısı: ZIMPARA_FASON'a özellik atanır (appliesProperty=true)",
      zr.data.properties.length === 1 && zr.data.properties[0].code === "ZIMPARALI",
      `props=${zr.data.properties.map((p) => p.code).join(",")}`,
    );
  } finally {
    // Kendi yarattıklarımızı temizle. StationColor/StationProperty → Station Cascade.
    await prisma.stationColor.deleteMany({ where: { stationId: zimpara.id } }).catch(() => {});
    await prisma.stationProperty.deleteMany({ where: { stationId: zimpara.id } }).catch(() => {});
    await prisma.station.delete({ where: { id: testStation.id } }).catch(() => {});
    await prisma.station.delete({ where: { id: inactiveStation.id } }).catch(() => {});
    await prisma.color.delete({ where: { id: inactiveColor.id } }).catch(() => {});
    await prisma.fabricProperty.delete({ where: { id: inactiveProp.id } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
