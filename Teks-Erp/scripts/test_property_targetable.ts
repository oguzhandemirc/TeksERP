// =============================================================================
// Test: SEÇİM (CHOICE) ÖZELLİĞİ HEDEF OLAMAZ + TİP GEÇİŞ KİLİTLERİ (2026-08-11)
// Çalıştır: npx tsx scripts/test_property_targetable.ts
// =============================================================================
// Denetim bulguları Q1/Q2/F2/F3/F5/SEK-3'ün bekçisi.
//
// SEÇİM tipli özellik (GRAMAJ gibi) bir SORU'dur — cevabını istasyon operatörü
// verir. Hedef/planlama listeleri ise BAYRAK evrenidir ("bu topta şu olacak").
// CHOICE bir hedef listesine sızarsa iki dünya karışır: planlamacı "GRAMAJ"
// hedefler ama HANGİ gramaj olduğunu kimse söyleyemez; canlı top replace'leri
// de o satırı değersiz kopyalayıp operatör seçimini ezerdi.
//
// Korunan invariantlar:
//   1. KAYNAK TARAMASI (mekanik): 9 hedef kapısının HEPSİ
//      `assertTargetablePropertyIds` çağırır — biri silinirse kırmızı.
//      (işlevsel kontrolü ağır olan kapılar — sipariş kalemi, fason kabul,
//      KK1 girişi — en azından bu taramayla kilitli kalır)
//   2. İş emri create: CHOICE hedef → 400 (özelliğin ADIYLA); FLAG → geçer
//   3. Rota adımı: plannedPropertyIds'te CHOICE → 400
//   4. Ürün izinli listesi: create + update'te CHOICE → 400
//   5. Tip geçişleri (fabric-property.update):
//      a. KAT sistem karakteristiği — tipi HİÇ değiştirilemez
//      b. CHOICE→FLAG: değer listesi varken 400
//      c. FLAG→CHOICE: AUTO modlu istasyon bağı varken 400 (istasyon ADIYLA)
//      d. FLAG→CHOICE: hedef pivotunda kullanılırken 400
//      e. Temiz FLAG→CHOICE geçer (kilit aşırı geniş değil)
// =============================================================================
import { readFileSync } from "fs";
import path from "path";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { RouteService, ROUTE_SERVICE_CONFIG } from "../src/services/route.service";
import { ItemService } from "../src/services/item.service";
import { FabricPropertyService } from "../src/services/fabric-property.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectReject(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

const woSvc = new WorkOrderService();
const routeSvc = new RouteService(ROUTE_SERVICE_CONFIG);
// Config'ler route dosyalarındakiyle hizalı (test yalnız create/update yolunu ölçer).
const itemSvc = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  duplicateNameField: "name",
  entityLabel: "ürün",
});
const propSvc = new FabricPropertyService({
  modelName: "fabricProperty",
  tableName: "FABRIC_PROPERTY",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  nestedCreateFields: ["stationCapabilities", "values"],
  duplicateNameField: "name",
  entityLabel: "özellik",
});

async function main() {
  const ts = Date.now();

  // ── 1) KAYNAK TARAMASI — 9 kapı, 6 dosya ──────────────────────────────────
  // Import satırı sayılmaz; yalnız `await assertTargetablePropertyIds(` çağrıları.
  // Körlük zemini: dosya okunamazsa/boşsa "0 çağrı" ile kırmızıya düşer.
  const GATES: Record<string, number> = {
    "workorder.service.ts": 3, // create + replace + updateTargetProperties
    "inventory.service.ts": 1, // KK1 createInitialEntry
    "order.service.ts": 1,     // sipariş kalemi özellikleri
    "route.service.ts": 1,     // rota adımı plannedPropertyIds
    "item.service.ts": 2,      // ürün izinli listesi create + update
    "subcontractor.service.ts": 1, // fason kabulde uygulanan özellik
  };
  let totalCalls = 0;
  for (const [file, expected] of Object.entries(GATES)) {
    const src = readFileSync(path.join(__dirname, "..", "src", "services", file), "utf8");
    const calls = (src.match(/await assertTargetablePropertyIds\(/g) ?? []).length;
    totalCalls += calls;
    check(`kapı taraması: ${file} ${expected} çağrı`, calls === expected, `bulundu=${calls}`);
  }
  check("kapı taraması körlük zemini (toplam 9)", totalCalls === 9, `toplam=${totalCalls}`);

  // ── Fixture ────────────────────────────────────────────────────────────────
  const station = await prisma.station.create({
    data: {
      code: `TEST-TGT-${ts}`, name: "TEST Hedef İstasyonu",
      type: "INTERNAL", kind: "OTHER", appliesProperty: true,
    },
    select: { id: true },
  });
  const choice = await prisma.fabricProperty.create({
    data: {
      code: `TEST-TGT-GR-${ts}`, name: "TEST Hedef Gramaj", valueType: "CHOICE",
      values: { create: [{ code: "25GR", name: "25 gr", sortOrder: 10 }] },
    },
    select: { id: true, name: true },
  });
  const flag = await prisma.fabricProperty.create({
    data: { code: `TEST-TGT-FL-${ts}`, name: "TEST Hedef Bayrak", valueType: "FLAG" },
    select: { id: true, name: true },
  });
  // İstasyon her iki özelliği de verebilsin (WO create "uygulayabilen adım" kuralı).
  await prisma.stationProperty.createMany({
    data: [
      { stationId: station.id, propertyId: choice.id, mode: "OPTIONAL" },
      { stationId: station.id, propertyId: flag.id, mode: "OPTIONAL" },
    ],
  });
  const item = await prisma.item.create({
    data: { code: `TEST-TGT-ITM-${ts}`, name: `TEST Hedef ${ts}`, itemType: "FABRIC" },
    select: { id: true },
  });

  const cleanupWoIds: string[] = [];
  const cleanupItemIds: string[] = [item.id];
  const cleanupPropIds: string[] = [choice.id, flag.id];
  let routeId: string | null = null;

  try {
    // ── 2) İş emri create ────────────────────────────────────────────────────
    await expectReject("WO create: CHOICE hedef 400 (ADIYLA)", choice.name, () =>
      woSvc.create({
        type: "STOCK_PRODUCTION",
        targetItemId: item.id,
        width: 150,
        targetPropertyIds: [choice.id],
        steps: [{ stationId: station.id }],
      }),
    );
    const okWo = await woSvc.create({
      type: "STOCK_PRODUCTION",
      targetItemId: item.id,
      width: 150,
      targetPropertyIds: [flag.id],
      steps: [{ stationId: station.id }],
    });
    const okWoId = (okWo.data as { id: string }).id;
    cleanupWoIds.push(okWoId);
    check("WO create: FLAG hedef geçer (kilit aşırı geniş değil)", okWo.success === true);

    // ── 3) Rota adımı ────────────────────────────────────────────────────────
    await expectReject("rota adımı: plannedPropertyIds'te CHOICE 400", choice.name, () =>
      routeSvc.create({
        code: `TEST-TGT-RT-${ts}`,
        name: `TEST Hedef Rota ${ts}`,
        steps: [{ stationId: station.id, sequence: 1, plannedPropertyIds: [choice.id] }],
      }),
    );
    const okRoute = await routeSvc.create({
      code: `TEST-TGT-RT-${ts}`,
      name: `TEST Hedef Rota ${ts}`,
      steps: [{ stationId: station.id, sequence: 1, plannedPropertyIds: [flag.id] }],
    });
    routeId = (okRoute.data as { id: string }).id;
    check("rota adımı: FLAG hedef geçer", okRoute.success === true);

    // ── 4) Ürün izinli listesi ───────────────────────────────────────────────
    await expectReject("ürün create: izinli listede CHOICE 400", choice.name, () =>
      itemSvc.create({
        code: `TEST-TGT-ITM2-${ts}`,
        name: `TEST Hedef 2 ${ts}`,
        itemType: "FABRIC",
        allowedPropertyIds: [choice.id],
      }),
    );
    const okItem = await itemSvc.create({
      code: `TEST-TGT-ITM2-${ts}`,
      name: `TEST Hedef 2 ${ts}`,
      itemType: "FABRIC",
      allowedPropertyIds: [flag.id],
    });
    const okItemId = (okItem.data as { id: string }).id;
    cleanupItemIds.push(okItemId);
    check("ürün create: FLAG izinli geçer", okItem.success === true);
    await expectReject("ürün update: izinli listede CHOICE 400", choice.name, () =>
      itemSvc.update(okItemId, { allowedPropertyIds: [choice.id] }),
    );

    // ── 5a) KAT tipi değiştirilemez ─────────────────────────────────────────
    const kat = await prisma.fabricProperty.findFirst({
      where: { code: "KAT" },
      select: { id: true, valueType: true },
    });
    if (kat) {
      await expectReject("KAT tipi değiştirilemez (sistem karakteristiği)", "KAT", () =>
        propSvc.update(kat.id, { valueType: "FLAG" }),
      );
      const katAfter = await prisma.fabricProperty.findUnique({
        where: { id: kat.id }, select: { valueType: true },
      });
      check("KAT reddedilirken MUTASYONA uğramadı", katAfter?.valueType === kat.valueType);
    } else {
      // Taze DB'de seed KAT'ı kurar; yoksa ortam sorunu — sessiz geçme, düş.
      check("KAT karakteristiği bulunamadı (seed koşmamış?)", false);
    }

    // ── 5b) CHOICE→FLAG: değer listesi varken 400 ────────────────────────────
    await expectReject("CHOICE→FLAG: değer listesi varken 400", "çevrilemez", () =>
      propSvc.update(choice.id, { valueType: "FLAG" }),
    );

    // ── 5c) FLAG→CHOICE: AUTO modlu istasyon bağı varken 400 ────────────────
    const autoFlag = await prisma.fabricProperty.create({
      data: { code: `TEST-TGT-AF-${ts}`, name: "TEST Auto Bayrak", valueType: "FLAG" },
      select: { id: true },
    });
    cleanupPropIds.push(autoFlag.id);
    await prisma.stationProperty.create({
      data: { stationId: station.id, propertyId: autoFlag.id, mode: "AUTO" },
    });
    await expectReject("FLAG→CHOICE: AUTO bağı varken 400 (istasyon ADIYLA)",
      "TEST Hedef İstasyonu", () => propSvc.update(autoFlag.id, { valueType: "CHOICE" }));

    // ── 5d) FLAG→CHOICE: hedef pivotunda kullanılırken 400 ──────────────────
    // `flag` şu an: okWo hedefi + rota adımı + ürün izinli listesi → 400.
    await expectReject("FLAG→CHOICE: hedef pivotlarında kullanılırken 400", "kullanılıyor", () =>
      propSvc.update(flag.id, { valueType: "CHOICE" }),
    );

    // ── 5e) FLAG→CHOICE: values'suz 400, values'lu geçer ────────────────────
    const cleanFlag = await prisma.fabricProperty.create({
      data: { code: `TEST-TGT-CF-${ts}`, name: "TEST Temiz Bayrak", valueType: "FLAG" },
      select: { id: true },
    });
    cleanupPropIds.push(cleanFlag.id);
    // SEK-3: değersiz bir SEÇİM özelliği "tanımlı ama seçilemez" limbosudur —
    // geçiş aynı PATCH'te en az bir aktif değer istemek zorunda.
    await expectReject("FLAG→CHOICE: values'suz 400 (değersiz seçim limbosu)", "değer", () =>
      propSvc.update(cleanFlag.id, { valueType: "CHOICE" }),
    );
    const flip = await propSvc.update(cleanFlag.id, {
      valueType: "CHOICE",
      values: [{ code: "V1", name: "Değer 1" }], // isActive verilmedi → yazma yolu ?? true
    });
    check("FLAG→CHOICE values'la geçer (kilit aşırı geniş değil)", flip.success === true);
    const flipped = await prisma.fabricProperty.findUnique({
      where: { id: cleanFlag.id }, select: { valueType: true },
    });
    check("geçiş gerçekten yazıldı", flipped?.valueType === "CHOICE");
  } finally {
    if (routeId) {
      await prisma.routeStepProperty.deleteMany({
        where: { routeStep: { routeId } },
      }).catch(() => {});
      await prisma.routeStep.deleteMany({ where: { routeId } }).catch(() => {});
      await prisma.route.deleteMany({ where: { id: routeId } }).catch(() => {});
    }
    for (const woId of cleanupWoIds) {
      await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: woId } }).catch(() => {});
      await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: woId } } }).catch(() => {});
      await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } }).catch(() => {});
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } }).catch(() => {});
      await prisma.workOrder.deleteMany({ where: { id: woId } }).catch(() => {});
    }
    await prisma.itemAllowedProperty.deleteMany({
      where: { itemId: { in: cleanupItemIds } },
    }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: cleanupItemIds } } }).catch(() => {});
    await prisma.stationProperty.deleteMany({ where: { stationId: station.id } }).catch(() => {});
    await prisma.fabricPropertyValue.deleteMany({
      where: { propertyId: { in: cleanupPropIds } },
    }).catch(() => {});
    await prisma.fabricProperty.deleteMany({ where: { id: { in: cleanupPropIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: station.id } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
