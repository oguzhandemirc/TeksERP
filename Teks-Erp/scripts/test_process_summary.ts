// =============================================================================
// BEKÇİ — KURŞUN GRAMAJ ÖZETİ: iş emri · parti · rapor · hedef · kâğıt (KQ-D6, 2026-10-24)
// Çalıştır: npx tsx scripts/run-all-tests.ts process_summary
// =============================================================================
// Kullanıcı isteği: "gramaj düğmeleri topa, partiye ve iş emrine kaydedilir".
// Görünüm TEK helper'dan (`process-summary.helper.ts`) türer; rapor kendi sorgusunu
// yazmaz. Hedef gramaj İE plan alanıdır, sapma türetilir ve hiçbir şeyi engellemez.
//
//   §0  Metraj kaynağı ölçümü: hareket satırı (qtyOut ?? qtyIn) ≠ topun anlık uzunluğu
//   §1  ⭐ İE özeti = partilerinin özetleri toplamı
//   §2  ⭐ Rapor satır toplamları ↔ İE özeti bayt-eşit (aynı helper) + cursor sayfası eksiksiz
//   §3  ⭐ Geri alınmış (revoke) ve miras (Tambur kopyası) satırlar dışarıda; düzeltme tek sayılır
//   §4  Kâğıt: gramajlı satır ve "gramaj bilinmiyor" satırı
//   §5  Hedef 50, uygulanan 25 → deviatesFromTarget=true (50 → false)
//   §6  Fabrika günü sınırı (gece yarısı fabrika diliminde; UTC günü aynı olan iki kayıt iki güne düşer)
//   §7  Hedef değişimi eskiyi damgalar · aynısı no-op · çeşit olmayan özellik 400 · tablet özeti hedefi taşır
//   §7b ⭐ Özellik kapsamı (K1): bir özelliğin PUT'u ötekini iptal etmez · valueId null açık kaldırma · [] eski sözleşme
//   §8  Kâğıt gramajı: tamamlanmış atamada PATCH 409 · yanlış değer 400 · eşzamanlı yazımlar tutarlı
//
// FİKSTÜR KENDİ KENDİNE (TEST-PSU- damgası). KURSUN bayrağının çeşidi zaten varsa
// (bir bayrağın TEK çeşidi — partial unique) ona yalnız bu koşumun DEĞERLERİ eklenir.
//
// NEGATİF SONDALAR (2026-10-24, PR gövdesinde çıktı):
//   (a) helper'dan `ACTIVE_OPERATION` (revokedAt süzgeci) kaldırıldı → §3 KIRMIZI
//   (b) rapor helper'ı atlayıp kendi `rollOperation.findMany`ini yazdı → §2 KIRMIZI
// =============================================================================
import { randomUUID } from "node:crypto";
import { KursunBypassCompletionSource, RollOperationType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { KursunBypassService } from "../src/services/kursun-bypass.service";
import { replaceWorkOrderTargetValues } from "../src/services/workorder-target-value.service";
import { applyKursunOperationTx } from "../src/services/helpers/kursun-operation.helper";
import { revokeRollOperations } from "../src/services/helpers/roll-operation.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { KURSUN_BYPASS_MARKER_PREFIX } from "../src/services/helpers/kursun-bypass-guard.helper";
import {
  listKursunApplications,
  summarizeKursunApplications,
  UNKNOWN_GRAMAJ_LABEL,
  type KursunSummaryRow,
} from "../src/services/helpers/process-summary.helper";
import { buildKursunGramajSunumu, getKursunGramajReport } from "../src/services/reports/kursun-gramaj.report.service";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

async function expectAppError(label: string, status: number, code: string | null, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(label, false, "hata bekleniyordu");
  } catch (e) {
    const ok = e instanceof AppError && e.statusCode === status && (code === null || e.details?.code === code);
    const det = e instanceof AppError ? `${e.statusCode} ${String(e.details?.code ?? "")} ${e.message}` : String(e);
    check(label, ok, det.slice(0, 200));
  }
}

const STAMP = `${process.pid % 10000}${Date.now().toString(36).slice(-4)}`;
const P = `TEST-PSU-${STAMP}`;
const fx = {
  rollIds: [] as string[], woIds: [] as string[], stationIds: [] as string[], machineIds: [] as string[],
  propIds: [] as string[], valueIds: [] as string[], itemIds: [] as string[], kursunCreated: null as string | null,
};

/** Grup anahtarına indirger — kart/parti/rapor karşılaştırmasının ortak dili. */
function keyed(rows: KursunSummaryRow[]): Record<string, { rollCount: number; meters: string }> {
  const out: Record<string, { rollCount: number; meters: string }> = {};
  for (const r of rows) out[`${r.source}:${r.valueId ?? "-"}`] = { rollCount: r.rollCount, meters: r.meters };
  return out;
}
function addInto(acc: Record<string, { rollCount: number; meters: number }>, rows: Array<{ source: string; valueId: string | null; rollCount: number; meters: string }>): void {
  for (const r of rows) {
    const k = `${r.source}:${r.valueId ?? "-"}`;
    const cur = acc[k] ?? { rollCount: 0, meters: 0 };
    acc[k] = { rollCount: cur.rollCount + r.rollCount, meters: Math.round((cur.meters + Number(r.meters)) * 100) / 100 };
  }
}
function norm(acc: Record<string, { rollCount: number; meters: number | string }>): string {
  return JSON.stringify(Object.keys(acc).sort().map((k) => [k, acc[k]!.rollCount, Number(acc[k]!.meters).toFixed(2)]));
}

async function setupGramaj(): Promise<{ propId: string; v: Record<"25" | "50" | "100", string> }> {
  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  let variant = await prisma.fabricProperty.findFirst({ where: { variantOfPropertyId: kursun.id }, select: { id: true } });
  if (!variant) {
    variant = await prisma.fabricProperty.create({
      data: { code: `${P}-GR`.slice(0, 32), name: `TEST PSU gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id },
      select: { id: true },
    });
    fx.propIds.push(variant.id);
  }
  const mk = async (n: string, sort: number) => {
    const v = await prisma.fabricPropertyValue.create({
      data: { propertyId: variant!.id, code: `PSU${n}-${STAMP}`.slice(0, 32), name: `${n} gr`, sortOrder: sort },
      select: { id: true },
    });
    fx.valueIds.push(v.id);
    return v.id;
  };
  return { propId: variant.id, v: { "25": await mk("25", 10), "50": await mk("50", 20), "100": await mk("100", 30) } };
}

async function mkWorkOrder(n: number, itemId: string, stationId: string, steps: number) {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${P}-WO${n}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: itemId,
      steps: { create: Array.from({ length: steps }, (_, i) => ({ stationId, stepSequence: i + 1, status: "ACTIVE" as const })) },
    },
    select: { id: true, steps: { orderBy: { stepSequence: "asc" }, select: { id: true } } },
  });
  fx.woIds.push(wo.id);
  return { id: wo.id, stepIds: wo.steps.map((s) => s.id) };
}

let rollSeq = 0;
async function mkRoll(itemId: string, batchId: string | null, stepId: string, qty: { in: number; out: number | null; now: number }, notes?: string) {
  rollSeq++;
  const roll = await prisma.roll.create({
    data: { itemId, barcode: `${P}-R${rollSeq}`, initialQty: qty.in, currentQty: qty.now, status: "IN_PRODUCTION", currentStepId: stepId, batchId },
    select: { id: true },
  });
  fx.rollIds.push(roll.id);
  await prisma.rollMovement.create({
    data: { rollId: roll.id, workOrderStepId: stepId, qtyIn: qty.in, qtyOut: qty.out, exitedAt: qty.out === null ? null : new Date(), notes: notes ?? null },
  });
  return roll.id;
}

async function press(rollId: string, stepId: string, valueId: string | null, actor: string, machineId: string): Promise<void> {
  await prisma.$transaction((tx) => applyKursunOperationTx(tx, { rollId, stepId, valueId, userId: actor, machineId }));
}

async function readActiveTargets(workOrderId: string): Promise<string[]> {
  const rows = await prisma.workOrderTargetValue.findMany({ where: { workOrderId, revokedAt: null }, select: { propertyId: true, valueId: true } });
  return rows.map((r) => `${r.propertyId}:${r.valueId}`);
}

async function main(): Promise<void> {
  console.log("=== Kurşun gramaj özeti — İE · parti · rapor · hedef · kâğıt (KQ-D6) ===");
  const actor = await testActorId();
  const g = await setupGramaj();
  const item = await prisma.item.create({ data: { code: `${P}-ITM`, name: `TEST PSU kumaş ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });
  fx.itemIds.push(item.id);
  const st = await prisma.station.create({
    data: { code: `${P}-K`.slice(0, 32), name: `TEST PSU kurşun ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true },
    select: { id: true },
  });
  fx.stationIds.push(st.id);
  const m = await prisma.machine.create({ data: { stationId: st.id, code: `${P}-M`.slice(0, 32), name: `TEST PSU makine ${STAMP}` }, select: { id: true } });
  fx.machineIds.push(m.id);
  const other = await prisma.fabricProperty.create({
    data: { code: `${P}-OT`.slice(0, 32), name: `TEST PSU çeşitsiz ${STAMP}`, valueType: "CHOICE", values: { create: [{ code: "X", name: "X" }] } },
    select: { id: true, values: { select: { id: true } } },
  });
  fx.propIds.push(other.id);

  // ── Ana senaryo: İE W (S1 tablet, S2 kâğıt), iki parti ─────────────────────
  const W = await mkWorkOrder(1, item.id, st.id, 2);
  const [S1, S2] = W.stepIds as [string, string];
  const B1 = await prisma.batch.create({ data: { batchNumber: `${P}-B1`, workOrderId: W.id }, select: { id: true } });
  const B2 = await prisma.batch.create({ data: { batchNumber: `${P}-B2`, workOrderId: W.id }, select: { id: true } });
  await replaceWorkOrderTargetValues(W.id, [{ propertyId: g.propId, valueId: g.v["50"] }], actor);
  const q = { in: 100, out: 98, now: 90 };
  for (let i = 0; i < 13; i++) await press(await mkRoll(item.id, i < 9 ? B1.id : B2.id, S1, q), S1, g.v["50"], actor, m.id);
  const rCor = await mkRoll(item.id, B2.id, S1, q);
  await press(rCor, S1, g.v["25"], actor, m.id);
  await press(rCor, S1, g.v["50"], actor, m.id); // düzeltme: 25 damgalı, 50 aktif
  for (let i = 0; i < 3; i++) await press(await mkRoll(item.id, B1.id, S1, q), S1, g.v["25"], actor, m.id);
  const rRev = await mkRoll(item.id, B1.id, S1, q);
  await press(rRev, S1, g.v["50"], actor, m.id);
  await prisma.$transaction((tx) => revokeRollOperations(tx, { rollIds: [rRev], workOrderStepIds: [S1], reason: "TEST_UNDO", userId: actor }));
  const rChild = await mkRoll(item.id, B2.id, S1, q);
  await prisma.rollOperation.create({ // Tambur kesim kopyası (miras) — sayılmamalı
    data: { rollId: rChild, workOrderStepId: S1, operationType: RollOperationType.KURSUN_APPLIED, propertyValueId: g.v["50"], inheritedFromParentRollId: rCor },
  });
  const marker = `${KURSUN_BYPASS_MARKER_PREFIX}:${randomUUID()}`;
  const kagitRolls = [await mkRoll(item.id, B2.id, S2, { in: 100, out: 100, now: 100 }, marker), await mkRoll(item.id, B2.id, S2, { in: 100, out: 100, now: 100 }, marker)];
  await prisma.kursunBypassAssignment.create({
    data: { workOrderId: W.id, workOrderStepId: S2, machineId: m.id, assignedById: actor, completedAt: new Date(), completedById: actor, completedVia: KursunBypassCompletionSource.DISTRIBUTION_LAST_STEP },
  });

  const sum = await summarizeKursunApplications({ workOrderId: W.id });
  const rowOf = (src: string, v: string | null) => sum.rows.find((r) => r.source === src && r.valueId === v);

  // ── §0 ──────────────────────────────────────────────────────────────────
  section("§0 metraj kaynağı ölçümü");
  const apps = await listKursunApplications({ workOrderId: W.id });
  const tabletApps = apps.filter((a) => a.source === "TABLET");
  const movementSum = tabletApps.reduce((s, a) => s + Number(a.meters), 0);
  const nowSum = tabletApps.length * q.now;
  console.log(`   ölçüm: hareket satırı (qtyOut) toplamı ${movementSum} · topun anlık uzunluğu toplamı ${nowSum}`);
  check("kaynak = hareket satırı (adımdaki metraj), anlık uzunluk DEĞİL", movementSum === tabletApps.length * q.out && movementSum !== nowSum);

  // ── §5 (ana tablo okunurken) ────────────────────────────────────────────
  section("§5 hedef ve sapma");
  check("İE hedefi = 50 gr", sum.target?.valueId === g.v["50"], JSON.stringify(sum.target));
  check("50 gr: 14 top, 1372.00 m, sapma YOK", rowOf("TABLET", g.v["50"])?.rollCount === 14 && rowOf("TABLET", g.v["50"])?.meters === "1372.00" && rowOf("TABLET", g.v["50"])?.deviatesFromTarget === false,
    JSON.stringify(rowOf("TABLET", g.v["50"])));
  check("⭐ 25 gr: 3 top, 294.00 m, deviatesFromTarget=true", rowOf("TABLET", g.v["25"])?.rollCount === 3 && rowOf("TABLET", g.v["25"])?.meters === "294.00" && rowOf("TABLET", g.v["25"])?.deviatesFromTarget === true,
    JSON.stringify(rowOf("TABLET", g.v["25"])));

  // ── §3 ──────────────────────────────────────────────────────────────────
  section("§3 geri alınan + miras dışarıda");
  const appRollIds = new Set(apps.map((a) => a.rollId));
  check("⭐ geri alınmış satırın topu sayılmadı", !appRollIds.has(rRev));
  check("⭐ miras (Tambur kopyası) satırı sayılmadı", !appRollIds.has(rChild));
  check("düzeltilen top TEK kez (50 gr) sayıldı", apps.filter((a) => a.rollId === rCor).length === 1 && apps.find((a) => a.rollId === rCor)?.valueId === g.v["50"]);
  check("toplam = 14 + 3 + 2 kâğıt = 19 uygulama", sum.totals.rollCount === 19, String(sum.totals.rollCount));

  // ── §4 ──────────────────────────────────────────────────────────────────
  section("§4 kâğıt satırları");
  const unk = rowOf("KAGIT", null);
  check("⭐ kâğıt · gramaj bilinmiyor: 2 top, 1 adım, 200.00 m, sapma yok", unk?.rollCount === 2 && unk.stepCount === 1 && unk.meters === "200.00" && unk.valueName === UNKNOWN_GRAMAJ_LABEL && !unk.deviatesFromTarget,
    JSON.stringify(unk));
  check("kâğıt topları TABLET satırına karışmadı", apps.filter((a) => kagitRolls.includes(a.rollId)).every((a) => a.source === "KAGIT"));
  const W2 = await mkWorkOrder(2, item.id, st.id, 2);
  await mkRoll(item.id, null, W2.stepIds[0]!, { in: 50, out: 50, now: 50 }, `${KURSUN_BYPASS_MARKER_PREFIX}:${randomUUID()}`);
  const a2 = await prisma.kursunBypassAssignment.create({
    data: { workOrderId: W2.id, workOrderStepId: W2.stepIds[0]!, machineId: m.id, assignedById: actor, propertyValueId: g.v["100"], completedAt: new Date(), completedById: actor, completedVia: KursunBypassCompletionSource.DISTRIBUTION_LAST_STEP },
    select: { id: true },
  });
  const sum2 = await summarizeKursunApplications({ workOrderId: W2.id });
  check("kâğıt · 100 gr satırı (gramajlı)", sum2.rows.length === 1 && sum2.rows[0]!.source === "KAGIT" && sum2.rows[0]!.valueId === g.v["100"] && sum2.rows[0]!.meters === "50.00",
    JSON.stringify(sum2.rows));

  // ── §1 ──────────────────────────────────────────────────────────────────
  section("§1 İE = partilerin toplamı");
  const acc: Record<string, { rollCount: number; meters: number }> = {};
  for (const b of [B1.id, B2.id]) addInto(acc, (await summarizeKursunApplications({ batchId: b })).rows);
  const woAcc: Record<string, { rollCount: number; meters: number }> = {};
  addInto(woAcc, sum.rows);
  check("⭐ İE özeti = B1 + B2 özetleri (kaynak × gramaj, top + metre)", norm(acc) === norm(woAcc), `${norm(acc)} vs ${norm(woAcc)}`);
  const b1 = await summarizeKursunApplications({ batchId: B1.id });
  check("parti özeti İE hedefini taşır", b1.target?.valueId === g.v["50"]);

  // ── §2 ──────────────────────────────────────────────────────────────────
  section("§2 rapor ↔ İE özeti bayt-eşit");
  const range = { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 3600_000) };
  const rep = await getKursunGramajReport(range, { workOrderId: W.id, limit: 500 });
  const repAcc: Record<string, { rollCount: number; meters: number }> = {};
  addInto(repAcc, rep.rows);
  check("⭐ rapor satır toplamları = İE özeti", norm(repAcc) === norm(woAcc), `${norm(repAcc)} vs ${norm(woAcc)}`);
  check("⭐ rapor özet şeridi = İE özet satırları (bayt-eşit JSON)", JSON.stringify(rep.summary.rows) === JSON.stringify(sum.rows));
  const paged: typeof rep.rows = [];
  let cursor: number | null = 0;
  while (cursor !== null) {
    const pg = await getKursunGramajReport(range, { workOrderId: W.id, limit: 1, cursor });
    paged.push(...pg.rows);
    cursor = pg.nextCursor;
  }
  check("cursor ile sayfalanan satırlar = tek sayfa", JSON.stringify(paged) === JSON.stringify(rep.rows), `${paged.length}/${rep.totalRows}`);
  const only25 = await getKursunGramajReport(range, { workOrderId: W.id, valueId: g.v["25"] });
  check("süzgeç sunucuda: liste ve şerit aynı süzülmüş kümeden", only25.summary.totals.rollCount === 3 && only25.rows.every((r) => r.valueId === g.v["25"]));
  const onlyUnknown = await getKursunGramajReport(range, { workOrderId: W.id, valueId: "none" });
  check("valueId=none → yalnız bilinmiyor satırları", onlyUnknown.summary.totals.rollCount === 2);
  // v2 sunumu AYNI rapordan: ana sayı · tablo toplamı · kıyas beyanı (K-KIYAS, varsayılanı sunucu yazar).
  const sunum = await buildKursunGramajSunumu(range, { workOrderId: W.id });
  check("⭐ v2 ana sayı = rapor özet top sayısı", sunum.anaSayi.deger === rep.summary.totals.rollCount, `${sunum.anaSayi.deger}`);
  check("v2 tablo toplamı = rapor metresi", sunum.tablo?.toplam?.metre === Number(rep.summary.totals.meters));
  check("v2 kıyas beyanlı (varsayılan prev) ve kıyas dönemi taşır",
    sunum.parametreler.find((p) => p.ad === "kiyas")?.deger === "prev" && Boolean(sunum.kiyasDonemi) && sunum.anaSayi.kiyas !== undefined);
  const sunumYok = await buildKursunGramajSunumu(range, { workOrderId: W.id, kiyas: "none" });
  check("kiyas=none → kıyas dönemi ve kıyas YOK", !sunumYok.kiyasDonemi && sunumYok.anaSayi.kiyas === undefined);
  const sunumBilinmeyen = await buildKursunGramajSunumu(range, { workOrderId: W.id, gramaj: "none" });
  check("gramaj=none süzgeci v2'de de sunucuda", sunumBilinmeyen.anaSayi.deger === 2);

  // ── §6 ──────────────────────────────────────────────────────────────────
  section("§6 fabrika günü sınırı");
  const W3 = await mkWorkOrder(3, item.id, st.id, 1);
  const late = await mkRoll(item.id, null, W3.stepIds[0]!, q);
  const early = await mkRoll(item.id, null, W3.stepIds[0]!, q);
  await press(late, W3.stepIds[0]!, g.v["50"], actor, m.id);
  await press(early, W3.stepIds[0]!, g.v["50"], actor, m.id);
  // İkisi de UTC 2026-03-10; İstanbul'da 23:30 (10'u) ve 00:30 (11'i).
  await prisma.rollOperation.updateMany({ where: { rollId: late }, data: { createdAt: new Date("2026-03-10T20:30:00Z") } });
  await prisma.rollOperation.updateMany({ where: { rollId: early }, data: { createdAt: new Date("2026-03-10T21:30:00Z") } });
  const dayRep = await getKursunGramajReport({ from: new Date("2026-03-10T00:00:00Z"), to: new Date("2026-03-12T00:00:00Z") }, { workOrderId: W3.id });
  const days = dayRep.rows.map((r) => `${r.day}:${r.rollCount}`).sort().join(",");
  check("⭐ gece yarısı fabrika diliminde kesilir (10'u 1 top · 11'i 1 top)", days === "2026-03-10:1,2026-03-11:1", days);

  // ── §7 ──────────────────────────────────────────────────────────────────
  section("§7 hedef yazımı");
  const same = await replaceWorkOrderTargetValues(W.id, [{ propertyId: g.propId, valueId: g.v["50"] }], actor);
  check("aynı hedef → no-op (changed=false)", same.data.changed === false);
  const changed = await replaceWorkOrderTargetValues(W.id, [{ propertyId: g.propId, valueId: g.v["25"] }], actor);
  const rows7 = await prisma.workOrderTargetValue.findMany({ where: { workOrderId: W.id }, select: { valueId: true, revokedAt: true, revokeReason: true } });
  check("⭐ değişim eskiyi DAMGALAR, yenisi aktif (satır silinmez)", changed.data.changed && rows7.length === 2 && rows7.some((r) => r.valueId === g.v["50"] && r.revokedAt !== null) && rows7.some((r) => r.valueId === g.v["25"] && r.revokedAt === null),
    JSON.stringify(rows7.map((r) => [r.valueId === g.v["50"] ? 50 : 25, r.revokedAt !== null])));
  const audits = await prisma.systemLog.count({ where: { tableName: "WORK_ORDER_TARGET_VALUE", newData: { path: ["workOrderId"], equals: W.id } } });
  check("audit: ilk yazım + damga + yeni = 3 satır", audits === 3, String(audits));
  const after = await summarizeKursunApplications({ workOrderId: W.id });
  check("hedef 25'e dönünce sapma 50 satırına geçer (türetilir, yazılmaz)", after.rows.find((r) => r.valueId === g.v["50"])?.deviatesFromTarget === true && after.rows.find((r) => r.valueId === g.v["25"])?.deviatesFromTarget === false);
  const stepSum = await new KursunQcService().getStep(S1);
  check("tablet adım özeti hedefi taşır (targetValues + valueCode)", stepSum.data?.targetValues.length === 1 && stepSum.data.targetValues[0]!.valueId === g.v["25"] && stepSum.data.targetValues[0]!.valueCode.startsWith("PSU25"),
    JSON.stringify(stepSum.data?.targetValues));
  await expectAppError("çeşit OLMAYAN özellik → 400 TARGET_PROPERTY_NOT_VARIANT", 400, "TARGET_PROPERTY_NOT_VARIANT",
    () => replaceWorkOrderTargetValues(W.id, [{ propertyId: other.id, valueId: other.values[0]!.id }], actor));
  await expectAppError("başka özelliğin değeri → 400 TARGET_VALUE_INVALID", 400, "TARGET_VALUE_INVALID",
    () => replaceWorkOrderTargetValues(W.id, [{ propertyId: g.propId, valueId: other.values[0]!.id }], actor));
  // §7b (K1): ÖZELLİK KAPSAMI — ikinci bir çeşit özelliği; birinin hedefini değiştiren PUT ötekini iptal ETMEZ.
  const flag2 = await prisma.fabricProperty.create({ data: { code: `${P}-F2`.slice(0, 32), name: `TEST PSU bayrak2 ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
  fx.propIds.push(flag2.id);
  const var2 = await prisma.fabricProperty.create({
    data: { code: `${P}-V2`.slice(0, 32), name: `TEST PSU çeşit2 ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: flag2.id },
    select: { id: true },
  });
  fx.propIds.push(var2.id);
  const v2 = await prisma.fabricPropertyValue.create({ data: { propertyId: var2.id, code: `PSUV2-${STAMP}`.slice(0, 32), name: "çeşit2 A", sortOrder: 10 }, select: { id: true } });
  fx.valueIds.push(v2.id);
  await replaceWorkOrderTargetValues(W.id, [{ propertyId: var2.id, valueId: v2.id }], actor);
  const both = await readActiveTargets(W.id);
  check("⭐ §7b yalnız ikinci özelliği yazan PUT kurşun hedefini İPTAL ETMEZ", both.length === 2 && both.includes(`${g.propId}:${g.v["25"]}`) && both.includes(`${var2.id}:${v2.id}`), JSON.stringify(both));
  await replaceWorkOrderTargetValues(W.id, [{ propertyId: g.propId, valueId: g.v["100"] }], actor);
  const both2 = await readActiveTargets(W.id);
  check("⭐ §7b kurşun hedefini değiştiren PUT ikinci özelliğe dokunmaz", both2.length === 2 && both2.includes(`${g.propId}:${g.v["100"]}`) && both2.includes(`${var2.id}:${v2.id}`), JSON.stringify(both2));
  const removed = await replaceWorkOrderTargetValues(W.id, [{ propertyId: g.propId, valueId: null }], actor);
  const after7b = await readActiveTargets(W.id);
  check("⭐ §7b açık kaldırma (valueId null) yalnız o özelliği damgalar", removed.data.changed && after7b.length === 1 && after7b[0] === `${var2.id}:${v2.id}`, JSON.stringify(after7b));
  const noop = await replaceWorkOrderTargetValues(W.id, [{ propertyId: g.propId, valueId: null }], actor);
  check("§7b hedefi olmayan özelliği kaldırmak no-op", noop.data.changed === false);
  await expectAppError("§7b aynı özellik iki kez (biri kaldırma) → 400 TARGET_VALUE_DUPLICATE", 400, "TARGET_VALUE_DUPLICATE",
    () => replaceWorkOrderTargetValues(W.id, [{ propertyId: var2.id, valueId: null }, { propertyId: var2.id, valueId: v2.id }], actor));
  await replaceWorkOrderTargetValues(W.id, [{ propertyId: g.propId, valueId: g.v["25"] }], actor);
  const cleared = await replaceWorkOrderTargetValues(W.id, [], actor);
  check("boş liste (eski istemci sözleşmesi) → İKİ özelliğin de aktif hedefi kalmaz", cleared.data.targetValues.length === 0);

  // ── §8 ──────────────────────────────────────────────────────────────────
  section("§8 kâğıt gramajı yazımı");
  const svc = new KursunBypassService();
  await expectAppError("⭐ tamamlanmış atamada PATCH → 409 KURSUN_GRAMAJ_FROZEN", 409, "KURSUN_GRAMAJ_FROZEN", () => svc.setGramaj(a2.id, g.v["25"], actor));
  const a3 = await prisma.kursunBypassAssignment.create({
    data: { workOrderId: W2.id, workOrderStepId: W2.stepIds[1]!, machineId: m.id, assignedById: actor },
    select: { id: true },
  });
  await expectAppError("kurşun çeşidine ait olmayan değer → 400 KURSUN_GRAMAJ_INVALID", 400, "KURSUN_GRAMAJ_INVALID", () => svc.setGramaj(a3.id, other.values[0]!.id, actor));
  const ok = await svc.setGramaj(a3.id, g.v["25"], actor);
  check("açık atamada gramaj yazılır", ok.data?.changed === true);
  const two = await Promise.allSettled([svc.setGramaj(a3.id, g.v["50"], actor), svc.setGramaj(a3.id, g.v["100"], actor)]);
  const v3 = (await prisma.kursunBypassAssignment.findUnique({ where: { id: a3.id }, select: { propertyValueId: true } }))!.propertyValueId;
  check("eşzamanlı iki PATCH: ikisi de başarılı, son değer ikisinden biri", two.every((t) => t.status === "fulfilled") && (v3 === g.v["50"] || v3 === g.v["100"]));
  const race = await Promise.allSettled([
    svc.setGramaj(a3.id, g.v["25"], actor),
    prisma.kursunBypassAssignment.updateMany({ where: { id: a3.id, completedAt: null, cancelledAt: null }, data: { completedAt: new Date() } }),
  ]);
  const final = (await prisma.kursunBypassAssignment.findUnique({ where: { id: a3.id }, select: { propertyValueId: true, completedAt: true } }))!;
  const patchOk = race[0]!.status === "fulfilled";
  check("PATCH ↔ tamamlama yarışı tutarlı (başarılıysa 25, 409 ise önceki değer)",
    final.completedAt !== null && (patchOk ? final.propertyValueId === g.v["25"] : final.propertyValueId === v3),
    `patch ${patchOk ? "ok" : "409"} · değer ${final.propertyValueId === g.v["25"] ? 25 : "önceki"}`);
  const opsAfter = await prisma.rollOperation.count({ where: { step: { workOrderId: W2.id } } });
  check("bypass kuralı: kâğıt gramajı RollOperation YAZMAZ", opsAfter === 0, String(opsAfter));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  const ids = fx.rollIds;
  await del("assignment", () => prisma.kursunBypassAssignment.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: ids } }, { inheritedFromParentRollId: { in: ids } }] } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("batch", () => prisma.batch.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("targetValue", () => prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("machine", () => prisma.machine.deleteMany({ where: { id: { in: fx.machineIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { OR: [{ id: { in: fx.valueIds } }, { propertyId: { in: fx.propIds } }] } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  const left = await prisma.roll.count({ where: { barcode: { startsWith: P } } });
  check("temizlik: TEST-PSU top kalıntısı yok", left === 0, String(left));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
