// =============================================================================
// BEKÇİ — EL TERMİNALİ SEVKİYAT v2 (B1): aç → okut → çuval aç → kg → sevk et
// =============================================================================
// Çalıştırma: npx tsx scripts/test_elt_sevk_v2.ts
//
// NEDEN: telefon Sevk Çıkışı'nda cari seçip topları okutarak sevkiyatı yükler; karar (ekle · aktar ·
// çıkar · hazır değil · ret) TEK boğazda sunucuda verilir (`classifyHandheldScan`). İstemci yalnız onay
// sorar. Karışık yük (çuval + tek dökme) YALNIZ bu yolda; eski yollar tek tür kalır.
//
// ÖLÇÜLENLER (PLAN-elt-sevk-v2 §b):
//   T1  bayrak kayıtsız → false; kapalıyken A1–A6 403 HANDHELD_DISABLED (servis + HTTP)
//   T2  A1 boş PLANNED (onay kapalıyken bile), olay PLANNED, replay aynı id, başka cari + aynı token 409, CARI_HOLD
//   T3  hedef null → added + BULK doğar; tekrar → needsRemoveConfirm (yazım yok); confirmRemove → removed, BULK çözülür
//   T4  A4 çuval aç (BULK varken de); eski add-scan karışık sevkiyata → hâlâ 409 LOAD_UNIT_KIND_MIXED
//   T5  dökme → çuval aktar (dökme çözülür); A → B aktar; aynı çuvala → needsRemoveConfirm
//   T6  başka sevkiyat · havuz çuvalı · başka depo · sevk edilmiş → ret, yazım yok
//   T7  sahiplik: emanet sahibi B · iş emri carisi B → OWNER_MISMATCH; sahipsiz → added; SQL ikizi = JS
//   T8  STOCK → needsNotReadyConfirm → onayla added; IN_PRODUCTION → ROLL_NOT_PHYSICAL (onayla da)
//   T9  A5 kg: WEIGHED · REWEIGHED · aynı kg no-op · top eklenince CLEARED + labelDirty · null CLEARED · dökme 409 · kısıt 403
//   T10 A6: boş çuval düşer, LOAD_CHANGED, belge loadSummary (yalnız karışıkta), replay, brüt metre
//   T11 yarış: iki sevkiyata aynı top · açık tutulan sevk tx'i varken okutma → 409 SHIPMENT_NOT_PLANNED
//   T12 iptal: karışık PLANNED → dökme çözülür, çuval havuza, toplar rafta; storno → toplar rafta
//   T13 HTTP: yalnız mobile:sevkiyat → A1–A6 başarılı; strict gövde 400; storno 403 (SoD)
//   T14 liste: hasRolls boş PLANNED'ı gizler; customerName asc/desc + cursor tekrar/atlama yok
//   T15 isRetry: added → aynı token added{replayed}; removed → removed{replayed}
//
// NEGATİF SONDALAR (2026-11-11, elle; her biri kırmızı verdi, geri alındı): başlıkta değil raporda —
//   bkz. docs/bekci-harita/sevkiyat.md satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as bcrypt from "bcryptjs";
import { LoadUnitKind, Prisma, PrintedDocType, RollStatus, SackWeighingKind, ShipmentStatus, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import app from "../src/app";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { shippingService } from "../src/services/shipping.service";
import { effectiveRollCustomer, effectiveRollCustomerSql } from "../src/services/helpers/handheld-scan.helper";
import type { HandheldOutcome } from "../src/services/shipping/handheld-load";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const TAG = `TEST-HH2-${Date.now().toString(36)}`;
const SETTINGS = [
  SETTING_KEYS.SHIPMENT_HANDHELD_CREATE_ENABLED,
  SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED,
  SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED,
  SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED,
  SETTING_KEYS.SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED,
  SETTING_KEYS.EMANET_ENABLED,
  SETTING_KEYS.FINANCE_ENABLED,
] as const;
const inventory = new InventoryService();
const made = { customers: [] as string[], items: [] as string[], rolls: [] as string[], users: [] as string[], wos: [] as string[], warehouses: [] as string[], sacks: [] as string[] };
const setSetting = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Err = { status: number | null; code: string | null; message: string };
async function caught(fn: () => Promise<unknown>): Promise<Err> {
  try {
    await fn();
    return { status: null, code: null, message: "" };
  } catch (e) {
    const err = e as { message?: string; statusCode?: number; details?: Record<string, unknown> };
    return { status: err.statusCode ?? null, code: (err.details?.code as string | undefined) ?? null, message: err.message ?? String(e) };
  }
}

interface Ctx {
  adminId: string;
  wh: string;
  wh2: string;
  custA: string;
  custB: string;
  custC: string;
  fabric: string;
  base: string;
}
type R = { id: string; barcode: string };

async function mkRoll(c: Ctx, qty: number, owner: string | null, status: RollStatus, wh?: string): Promise<R> {
  const r = await inventory.createInitialEntry({ itemId: c.fabric, initialQty: qty, width: 150 }, c.adminId, null, false, { ownerCustomerId: owner, gradeRequired: false, warehouseId: wh ?? c.wh, forcedStatus: status });
  made.rolls.push(r.data.id);
  const row = await prisma.roll.findUniqueOrThrow({ where: { id: r.data.id }, select: { barcode: true } });
  return { id: r.data.id, barcode: row.barcode! };
}
const open = async (c: Ctx, customerId: string) => (await shippingService.openHandheldShipment({ customerId, clientToken: randomUUID() }, c.adminId)).state.shipment.id;
const scan = async (c: Ctx, sh: string, barcode: string, target: string | null, extra: Record<string, unknown> = {}): Promise<HandheldOutcome> =>
  (await shippingService.scanIntoShipment(sh, { barcode, targetSackId: target, clientToken: randomUUID(), ...extra }, c.adminId)).outcome;
const newSack = async (c: Ctx, sh: string) => (await shippingService.openSackInShipment(sh, { clientToken: randomUUID() }, c.adminId)).sack;
const where = (rollId: string) => prisma.roll.findUniqueOrThrow({ where: { id: rollId }, select: { sackId: true, shipmentId: true, status: true } });
async function counts(c: Ctx): Promise<string> {
  const ids = [c.custA, c.custB, c.custC];
  const sh = await prisma.shipment.count({ where: { customerId: { in: ids } } });
  const sk = await prisma.sack.count({ where: { customerId: { in: ids }, dissolvedAt: null } });
  const bound = await prisma.roll.count({ where: { id: { in: made.rolls }, OR: [{ sackId: { not: null } }, { shipmentId: { not: null } }] } });
  return `${sh}/${sk}/${bound}`;
}

async function t1Flag(c: Ctx): Promise<void> {
  const f0 = (await systemSettingService.getFeatureFlags()).data!;
  check("T1a bayrak kayıtsız → shipmentHandheldCreateEnabled === false", f0.shipmentHandheldCreateEnabled === false, String(f0.shipmentHandheldCreateEnabled));
  const fake = randomUUID();
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["A1", () => shippingService.openHandheldShipment({ customerId: c.custA, clientToken: randomUUID() }, c.adminId)],
    ["A2", () => shippingService.getHandheldLoadState(fake)],
    ["A3", () => shippingService.scanIntoShipment(fake, { barcode: "X", targetSackId: null, clientToken: randomUUID() }, c.adminId)],
    ["A4", () => shippingService.openSackInShipment(fake, { clientToken: randomUUID() }, c.adminId)],
    ["A5", () => shippingService.setSackWeightInShipment(fake, fake, { weightKg: 1 }, { userId: c.adminId })],
    ["A6", () => shippingService.handheldDispatch(fake, { expectedRollCount: 1 }, c.adminId)],
  ];
  const res: string[] = [];
  for (const [ad, fn] of calls) {
    const e = await caught(fn);
    if (e.status !== 403 || e.code !== "HANDHELD_DISABLED") res.push(`${ad}:${e.status}/${e.code}`);
  }
  check("T1b ⭐ bayrak kapalıyken A1–A6 → 403 HANDHELD_DISABLED", res.length === 0, res.join(" "));
  await systemSettingService.setFeatureFlags({ shipmentHandheldCreateEnabled: true }, c.adminId);
  const f1 = (await systemSettingService.getFeatureFlags()).data!;
  check("T1c setFeatureFlags aç → true", f1.shipmentHandheldCreateEnabled === true);
}

async function t2Open(c: Ctx): Promise<void> {
  const token = randomUUID();
  const a = await shippingService.openHandheldShipment({ customerId: c.custA, clientToken: token }, c.adminId);
  const sh = await prisma.shipment.findUniqueOrThrow({ where: { id: a.state.shipment.id }, select: { status: true, shipmentNo: true, clientToken: true } });
  const ev = await prisma.shipmentEvent.findMany({ where: { shipmentId: a.state.shipment.id }, select: { type: true } });
  check("T2a ⭐ A1 boş PLANNED doğar (onay KAPALI kurulumda bile)", a.created && sh.status === ShipmentStatus.PLANNED && a.state.sacks.length === 0 && a.state.loose.unitId === null, sh.status);
  check("T2b ShipmentEvent PLANNED + numara serisi", ev.length === 1 && String(ev[0]!.type) === "PLANNED" && sh.shipmentNo.length > 0, ev.map((e) => e.type).join(","));
  const again = await shippingService.openHandheldShipment({ customerId: c.custA, clientToken: token }, c.adminId);
  check("T2c aynı token → aynı id, created=false (replay)", !again.created && again.state.shipment.id === a.state.shipment.id);
  const col = await caught(() => shippingService.openHandheldShipment({ customerId: c.custB, clientToken: token }, c.adminId));
  check("T2d başka cari + aynı token → 409 CLIENT_TOKEN_COLLISION", col.status === 409 && col.code === "CLIENT_TOKEN_COLLISION", `${col.status} ${col.code}`);
  await setSetting(SETTING_KEYS.FINANCE_ENABLED, true);
  const acc = await prisma.cariAccount.upsert({ where: { customerId: c.custC }, create: { kind: "CUSTOMER", customerId: c.custC }, update: {}, select: { id: true } });
  const hold = await prisma.cariHold.create({ data: { cariId: acc.id, blocksIntake: false, blocksShipment: true, blocksInvoice: false, reasonCode: "BORC", reasonText: TAG, placedById: c.adminId, clientToken: randomUUID() }, select: { id: true } });
  const before = await prisma.shipment.count({ where: { customerId: c.custC } });
  const h = await caught(() => shippingService.openHandheldShipment({ customerId: c.custC, clientToken: randomUUID() }, c.adminId));
  const after = await prisma.shipment.count({ where: { customerId: c.custC } });
  check("T2e cari kilitli → 409 CARI_HOLD, yazım yok", h.status === 409 && h.code === "CARI_HOLD" && before === after, `${h.status} ${h.code} ${before}→${after}`);
  await prisma.cariHold.delete({ where: { id: hold.id } });
  await setSetting(SETTING_KEYS.FINANCE_ENABLED, false);
}

async function t3t15LooseAndRetry(c: Ctx): Promise<void> {
  const sh = await open(c, c.custA);
  const r = await mkRoll(c, 30, null, RollStatus.WAREHOUSE);
  const o1 = await scan(c, sh, r.barcode, null);
  const bulk = await prisma.sack.findFirst({ where: { shipmentId: sh, unitKind: LoadUnitKind.BULK, dissolvedAt: null }, select: { id: true } });
  check("T3a ⭐ hedef null + hazır top → added, canlı BULK doğar", o1.kind === "added" && o1.to.sackId === null && o1.to.label === "Çuvalsız" && !!bulk && (await where(r.id)).sackId === bulk.id, JSON.stringify(o1));
  const before = await counts(c);
  const o2 = await scan(c, sh, r.barcode, null);
  check("T3b aynı top tekrar → needsRemoveConfirm, yazım yok", o2.kind === "needsRemoveConfirm" && (await counts(c)) === before, o2.kind);
  const o3 = await scan(c, sh, r.barcode, null, { confirmRemove: true });
  const dis = await prisma.sack.findUniqueOrThrow({ where: { id: bulk!.id }, select: { dissolvedAt: true } });
  const w3 = await where(r.id);
  check("T3c confirmRemove → removed, BULK çözüldü (dissolvedAt), top rafta", o3.kind === "removed" && o3.unitDissolved && dis.dissolvedAt !== null && w3.sackId === null && w3.shipmentId === null, JSON.stringify(o3));
  // T15 isRetry
  const tok = randomUUID();
  const a1 = (await shippingService.scanIntoShipment(sh, { barcode: r.barcode, targetSackId: null, clientToken: tok }, c.adminId)).outcome;
  const a2 = (await shippingService.scanIntoShipment(sh, { barcode: r.barcode, targetSackId: null, clientToken: tok, isRetry: true }, c.adminId)).outcome;
  check("T15a added sonrası aynı token + isRetry → added{replayed} (çıkarma sorusu yok)", a1.kind === "added" && a2.kind === "added" && a2.replayed === true, `${a1.kind}/${a2.kind}`);
  const tok2 = randomUUID();
  const d1 = (await shippingService.scanIntoShipment(sh, { barcode: r.barcode, targetSackId: null, clientToken: tok2, confirmRemove: true }, c.adminId)).outcome;
  const d2 = (await shippingService.scanIntoShipment(sh, { barcode: r.barcode, targetSackId: null, clientToken: tok2, confirmRemove: true, isRetry: true }, c.adminId)).outcome;
  check("T15b removed sonrası aynı token + isRetry → removed{replayed}", d1.kind === "removed" && d2.kind === "removed" && d2.replayed === true && (await where(r.id)).shipmentId === null, `${d1.kind}/${d2.kind}`);
}

async function t4t5SacksAndTransfer(c: Ctx): Promise<void> {
  const sh = await open(c, c.custA);
  const [r1, r2, r3] = [await mkRoll(c, 20, null, RollStatus.WAREHOUSE), await mkRoll(c, 21, null, RollStatus.WAREHOUSE), await mkRoll(c, 22, null, RollStatus.WAREHOUSE)];
  await scan(c, sh, r1.barcode, null);
  await scan(c, sh, r3.barcode, null);
  const sA = await newSack(c, sh);
  const rowA = await prisma.sack.findUniqueOrThrow({ where: { id: sA.id }, select: { shipmentId: true, unitKind: true, seq: true } });
  check("T4a ⭐ A4 çuval aç → SACK sevkiyatta, seq atandı; BULK varken de açılır (karışık)", rowA.shipmentId === sh && rowA.unitKind === LoadUnitKind.SACK && rowA.seq !== null && sA.seqLabel !== null, JSON.stringify(rowA));
  const old = await caught(() => shippingService.addLoadByScan(sh, { barcode: r2.barcode, unitKind: "BULK", clientToken: randomUUID() }, c.adminId));
  check("T4b eski add-scan karışık sevkiyata → hâlâ 409 LOAD_UNIT_KIND_MIXED (eski yol bayt-aynı)", old.status === 409 && old.code === "LOAD_UNIT_KIND_MIXED", `${old.status} ${old.code}`);
  const bulkId = (await where(r1.id)).sackId!;
  const t1 = await scan(c, sh, r1.barcode, sA.id);
  check("T5a dökmedeki top hedef A → transferred Çuvalsız → A", t1.kind === "transferred" && t1.from.label === "Çuvalsız" && t1.to.sackId === sA.id && (await where(r1.id)).sackId === sA.id, JSON.stringify(t1));
  const t1b = await scan(c, sh, r3.barcode, sA.id);
  const bulkRow = await prisma.sack.findUniqueOrThrow({ where: { id: bulkId }, select: { dissolvedAt: true } });
  check("T5b dökme boşalınca çözülür", t1b.kind === "transferred" && bulkRow.dissolvedAt !== null, JSON.stringify(bulkRow));
  const sB = await newSack(c, sh);
  const t2 = await scan(c, sh, r1.barcode, sB.id);
  check("T5c A'daki top hedef B → transferred A → B", t2.kind === "transferred" && t2.from.sackId === sA.id && t2.to.sackId === sB.id && t2.from.label === sA.sackNo, JSON.stringify(t2));
  const t3 = await scan(c, sh, r1.barcode, sB.id);
  check("T5d B'deki top hedef B → needsRemoveConfirm", t3.kind === "needsRemoveConfirm" && t3.from.sackId === sB.id, t3.kind);
  const sel = await scan(c, sh, sA.sackNo, null);
  check("T5e sevkiyatın kendi çuval kodu → sackSelected (K7)", sel.kind === "sackSelected" && sel.sackId === sA.id, JSON.stringify(sel));
  const nf = await scan(c, sh, `${TAG}-YOK`, null);
  check("T5f bilinmeyen barkod → rejected NOT_FOUND", nf.kind === "rejected" && nf.reason === "NOT_FOUND", JSON.stringify(nf));
}

async function t6t7t8Rejections(c: Ctx): Promise<void> {
  const shA = await open(c, c.custA);
  const shOther = await open(c, c.custA);
  const base = await mkRoll(c, 10, null, RollStatus.WAREHOUSE); // sevkiyatın deposu buradan doğar
  await scan(c, shA, base.barcode, null);
  const inOther = await mkRoll(c, 11, null, RollStatus.WAREHOUSE);
  await scan(c, shOther, inOther.barcode, null);
  const pooled = await mkRoll(c, 12, null, RollStatus.WAREHOUSE);
  const pool = await prisma.sack.create({ data: { sackNo: `${TAG}-HAVUZ`, customerId: c.custA, warehouseId: c.wh }, select: { id: true } });
  made.sacks.push(pool.id);
  await prisma.roll.update({ where: { id: pooled.id }, data: { sackId: pool.id } });
  const far = await mkRoll(c, 13, null, RollStatus.WAREHOUSE, c.wh2);
  const before = await counts(c);
  const rj = async (b: string) => { const o = await scan(c, shA, b, null); return o.kind === "rejected" ? o.reason : o.kind; };
  const got = [await rj(inOther.barcode), await rj(pooled.barcode), await rj(far.barcode)];
  check("T6a ⭐ başka sevkiyat · havuz çuvalı · başka depo → ROLL_IN_OTHER_SHIPMENT · ROLL_IN_POOL_SACK · WAREHOUSE_MISMATCH", got.join(",") === "ROLL_IN_OTHER_SHIPMENT,ROLL_IN_POOL_SACK,WAREHOUSE_MISMATCH", got.join(","));
  check("T6b retlerde yazım yok (sevkiyat/birim/bağlı top sayıları sabit)", (await counts(c)) === before, `${before} → ${await counts(c)}`);
  // T7 sahiplik
  const ownB = await mkRoll(c, 14, c.custB, RollStatus.WAREHOUSE);
  const woB = await mkRoll(c, 15, null, RollStatus.WAREHOUSE);
  const free = await mkRoll(c, 16, null, RollStatus.WAREHOUSE);
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, width: 150, targetItemId: c.fabric, customerId: c.custB }, select: { id: true } });
  made.wos.push(wo.id);
  const batch = await prisma.batch.create({ data: { batchNumber: `${TAG}-P`, workOrderId: wo.id }, select: { id: true } });
  await prisma.roll.update({ where: { id: woB.id }, data: { batchId: batch.id } });
  check("T7a emanet sahibi B olan top A sevkiyatına → OWNER_MISMATCH", (await rj(ownB.barcode)) === "OWNER_MISMATCH");
  check("T7b ⭐ sahipsiz ama iş emri carisi B → OWNER_MISMATCH (K2)", (await rj(woB.barcode)) === "OWNER_MISMATCH");
  check("T7c ikisi de boş → added", (await rj(free.barcode)) === "added");
  const ids = [ownB.id, woB.id, free.id];
  const sqlRows = await prisma.$queryRaw<{ id: string; eff: string | null }[]>`SELECT r.id, ${effectiveRollCustomerSql("r")} AS eff FROM rolls r WHERE r.id IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))})`;
  const jsOk = [ { id: ownB.id, js: effectiveRollCustomer({ ownerCustomerId: c.custB, workOrderCustomerId: null }) }, { id: woB.id, js: effectiveRollCustomer({ ownerCustomerId: null, workOrderCustomerId: c.custB }) }, { id: free.id, js: effectiveRollCustomer({ ownerCustomerId: null, workOrderCustomerId: null }) } ]
    .every((x) => sqlRows.find((s) => s.id === x.id)?.eff === x.js);
  check("T7d sahiplik SQL ikizi = JS yüklemi (boğaz-ikiz)", jsOk, JSON.stringify(sqlRows));
  // T8 hazırlık
  const raw = await mkRoll(c, 17, null, RollStatus.STOCK);
  const b8 = await counts(c);
  const n1 = await scan(c, shA, raw.barcode, null);
  check("T8a STOCK top → needsNotReadyConfirm (stageLabel), yazım yok", n1.kind === "needsNotReadyConfirm" && n1.reason === "ROLL_NOT_READY" && n1.stageLabel === "Ham (işlenmemiş)" && (await counts(c)) === b8, JSON.stringify(n1));
  const n2 = await scan(c, shA, raw.barcode, null, { confirmNotReady: true });
  check("T8b confirmNotReady → added", n2.kind === "added");
  const tambur = await mkRoll(c, 18, null, RollStatus.IN_PRODUCTION);
  const n3 = await scan(c, shA, tambur.barcode, null);
  const n4 = await scan(c, shA, tambur.barcode, null, { confirmNotReady: true });
  check("T8c ⭐ IN_PRODUCTION → ROLL_NOT_PHYSICAL, confirmNotReady ile de (K1)", n3.kind === "rejected" && n3.reason === "ROLL_NOT_PHYSICAL" && n4.kind === "rejected" && n4.reason === "ROLL_NOT_PHYSICAL", `${n3.kind}/${n4.kind}`);
}

async function t9Weight(c: Ctx): Promise<void> {
  const sh = await open(c, c.custA);
  const r = await mkRoll(c, 25, null, RollStatus.WAREHOUSE);
  const s = await newSack(c, sh);
  await scan(c, sh, r.barcode, s.id);
  const kinds = async () => (await prisma.sackWeighing.findMany({ where: { sackId: s.id }, orderBy: { createdAt: "asc" }, select: { kind: true } })).map((k) => k.kind).join(",");
  await shippingService.setSackWeightInShipment(sh, s.id, { weightKg: 12.5 }, { userId: c.adminId, permissions: [] });
  const w1 = await prisma.sack.findUniqueOrThrow({ where: { id: s.id }, select: { weightKg: true, weightSource: true } });
  check("T9a kg 12.5 → weightKg, weightSource MANUAL, SackWeighing WEIGHED", Number(w1.weightKg) === 12.5 && w1.weightSource === "MANUAL" && (await kinds()) === "WEIGHED", `${w1.weightKg} ${w1.weightSource} ${await kinds()}`);
  await shippingService.setSackWeightInShipment(sh, s.id, { weightKg: 13 }, { userId: c.adminId, permissions: [] });
  await shippingService.setSackWeightInShipment(sh, s.id, { weightKg: 13 }, { userId: c.adminId, permissions: [] });
  check("T9b 13 → REWEIGHED; aynı 13 tekrar → defter satırı yazılmaz (durum-idempotent)", (await kinds()) === "WEIGHED,REWEIGHED", await kinds());
  const r2 = await mkRoll(c, 26, null, RollStatus.WAREHOUSE);
  await scan(c, sh, r2.barcode, s.id);
  const w2 = await prisma.sack.findUniqueOrThrow({ where: { id: s.id }, select: { weightKg: true, labelDirty: true } });
  check("T9c top eklenince kg düşer (CLEARED) ve labelDirty", w2.weightKg === null && w2.labelDirty && (await kinds()).endsWith(SackWeighingKind.CLEARED), `${w2.weightKg} ${w2.labelDirty} ${await kinds()}`);
  await shippingService.setSackWeightInShipment(sh, s.id, { weightKg: 14 }, { userId: c.adminId, permissions: [] });
  const st = await shippingService.setSackWeightInShipment(sh, s.id, { weightKg: null }, { userId: c.adminId, permissions: [] });
  check("T9d null → CLEARED, state'te kg yok", (await kinds()).endsWith("WEIGHED,CLEARED") && st.state.sacks.find((x) => x.id === s.id)?.weightKg === null, await kinds());
  const r3 = await mkRoll(c, 27, null, RollStatus.WAREHOUSE);
  await scan(c, sh, r3.barcode, null);
  const bulkId = (await where(r3.id)).sackId!;
  const eb = await caught(() => shippingService.setSackWeightInShipment(sh, bulkId, { weightKg: 5 }, { userId: c.adminId, permissions: [] }));
  check("T9e dökme birime kg → 409 SACK_NOT_IN_SHIPMENT", eb.status === 409 && eb.code === "SACK_NOT_IN_SHIPMENT", `${eb.status} ${eb.code}`);
  await setSetting(SETTING_KEYS.SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED, true);
  const er = await caught(() => shippingService.setSackWeightInShipment(sh, s.id, { weightKg: 5 }, { userId: c.adminId, permissions: ["mobile:sevkiyat"] }));
  await setSetting(SETTING_KEYS.SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED, false);
  check("T9f elle tartı kısıtı açık + yetkisiz → 403 MANUAL_WEIGHT_RESTRICTED", er.status === 403 && er.code === "MANUAL_WEIGHT_RESTRICTED", `${er.status} ${er.code}`);
}

async function t10Dispatch(c: Ctx): Promise<string> {
  const sh = await open(c, c.custA);
  const empty = await newSack(c, sh);
  const full = await newSack(c, sh);
  const sackRolls = [await mkRoll(c, 40, null, RollStatus.WAREHOUSE), await mkRoll(c, 41, null, RollStatus.WAREHOUSE)];
  const loose = [await mkRoll(c, 10.5, null, RollStatus.WAREHOUSE), await mkRoll(c, 11, null, RollStatus.WAREHOUSE), await mkRoll(c, 12, null, RollStatus.WAREHOUSE)];
  for (const r of sackRolls) await scan(c, sh, r.barcode, full.id);
  for (const r of loose) await scan(c, sh, r.barcode, null);
  const lc = await caught(() => shippingService.handheldDispatch(sh, { expectedRollCount: 4 }, c.adminId));
  const still = await prisma.shipment.findUniqueOrThrow({ where: { id: sh }, select: { status: true } });
  const emptyStill = await prisma.sack.count({ where: { id: empty.id } });
  check("T10a expectedRollCount yanlış → 409 LOAD_CHANGED, yazım yok (boş çuval da yerinde)", lc.status === 409 && lc.code === "LOAD_CHANGED" && still.status === ShipmentStatus.PLANNED && emptyStill === 1, `${lc.status} ${lc.code}`);
  const d = await shippingService.handheldDispatch(sh, { expectedRollCount: 5, plateNumber: "34 HH 01" }, c.adminId);
  const st = await prisma.shipment.findUniqueOrThrow({ where: { id: sh }, select: { status: true } });
  const fullRow = await prisma.sack.findUniqueOrThrow({ where: { id: full.id }, select: { seq: true } });
  check("T10b ⭐ 2 çuval (biri boş) + 3 dökme → DISPATCHED, boş çuval düştü", st.status === ShipmentStatus.DISPATCHED && d.droppedEmptySacks.join() === empty.sackNo && (await prisma.sack.count({ where: { id: empty.id } })) === 0 && d.rollCount === 5 && d.sackCount === 1 && d.looseRollCount === 3, JSON.stringify({ ...d, state: undefined }));
  check("T10c sıra boşluğu kapandı (kalan çuval ilk sırada)", fullRow.seq !== null && fullRow.seq < (await prisma.sack.findFirstOrThrow({ where: { shipmentId: sh, unitKind: LoadUnitKind.BULK }, select: { seq: true } })).seq!, String(fullRow.seq));
  const doc = await prisma.printedDocument.findFirst({ where: { docType: PrintedDocType.SHIPMENT_DISPATCH, sourceId: sh, status: "ACTIVE" }, select: { snapshot: true, documentNo: true } });
  const totals = ((doc?.snapshot as { doc?: { totals?: Record<string, unknown> } } | null)?.doc?.totals ?? {}) as Record<string, unknown>;
  check("T10d ⭐ belge ACTIVE, totals.loadSummary === \"1 çuval (2 top) + 3 top dökme\", documentNo dönüldü", !!doc && totals.loadSummary === "1 çuval (2 top) + 3 top dökme" && d.documentNo === doc.documentNo, `${String(totals.loadSummary)} ${d.documentNo}`);
  const meters = [...sackRolls, ...loose].length && Number(totals.totalMeters);
  const allocSum = await prisma.sackAllocation.count({ where: { sack: { shipmentId: sh } } });
  check("T10e brüt: sevk metresi = top metre toplamı (40+41+10.5+11+12)", meters === 114.5 && d.state.summary.meters === 114.5, `${meters} ${d.state.summary.meters} alloc=${allocSum}`);
  const rep = await shippingService.handheldDispatch(sh, { expectedRollCount: 5 }, c.adminId);
  check("T10f aynı kullanıcı tekrar → 200 replayed", rep.replayed === true && rep.shipmentNo === d.shipmentNo);
  // Tek türlü (yalnız dökme) sevkiyatta anahtar YOK — bayt-eşitlik
  const sh2 = await open(c, c.custA);
  const one = await mkRoll(c, 9, null, RollStatus.WAREHOUSE);
  await scan(c, sh2, one.barcode, null);
  await shippingService.handheldDispatch(sh2, { expectedRollCount: 1 }, c.adminId);
  const doc2 = await prisma.printedDocument.findFirst({ where: { docType: PrintedDocType.SHIPMENT_DISPATCH, sourceId: sh2, status: "ACTIVE" }, select: { snapshot: true } });
  const t2 = ((doc2?.snapshot as { doc?: { totals?: Record<string, unknown> } } | null)?.doc?.totals ?? {}) as Record<string, unknown>;
  check("T10g ⭐ tek türlü sevkiyatın snapshot'ında loadSummary anahtarı YOK", !!doc2 && !("loadSummary" in t2), JSON.stringify(t2));
  // T6 sevk edilmiş top
  const shX = await open(c, c.custA);
  const o = await scan(c, shX, loose[0]!.barcode, null);
  check("T6c sevk edilmiş top → ROLL_SHIPPED", o.kind === "rejected" && o.reason === "ROLL_SHIPPED", JSON.stringify(o));
  return sh;
}

async function t11Races(c: Ctx): Promise<void> {
  const s1 = await open(c, c.custA);
  const s2 = await open(c, c.custA);
  const r = await mkRoll(c, 19, null, RollStatus.WAREHOUSE);
  const settle = (p: Promise<{ outcome: HandheldOutcome }>) => p.then((v) => v.outcome.kind === "rejected" ? v.outcome.reason : v.outcome.kind, (e: { details?: { code?: string } }) => e.details?.code ?? "ERR");
  const [a, b] = await Promise.all([
    settle(shippingService.scanIntoShipment(s1, { barcode: r.barcode, targetSackId: null, clientToken: randomUUID() }, c.adminId)),
    settle(shippingService.scanIntoShipment(s2, { barcode: r.barcode, targetSackId: null, clientToken: randomUUID() }, c.adminId)),
  ]);
  const w = await where(r.id);
  const okLoser = (x: string) => x === "ROLL_IN_OTHER_SHIPMENT" || x === "ROLL_TAKEN";
  check("T11a ⭐ iki sevkiyata aynı top eşzamanlı → biri added, diğeri ret/409; top tek yerde", [a, b].filter((x) => x === "added").length === 1 && [a, b].some(okLoser) && (w.shipmentId === s1 || w.shipmentId === s2), `${a}/${b}`);
  // Açık tutulan sevk tx'i: sevkiyat satırı kilitli + DISPATCHED (henüz commit değil) → okutma ön kapıyı geçer,
  // claim'de bekler, commit sonrası 409 vermeli. Claim yoksa top sevk edilmiş sevkiyata girerdi.
  const s3 = await open(c, c.custA);
  const r3 = await mkRoll(c, 23, null, RollStatus.WAREHOUSE);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((res) => { release = res; });
  const held = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${s3}::uuid FOR UPDATE`;
    await tx.shipment.update({ where: { id: s3 }, data: { status: ShipmentStatus.DISPATCHED } });
    await gate;
  }, { timeout: 20000 });
  await wait(200);
  const pScan = settle(shippingService.scanIntoShipment(s3, { barcode: r3.barcode, targetSackId: null, clientToken: randomUUID() }, c.adminId));
  await wait(400);
  release();
  await held;
  const res = await pScan;
  const w3 = await where(r3.id);
  check("T11b ⭐ sevk tx'i açıkken okutma → 409 SHIPMENT_NOT_PLANNED, top sevkiyata girmedi (yarım durum yok)", res === "SHIPMENT_NOT_PLANNED" && w3.shipmentId === null, `${res} ${w3.shipmentId}`);
}

async function t12Cancel(c: Ctx, dispatchedId: string): Promise<void> {
  const sh = await open(c, c.custA);
  const s = await newSack(c, sh);
  const [a, b] = [await mkRoll(c, 31, null, RollStatus.WAREHOUSE), await mkRoll(c, 32, null, RollStatus.WAREHOUSE)];
  await scan(c, sh, a.barcode, s.id);
  await scan(c, sh, b.barcode, null);
  const bulkId = (await where(b.id)).sackId!;
  await shippingService.cancelShipment(sh, c.adminId);
  const sk = await prisma.sack.findUniqueOrThrow({ where: { id: s.id }, select: { shipmentId: true, dissolvedAt: true } });
  const bk = await prisma.sack.findUniqueOrThrow({ where: { id: bulkId }, select: { dissolvedAt: true } });
  const wb = await where(b.id);
  check("T12a karışık PLANNED iptal → dökme çözülür, çuval havuza döner, dökme topu rafta", bk.dissolvedAt !== null && sk.shipmentId === null && sk.dissolvedAt === null && wb.sackId === null && wb.shipmentId === null, JSON.stringify({ sk, bk, wb }));
  await shippingService.undoDispatch(dispatchedId, `${TAG} storno`, c.adminId, { releaseSacks: true });
  const left = await prisma.roll.count({ where: { id: { in: made.rolls }, shipmentId: dispatchedId } });
  const shipped = await prisma.roll.count({ where: { id: { in: made.rolls }, status: RollStatus.SHIPPED, shipment: { id: dispatchedId } } });
  check("T12b karışık sevkiyat storno → toplar sevkiyattan çıktı (rafta)", left === 0 && shipped === 0, `${left}/${shipped}`);
}

async function httpUser(c: Ctx): Promise<string> {
  const parola = kosumaOzguParola();
  const perm = await prisma.permission.findUniqueOrThrow({ where: { code: "mobile:sevkiyat" }, select: { id: true } });
  const u = await prisma.user.create({
    data: { username: `${TAG}-svk`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 4), fullName: `${TAG} sevk`, isActive: true, permissions: { create: [{ permissionId: perm.id, grantedById: c.adminId }] } },
    select: { id: true, username: true },
  });
  made.users.push(u.id);
  const lg = await fetch(`${c.base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u.username, password: parola, clientType: "mobile" }) });
  return ((await lg.json()) as { data?: { token?: string } }).data?.token ?? "";
}

type HttpRes = { status: number; data: Record<string, unknown> & { state?: { shipment: { id: string }; summary: { rollCount: number } } }; code?: string };
function http(c: Ctx, token: string) {
  return async (method: string, p: string, body?: unknown): Promise<HttpRes> => {
    const r = await fetch(`${c.base}/api/shipping${p}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const j = (await r.json().catch(() => ({}))) as { data?: HttpRes["data"]; details?: { code?: string } };
    return { status: r.status, data: j.data ?? {}, code: j.details?.code };
  };
}

async function t13Http(c: Ctx, token: string): Promise<void> {
  const call = http(c, token);
  const a1 = await call("POST", "/shipments/handheld", { customerId: c.custA, clientToken: randomUUID() });
  const shId = (a1.data as { shipment?: { id: string } }).shipment?.id ?? "";
  const a2 = await call("GET", `/shipments/${shId}/handheld`);
  const a4 = await call("POST", `/shipments/${shId}/sacks`, { clientToken: randomUUID() });
  const sack = (a4.data as { sack?: { id: string } }).sack?.id ?? "";
  const r = await mkRoll(c, 28, null, RollStatus.WAREHOUSE);
  const a3 = await call("POST", `/shipments/${shId}/scan`, { barcode: r.barcode, targetSackId: sack, clientToken: randomUUID() });
  const a5 = await call("PUT", `/shipments/${shId}/sacks/${sack}/weight`, { weightKg: 7.25 });
  const strict = await call("POST", `/shipments/${shId}/scan`, { barcode: r.barcode, targetSackId: null, clientToken: randomUUID(), extra: 1 });
  const a6 = await call("POST", `/shipments/${shId}/handheld-dispatch`, { expectedRollCount: 1, plateNumber: null, driverName: null });
  const got = [a1.status, a2.status, a4.status, a3.status, a5.status, a6.status].join(",");
  check("T13a ⭐ yalnız mobile:sevkiyat → A1 201 · A2 200 · A4 201 · A3 200 · A5 200 · A6 200", token.length > 0 && got === "201,200,201,200,200,200", got);
  check("T13b A3 gövdesi { outcome, state }", (a3.data as { outcome?: { kind: string } }).outcome?.kind === "added" && !!a3.data.state, JSON.stringify(a3.data).slice(0, 120));
  check("T13c strict gövde: bilinmeyen alan → 400", strict.status === 400, `${strict.status}`);
  const st = await call("POST", `/shipments/${shId}/undo-dispatch`, { reason: `${TAG} deneme` });
  check("T13d SoD: storno 403", st.status === 403, `${st.status}`);
  await setSetting(SETTING_KEYS.SHIPMENT_HANDHELD_CREATE_ENABLED, false);
  const off = await call("GET", `/shipments/${shId}/handheld`);
  await setSetting(SETTING_KEYS.SHIPMENT_HANDHELD_CREATE_ENABLED, true);
  check("T1d HTTP: bayrak kapalı → 403 details.code HANDHELD_DISABLED", off.status === 403 && off.code === "HANDHELD_DISABLED", `${off.status} ${off.code}`);
}

async function t14List(c: Ctx, token: string): Promise<void> {
  const call = http(c, token);
  const emptyId = await open(c, c.custB);
  const list = async (q: string) => (await fetch(`${c.base}/api/shipping/shipments?${q}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())) as { data: Array<{ id: string; customer: { name: string } }>; pagination?: { nextCursor: string | null } };
  const q0 = `search=${encodeURIComponent(TAG)}&status=PLANNED&limit=200&cursor=`;
  const all = (await list(q0)).data.map((x) => x.id);
  const filtered = (await list(`${q0}&hasRolls=true`)).data.map((x) => x.id);
  check("T14a hasRolls=true boş PLANNED'ı gizler; parametresiz görünür (K4 varsayılanı)", all.includes(emptyId) && !filtered.includes(emptyId), `${all.length}/${filtered.length}`);
  for (const dir of ["asc", "desc"] as const) {
    const full = (await list(`search=${encodeURIComponent(TAG)}&sortBy=customerName&sortOrder=${dir}&limit=200&cursor=`)).data;
    const paged: string[] = [];
    let cursor = "";
    for (let i = 0; i < 100; i++) {
      const page = await list(`search=${encodeURIComponent(TAG)}&sortBy=customerName&sortOrder=${dir}&limit=2&cursor=${encodeURIComponent(cursor)}`);
      paged.push(...page.data.map((x) => x.id));
      if (!page.pagination?.nextCursor) break;
      cursor = page.pagination.nextCursor;
    }
    const names = full.map((x) => x.customer.name);
    const sorted = names.every((n, i) => i === 0 || (dir === "asc" ? names[i - 1]! <= n : names[i - 1]! >= n));
    check(`T14b customerName ${dir} + cursor (sayfa 2) → tekrar/atlama yok, sıralı`, full.length >= 3 && sorted && paged.join() === full.map((x) => x.id).join(), `${full.length}/${paged.length}`);
  }
  void call;
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const rollIds = made.rolls;
  const shipIds = (await prisma.shipment.findMany({ where: { customerId: { in: made.customers } }, select: { id: true } })).map((s) => s.id);
  const sackIds = [...new Set([...made.sacks, ...(await prisma.sack.findMany({ where: { OR: [{ shipmentId: { in: shipIds } }, { customerId: { in: made.customers } }] }, select: { id: true } })).map((s) => s.id)])];
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } }).catch(swallow);
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipIds } } }).catch(swallow);
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipIds } } }).catch(swallow);
  await prisma.rollReturn.deleteMany({ where: { OR: [{ fromShipmentId: { in: shipIds } }, { rollId: { in: rollIds } }] } }).catch(swallow);
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null, batchId: null } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "warehouseMovement", "rollVariance", "rollStatusEvent"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { sackId: { in: sackIds } } }).catch(swallow);
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch((e) => console.error("temizlik sack:", (e as Error).message));
  await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipIds } } }).catch(swallow);
  await prisma.shipment.deleteMany({ where: { id: { in: shipIds } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: made.wos } } }).catch(swallow);
  await prisma.workOrderEvent.deleteMany({ where: { workOrderId: { in: made.wos } } }).catch(swallow);
  await prisma.workOrder.deleteMany({ where: { id: { in: made.wos } } }).catch((e) => console.error("temizlik wo:", (e as Error).message));
  const accIds = (await prisma.cariAccount.findMany({ where: { customerId: { in: made.customers } }, select: { id: true } })).map((a) => a.id);
  await prisma.cariHold.deleteMany({ where: { cariId: { in: accIds } } }).catch(swallow);
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } }).catch(swallow);
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  await prisma.warehouse.deleteMany({ where: { id: { in: made.warehouses } } }).catch((e) => console.error("temizlik depo:", (e as Error).message));
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...shipIds, ...sackIds] } } }).catch(swallow);
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(swallow);
  await prisma.user.updateMany({ where: { id: { in: made.users } }, data: { isActive: false } }).catch(swallow);
}

async function setup(base: string): Promise<Ctx> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.SHIPMENT_HANDHELD_CREATE_ENABLED } });
  await setSetting(SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED, true);
  await setSetting(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, false);
  await setSetting(SETTING_KEYS.SHIPPING_WEIGH_REQUIRED_ENABLED, false);
  await setSetting(SETTING_KEYS.SHIPPING_MANUAL_WEIGHT_RESTRICTED_ENABLED, false);
  await setSetting(SETTING_KEYS.EMANET_ENABLED, true);
  await setSetting(SETTING_KEYS.FINANCE_ENABLED, false);
  const cust = async (k: string, name: string) => (await prisma.customer.create({ data: { code: `${TAG}-${k}`, name: `${TAG} ${name}` }, select: { id: true } })).id;
  const [custA, custB, custC] = [await cust("A", "Alfa"), await cust("B", "Beta"), await cust("C", "Gama")];
  made.customers.push(custA, custB, custC);
  const fabric = (await prisma.item.create({ data: { code: `${TAG}-K`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(fabric);
  const wh2 = (await prisma.warehouse.create({ data: { code: `${TAG}-D2`.slice(0, 32), name: `${TAG} depo 2` }, select: { id: true } })).id;
  made.warehouses.push(wh2);
  return { adminId: admin.id, wh: await fixtureWarehouseId(), wh2, custA, custB, custC, fabric, base };
}

async function run(base: string): Promise<void> {
  const c = await setup(base);
  await t1Flag(c);
  await t2Open(c);
  await t3t15LooseAndRetry(c);
  await t4t5SacksAndTransfer(c);
  await t6t7t8Rejections(c);
  await t9Weight(c);
  const dispatched = await t10Dispatch(c);
  await t11Races(c);
  await t12Cancel(c, dispatched);
  const token = await httpUser(c);
  await t13Http(c, token);
  await t14List(c, token);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== EL TERMİNALİ SEVKİYAT v2 BEKÇİSİ (B1) ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTINGS] } }, select: { key: true, value: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    server.close();
    stopNotificationJobs();
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

void main();
