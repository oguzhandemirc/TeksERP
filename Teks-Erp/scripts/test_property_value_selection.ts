// =============================================================================
// Test: DEĞER TAŞIYAN ÖZELLİK — "Kurşunda 50 gr yaptım" (2026-08-11)
// Çalıştır: npx tsx scripts/test_property_value_selection.ts
// =============================================================================
// Saha isteği: Kurşun istasyonunda operatör 25GR / 50GR / 75GR seçebilsin ve
// bu, topun üstünde kalsın. Kat (KAT) bunu KENDİ KOLONUYLA çözüyordu
// (`Roll.foldType`); ikinci bir SEÇİM özelliğinin kolonu yok — değer artık
// `RollProperty.valueId`'de.
//
// Korunan invariantlar:
//   1. SEÇİM özelliğinde seçilen değer topa YAZILIR
//   2. Aynı özellikte İKİNCİ bir değer AYRI satır AÇMAZ, üstüne yazar
//      (@@unique([rollId,propertyId]) = dışlayıcılık; 25GR ve 50GR aynı anda olamaz)
//   3. SEÇİM özelliği değersiz işaretlenirse 400 (ADIYLA)
//   4. Katalogda olmayan değer 400 (geçerli değerleri sayar)
//   5. BAYRAK özelliğine değer gönderilirse 400 (sessizce yutulmaz)
//   6. SEÇİM özelliği AUTO moda ALINAMAZ (seçecek operatör yok)
//   7. Değer taşımayan çağrı MEVCUT değeri SİLMEZ (bypass kapanışı emsali)
//   8. Kod karşılaştırması locale-BAĞIMSIZ ("50gr" → "50GR")
//   9. Pasif değer operatöre SUNULMAZ (ama geçmiş kayıtta durur)
//  10. Kullanılan değer satırı SİLİNEMEZ (FK RESTRICT — geçmiş korunur)
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  assertPropertySelectionsValid,
  copyStationCapabilitiesToRoll,
  loadStationPropertyCaps,
} from "../src/services/helpers/station-capability-transfer.helper";
import { StationCapabilityService } from "../src/services/station-capability.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
function expectThrow(label: string, part: string, fn: () => void) {
  try { fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}
async function expectThrowAsync(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

const capSvc = new StationCapabilityService();

async function main() {
  const ts = Date.now();

  // ── Fixture: istasyon + GRAMAJ (SEÇİM) + KURSUNLU (BAYRAK) + top ──────────
  const station = await prisma.station.create({
    data: {
      code: `TEST-PVS-${ts}`,
      name: "TEST Değer İstasyonu",
      type: "INTERNAL",
      kind: "OTHER",
      appliesProperty: true,
    },
    select: { id: true },
  });
  const gramaj = await prisma.fabricProperty.create({
    data: {
      code: `TEST-PVS-GR-${ts}`,
      name: "TEST Gramaj",
      valueType: "CHOICE",
      values: {
        create: [
          { code: "25GR", name: "25 gr", sortOrder: 10 },
          { code: "50GR", name: "50 gr", sortOrder: 20 },
          { code: "75GR", name: "75 gr", sortOrder: 30, isActive: false }, // PASİF
        ],
      },
    },
    select: { id: true, name: true },
  });
  const flagProp = await prisma.fabricProperty.create({
    data: { code: `TEST-PVS-FL-${ts}`, name: "TEST Bayrak Özellik", valueType: "FLAG" },
    select: { id: true, name: true },
  });
  await prisma.stationProperty.create({
    data: { stationId: station.id, propertyId: gramaj.id, mode: "REQUIRED" },
  });
  await prisma.stationProperty.create({
    data: { stationId: station.id, propertyId: flagProp.id, mode: "OPTIONAL" },
  });

  const item = await prisma.item.create({
    data: { code: `TEST-PVS-ITM-${ts}`, name: `TEST Değer ${ts}`, itemType: "FABRIC" },
    select: { id: true },
  });
  const mkRoll = async (n: number) =>
    (await prisma.roll.create({
      data: {
        barcode: `TEST-PVS-R${n}-${ts}`,
        itemId: item.id,
        status: "WAREHOUSE",
        initialQty: 100,
        currentQty: 100,
        entrySource: "TAMBUR_MANUAL",
      },
      select: { id: true },
    })).id;

  const rollIds: string[] = [];
  const propIds = [gramaj.id, flagProp.id];

  try {
    const caps = await loadStationPropertyCaps(prisma, station.id);
    const grCap = caps.find((c) => c.propertyId === gramaj.id)!;

    // ── 9) Pasif değer SUNULMAZ ──────────────────────────────────────────────
    check("pasif değer (75GR) operatöre sunulmaz",
      grCap.values.map((v) => v.code).join(",") === "25GR,50GR",
      grCap.values.map((v) => v.code).join(","));
    check("SEÇİM tipi DTO'da taşınıyor", grCap.valueType === "CHOICE");

    // ── 1) Değer topa yazılır ────────────────────────────────────────────────
    const r1 = await mkRoll(1); rollIds.push(r1);
    await copyStationCapabilitiesToRoll(prisma, {
      stationId: station.id,
      rollId: r1,
      selections: [{ propertyId: gramaj.id, valueCode: "50GR" }],
      caps,
    });
    const w1 = await prisma.rollProperty.findFirst({
      where: { rollId: r1, propertyId: gramaj.id },
      select: { value: { select: { code: true } } },
    });
    check("seçilen değer topa YAZILDI", w1?.value?.code === "50GR", String(w1?.value?.code));

    // ── 2) İkinci değer AYRI SATIR AÇMAZ, üstüne yazar ───────────────────────
    await copyStationCapabilitiesToRoll(prisma, {
      stationId: station.id,
      rollId: r1,
      selections: [{ propertyId: gramaj.id, valueCode: "25GR" }],
      caps,
    });
    const rows1 = await prisma.rollProperty.findMany({
      where: { rollId: r1, propertyId: gramaj.id },
      select: { value: { select: { code: true } } },
    });
    check("düzeltme ÜSTÜNE yazar, ikinci satır açmaz", rows1.length === 1, `satır=${rows1.length}`);
    check("düzeltilen değer 25GR", rows1[0]?.value?.code === "25GR", String(rows1[0]?.value?.code));

    // ── 7) Değersiz çağrı MEVCUT değeri SİLMEZ (bypass kapanışı emsali) ──────
    await copyStationCapabilitiesToRoll(prisma, { stationId: station.id, rollId: r1, caps });
    const afterNoSel = await prisma.rollProperty.findFirst({
      where: { rollId: r1, propertyId: gramaj.id },
      select: { value: { select: { code: true } } },
    });
    check("seçimsiz çağrı mevcut değeri SİLMEDİ", afterNoSel?.value?.code === "25GR",
      String(afterNoSel?.value?.code));

    // ── 8) Locale-bağımsız kod eşleşmesi ─────────────────────────────────────
    const r2 = await mkRoll(2); rollIds.push(r2);
    await copyStationCapabilitiesToRoll(prisma, {
      stationId: station.id,
      rollId: r2,
      selections: [{ propertyId: gramaj.id, valueCode: " 50gr " }],
      caps,
    });
    const w2 = await prisma.rollProperty.findFirst({
      where: { rollId: r2, propertyId: gramaj.id },
      select: { value: { select: { code: true } } },
    });
    check('"50gr" (küçük harf + boşluk) → 50GR', w2?.value?.code === "50GR", String(w2?.value?.code));

    // ── 3/4/5) Doğrulama kuralları ───────────────────────────────────────────
    expectThrow("SEÇİM değersiz işaretlenirse 400 (ADIYLA)", "TEST Gramaj", () =>
      assertPropertySelectionsValid(caps, [{ propertyId: gramaj.id }]),
    );
    expectThrow("katalog dışı değer 400", "tanımlı değil", () =>
      assertPropertySelectionsValid(caps, [{ propertyId: gramaj.id, valueCode: "99GR" }]),
    );
    expectThrow("hata mesajı geçerli değerleri SAYAR", "25GR", () =>
      assertPropertySelectionsValid(caps, [{ propertyId: gramaj.id, valueCode: "99GR" }]),
    );
    expectThrow("PASİF değer seçilemez", "tanımlı değil", () =>
      assertPropertySelectionsValid(caps, [{ propertyId: gramaj.id, valueCode: "75GR" }]),
    );
    expectThrow("BAYRAK özelliğine değer 400 (sessizce yutulmaz)", "BAYRAK", () =>
      assertPropertySelectionsValid(caps, [
        { propertyId: gramaj.id, valueCode: "50GR" },
        { propertyId: flagProp.id, valueCode: "50GR" },
      ]),
    );
    let okErr = "";
    try {
      assertPropertySelectionsValid(caps, [
        { propertyId: gramaj.id, valueCode: "50GR" },
        { propertyId: flagProp.id },
      ]);
    } catch (e) { okErr = e instanceof Error ? e.message : String(e); }
    check("geçerli cevap kümesi kabul edilir", okErr === "", okErr);

    // ── 6) SEÇİM özelliği AUTO moda ALINAMAZ ─────────────────────────────────
    await expectThrowAsync("SEÇİM özelliği AUTO yapılamaz", "Otomatik", () =>
      capSvc.setCapabilities(station.id, {
        properties: [
          { propertyId: gramaj.id, mode: "AUTO" },
          { propertyId: flagProp.id, mode: "OPTIONAL" },
        ],
      }),
    );
    // BAYRAK hâlâ AUTO olabilir (kurşun emsali)
    let flagAutoErr = "";
    try {
      await capSvc.setCapabilities(station.id, {
        properties: [
          { propertyId: gramaj.id, mode: "REQUIRED" },
          { propertyId: flagProp.id, mode: "AUTO" },
        ],
      });
    } catch (e) { flagAutoErr = e instanceof Error ? e.message : String(e); }
    check("BAYRAK özelliği AUTO olabilir (kurşun emsali)", flagAutoErr === "", flagAutoErr);

    // ── 10) Kullanılan değer satırı SİLİNEMEZ (FK RESTRICT) ──────────────────
    await expectThrowAsync("kullanılan değer satırı SİLİNEMEZ (geçmiş korunur)", "", async () => {
      const v = await prisma.fabricPropertyValue.findFirstOrThrow({
        where: { propertyId: gramaj.id, code: "25GR" },
        select: { id: true },
      });
      await prisma.fabricPropertyValue.delete({ where: { id: v.id } });
    });
  } finally {
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: item.id } }).catch(() => {});
    await prisma.stationProperty.deleteMany({ where: { stationId: station.id } }).catch(() => {});
    await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: propIds } } }).catch(() => {});
    await prisma.fabricProperty.deleteMany({ where: { id: { in: propIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: station.id } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
