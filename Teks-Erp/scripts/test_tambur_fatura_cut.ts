// =============================================================================
// BEKÇİ — TAMBUR KESİM METRESİ ↔ HİZMET FATURASI (D4-B2, DALGA4 §3.5 madde 4–5, K4)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_tambur_fatura_cut.ts
//
// NEDEN: Tambur çocuğunun hizmet satırı kesilen metreden (CUT) faturalanır. Metre simülasyondan
// geldiyse uydurulmuş sayı müşteriye kesilir (K4 — çekirdek, ayar değil). Okuma varsa satır ona
// bağlanmalı (düzeltme/geri alma faturalı metreyi sessizce değiştirmesin); okumasız eski top bugünkü gibi.
//
// ÖLÇÜLENLER:
//   §1 SIMULATED CUT okumalı çocuk → hizmet taslağına 0 satır + "simüle ölçüm" uyarısı
//   §2 MACHINE okumalı çocuk → iş readingId bağlı, metre okumadan; okumasız (eski) çocuk → initialQty satırı (bayt-aynı)
//   §3 iptal → geri al: iş DİRİLEN okumanın readingId'sine bağlanır; SIMULATED dirilen yine dışarıda
//   §4 düzeltme: SUPERVISOR okuması yazılır, eski damgalı; fatura zinciri yeniyi okur; initialQty değişmez;
//      aynı clientToken ikinci istek → aynı yanıt, TEK SUPERVISOR satırı
//   §5 eşzamanlı iki düzeltme → biri 409 METER_READING_ALREADY_CORRECTED, tek aktif okuma
//   §6 faturalı okuma → 409 SERVICE_ALREADY_BILLED; CUT dışı okuma → 400 METER_READING_NOT_CUT
//   §7 uç kapısı: verifyToken + kursun:meter-approve; izinsiz 403, router üretim modülü kapısının altında
//   §9 çok kuşak: SIMULATED kesimli çocuk kendisi de kesilmiş ata olarak sevk edilirse ④ DECLARED'a düşmez
//   §10 top izi (`/rolls/:id/history`) `measurements`: düzeltilen okuma damgalı + SUPERVISOR aktif; sapma measureSource
//   §8 iptal edilmiş top → 409 ROLL_NOT_CORRECTABLE; iptal tx'i okuma anlık görüntüsünü aldıktan sonra
//      gelen düzeltme top kilidinde bekler → iptal topta aktif CUT okuması KALMAZ (roll → okuma kilit sırası)
// Negatif sondalar (2026-10-30): CUT kolundaki SIMULATED dışlaması kaldırılınca §1 kırmızı ·
// düzeltme claim'inde `revokedAt: null` çıkarılınca §5 kırmızı · düzeltmedeki top FOR UPDATE + iptal
// denetimi çıkarılınca §8 kırmızı (aktif=1) · ③ önündeki SIMULATED denetimi eski yerine alınınca §9
// kırmızı (ata DECLARED 50 faturada) (geri alındı).
// D4-B4 sondaları (2026-10-30): top izi okuma sorgusuna `revokedAt: null` eklenince §10a kırmızı (yalnız SUPERVISOR) ·
// sapma `measureSource` null'a sabitlenince §10b kırmızı (geri alındı).
// =============================================================================
import { randomUUID } from "node:crypto";
import { Currency, ItemType, MeterPhase, Prisma, PriceKind, RollEntrySource, RollStatus, StationKind, StationType, StepStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { InventoryService } from "../src/services/inventory.service";
import { resolveServiceItemsForRolls, simulatedCutWarning } from "../src/services/helpers/service-pricing.helper";
import { correctCutReading } from "../src/services/tambur-meter-correct.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { collectServiceBillingDraft } from "../src/services/helpers/service-billing.helper";
import { stampMeterReadingsTx } from "../src/services/helpers/meter-reading.helper";
import { loadServiceBillingSettings } from "../src/services/system-setting.service";
import tamburRouter from "../src/routes/tambur.routes";
import type { Request, Response } from "express";

const tambur = new TamburService();
const inv = new InventoryService();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const STAMP = randomUUID().slice(0, 8);
const P = `TEST-TFC-${STAMP}`;
const fx = {
  rolls: [] as string[], steps: [] as string[], wos: [] as string[], items: [] as string[], props: [] as string[],
  stationId: null as string | null, machineId: null as string | null, customerId: null as string | null,
  invoiceIds: [] as string[], gradeCode: "",
};
let flagId = "";
/** Bu bekçi kesimi varsayılan Tambur ayarlarıyla koşar (simüle AÇIK, kaynak zorunlu KAPALI); profil ne olursa olsun birebir geri yüklenir. */
const KEYS = ["tambur.simulatedMeterEnabled", "tambur.olcumKaynagiZorunlu", "tambur.overQuantityEnabled"] as const;
let savedSettings: Array<{ key: string; value: Prisma.JsonValue; description: string | null }> = [];

async function errOf(fn: () => Promise<unknown>): Promise<{ status?: number; code?: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    return { status: err.statusCode, code: err.details?.code };
  }
}

async function fixtures() {
  const g = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
  if (!g) throw new Error("FIRST rollü kalite yok — seed'siz DB");
  fx.gradeCode = g.code;
  const fabric = await prisma.item.create({ data: { code: `${P}-K`, name: `TEST TFC kumaş ${STAMP}`, itemType: ItemType.FABRIC, unit: "MT" }, select: { id: true } });
  const svc = await prisma.item.create({ data: { code: `${P}-S`, name: `TEST TFC tambur hizmeti ${STAMP}`, itemType: ItemType.SERVICE, unit: "MT" }, select: { id: true } });
  fx.items.push(fabric.id, svc.id);
  await prisma.itemPrice.create({ data: { itemId: svc.id, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price: "2.0000" } });
  const flag = await prisma.fabricProperty.create({ data: { code: `${P}-TB`, name: `TEST TFC Tambur`, valueType: "FLAG", serviceItemId: svc.id }, select: { id: true } });
  fx.props.push(flag.id);
  flagId = flag.id;
  const st = await prisma.station.create({ data: { code: `${P}-ST`, name: `TEST TFC Tambur ${STAMP}`, type: StationType.INTERNAL, kind: StationKind.TAMBUR }, select: { id: true } });
  fx.stationId = st.id;
  const m = await prisma.machine.create({ data: { stationId: st.id, code: `TFC-${STAMP}`, name: `TEST TFC makine ${STAMP}` }, select: { id: true } });
  fx.machineId = m.id;
  const cust = await prisma.customer.create({ data: { code: `${P}-C`, name: `TEST TFC müşteri ${STAMP}` }, select: { id: true } });
  fx.customerId = cust.id;
  return { itemId: fabric.id, serviceItemId: svc.id };
}

/** Tambur adımında bekleyen emanet ata — bayrak atada, kesimde çocuğa kalıtılır. */
async function parentRoll(itemId: string, qty: number) {
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${P}-WO-${fx.wos.length}`, status: "IN_PROGRESS" }, select: { id: true } });
  fx.wos.push(wo.id);
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: fx.stationId!, stepSequence: 1, status: StepStatus.ACTIVE }, select: { id: true } });
  fx.steps.push(step.id);
  const roll = await prisma.roll.create({
    data: {
      barcode: null, itemId, colorId: null, width: 150, initialQty: qty, currentQty: qty, status: RollStatus.IN_PRODUCTION,
      qualityGrade: fx.gradeCode, entrySource: RollEntrySource.SUBCONTRACTOR_RETURN, currentStepId: step.id, ownerCustomerId: fx.customerId,
    },
    select: { id: true },
  });
  fx.rolls.push(roll.id);
  await prisma.rollProperty.create({ data: { rollId: roll.id, propertyId: flagId } });
  return { rollId: roll.id, stepId: step.id };
}

/** Çocukları izler; bayrak kalıtılmadıysa (yol farkı) aynı bayrağı çocuğa koyar — iş ③ kolundan çözülsün. */
async function kids(parentId: string) {
  const rows = await prisma.roll.findMany({ where: { parentRollId: parentId }, select: { id: true, initialQty: true, createdAt: true, producedInStepId: true }, orderBy: { initialQty: "asc" } });
  for (const r of rows) {
    if (!fx.rolls.includes(r.id)) fx.rolls.push(r.id);
    const has = await prisma.rollProperty.count({ where: { rollId: r.id, propertyId: flagId, revokedAt: null } });
    if (has === 0) await prisma.rollProperty.create({ data: { rollId: r.id, propertyId: flagId } });
  }
  return rows;
}
const activeCut = (rollId: string) => prisma.rollMeterReading.findFirst({ where: { rollId, phase: MeterPhase.CUT, revokedAt: null }, select: { id: true, source: true, meters: true } });
const resolve = (rollIds: string[]) => resolveServiceItemsForRolls({ rollIds, customerId: fx.customerId, currency: Currency.TRY });

async function main() {
  console.log("=== D4-B2 Tambur kesim metresi ↔ hizmet faturası ===");
  savedSettings = await prisma.systemSetting.findMany({ where: { key: { in: [...KEYS] } }, select: { key: true, value: true, description: true } });
  await prisma.systemSetting.deleteMany({ where: { key: { in: [...KEYS] } } });
  const base = await fixtures();
  // finalize kesimleri: MACHINE · SIMULATED · ölçümsüz (eski APK) — metreler aşağıdaki cuts[] dizisinde
  const a = await parentRoll(base.itemId, 100);
  await tambur.finalize({
    rollId: a.rollId, decisions: [],
    cuts: [
      { length: 20, qualityGrade: fx.gradeCode, relatedErrorIds: [], measure: { source: "MACHINE" } },
      { length: 30, qualityGrade: fx.gradeCode, relatedErrorIds: [], measure: { source: "SIMULATED" } },
      { length: 40, qualityGrade: fx.gradeCode, relatedErrorIds: [] },
    ],
  }, undefined, fx.machineId);
  // Ata 100 m, kesimler 90 m — kalan parça da çocuk olarak doğar; çocuklar metreleriyle seçilir.
  const all = await kids(a.rollId);
  const byQty = (q: number) => all.find((k) => Number(k.initialQty) === q);
  const [kMachine, kSim, kOld] = [byQty(20), byQty(30), byQty(40)];
  if (!kMachine || !kSim || !kOld) throw new Error("finalize 3 çocuk üretmedi");

  console.log("\n§1 SIMULATED kesim metresi faturaya girmez");
  const r1 = await resolve([kSim.id]);
  check("§1 SIMULATED CUT okumalı çocuk → taslakta 0 satır, 0 iş", r1.lines.length === 0 && r1.works.length === 0, JSON.stringify(r1.lines));
  check("§1 'simüle ölçüm — süpervizör düzeltmesi gerekli' uyarısı", r1.warnings.includes(simulatedCutWarning(1)), JSON.stringify(r1.warnings));
  // Gerçek taslak yolu (sevk/dönem taslağının ortak toplayıcısı): satır/bağ yok, uyarı taslağa taşınır.
  const d1 = await collectServiceBillingDraft({
    rollIds: [kSim.id], customerId: fx.customerId!, currency: Currency.TRY, settings: await loadServiceBillingSettings(), dispatchedAt: new Date(),
  });
  check("§1 hizmet faturası taslağı (collectServiceBillingDraft): SIMULATED topa bağ yok + uyarı taslakta",
    !d1.links.some((l) => l.rollId === kSim.id) && d1.warnings.includes(simulatedCutWarning(1)), JSON.stringify({ links: d1.links.length, w: d1.warnings }));

  console.log("\n§2 MACHINE okumalı → readingId bağlı; okumasız eski çocuk → initialQty (bayt-aynı)");
  const r2 = await resolve([kMachine.id, kSim.id, kOld.id]);
  const rd = await activeCut(kMachine.id);
  const wM = r2.works.find((w) => w.rollId === kMachine.id);
  check("§2 MACHINE çocuğu: meterBasis CUT, readingId = aktif CUT okuması, metre okumadan",
    !!rd && wM?.meterBasis === "CUT" && wM.readingId === rd.id && Number(wM.meters) === 20, JSON.stringify(wM));
  const wO = r2.works.find((w) => w.rollId === kOld.id);
  const expectOld = {
    rollId: kOld.id, workOrderStepId: kOld.producedInStepId, source: "PROPERTY", valueId: null, gramajFrom: "NONE", serviceItemId: base.serviceItemId,
    meters: kOld.initialQty.toString(), meterBasis: "CUT", readingId: null, serviceAt: kOld.createdAt.toISOString(),
  };
  const gotOld = wO && {
    rollId: wO.rollId, workOrderStepId: wO.workOrderStepId, source: wO.source, valueId: wO.valueId, gramajFrom: wO.gramajFrom, serviceItemId: wO.serviceItemId,
    meters: wO.meters.toString(), meterBasis: wO.meterBasis, readingId: wO.readingId, serviceAt: wO.serviceAt.toISOString(),
  };
  check("§2 okumasız çocuk: bugünkü initialQty satırı (snapshot bayt-aynı)", JSON.stringify(gotOld) === JSON.stringify(expectOld), JSON.stringify(gotOld));
  check("§2 karışık küme: 2 iş, satır miktarı 60 (20 + 40; simüle 30 yok)",
    r2.works.length === 2 && r2.lines.length === 1 && r2.lines[0]!.quantity === "60.000", JSON.stringify(r2.lines.map((l) => l.quantity)));

  console.log("\n§3 iptal → geri al: fatura dirilen okumayı görür");
  const b = await parentRoll(base.itemId, 100);
  const cut = await tambur.cutOpenFabric(b.rollId, { lengthMeters: 25, status: "WAREHOUSE", measure: { source: "MACHINE" } }, undefined, fx.machineId);
  const kRestore = cut.data.childRoll.id;
  await kids(b.rollId);
  const origReading = await activeCut(kRestore);
  await inv.softDelete(kRestore, undefined, { confirmActive: true, confirmLabelPrinted: true });
  await inv.restoreCancelledRoll(kRestore, undefined, { reason: "bekçi D4-B2 §3" });
  const revived = await activeCut(kRestore);
  const r3 = await resolve([kRestore]);
  const w3 = r3.works.find((w) => w.rollId === kRestore);
  check("§3 dirilen okuma YENİ satır ve iş onun readingId'sine bağlı",
    !!origReading && !!revived && revived.id !== origReading.id && w3?.readingId === revived.id && Number(w3.meters) === 25, JSON.stringify({ w3, revived }));
  await inv.softDelete(kSim.id, undefined, { confirmActive: true, confirmLabelPrinted: true });
  await inv.restoreCancelledRoll(kSim.id, undefined, { reason: "bekçi D4-B2 §3" });
  const r3b = await resolve([kSim.id]);
  check("§3 SIMULATED okumalı top iptal/geri al sonrası yine faturada YOK + uyarı",
    r3b.works.length === 0 && r3b.warnings.includes(simulatedCutWarning(1)), JSON.stringify(r3b.warnings));

  console.log("\n§4 süpervizör düzeltmesi + replay");
  const simReading = await activeCut(kSim.id);
  const token = randomUUID();
  const body = { meters: 29.5, clientToken: token, reason: "simülasyondaydı, şerit metreyle ölçüldü" };
  const first = await correctCutReading(simReading!.id, body, undefined);
  const after = await prisma.rollMeterReading.findMany({ where: { rollId: kSim.id, phase: MeterPhase.CUT }, select: { id: true, source: true, revokedAt: true, revokeReason: true, clientToken: true } });
  check("§4 yeni okuma SUPERVISOR, gövde token'ıyla; eski okuma damgalı (silinmedi)",
    first.data.reading.source === "SUPERVISOR" && first.data.reading.clientToken === token &&
      after.some((r) => r.id === simReading!.id && r.revokedAt !== null && (r.revokeReason ?? "").startsWith("TAMBUR_METER_CORRECTION")),
    JSON.stringify(after.map((r) => [r.source, !!r.revokedAt])));
  const r4 = await resolve([kSim.id]);
  const w4 = r4.works.find((w) => w.rollId === kSim.id);
  check("§4 düzeltme sonrası fatura zinciri SUPERVISOR okumasını okur (29.5, readingId yeni)",
    w4?.readingId === first.data.reading.id && Number(w4.meters) === 29.5 && !r4.warnings.includes(simulatedCutWarning(1)), JSON.stringify(w4));
  const rollAfter = await prisma.roll.findUnique({ where: { id: kSim.id }, select: { initialQty: true } });
  check("§4 Roll.initialQty DEĞİŞMEZ (30)", Number(rollAfter?.initialQty) === 30, String(rollAfter?.initialQty));
  const again = await correctCutReading(simReading!.id, body, undefined);
  const supCount = await prisma.rollMeterReading.count({ where: { rollId: kSim.id, source: "SUPERVISOR" } });
  check("§4 aynı clientToken ikinci istek → aynı yanıt (okuma id + düzeltilen id), TEK SUPERVISOR satırı",
    again.success && again.data.reading.id === first.data.reading.id && again.data.correctedReadingId === simReading!.id && supCount === 1 &&
      JSON.stringify(again) === JSON.stringify(first),
    `supervisor=${supCount}`);
  const collide = await errOf(() => correctCutReading(simReading!.id, { ...body, meters: 31 }, undefined));
  check("§4 aynı token başka metre → 409 CLIENT_TOKEN_COLLISION", collide?.status === 409 && collide.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(collide));

  console.log("\n§10 top izi ölçüm geçmişi (D4-B4 eklemeli alan)");
  const h10 = await inv.getRollHistory(kSim.id);
  const m10 = h10.data?.measurements;
  const cuts10 = (m10?.readings ?? []).filter((r) => r.phase === "CUT");
  check("§10 top izi düzeltilen SIMULATED okumayı damgalı, SUPERVISOR okumasını aktif listeler (kronolojik)",
    // §3'ün iptal/geri alması kSim'e damgalı bir SIMULATED satırı daha bıraktı: hepsi listede, yalnız sonuncusu aktif.
    cuts10.length >= 2 && cuts10.some((r) => r.id === simReading!.id && r.source === "SIMULATED" && r.revokedAt !== null) &&
      cuts10.slice(0, -1).every((r) => r.revokedAt !== null) && cuts10.every((r, i) => i === 0 || cuts10[i - 1].createdAt <= r.createdAt) &&
      cuts10.at(-1)?.id === first.data.reading.id && cuts10.at(-1)?.source === "SUPERVISOR" && cuts10.at(-1)?.meters === 29.5,
    JSON.stringify(cuts10.map((r) => [r.source, r.meters, !!r.revokedAt])));
  // Aşımlı kesim (MACHINE + SIMULATED) sapma doğurur; zayıf halka SIMULATED top izinde measureSource olarak görünür.
  await prisma.systemSetting.upsert({ where: { key: "tambur.overQuantityEnabled" }, update: { value: true }, create: { key: "tambur.overQuantityEnabled", value: true, description: "test geçici" } });
  const v10 = await parentRoll(base.itemId, 100);
  await tambur.finalize({
    rollId: v10.rollId, decisions: [],
    cuts: [
      { length: 80, qualityGrade: fx.gradeCode, relatedErrorIds: [], measure: { source: "MACHINE" } },
      { length: 40, qualityGrade: fx.gradeCode, relatedErrorIds: [], measure: { source: "SIMULATED" } },
    ],
  }, undefined, fx.machineId);
  await kids(v10.rollId);
  await prisma.systemSetting.deleteMany({ where: { key: "tambur.overQuantityEnabled" } });
  const vDb = await prisma.rollVariance.findMany({ where: { rollId: { in: [a.rollId, v10.rollId] } }, select: { id: true, rollId: true, measureSource: true } });
  const vApi = [
    ...((await inv.getRollHistory(a.rollId)).data?.measurements.variances ?? []),
    ...((await inv.getRollHistory(v10.rollId)).data?.measurements.variances ?? []),
  ];
  check("§10 sapma satırları measureSource ile (DB ile birebir; aşımlı kesimde SIMULATED)",
    vDb.length >= 1 && vApi.length === vDb.length && vDb.every((d) => vApi.some((v) => v.id === d.id && v.measureSource === d.measureSource)) &&
      vApi.some((v) => v.measureSource === "SIMULATED"),
    JSON.stringify(vApi.map((v) => [v.kind, v.qty, v.measureSource])));

  console.log("\n§5 eşzamanlı iki düzeltme");
  const mReading = await activeCut(kMachine.id);
  const race = await Promise.allSettled([
    correctCutReading(mReading!.id, { meters: 19.5, clientToken: randomUUID(), reason: "yarış A" }, undefined),
    correctCutReading(mReading!.id, { meters: 19.8, clientToken: randomUUID(), reason: "yarış B" }, undefined),
  ]);
  const ok = race.filter((x) => x.status === "fulfilled").length;
  const rej = race.find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
  const rejErr = rej?.reason as { statusCode?: number; details?: { code?: string } } | undefined;
  const activeM = await prisma.rollMeterReading.count({ where: { rollId: kMachine.id, phase: MeterPhase.CUT, revokedAt: null } });
  check("§5 biri geçer, öteki 409 METER_READING_ALREADY_CORRECTED; tek aktif CUT okuması",
    ok === 1 && rejErr?.statusCode === 409 && rejErr.details?.code === "METER_READING_ALREADY_CORRECTED" && activeM === 1,
    `ok=${ok} status=${rejErr?.statusCode} code=${rejErr?.details?.code} aktif=${activeM}`);

  console.log("\n§6 faturalı okuma 409 · CUT dışı 400");
  const cari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: fx.customerId!, subcontractorId: null }));
  const invc = await prisma.invoice.create({ data: { docNo: `${P}-F`, type: "SALES", cariId: cari.id, issueDate: new Date() }, select: { id: true } });
  fx.invoiceIds.push(invc.id);
  const billed = await activeCut(kRestore);
  await prisma.serviceBillingLink.create({ data: {
    invoiceId: invc.id, rollId: kRestore, workOrderStepId: w3!.workOrderStepId, serviceItemId: base.serviceItemId, readingId: billed!.id,
    billedMeters: "25", meterBasis: "CUT", unitPrice: "2", currency: Currency.TRY, serviceAt: new Date(),
  } });
  const e6 = await errOf(() => correctCutReading(billed!.id, { meters: 24, clientToken: randomUUID(), reason: "faturalı" }, undefined));
  const still = await activeCut(kRestore);
  check("§6 faturalı okuma → 409 SERVICE_ALREADY_BILLED, okuma damgalanmadı", e6?.status === 409 && e6.code === "SERVICE_ALREADY_BILLED" && still?.id === billed!.id, JSON.stringify(e6));
  const inRow = await prisma.rollMeterReading.create({ data: {
    rollId: kOld.id, workOrderStepId: kOld.producedInStepId!, phase: MeterPhase.IN, meters: "40", source: "MACHINE",
    basis: "DECLARED_IN", approvalMode: "OFFICE", clientToken: randomUUID(),
  }, select: { id: true } });
  const e6b = await errOf(() => correctCutReading(inRow.id, { meters: 41, clientToken: randomUUID(), reason: "giriş" }, undefined));
  check("§6 CUT dışı okuma → 400 METER_READING_NOT_CUT", e6b?.status === 400 && e6b.code === "METER_READING_NOT_CUT", JSON.stringify(e6b));

  console.log("\n§8 iptal edilmiş top · düzeltme ↔ iptal yarışı");
  const c = await parentRoll(base.itemId, 100);
  const kc = (await tambur.cutOpenFabric(c.rollId, { lengthMeters: 15, status: "WAREHOUSE", measure: { source: "MACHINE" } }, undefined, fx.machineId)).data.childRoll.id;
  const kd = (await tambur.cutOpenFabric(c.rollId, { lengthMeters: 12, status: "WAREHOUSE", measure: { source: "MACHINE" } }, undefined, fx.machineId)).data.childRoll.id;
  await kids(c.rollId);
  const rc = await activeCut(kc);
  await inv.softDelete(kc, undefined, { confirmActive: true, confirmLabelPrinted: true });
  const damgali = await prisma.rollMeterReading.findFirst({ where: { rollId: kc, phase: MeterPhase.CUT }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const e8 = await errOf(() => correctCutReading(damgali?.id ?? rc!.id, { meters: 14, clientToken: randomUUID(), reason: "iptal top" }, undefined));
  check("§8 iptal edilmiş topun okuması → 409 ROLL_NOT_CORRECTABLE", e8?.status === 409 && e8.code === "ROLL_NOT_CORRECTABLE", JSON.stringify(e8));
  // Yarış: iptal tx'i (roll claim → okuma anlık görüntüsü → damga) ile düzeltme iç içe; düzeltme anlık görüntüden SONRA başlar.
  const rd8 = await activeCut(kd);
  let corr: Promise<{ status?: number; code?: string } | null> = Promise.resolve(null);
  await prisma.$transaction(async (tx) => {
    await tx.roll.updateMany({ where: { id: kd }, data: { status: RollStatus.CANCELLED, cancelledAt: new Date(), preCancelStatus: RollStatus.WAREHOUSE } });
    const snap = await tx.rollMeterReading.findMany({ where: { rollId: kd, phase: MeterPhase.CUT, revokedAt: null }, select: { id: true } });
    corr = errOf(() => correctCutReading(rd8!.id, { meters: 11.5, clientToken: randomUUID(), reason: "yarış iptal" }, undefined));
    await new Promise((r) => setTimeout(r, 400));
    for (const r of snap) await stampMeterReadingsTx(tx, { id: r.id }, { revokedAt: new Date(), revokedById: null, revokeReason: "ROLL_CANCEL" });
  }, { timeout: 15000 });
  const e8b = await corr;
  const left = await prisma.rollMeterReading.count({ where: { rollId: kd, phase: MeterPhase.CUT, revokedAt: null } });
  check("§8 iptal anlık görüntüsünden sonra gelen düzeltme → 409, iptal topta aktif CUT okuması 0",
    left === 0 && e8b?.status === 409, `aktif=${left} düzeltme=${JSON.stringify(e8b)}`);

  console.log("\n§9 çok kuşak SIMULATED ata");
  const e = await parentRoll(base.itemId, 100);
  const ke = (await tambur.cutOpenFabric(e.rollId, { lengthMeters: 50, status: "WAREHOUSE", measure: { source: "SIMULATED" } }, undefined, fx.machineId)).data.childRoll.id;
  await kids(e.rollId);
  const keRow = await prisma.roll.findUniqueOrThrow({ where: { id: ke }, select: { producedInStepId: true } });
  const kf = await prisma.roll.create({ data: {
    barcode: null, itemId: base.itemId, colorId: null, width: 150, initialQty: 10, currentQty: 10, status: RollStatus.WAREHOUSE, qualityGrade: fx.gradeCode,
    entrySource: RollEntrySource.TAMBUR_SPLIT, parentRollId: ke, producedInStepId: keRow.producedInStepId, ownerCustomerId: fx.customerId,
  }, select: { id: true } });
  fx.rolls.push(kf.id);
  await kids(ke);
  const r9 = await resolveServiceItemsForRolls({ rollIds: [ke, kf.id], customerId: fx.customerId, currency: Currency.TRY, options: { shippedRollIds: new Set([ke, kf.id]) } });
  check("§9 SIMULATED kesimli ata (çocuğuyla birlikte sevk) faturada YOK + uyarı; çocuğun işi duruyor",
    !r9.works.some((w) => w.rollId === ke) && r9.works.some((w) => w.rollId === kf.id) && r9.warnings.includes(simulatedCutWarning(1)),
    JSON.stringify({ works: r9.works.map((w) => [w.rollId === ke ? "ata" : "cocuk", w.meterBasis, String(w.meters)]), w: r9.warnings }));

  console.log("\n§7 uç kapısı");
  const stack = tamburRouter.stack;
  const layer = stack.find((l) => l.route?.path === "/meter-readings/:id/correct");
  const names = layer?.route?.stack.map((s) => s.name) ?? [];
  const idx = layer ? stack.indexOf(layer) : -1;
  const gated = stack.slice(0, Math.max(idx, 0)).some((l) => !l.route && l.name === "requireProductionEnabled");
  check("§7 uç var, verifyToken ilk halka; router üretim modülü kapısının altında", !!layer && names[0] === "verifyToken" && gated, `${names.join(",")} gated=${gated}`);
  const permStep = layer!.route!.stack[1]!;
  const fakeReq = (perms: string[]): Partial<Request> => ({ user: { userId: randomUUID(), username: "tfc", permissions: perms, tokenVersion: 0 } as Request["user"] });
  const run = (perms: string[]) => new Promise<unknown>((res) => { void permStep.handle(fakeReq(perms) as Request, {} as Response, (e?: unknown) => res(e ?? "next")); });
  const denied = (await run(["mobile:tambur", "quality:write"])) as { statusCode?: number };
  const allowed = await run(["kursun:meter-approve"]);
  check("§7 kursun:meter-approve yoksa 403; varsa geçer", denied?.statusCode === 403 && allowed === "next", `denied=${denied?.statusCode} allowed=${String(allowed)}`);
}

function cleanupError(e: unknown) {
  console.error(`   ⚠️ temizlik adımı düştü: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200)}`);
}

async function cleanup() {
  await prisma.systemSetting.deleteMany({ where: { key: { in: [...KEYS] } } }).catch(cleanupError);
  for (const st of savedSettings) {
    await prisma.systemSetting.create({ data: { key: st.key, value: st.value as Prisma.InputJsonValue, description: st.description } }).catch(cleanupError);
  }
  if (fx.invoiceIds.length) {
    await prisma.serviceBillingLink.deleteMany({ where: { invoiceId: { in: fx.invoiceIds } } }).catch(cleanupError);
    await prisma.invoice.deleteMany({ where: { id: { in: fx.invoiceIds } } }).catch(cleanupError);
  }
  if (fx.rolls.length) {
    const readingIds = (await prisma.rollMeterReading.findMany({ where: { rollId: { in: fx.rolls } }, select: { id: true } })).map((r) => r.id);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...readingIds, ...fx.rolls] } } }).catch(cleanupError);
    await prisma.rollMeterReading.deleteMany({ where: { id: { in: readingIds } } }).catch(cleanupError);
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: fx.rolls } } }).catch(cleanupError);
    await prisma.warehouseMovement.deleteMany({ where: { OR: [{ rollId: { in: fx.rolls } }, { rollVariance: { rollId: { in: fx.rolls } } }] } }).catch(cleanupError);
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: fx.rolls } } }).catch(cleanupError);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: fx.rolls } } }).catch(cleanupError);
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: fx.rolls } } }).catch(cleanupError);
    await prisma.roll.deleteMany({ where: { id: { in: fx.rolls }, parentRollId: { not: null } } }).catch(cleanupError);
    await prisma.roll.deleteMany({ where: { id: { in: fx.rolls } } }).catch(cleanupError);
  }
  if (fx.steps.length) {
    await prisma.rollOperation.deleteMany({ where: { workOrderStepId: { in: fx.steps } } }).catch(cleanupError);
    await prisma.workOrderStep.deleteMany({ where: { id: { in: fx.steps } } }).catch(cleanupError);
  }
  if (fx.wos.length) await prisma.workOrder.deleteMany({ where: { id: { in: fx.wos } } }).catch(cleanupError);
  if (fx.customerId) {
    await prisma.cariAccount.deleteMany({ where: { customerId: fx.customerId } }).catch(cleanupError);
    await prisma.customer.deleteMany({ where: { id: fx.customerId } }).catch(cleanupError);
  }
  if (fx.props.length) await prisma.fabricProperty.deleteMany({ where: { id: { in: fx.props } } }).catch(cleanupError);
  if (fx.items.length) {
    await prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.items } } }).catch(cleanupError);
    await prisma.item.deleteMany({ where: { id: { in: fx.items } } }).catch(cleanupError);
  }
  if (fx.machineId) await prisma.machine.deleteMany({ where: { id: fx.machineId } }).catch(cleanupError);
  if (fx.stationId) await prisma.station.deleteMany({ where: { id: fx.stationId } }).catch(cleanupError);
}

main()
  .catch((e) => {
    console.error("Test hatası:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup().catch(cleanupError);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  });

