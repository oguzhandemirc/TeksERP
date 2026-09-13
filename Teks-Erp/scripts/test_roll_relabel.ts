// =============================================================================
// Test: Saha #4 — top etiketi değiştirme (renk/özellik/en/kalite)
// Çalıştır: npx tsx scripts/test_roll_relabel.ts
// Doğrulananlar (ÇUVAL DEPO modeli):
//   1. Serbest WAREHOUSE topun rengi/eni/kalitesi değişir
//   2. Özellik (RollProperty) replace
//   3. DEPODAKİ (havuz) çuvaldaki top relabel EDİLEBİLİR (mühür YOK → çuval her an düzenlenebilir)
//   4. ATANMIŞ sevkiyattaki top relabel REDDEDİLİR (409 — "sevkiyattan çıkarın")
//   5. Renksiz (color null) yapılabilir
//   6. Metraj (currentQty) düzeltmesi — bütün topta initialQty ile birlikte güncellenir
//   7. Kısmen tüketilmiş topta metraj düzeltme reddedilir (renk-only geçer)
//   8-10. Etiket bayat: relabel→labelDirty=true, baskı→false, no-op→temiz kalır
//   11. FAZ 0 (OZELLIK-PIVOT-SURUMLEME-PLAN §9, 2026-09-14): `propertyIds`
//       GÖNDERİLMEYİNCE bayrak DURUR (eskiden `?? []` her düzeltmede hepsini
//       siliyordu); etiket bayatlamaz; dizi gelince replace hâlâ çalışır.
// =============================================================================
import { readFileSync } from "fs";
import { join } from "path";
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { InventoryService } from "../src/services/inventory.service";
import { ShippingService } from "../src/services/shipping.service";
import { LabelService } from "../src/services/label.service";

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
  const ts = Date.now();
  const inv = new InventoryService();
  const ship = new ShippingService();

  const customer = await prisma.customer.create({
    data: { code: `TST-RLB-${ts}`, name: `TEST RELABEL ${ts}` },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-RLB-I-${ts}`, name: `TEST RLB ÜRÜN ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const colorA = await prisma.color.create({ data: { code: `RLB-A-${ts}`, name: "RLB MAVİ" }, select: { id: true } });
  const colorB = await prisma.color.create({ data: { code: `RLB-B-${ts}`, name: "RLB YEŞİL" }, select: { id: true } });
  const prop = await prisma.fabricProperty.findFirst({ where: { isActive: true }, select: { id: true } });

  const mkRoll = (n: number) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-RLB-R${n}-${ts}`,
        itemId: item.id,
        colorId: colorA.id,
        status: "WAREHOUSE",
        currentQty: 100,
        initialQty: 100,
        width: 150,
        qualityGrade: "B",
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true, barcode: true },
    });

  const r1 = await mkRoll(1);
  const r2 = await mkRoll(2);
  const r3 = await mkRoll(3);
  const sackIds: string[] = [];
  const shipmentIds: string[] = [];
  // Senaryo 4 (atanmış sevkiyattaki top) sevk onayı AÇIK iken çalışır — aksi halde
  // sevk onayı varsayılan KAPALI olduğundan createShipment doğrudan DISPATCHED eder
  // (top SHIPPED → farklı guard/400 fırlar). "Sevkiyata atanmış (PLANNED) → 409" hâlini
  // test ettiğimizden onayı geçici açıyoruz (finally'de geri alınır).
  const CONF_KEY = "shipping.confirmationEnabled";
  let prevConf: { value: unknown } | null | undefined;

  // Relabel hedefi ROLDEN çözülür: kod fabrikaya, rol kuruluma aittir.
  const targetGradeCode = (await roleGrade("SECOND")).code;

  try {
    // 1+2) Serbest topu relabel
    await inv.applyManualProperties(
      r1.id,
      { colorId: colorB.id, propertyIds: prop ? [prop.id] : [], width: 200, qualityGrade: targetGradeCode },
      undefined,
    );
    const r1After = await prisma.roll.findUnique({
      where: { id: r1.id },
      select: { colorId: true, width: true, qualityGrade: true, properties: { select: { propertyId: true } } },
    });
    check("Renk değişti (A→B)", r1After?.colorId === colorB.id);
    check("En değişti (150→200)", Number(r1After?.width) === 200);
    check(`Kalite değişti (B→${targetGradeCode}, katalog doğrulandı + FK senkron)`, r1After?.qualityGrade === targetGradeCode);
    if (prop) check("Özellik atandı (replace)", r1After?.properties.length === 1 && r1After.properties[0].propertyId === prop.id);

    // 5) Renksiz yap
    await inv.applyManualProperties(r1.id, { colorId: null, propertyIds: [] }, undefined);
    const r1Raw = await prisma.roll.findUnique({ where: { id: r1.id }, select: { colorId: true, properties: true } });
    check("Renksiz (color null) + özellik temizlendi", r1Raw?.colorId === null && r1Raw.properties.length === 0);

    // 3) DEPODAKİ (havuz) çuvaldaki top relabel EDİLEBİLİR (mühür YOK → çuval her an düzenlenebilir)
    const sackId = ((await ship.openSack({ customerId: customer.id })) as { data: { id: string } }).data.id;
    sackIds.push(sackId);
    await ship.scanIntoSack({ sackId, barcode: r2.barcode! });
    await inv.applyManualProperties(r2.id, { colorId: colorB.id, propertyIds: [] }, undefined);
    const r2Open = await prisma.roll.findUnique({ where: { id: r2.id }, select: { colorId: true, sackId: true } });
    check("Depodaki çuvaldaki top relabel edildi", r2Open?.colorId === colorB.id && r2Open?.sackId === sackId);

    // 4) ATANMIŞ sevkiyattaki top relabel REDDEDİLİR (409 — sevkiyat donar).
    // Sevk onayını geçici aç → sevkiyat PLANNED kalır (top WAREHOUSE'ta ama shipmentId atanmış),
    // böylece "sevkiyata atanmış" 409 guard'ı tetiklenir (onay kapalıyken top SHIPPED olup 400 alırdı).
    prevConf = await prisma.systemSetting.findUnique({ where: { key: CONF_KEY }, select: { value: true } });
    await prisma.systemSetting.upsert({ where: { key: CONF_KEY }, create: { key: CONF_KEY, value: true }, update: { value: true } });
    const shipmentId = ((await ship.createShipment({ sackIds: [sackId], customerId: customer.id })) as { data: { id: string } }).data.id;
    shipmentIds.push(shipmentId);
    let shipRej: { code?: number; msg?: string } = {};
    try {
      await inv.applyManualProperties(r2.id, { colorId: colorA.id, propertyIds: [] }, undefined);
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      shipRej = { code: err.statusCode, msg: err.message };
    }
    check("Atanmış sevkiyattaki top relabel 409", shipRej.code === 409, shipRej.msg);
    check("Sevkiyat mesajı ('sevkiyat')", !!shipRej.msg?.includes("sevkiyat"));

    // 6) Metraj (currentQty) düzeltmesi — bütün topta initialQty ile BİRLİKTE güncellenir
    await inv.applyManualProperties(r3.id, { colorId: colorA.id, propertyIds: [], currentQty: 250 }, undefined);
    const r3After = await prisma.roll.findUnique({
      where: { id: r3.id },
      select: { currentQty: true, initialQty: true },
    });
    check(
      "Metraj değişti (100→250) + initialQty senkron",
      Number(r3After?.currentQty) === 250 && Number(r3After?.initialQty) === 250,
    );

    // 7) Kısmen tüketilmiş top (currentQty < initialQty) → metraj düzeltme REDDEDİLİR (409)
    await prisma.roll.update({ where: { id: r3.id }, data: { currentQty: 200, initialQty: 250 } });
    let metrajRejected = false;
    try {
      await inv.applyManualProperties(r3.id, { colorId: colorA.id, propertyIds: [], currentQty: 300 }, undefined);
    } catch (e) {
      metrajRejected = (e as { statusCode?: number }).statusCode === 409;
    }
    check("Kısmen tüketilmiş topta metraj düzeltme 409", metrajRejected);

    // 7b) Metraj GÖNDERİLMEZSE (renk-only) kısmi topta bile relabel geçer (guard sadece metraja)
    await inv.applyManualProperties(r3.id, { colorId: colorB.id, propertyIds: [] }, undefined);
    const r3ColorOnly = await prisma.roll.findUnique({ where: { id: r3.id }, select: { colorId: true } });
    check("Kısmi topta metrajsız (renk-only) relabel geçer", r3ColorOnly?.colorId === colorB.id);

    // 8) Etiket bayat bayrağı — relabel edilen top labelDirty=true olur
    const r1Dirty = await prisma.roll.findUnique({ where: { id: r1.id }, select: { labelDirty: true } });
    check("Relabel sonrası labelDirty=true", r1Dirty?.labelDirty === true);

    // 9) Etiket basılınca (recordPrintEvent) labelDirty=false'a döner
    const label = new LabelService();
    await label.recordPrintEvent(r1.id, undefined, { stock: true });
    const r1Clean = await prisma.roll.findUnique({ where: { id: r1.id }, select: { labelDirty: true } });
    check("Baskı sonrası labelDirty=false", r1Clean?.labelDirty === false);

    // 10) No-op relabel (aynı değerler) → labelDirty set edilmez (temiz kalır)
    const r1Cur = await prisma.roll.findUnique({
      where: { id: r1.id },
      select: { colorId: true, width: true, qualityGrade: true, properties: { select: { propertyId: true } } },
    });
    await inv.applyManualProperties(
      r1.id,
      {
        colorId: r1Cur!.colorId,
        propertyIds: r1Cur!.properties.map((p) => p.propertyId),
        width: r1Cur!.width != null ? Number(r1Cur!.width) : null,
        // `applyManualProperties` `qualityGrade?: string` bekler (nullable DEĞİL).
        // Bu noktada değer SECOND rolünün kodu (yukarıda doğrulandı) → dönüşüm davranışı değiştirmez.
        qualityGrade: r1Cur!.qualityGrade ?? undefined,
      },
      undefined,
    );
    const r1Noop = await prisma.roll.findUnique({ where: { id: r1.id }, select: { labelDirty: true } });
    check("No-op relabel labelDirty set etmez (temiz kalır)", r1Noop?.labelDirty === false);

    // 11) FAZ 0 — `propertyIds` gönderilmeyince bayrak DURUR. Fikstür özelliği İŞ
    //     ANAHTARIYLA (code) kurulur, ortamda aranmaz.
    const faz0Prop = await prisma.fabricProperty.upsert({
      where: { code: "TEST-RELABEL-FAZ0" },
      create: { code: "TEST-RELABEL-FAZ0", name: "TEST Faz 0 bayrağı", valueType: "FLAG" },
      update: {}, select: { id: true },
    });
    const faz0Base = { colorId: r1Cur!.colorId, width: r1Cur!.width != null ? Number(r1Cur!.width) : null, qualityGrade: r1Cur!.qualityGrade ?? undefined };
    await inv.applyManualProperties(r1.id, { ...faz0Base, propertyIds: [faz0Prop.id] }, undefined);
    await label.recordPrintEvent(r1.id, undefined, { stock: true });
    const flagCount = () => prisma.rollProperty.count({ where: { rollId: r1.id, propertyId: faz0Prop.id } });
    check("11 ön koşul — bayrak yazıldı, etiket temiz", (await flagCount()) === 1 && (await prisma.roll.findUnique({ where: { id: r1.id }, select: { labelDirty: true } }))?.labelDirty === false);
    // (a) alan yok + başka değişiklik yok → bayrak durur, etiket temiz kalır
    await inv.applyManualProperties(r1.id, { ...faz0Base }, undefined);
    const r1a = await prisma.roll.findUnique({ where: { id: r1.id }, select: { labelDirty: true } });
    check("⭐ 11a propertyIds GÖNDERİLMEDİ → bayrak DURUYOR", (await flagCount()) === 1);
    check("11a propertyIds gönderilmeyince etiket BAYATLAMADI", r1a?.labelDirty === false);
    // (b) alan yok + en değişti → bayrak yine durur, etiket bayatlar (en yüzünden)
    await inv.applyManualProperties(r1.id, { ...faz0Base, width: 210 }, undefined);
    const r1b = await prisma.roll.findUnique({ where: { id: r1.id }, select: { labelDirty: true, width: true } });
    check("⭐ 11b en düzeltmesi bayrağı SİLMEDİ (tabletten renk/en düzeltme senaryosu)", (await flagCount()) === 1 && Number(r1b?.width) === 210);
    check("11b en değişince etiket bayatladı", r1b?.labelDirty === true);
    // (c) dizi geldi → replace hâlâ çalışır (boş dizi = hepsini kaldır)
    await inv.applyManualProperties(r1.id, { ...faz0Base, width: 210, propertyIds: [] }, undefined);
    check("11c propertyIds: [] → bayrak KALDIRILDI (replace sözleşmesi korunur)", (await flagCount()) === 0);
    // (d) Controller `undefined`i servise OLDUĞU GİBİ geçirir — `?? []` geri gelirse
    //     yukarıdaki servis kontrolleri yeşil kalır (servisi doğrudan çağırıyoruz),
    //     kusur ROUTE katmanında yaşar. Statik çapa: iki geçiş noktası, sıfır `?? []`.
    const ctlSrc = readFileSync(join(__dirname, "..", "src", "controllers", "inventory.controller.ts"), "utf8");
    const gecis = ctlSrc.split("propertyIds: body.propertyIds,").length - 1;
    const kacis = ctlSrc.split("propertyIds: body.propertyIds ?? []").length - 1;
    check("⭐ 11d controller `?? []` YOK, iki uç `undefined`i geçiriyor", gecis === 2 && kacis === 0, `geçiş=${gecis} ??[]=${kacis}`);
  } finally {
    // Sevk onayı ayarını eski değerine döndür (senaryo 4 geçici açmıştı).
    if (prevConf !== undefined) {
      if (prevConf === null) await prisma.systemSetting.delete({ where: { key: CONF_KEY } }).catch(() => {});
      else await prisma.systemSetting.update({ where: { key: CONF_KEY }, data: { value: prevConf.value as never } }).catch(() => {});
    }
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
    await prisma.roll.updateMany({
      where: { id: { in: [r1.id, r2.id, r3.id] } },
      data: { shipmentId: null, sackId: null },
    });
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    for (const id of shipmentIds) {
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: id } });
      await prisma.shipment.delete({ where: { id } }).catch(() => {});
    }
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: [r1.id, r2.id, r3.id] } } });
    await prisma.fabricProperty.deleteMany({ where: { code: "TEST-RELABEL-FAZ0" } }).catch(() => {});
    // Metraj düzeltmesi 2026-09-14'ten beri deftere yazar (ENTRY_CORRECTION + sapma satırı):
    // çocuklar topun ÖNCE silinir (RESTRICT), yoksa temizlik FK'ya çarpar ve kalıntı büyür.
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: [r1.id, r2.id, r3.id] } } });
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: [r1.id, r2.id, r3.id] } } });
    await prisma.roll.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id] } } });
    await prisma.color.deleteMany({ where: { id: { in: [colorA.id, colorB.id] } } });
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
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
