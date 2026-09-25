// =============================================================================
// TEST: İŞ EMRİ HAREKET DEFTERİ — plan alanı değişimleri satır yazar (D2)
// Çalıştır: npx tsx scripts/test_workorder_event_fields.ts
// =============================================================================
// Tasarım: docs/design/IS-EMRI-HAREKET-DEFTERI.md §4.3–§4.4, §6.3. Fikstür GERÇEK
// yazma yollarından geçer (update · replace · changeTargetColor · changeWidth ·
// updateStepPlanning · setWorkOrderTypeTx):
//   §1 update: değişen alan başına bir FIELD_CHANGED, tek grup; tarih etiketi fabrika günü
//   §2 aynı değerlerle tekrar → satır YOK
//   §3 numara kilidi: aynı numara kabul, farklı numara 409 WORK_ORDER_NUMBER_FROZEN
//   §4 renk değişimi: etiket rengin o anki ADI, sebep satırda
//   §5 en değişimi: tek tx, sebep + tetik
//   §6 tip çevirme: CHANGED/ALREADY/NO_MATCH; yalnız CHANGED satır yazar
//   §7 adım planı: STEP_PLAN_CHANGED, adım yükte
//   §8 replace: değişen alanlar WO_REPLACE ile; numara kilidi burada da
//   §9 tablet isteği → kanal TABLET
// NEGATİF SONDA (elle, 2026-09-25): `recordWorkOrderFieldDiffTx` gövdesi erken
// `return 0` yapıldı → §1–§1d/§2/§4/§5/§8/§9 kırmızı (9); yedek kopyadan geri alındı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { WorkOrderLinkService } from "../src/services/workorder-link.service";
import { setWorkOrderTypeTx } from "../src/services/helpers/workorder-event.helper";
import { runWithRequestContext } from "../src/lib/request-context";
import { factoryDateTr } from "../src/constants/time";
import { WorkOrderStatus, WorkOrderType } from "@prisma/client";
import type { Request } from "express";
import { ensureTestAdmin } from "./fixture-test-user";

const svc = new WorkOrderService();
const link = new WorkOrderLinkService();

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ITEM = "", ADMIN = "", ST_FASON = "", ST_TAMBUR = "", COLOR = "", COLOR_NAME = "";
const woIds: string[] = [];
const colorIds: string[] = [];

async function fikstur(): Promise<void> {
  const need = <T,>(v: T | null, label: string): T => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed' + 'seed:fixtures')`);
    return v;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  ADMIN = (await ensureTestAdmin()).id;
  ST_FASON = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1").id;
  // Renk koşuma özgü: ortamdaki "herhangi bir aktif renk"e yaslanmaz (etiket donması bu adla ölçülür).
  const tag = `TST-WOEF-${Date.now()}`;
  const color = await prisma.color.create({ data: { code: tag, name: `${tag} RENK` }, select: { id: true, name: true } });
  colorIds.push(color.id);
  COLOR = color.id;
  COLOR_NAME = color.name;
}

async function yeniWo(): Promise<string> {
  const res = await svc.create(
    { type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, steps: [{ stationId: ST_FASON }, { stationId: ST_TAMBUR }] },
    ADMIN,
  );
  const id = (res.data as { id: string }).id;
  woIds.push(id);
  return id;
}

const alanOlaylari = (workOrderId: string) =>
  prisma.workOrderEvent.findMany({
    where: { workOrderId, type: { in: ["FIELD_CHANGED", "STEP_PLAN_CHANGED"] } },
    orderBy: [{ createdAt: "asc" }, { field: "asc" }],
  });

function tabletIstegi<T>(fn: () => Promise<T>): Promise<T> {
  const req = {
    device: { id: "d-row", deviceId: "TST-WOE-FIELDS", name: "tablet", machineId: null, kind: "TABLET" },
    user: { userId: ADMIN },
    ip: "127.0.0.1",
  } as unknown as Request;
  return new Promise<T>((resolve, reject) => {
    runWithRequestContext(req, () => { fn().then(resolve, reject); });
  });
}

async function hataKodu(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; }
  catch (e) { return ((e as { details?: { code?: string } }).details?.code) ?? `HATA:${(e as Error).message}`; }
}

async function main(): Promise<void> {
  console.log("=== İş emri hareket defteri — plan alanları ===");
  await fikstur();
  try {
    const a = await yeniWo();
    const bitis = "2026-10-15T09:00:00.000Z";
    await svc.update(a, { width: 200, targetQuantity: 500, plannedEndDate: bitis }, ADMIN);
    const s1 = await alanOlaylari(a);
    const byField = new Map(s1.map((e) => [e.field, e]));
    check("§1 update üç değişen alana üç satır, tek grup, tetik WO_UPDATE",
      s1.length === 3 && new Set(s1.map((e) => e.groupId)).size === 1 && s1.every((e) => e.trigger === "WO_UPDATE"),
      s1.map((e) => e.field).join(","));
    check("§1b en 180→200 kanonik metin, metre null→500",
      byField.get("width")?.fromValue === "180" && byField.get("width")?.toValue === "200"
        && byField.get("targetQuantity")?.fromValue === null && byField.get("targetQuantity")?.toValue === "500");
    check("§1c tarih ISO değer + fabrika günü etiketi",
      byField.get("plannedEndDate")?.toValue === bitis && byField.get("plannedEndDate")?.toLabel === factoryDateTr(new Date(bitis)),
      byField.get("plannedEndDate")?.toLabel ?? "-");
    check("§1d aktör istekten, bağlamsız kanal SYSTEM", s1[0]?.createdById === ADMIN && s1[0]?.channel === "SYSTEM");

    await svc.update(a, { width: 200, targetQuantity: 500, plannedEndDate: bitis }, ADMIN);
    check("§2 aynı değerlerle tekrar satır YAZMAZ", (await alanOlaylari(a)).length === 3);

    const aNo = (await prisma.workOrder.findUniqueOrThrow({ where: { id: a }, select: { workOrderNumber: true } })).workOrderNumber;
    const ayni = await hataKodu(() => svc.update(a, { batchNumber: aNo }, ADMIN));
    const farkli = await hataKodu(() => svc.update(a, { batchNumber: `${aNo}X` }, ADMIN));
    const noSonra = (await prisma.workOrder.findUniqueOrThrow({ where: { id: a }, select: { workOrderNumber: true } })).workOrderNumber;
    check("§3 numara kilidi: aynı numara kabul, farklısı 409 WORK_ORDER_NUMBER_FROZEN, numara değişmedi",
      ayni === null && farkli === "WORK_ORDER_NUMBER_FROZEN" && noSonra === aNo, `${ayni} · ${farkli}`);

    await link.changeTargetColor(a, COLOR, "renk düzeltme testi", ADMIN);
    const renk = (await alanOlaylari(a)).find((e) => e.field === "targetColorId");
    check("§4 renk: etiket rengin adı, sebep ve tetik satırda",
      renk?.toValue === COLOR && renk?.toLabel === COLOR_NAME && renk?.reason === "renk düzeltme testi" && renk?.trigger === "COLOR_CHANGE",
      `${renk?.toLabel} · ${renk?.trigger}`);

    await link.changeWidth(a, 210, "en ölçüm testi", ADMIN);
    const en = (await alanOlaylari(a)).filter((e) => e.field === "width").at(-1);
    check("§5 en: 200→210, sebep, tetik WIDTH_CHANGE",
      en?.fromValue === "200" && en?.toValue === "210" && en?.reason === "en ölçüm testi" && en?.trigger === "WIDTH_CHANGE");

    const tip = (w: Parameters<typeof setWorkOrderTypeTx>[3]["where"], to: WorkOrderType) =>
      prisma.$transaction((tx) => setWorkOrderTypeTx(tx, a, to, { where: w, ctx: { trigger: "TEST_TYPE", userId: ADMIN } }));
    const t1 = await tip(undefined, WorkOrderType.ORDER_PRODUCTION);
    const t2 = await tip(undefined, WorkOrderType.ORDER_PRODUCTION);
    const t3 = await tip({ status: WorkOrderStatus.CANCELLED }, WorkOrderType.STOCK_PRODUCTION);
    const tipSatir = (await alanOlaylari(a)).filter((e) => e.field === "type");
    check("§6 tip: CHANGED → ALREADY → NO_MATCH; yalnız ilki satır yazar, etiket Stok→Siparişe Özel",
      t1 === "CHANGED" && t2 === "ALREADY" && t3 === "NO_MATCH" && tipSatir.length === 1
        && tipSatir[0].fromLabel === "Stok" && tipSatir[0].toLabel === "Siparişe Özel",
      `${t1}/${t2}/${t3} · ${tipSatir.length}`);

    const fasonAdim = await prisma.workOrderStep.findFirstOrThrow({ where: { workOrderId: a, stationId: ST_FASON }, select: { id: true } });
    await svc.updateStepPlanning(a, fasonAdim.id, { dispatchWithoutColor: true }, ADMIN);
    await svc.updateStepPlanning(a, fasonAdim.id, { dispatchWithoutColor: true }, ADMIN);
    const plan = (await alanOlaylari(a)).filter((e) => e.type === "STEP_PLAN_CHANGED");
    check("§7 adım planı: tek STEP_PLAN_CHANGED (tekrarı yok), adım yükte",
      plan.length === 1 && plan[0].field === "dispatchWithoutColor" && plan[0].toValue === "true"
        && (plan[0].payload as { stepId?: string } | null)?.stepId === fasonAdim.id,
      `${plan.length}`);

    const b = await yeniWo();
    const bRow = await prisma.workOrder.findUniqueOrThrow({
      where: { id: b }, select: { workOrderNumber: true, plannedStartDate: true, plannedEndDate: true },
    });
    const bNo = bRow.workOrderNumber;
    // Panel formu gibi mevcut tarihleri geri gönderir — tarihsiz replace tarihleri "şimdi"ye çeker (deftere düşer).
    const govde = { type: "STOCK_PRODUCTION" as const, targetItemId: ITEM, width: 190, targetQuantity: 300,
      plannedStartDate: bRow.plannedStartDate?.toISOString(), plannedEndDate: bRow.plannedEndDate?.toISOString(),
      steps: [{ stationId: ST_FASON }, { stationId: ST_TAMBUR }] };
    await svc.replace(b, { ...govde, batchNumber: bNo }, ADMIN);
    const r = await alanOlaylari(b);
    check("§8 replace: değişen iki alan WO_REPLACE ile, değişmeyenler satırsız",
      r.length === 2 && r.every((e) => e.trigger === "WO_REPLACE") && r.some((e) => e.field === "width" && e.toValue === "190"),
      r.map((e) => e.field).join(","));
    const rNo = await hataKodu(() => svc.replace(b, { ...govde, batchNumber: `${bNo}X` }, ADMIN));
    check("§8b replace numara kilidi 409", rNo === "WORK_ORDER_NUMBER_FROZEN", `${rNo}`);

    await tabletIstegi(() => svc.update(b, { targetWeight: 42 }, ADMIN));
    const tab = (await alanOlaylari(b)).find((e) => e.field === "targetWeight");
    check("§9 tablet isteği → kanal TABLET, cihaz bağlamdan", tab?.channel === "TABLET" && tab?.deviceId === "TST-WOE-FIELDS",
      `${tab?.channel} · ${tab?.deviceId}`);
  } finally {
    await temizle();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  const cards = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cards.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((x) => x.id);
  await prisma.systemLog.deleteMany({ where: { tableName: { in: ["WORK_ORDER", "WORK_ORDER_STEP"] }, recordId: { in: [...woIds, ...stepIds] } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.color.deleteMany({ where: { id: { in: colorIds } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
