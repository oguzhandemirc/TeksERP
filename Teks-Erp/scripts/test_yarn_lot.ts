// =============================================================================
// BEKÇİ — İPLİK LOTU (devere Faz 2 A1, DEVERE-LEVENT-TARAMASI §3.5/§4; hüküm 1e L1–L5)
// =============================================================================
//   §0 statik — allowlist `lotId`/`bobbinCount` (TxInput + create data), guard lot boyutu, normalize TRIM
//   §1 lot DOĞUŞU mal kabulde: `[kalem, lotNo]` upsert (ikinci fiş aynı lot), TRIM, tedarikçi ilk doğuşta, bobin
//   §2 KİMLİK: başka kalemin lotu 400 · pasif lot 400 (mal kabul + doğrudan yazıcı)
//   §3 L1: lot etiketli çıkış lot bakiyesini aşamaz → 409 (depo bakiyesi yeterken, bayrak KAPALIYKEN)
//   §4 sarım lotlu: iki lot → uyarı; lot × depo bakiyeleri; WOUND_CANCEL ters kayıt LOT BAZINDA (net 0)
//   §5 lotsuz sarım → uyarı (reddedilmez); `devere.lotRequired` AÇIK → 400 YARN_LOT_REQUIRED
//   §6 mal kabul iptali ters satırı lotla düşer (lot bakiyesi doğru kalır)
//   §7 ⭐ DEFAULT = BUGÜNKÜ DAVRANIŞ: bayrak satırı YOKKEN ve `false`ken yanıt BİREBİR (1e ek şart ③)
//   §8 lot servisi: liste türetilen bakiye · elle aç · mükerrer 409 · pasife alınca giriş 400
//   §9 elle hareket lot etiketi + liste süzgeci
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-14): ① `applyYarnMovementTx` create-data'dan `lotId: input.lotId ?? null`
//    düşürülünce §1c ❌ (sessiz düşüş yakalandı) · ② guard'dan lot dalı çıkarılınca §3 ❌ · ③ `groupYarnLinesTx`
//    anahtarından lot çıkarılınca §4e ❌ · ④ `readDevereLotRequired` sabit `true` dönünce §1f/§3a/§4b ❌ (lotsuz
//    satırlar daha §1'de düşer; ① ve ④ zincirleme çöker — kırmızı yine kırmızıdır).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar (devere · iplik · ticaret · lotRequired) FOTOĞRAFINA döner.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Prisma, StationType, WarpBeamOrigin, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS, readDevereLotRequired } from "../src/services/system-setting.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { cancelWound, windWarpBeam } from "../src/services/warp-beam-wind.service";
import { applyYarnMovementTx, yarnService } from "../src/services/yarn.service";
import { yarnLotService } from "../src/services/yarn-lot.service";
import { normalizeLotNo, yarnLotBalanceTx } from "../src/services/helpers/yarn-lot.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
async function beklenenHata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    if (e instanceof Prisma.PrismaClientKnownRequestError) return AppError.conflict(`prisma ${e.code}`, { code: e.code });
    throw e;
  }
}
const kod = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "geçti");

const TAG = `TEST-LOT-${process.pid}`;
const receiptIds: string[] = [];
const ROOT = path.resolve(__dirname, "..");
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED];
const lotBal = (lotId: string, wh?: string) => yarnLotBalanceTx(prisma, lotId, wh).then(Number);
type ReceiptRes = { data: { id: string; receiptNo: string; yarnMovements: Array<{ lot?: { lotNo: string } | null; bobbinCount?: number | null }>; failed: Array<{ index: number; reason: string }> } };
/** Mal kabul satır hatası FIRLATMAZ, `failed[]`e düşer (fiş kamyondayken yarım kalmasın) — sebep metniyle okunur. */
const dusen = async (fn: () => Promise<unknown>): Promise<string> => {
  const r = fis(await fn());
  receiptIds.push(r.id);
  return r.failed.map((f) => f.reason).join(" | ");
};
const fis = (r: unknown): ReceiptRes["data"] => (r as ReceiptRes).data;
const stok = async (itemId: string, warehouseId: string): Promise<number> => {
  const r = await prisma.yarnStock.findUnique({ where: { itemId_warehouseId: { itemId, warehouseId } }, select: { balanceKg: true } });
  return r ? Number(r.balanceKg) : 0;
};

function statik(): void {
  console.log("── §0 Statik ──");
  const yarnSvc = readFileSync(path.join(ROOT, "src/services/yarn.service.ts"), "utf8");
  const create = yarnSvc.slice(yarnSvc.indexOf("tx.yarnMovement.create({"), yarnSvc.indexOf("select: { id: true }", yarnSvc.indexOf("tx.yarnMovement.create({")));
  check("§0a create-data ALLOWLIST `lotId` + `bobbinCount` taşıyor (sessiz düşüş yok)", /lotId: input\.lotId \?\? null/.test(create) && /bobbinCount: input\.bobbinCount \?\? null/.test(create));
  check("§0b `YarnMovementTxInput` iki alanı da beyan ediyor", /lotId\?: string \| null;/.test(yarnSvc) && /bobbinCount\?: number \| null;/.test(yarnSvc));
  const guard = readFileSync(path.join(ROOT, "src/services/helpers/yarn-balance-guard.helper.ts"), "utf8");
  check("§0c guard lot boyutunu depo satırı kilidinden SONRA, bayraktan BAĞIMSIZ sorar", /FOR UPDATE[\s\S]*yarnLotBalanceTx\(tx, ref\.lotId, ref\.warehouseId\)/.test(guard) && /if \(!enabled && !ref\.lotId\) return;/.test(guard));
  check("§0d normalizeLotNo: TRIM, boş → null, harf/boşluk yapısı KORUNUR (ayrıştırılmaz)", normalizeLotNo("  YAN 1029-K ") === "YAN 1029-K" && normalizeLotNo("   ") === null && normalizeLotNo("yan 1029-k") === "yan 1029-k" && normalizeLotNo(undefined) === null);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== İPLİK LOTU BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const setLotRequired = async (v: boolean | null) => {
    if (v === null) await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_LOT_REQUIRED } });
    else await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.DEVERE_LOT_REQUIRED }, create: { key: SETTING_KEYS.DEVERE_LOT_REQUIRED, value: String(v) }, update: { value: String(v) } });
  };

  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const yarn2 = await prisma.item.create({ data: { code: `${TAG}-IP2`, name: `${TAG} iplik 2`, itemType: "YARN", unit: "KG", linearDensityDen: 200 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 1000 }, select: { id: true } });
  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} depo` }, select: { id: true } });
  const st = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
  const mk = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-M1`, code: `${TAG}-M1`.slice(0, 32) }, select: { id: true } });
  const supplier = await prisma.customer.create({ data: { code: `${TAG}-TED`, name: `${TAG} tedarikçi`, type: "SUPPLIER" }, select: { id: true } });
  const beamIds: string[] = [];
  const lotIds: string[] = [];
  try {
    for (const key of FLAGS.slice(0, 3)) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "true" }, update: { value: "true" } });
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_LOT_REQUIRED } });
    console.log("\n── §1 Lot doğuşu mal kabulde ──");
    const r1 = fis(await goodsReceiptService.create({ warehouseId: wh.id, supplierId: supplier.id, deliveryNoteNo: `${TAG}-IRS1`, lines: [{ itemId: yarn.id, initialQty: 100, lotNo: "  YAN 1029-K ", bobbinCount: 12 }] }));
    receiptIds.push(r1.id);
    const lotA = await prisma.yarnLot.findUnique({ where: { itemId_lotNo: { itemId: yarn.id, lotNo: "YAN 1029-K" } }, select: { id: true, supplierId: true, lotNo: true } });
    if (lotA) lotIds.push(lotA.id);
    check("§1a ⭐ lot `[kalem, lotNo]` ile doğdu, lotNo TRIM'li ve AYNEN (\"YAN 1029-K\")", lotA?.lotNo === "YAN 1029-K");
    check("§1b tedarikçi fişten kopyalandı (ilk doğuş)", lotA?.supplierId === supplier.id);
    const m1 = await prisma.yarnMovement.findFirst({ where: { goodsReceiptId: r1.id }, select: { lotId: true, bobbinCount: true, kind: true } });
    check("§1c ⭐ IN satırı lotId + bobbinCount taşıyor (allowlist)", m1?.lotId === lotA?.id && m1?.bobbinCount === 12 && m1?.kind === YarnMovementKind.IN, JSON.stringify(m1));
    const r2 = fis(await goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-IRS2`, lines: [{ itemId: yarn.id, initialQty: 50, lotNo: "YAN 1029-K" }] }));
    receiptIds.push(r2.id);
    check("§1d ikinci fiş AYNI lota yazdı — lot sayısı 1, tedarikçi DEĞİŞMEDİ", (await prisma.yarnLot.count({ where: { itemId: yarn.id, lotNo: "YAN 1029-K" } })) === 1 && (await prisma.yarnLot.findUnique({ where: { id: lotA!.id }, select: { supplierId: true } }))?.supplierId === supplier.id);
    check("§1e lot bakiyesi TÜRETİLDİ: 100 + 50 = 150 (depo bakiyesi de 150)", (await lotBal(lotA!.id)) === 150 && (await stok(yarn.id, wh.id)) === 150);
    const r3 = fis(await goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-IRS3`, lines: [{ itemId: yarn.id, initialQty: 60, lotNo: "YAN 2000" }, { itemId: yarn.id, initialQty: 40 }] }));
    receiptIds.push(r3.id);
    const lotB = await prisma.yarnLot.findUnique({ where: { itemId_lotNo: { itemId: yarn.id, lotNo: "YAN 2000" } }, select: { id: true } });
    if (lotB) lotIds.push(lotB.id);
    check("§1f ikinci lot + lotsuz satır aynı fişte: depo 250, lot A 150, lot B 60, lotsuz 40", (await stok(yarn.id, wh.id)) === 250 && (await lotBal(lotB!.id)) === 60);
    check("§1g fiş dökümü lot ve bobini taşıyor", r1.yarnMovements.some((y) => y.lot?.lotNo === "YAN 1029-K" && y.bobbinCount === 12));
    const bozuk = await dusen(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-IRSX`, lines: [{ itemId: yarn.id, initialQty: 1, lotNo: "X", bobbinCount: 0 }] }));
    check("§1h bobin adedi 0 → satır düşer (failed[]), lot X AÇILMAZ", /Bobin adedi/.test(bozuk) && (await prisma.yarnLot.count({ where: { itemId: yarn.id, lotNo: "X" } })) === 0, bozuk);

    console.log("\n── §2 Kimlik ──");
    const yabanci = await prisma.yarnLot.create({ data: { itemId: yarn2.id, lotNo: `${TAG}-Y` }, select: { id: true } });
    lotIds.push(yabanci.id);
    const e2a = await beklenenHata(() => prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: 1, lotId: yabanci.id })));
    check("§2a başka kalemin lotu → 400 YARN_LOT_ITEM_MISMATCH", kod(e2a) === "YARN_LOT_ITEM_MISMATCH");
    await prisma.yarnLot.update({ where: { id: lotB!.id }, data: { isActive: false } });
    const e2b = await dusen(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-IRSP`, lines: [{ itemId: yarn.id, initialQty: 1, lotNo: "YAN 2000" }] }));
    check("§2b pasif lota mal kabul → satır düşer 'pasif' (yeni lot AÇILMAZ, hareket yok)", /pasif/.test(e2b) && (await prisma.yarnLot.count({ where: { itemId: yarn.id, lotNo: "YAN 2000" } })) === 1 && (await lotBal(lotB!.id)) === 60, e2b);
    await prisma.yarnLot.update({ where: { id: lotB!.id }, data: { isActive: true } });

    console.log("\n── §3 L1: lot bakiyesi aşılamaz (bayrak KAPALI, depo bakiyesi yeterli) ──");
    check("§3a zemin: eksi-bakiye bayrağı kapalı, depo 250 kg", (await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.YARN_BLOCK_NEGATIVE_BALANCE_ENABLED } }))?.value !== true && (await stok(yarn.id, wh.id)) === 250);
    const p0 = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.IN_HOUSE });
    beamIds.push(p0.data.id);
    const e3 = await beklenenHata(() => windWarpBeam(p0.data.id, { lengthM: 100, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 200, lotId: lotA!.id }] }));
    check("§3b ⭐ lot A 150 kg iken lotlu 200 kg çıkış → 409 YARN_LOT_BALANCE_EXCEEDED (depo 250 yeterdi)", kod(e3) === "YARN_LOT_BALANCE_EXCEEDED" && String(e3?.message).includes("YAN 1029-K"));
    check("§3c tx geri alındı: levent PLANNED, hareket yok, lot A 150", (await prisma.warpBeam.findUnique({ where: { id: p0.data.id }, select: { status: true } }))?.status === "PLANNED" && (await lotBal(lotA!.id)) === 150);

    console.log("\n── §4 Sarım lotlu: iki lot + dip iadesi + iptal ──");
    const p1 = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 500, originKind: WarpBeamOrigin.IN_HOUSE });
    beamIds.push(p1.data.id);
    const w1 = await windWarpBeam(p1.data.id, { lengthM: 500, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, clientToken: crypto.randomUUID(), yarnIssues: [{ warehouseId: wh.id, qtyKg: 80, lotId: lotA!.id }, { warehouseId: wh.id, qtyKg: 20, lotId: lotB!.id }], yarnReturns: [{ warehouseId: wh.id, qtyKg: 5, reasonCode: "DEPOYA_IADE", lotId: lotA!.id }] });
    check("§4a READY; uyarı: 2 farklı lot (reddedilmedi)", w1.data.status === "READY" && (w1.warnings ?? []).some((x) => /2 farklı iplik lotu/.test(x)), JSON.stringify(w1.warnings));
    check("§4b lot × depo bakiyeleri: A 150−80+5 = 75 · B 60−20 = 40 · depo 250−100+5 = 155", (await lotBal(lotA!.id, wh.id)) === 75 && (await lotBal(lotB!.id)) === 40 && (await stok(yarn.id, wh.id)) === 155);
    const w1det = await prisma.yarnMovement.findMany({ where: { warpBeamId: p1.data.id }, select: { kind: true, lotId: true } });
    check("§4c WARP_ISSUE/RETURN satırları lot taşıyor", w1det.length === 3 && w1det.every((m) => m.lotId !== null));
    const w2 = await windWarpBeam((await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 10, originKind: WarpBeamOrigin.IN_HOUSE })).data.id, { lengthM: 10, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 1, lotId: lotA!.id }], yarnReturns: [{ warehouseId: wh.id, qtyKg: 1, reasonCode: "DEPOYA_IADE", lotId: lotB!.id }] });
    beamIds.push(w2.data.id);
    check("§4d dip iadesi çıkış lotlarından değilse UYARI (L5 (a)), red değil", (w2.warnings ?? []).some((x) => /çıkış lotlarından olmayan/.test(x)));
    await cancelWound(p1.data.id, "lot sondası");
    const ters = await prisma.yarnMovement.findMany({ where: { warpBeamId: p1.data.id, kind: { in: [YarnMovementKind.WARP_ISSUE_REVERSAL, YarnMovementKind.WARP_RETURN_REVERSAL] } }, select: { kind: true, lotId: true, qtyKg: true } });
    check("§4e ⭐ WOUND_CANCEL ters kayıtları LOT BAZINDA (A 80 · B 20 · iade A 5) — lot bakiyeleri geri", ters.length === 3 && ters.every((m) => m.lotId !== null) && (await lotBal(lotA!.id)) === 149 && (await lotBal(lotB!.id)) === 61, `ters=${JSON.stringify(ters.map((t) => [t.kind, Number(t.qtyKg)]))} A=${await lotBal(lotA!.id)} B=${await lotBal(lotB!.id)}`);

    console.log("\n── §5 Lotsuz sarım: uyarı · lotRequired 400 ──");
    const p3 = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 10, originKind: WarpBeamOrigin.IN_HOUSE });
    beamIds.push(p3.data.id);
    const w3 = await windWarpBeam(p3.data.id, { lengthM: 10, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 2 }] });
    check("§5a lotsuz çıkış KABUL + uyarı 'lotsuz' (bayrak satırı yok)", w3.data.status === "READY" && (w3.warnings ?? []).some((x) => /lotsuz/.test(x)));
    await setLotRequired(true);
    const p4 = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 10, originKind: WarpBeamOrigin.IN_HOUSE });
    beamIds.push(p4.data.id);
    const e5 = await beklenenHata(() => windWarpBeam(p4.data.id, { lengthM: 10, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 2 }] }));
    check("§5b lotRequired AÇIK: lotsuz çıkış 400 YARN_LOT_REQUIRED", kod(e5) === "YARN_LOT_REQUIRED");
    const e5b = await dusen(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-IRS5`, lines: [{ itemId: yarn.id, initialQty: 1 }] }));
    check("§5c lotRequired AÇIK: mal kabul iplik satırı lotsuz düşer ('lot numarası zorunlu')", /lot numarası zorunlu/.test(e5b), e5b);
    const w4 = await windWarpBeam(p4.data.id, { lengthM: 10, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 2, lotId: lotA!.id }] });
    check("§5d lotRequired AÇIK: lotlu çıkış geçer, lot uyarısı yok", w4.data.status === "READY" && !(w4.warnings ?? []).some((x) => /lotsuz/.test(x)));
    const pF = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 10, originKind: WarpBeamOrigin.PURCHASED, supplierId: supplier.id });
    beamIds.push(pF.data.id);
    const wF = await windWarpBeam(pF.data.id, { lengthM: 10, kgSource: WarpKgSource.THEORETICAL });
    check("§5e lotRequired AÇIK: hazır alım levent iplik satırı yazmaz → lot sorulmaz", wF.data.status === "READY" && !wF.warnings);
    await setLotRequired(null);

    console.log("\n── §6 Mal kabul iptali ters satırı lotla düşer ──");
    const aOnce = await lotBal(lotA!.id);
    await goodsReceiptService.cancel(r2.id, "lot sondası");
    const adj = await prisma.yarnMovement.findFirst({ where: { goodsReceiptId: r2.id, kind: YarnMovementKind.ADJUST_OUT }, select: { lotId: true, qtyKg: true } });
    check("§6a ADJUST_OUT satırı lotId taşıyor (50 kg), lot A 50 düştü", adj?.lotId === lotA!.id && Number(adj?.qtyKg) === 50 && (await lotBal(lotA!.id)) === aOnce - 50);
    const r6 = fis(await goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-IRS6`, lines: [{ itemId: yarn.id, initialQty: 7, lotNo: "YAN 1029-K" }, { itemId: yarn.id, initialQty: 3 }] }));
    receiptIds.push(r6.id);
    await goodsReceiptService.cancel(r6.id, "lot sondası 2");
    const adj6 = await prisma.yarnMovement.findMany({ where: { goodsReceiptId: r6.id, kind: YarnMovementKind.ADJUST_OUT }, select: { lotId: true, qtyKg: true } });
    check("§6b karışık fiş (lotlu 7 + lotsuz 3) iptali: iki ters satır, biri lotlu 7 biri lotsuz 3", adj6.length === 2 && adj6.some((a) => a.lotId === lotA!.id && Number(a.qtyKg) === 7) && adj6.some((a) => a.lotId === null && Number(a.qtyKg) === 3));

    console.log("\n── §7 ⭐ DEFAULT = bugünkü davranış (ek şart ③) ──");
    await setLotRequired(null);
    check("§7a bayrak satırı YOK → okuyucu false", (await readDevereLotRequired()) === false);
    const yok = await windWarpBeam((await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 10, originKind: WarpBeamOrigin.IN_HOUSE })).data.id, { lengthM: 10, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 1 }] });
    beamIds.push(yok.data.id);
    await setLotRequired(false);
    const kapali = await windWarpBeam((await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 10, originKind: WarpBeamOrigin.IN_HOUSE })).data.id, { lengthM: 10, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 1 }] });
    beamIds.push(kapali.data.id);
    const norm = (r: typeof yok) => JSON.stringify({ status: r.data.status, warnings: r.warnings ?? null, issues: r.data.wound ? 1 : 0 });
    check("§7b satır YOK ↔ `false`: lotsuz sarım yanıtı BİREBİR (durum + uyarılar), ikisi de kabul", norm(yok) === norm(kapali) && yok.data.status === "READY", `${norm(yok)} ↔ ${norm(kapali)}`);
    await setLotRequired(null);

    console.log("\n── §8 Lot servisi ──");
    const liste = await yarnLotService.list({ itemId: yarn.id, limit: 50 });
    const satirA = liste.data.find((l) => l.id === lotA!.id);
    check("§8a liste satırı türetilen bakiyeyi taşıyor (A) ve item/supplier adı var", satirA != null && satirA.balanceKg === (await lotBal(lotA!.id)) && satirA.supplier?.id === supplier.id && !!satirA.item.code);
    const elle = await yarnLotService.create({ itemId: yarn.id, lotNo: "  ELLE-1 ", notes: "elle" });
    lotIds.push(elle.data.id);
    check("§8b elle lot: TRIM, tedarikçisiz (NULL meşru), bakiye 0", elle.data.lotNo === "ELLE-1" && elle.data.supplierId === null && elle.data.balanceKg === 0);
    check("§8c mükerrer elle lot → 409 YARN_LOT_EXISTS", kod(await beklenenHata(() => yarnLotService.create({ itemId: yarn.id, lotNo: "ELLE-1" }))) === "YARN_LOT_EXISTS");
    const kumas = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    check("§8d kumaş kalemine lot → 400", kod(await beklenenHata(() => yarnLotService.create({ itemId: kumas.id, lotNo: "X" }))) === "YARN_LOT_ITEM_NOT_YARN");
    await prisma.item.delete({ where: { id: kumas.id } });
    check("§8e boş lotNo → 400", kod(await beklenenHata(() => yarnLotService.create({ itemId: yarn.id, lotNo: "   " }))) === "YARN_LOT_NO_REQUIRED");
    const pasif = await yarnLotService.update(elle.data.id, { isActive: false });
    check("§8f pasife alma (silme yok); arama lotNo'ya", pasif.data.isActive === false && (await yarnLotService.list({ search: "ELLE-1", isActive: false })).data.some((l) => l.id === elle.data.id));

    console.log("\n── §9 Elle hareket lot etiketi + süzgeç ──");
    const m9 = await yarnService.createMovement({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.OUT, qtyKg: 1, lotId: lotA!.id, reason: "lot sondası" });
    check("§9a elle OUT lotla yazıldı", !!m9.data.id && (await prisma.yarnMovement.findUnique({ where: { id: m9.data.id }, select: { lotId: true } }))?.lotId === lotA!.id);
    const l9 = await yarnService.listMovements({ lotId: lotA!.id, limit: 200 });
    check("§9b hareket listesi lotId süzgeci + satırda lot", l9.data.length >= 5 && (l9.data as Array<{ lot?: { lotNo: string } | null }>).every((m) => m.lot?.lotNo === "YAN 1029-K"));
  } finally {
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: [yarn.id, yarn2.id] } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: [yarn.id, yarn2.id] } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { warpSpecId: spec.id } });
    await prisma.yarnLot.deleteMany({ where: { itemId: { in: [yarn.id, yarn2.id] } } });
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } }).catch(() => undefined);
    await prisma.warpSpec.delete({ where: { id: spec.id } }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { id: { in: [yarn.id, yarn2.id] } } });
    await prisma.machine.delete({ where: { id: mk.id } }).catch(() => undefined);
    await prisma.station.delete({ where: { id: st.id } }).catch(() => undefined);
    await prisma.warehouse.delete({ where: { id: wh.id } }).catch(() => undefined);
    await prisma.customer.delete({ where: { id: supplier.id } }).catch(() => undefined);
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
