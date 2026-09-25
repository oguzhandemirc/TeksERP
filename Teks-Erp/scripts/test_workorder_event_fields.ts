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
//   §10 replace rota: istasyon sırası tek "route" satırı, adım notu adım başına; hepsi alan satırlarıyla tek grup
//   §11 toplara uygula: ROLL_ATTRIBUTES_APPLIED yükü top başına ESKİ renk/en (ters yolun dayanağı)
//   §12 Hareketler çizelgesi D2 satırlarını Türkçe başlık ve tetik adıyla basar (ham kod yok)
// NEGATİF SONDA (elle, 2026-09-25): `recordWorkOrderFieldDiffTx` gövdesi erken
// `return 0` yapıldı → 10 kırmızı (§1–§1d/§2/§4/§5/§8/§9/§10c); `recordStepDiffTx` susturuldu →
// §7/§10/§10b/§10c; top yükü boşaltıldı → §11; replace'teki sıra park satırı silindi → §10
// P2002 (araya adım ekleme 500 veriyordu); iki tetik etiketi silindi → §12/§12e. Hepsi
// yedek kopyadan geri alındı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { WorkOrderLinkService } from "../src/services/workorder-link.service";
import { WorkOrderTimelineService } from "../src/services/workorder-timeline.service";
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

let ITEM = "", ADMIN = "", ST_FASON = "", ST_TAMBUR = "", ST_KURSUN = "", COLOR = "", COLOR_NAME = "";
const woIds: string[] = [];
const colorIds: string[] = [];
const rollIds: string[] = [];
const batchIds: string[] = [];

async function fikstur(): Promise<void> {
  const need = <T,>(v: T | null, label: string): T => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed' + 'seed:fixtures')`);
    return v;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  ADMIN = (await ensureTestAdmin()).id;
  ST_FASON = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1").id;
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2").id;
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
      prisma.$transaction((tx) => setWorkOrderTypeTx(tx, a, to, { where: w, ctx: { trigger: "ORDER_LINK", userId: ADMIN } }));
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

    await rotaVeTopSenaryolari(a, b, govde);

    await cizelgeBasliklari(a, b);

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

async function rotaVeTopSenaryolari(
  a: string,
  b: string,
  govde: { plannedStartDate?: string; plannedEndDate?: string; [k: string]: unknown },
): Promise<void> {
  const eski = await prisma.workOrderStep.findMany({ where: { workOrderId: b }, orderBy: { stepSequence: "asc" }, select: { id: true, stationId: true } });
  const onceki = new Set((await alanOlaylari(b)).map((e) => e.id));
  await svc.replace(b, {
    ...govde, width: 195,
    steps: [{ id: eski[0].id, stationId: eski[0].stationId, notes: "boyahane notu" }, { stationId: ST_KURSUN }, { id: eski[1].id, stationId: eski[1].stationId }],
  } as Parameters<typeof svc.replace>[1], ADMIN);
  const yeni = (await alanOlaylari(b)).filter((e) => !onceki.has(e.id));
  const rota = yeni.find((e) => e.field === "route");
  const not = yeni.find((e) => e.field === "notes");
  check("§10 rota: tek route satırı, adım yükü yok, yeni sıra etikette",
    rota?.type === "STEP_PLAN_CHANGED" && rota.payload === null && (rota.toLabel ?? "").split(" → ").length === 3
      && (rota.fromLabel ?? "").split(" → ").length === 2, `${rota?.fromLabel} ⇒ ${rota?.toLabel}`);
  check("§10b adım notu adım başına, adım kimliği yükte",
    not?.toValue === "boyahane notu" && (not.payload as { stepId?: string } | null)?.stepId === eski[0].id);
  check("§10c route · not · en satırları TEK grup (tek eylem)",
    yeni.length === 3 && new Set(yeni.map((e) => e.groupId)).size === 1, yeni.map((e) => e.field).join(","));

  const batch = await prisma.batch.create({ data: { batchNumber: `TST-WOEF-${Date.now()}`, workOrderId: a }, select: { id: true } });
  batchIds.push(batch.id);
  const roll = await prisma.roll.create({
    data: { itemId: ITEM, colorId: COLOR, initialQty: 100, currentQty: 100, width: 300, status: "STOCK", batchId: batch.id },
    select: { id: true },
  });
  rollIds.push(roll.id);
  await link.applyAttributeToRolls(a, { rollIds: [roll.id], width: 295, reason: "kabulde ölçüldü" }, ADMIN, ["roll:manual-adjust"]);
  const uyg = await prisma.workOrderEvent.findFirst({ where: { workOrderId: a, type: "ROLL_ATTRIBUTES_APPLIED" } });
  const yuk = uyg?.payload as { rolls?: { rollId: string; fromColorId: string | null; fromWidth: string | null }[] } | null;
  check("§11 toplara uygula: satır rollWidth→295, yükte top başına ESKİ en ve renk",
    uyg?.field === "rollWidth" && uyg.toValue === "295" && yuk?.rolls?.length === 1
      && yuk.rolls[0].rollId === roll.id && Number(yuk.rolls[0].fromWidth) === 300 && yuk.rolls[0].fromColorId === COLOR,
    JSON.stringify(yuk?.rolls?.[0] ?? null));
}

async function cizelgeBasliklari(a: string, b: string): Promise<void> {
  const tl = new WorkOrderTimelineService();
  const satirlar = [...(await tl.list(a, { limit: 200 })).data, ...(await tl.list(b, { limit: 200 })).data]
    .filter((x) => x.id.startsWith("woe:"));
  const baslik = (t: string) => satirlar.find((x) => x.title === t);
  check("§12 en satırı 'En (cm) değişti', tetik 'Eni Değiştir'", satirlar.some((x) => x.title === "En (cm) değişti" && x.trigger === "Eni Değiştir"));
  check("§12b rota satırı 'Rota değişti'", !!baslik("Rota değişti"), baslik("Rota değişti")?.detail ?? "-");
  check("§12c adım satırı istasyon önekli ('…: Sevk rengi değişti')", satirlar.some((x) => /: Sevk rengi değişti$/.test(x.title)));
  check("§12d toplara uygula 'Toplara en uygulandı', ayrıntıda top sayısı", baslik("Toplara en uygulandı")?.detail === "295 · 1 top", baslik("Toplara en uygulandı")?.detail ?? "-");
  const hamKod = satirlar.filter((x) => x.trigger !== null && /^[A-Z_]+$/.test(x.trigger)).map((x) => x.trigger);
  check("§12e hiçbir tetik ham kodla basılmaz", hamKod.length === 0, hamKod.join(","));
}

async function temizle(): Promise<void> {
  await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
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
