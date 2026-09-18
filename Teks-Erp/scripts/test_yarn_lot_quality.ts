// =============================================================================
// BEKÇİ — İPLİK LOTU KALİTE BEKLETME / KARANTİNA (`goodsReceipt.yarnQualityHoldEnabled`, 2026-09-18)
// =============================================================================
//   §0 statik — şema varsayılanı RELEASED · bayrak satırı yokken false · kapı kümesi TAM {OUT, WARP_ISSUE,
//      SUBCONTRACT_OUT} · kapı tek yazarın (`applyYarnMovementTx`) içinde, kimlikten SONRA · resolver ticaret+iplik okur
//   §1 ⭐ DEFAULT = BUGÜNKÜ DAVRANIŞ: satır YOK ↔ `false` — mal kabul lotu RELEASED doğar, ON_HOLD lottan bile çıkış geçer
//   §2 bayrak AÇIK: mal kabul lotu ON_HOLD doğar (damgasız) · elle lot RELEASED · OUT / WARP_ISSUE / SUBCONTRACT_OUT
//      → 400 YARN_LOT_ON_HOLD (levent PLANNED kalır, hareket yok) · IN ve fiş iptali (ADJUST_OUT) serbest
//   §3 karar ucu: RELEASED damga (tarih + veren + not) → çıkış geçer · BLOCKED "bloke" 400 · audit UPDATE YARN_LOT
//      `changes[qualityStatus]` · pasif lot 400 YARN_LOT_INACTIVE · yok 404 · karar bayraktan BAĞIMSIZ yazılır
//   §4 liste `qualityStatus` süzgeci (CSV) · DTO dört alan · tablet bağlamı `yarnLots[].qualityStatus` + `yarnQualityHold`
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-18, dördü de kırmızı): ① `ensureYarnLotTx`te `onHold` sabit `false` → §2a ❌ (+ zincirleme
//    §2c/§2d/§2e/§3c: lot serbest doğunca kapı da ısırmaz) · ② `applyYarnMovementTx`ten `assertLotQualityReleasedTx` çağrısı
//    silinince → §0d + §2c/§2d/§2e/§3d ❌ · ③ kapı kümesinden `SUBCONTRACT_OUT` düşünce → §0b + §2e ❌ · ④ resolver bayrağı
//    okumayıp sabit `true` dönünce → §0e + §1a/§1b/§1c + §3g/§4d ❌ (varsayılan artık bugünkü davranış değil).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar (ticaret · iplik · devere · kalite bekletme) FOTOĞRAFINA döner;
//    defter silmeleri yalnız `finally` (temizle). Fason çıkışı kapıda DÜŞER — `dispatchItemId` CHECK'ine hiç ulaşmaz.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Prisma, StationType, WarpBeamOrigin, WarpKgSource, YarnLotQualityStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS, readGoodsReceiptYarnQualityHoldEnabled, resolveYarnQualityHoldEnabled } from "../src/services/system-setting.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { getWarpBeamTabletContext } from "../src/services/warp-beam-tablet.service";
import { applyYarnMovementTx, yarnService } from "../src/services/yarn.service";
import { yarnLotService } from "../src/services/yarn-lot.service";
import { YARN_LOT_QUALITY_GATED_KINDS } from "../src/services/helpers/yarn-lot.helper";
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
type Ayrinti = { code?: string; lotId?: string; lotNo?: string; qualityStatus?: string };
const ayrinti = (e: AppError | null): Ayrinti => (e?.details as Ayrinti | undefined) ?? {};
const kod = (e: AppError | null): string => String(ayrinti(e).code ?? e?.statusCode ?? "geçti");

const TAG = `TEST-LOTK-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const FLAGS = [SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.GOODS_RECEIPT_YARN_QUALITY_HOLD_ENABLED];
const HOLD = SETTING_KEYS.GOODS_RECEIPT_YARN_QUALITY_HOLD_ENABLED;
type ReceiptRes = { data: { id: string } };
const fisId = (r: unknown): string => (r as ReceiptRes).data.id;
const lotOku = (id: string) => prisma.yarnLot.findUniqueOrThrow({ where: { id }, select: { qualityStatus: true, qualityDecidedAt: true, qualityDecidedById: true, qualityNote: true, lotNo: true } });
const elleCikis = (itemId: string, warehouseId: string, lotId: string) => yarnService.createMovement({ itemId, warehouseId, kind: YarnMovementKind.OUT, qtyKg: 1, lotId, reason: "kalite sondası" });
async function auditBekle(recordId: string): Promise<{ changes: unknown; newData: unknown } | null> {
  for (let i = 0; i < 20; i++) {
    const row = await prisma.systemLog.findFirst({ where: { tableName: "YARN_LOT", recordId, action: "UPDATE", changes: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, select: { changes: true, newData: true } });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

function statik(): void {
  console.log("── §0 Statik ──");
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
  check("§0a şema: `qualityStatus` varsayılanı RELEASED (eski lotlar serbest okunur)", /qualityStatus\s+YarnLotQualityStatus\s+@default\(RELEASED\)/.test(schema));
  const helper = readFileSync(path.join(ROOT, "src/services/helpers/yarn-lot.helper.ts"), "utf8");
  check("§0b kapı kümesi TAM: OUT · WARP_ISSUE · SUBCONTRACT_OUT (3 tür, giriş/iade/storno dışarıda)", YARN_LOT_QUALITY_GATED_KINDS.size === 3 && [YarnMovementKind.OUT, YarnMovementKind.WARP_ISSUE, YarnMovementKind.SUBCONTRACT_OUT].every((k) => YARN_LOT_QUALITY_GATED_KINDS.has(k)));
  check("§0c kapı bayrağı yalnız resolver'dan okur (`resolveYarnQualityHoldEnabled`), ham okuyucu helper'da YOK", /resolveYarnQualityHoldEnabled\(tx\)/.test(helper) && !/readGoodsReceiptYarnQualityHoldEnabled/.test(helper));
  const yarnSvc = readFileSync(path.join(ROOT, "src/services/yarn.service.ts"), "utf8");
  const kimlik = yarnSvc.indexOf("await assertLotMatchesItemTx(tx, input.lotId, input.itemId)");
  const kapi = yarnSvc.indexOf("await assertLotQualityReleasedTx(tx, input.lotId, input.kind)");
  const yazim = yarnSvc.indexOf("tx.yarnMovement.create({");
  check("§0d kapı TEK YAZARIN içinde, kimlikten SONRA ve yazımdan ÖNCE (yeni çağıran kapısız doğamaz)", kimlik > 0 && kapi > kimlik && yazim > kapi, `${kimlik}<${kapi}<${yazim}`);
  const sys = readFileSync(path.join(ROOT, "src/services/system-setting.service.ts"), "utf8");
  const govde = sys.slice(sys.indexOf("export async function resolveYarnQualityHoldEnabled"), sys.indexOf("export async function resolveYarnQualityHoldEnabled") + 400);
  check("§0e resolver = ticaret ∧ iplik ∧ bayrak (modül kapalıyken kapı KOŞMAZ)", /readTicaretEnabled\(tx\)/.test(govde) && /readIplikEnabled\(tx\)/.test(govde) && /readGoodsReceiptYarnQualityHoldEnabled\(tx\)/.test(govde));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== İPLİK LOTU KALİTE BEKLETME BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const setHold = async (v: boolean | null) => {
    if (v === null) await prisma.systemSetting.deleteMany({ where: { key: HOLD } });
    else await prisma.systemSetting.upsert({ where: { key: HOLD }, create: { key: HOLD, value: v }, update: { value: v } });
  };
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 1000 }, select: { id: true } });
  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} depo` }, select: { id: true } });
  const st = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
  const mk = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-M1`, code: `${TAG}-M1`.slice(0, 32) }, select: { id: true } });
  const supplier = await prisma.customer.create({ data: { code: `${TAG}-TED`, name: `${TAG} tedarikçi`, type: "SUPPLIER" }, select: { id: true } });
  // Karar veren: kendi fikstürü (iş anahtarı `username`), ortamdan kullanıcı ARANMAZ (test_keyfi_arama).
  const karar = await prisma.user.create({ data: { username: `${TAG}-kalite`.toLowerCase(), fullName: `${TAG} kalite`, passwordHash: await bcrypt.hash("test123", 4), isActive: true }, select: { id: true } });
  const receiptIds: string[] = [];
  try {
    for (const key of FLAGS.slice(0, 3)) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "true" }, update: { value: "true" } });

    console.log("\n── §1 ⭐ DEFAULT = bugünkü davranış ──");
    await setHold(null);
    check("§1a bayrak satırı YOK → okuyucu false, etkin değer false", (await readGoodsReceiptYarnQualityHoldEnabled()) === false && (await resolveYarnQualityHoldEnabled()) === false);
    const r1 = fisId(await goodsReceiptService.create({ warehouseId: wh.id, supplierId: supplier.id, deliveryNoteNo: `${TAG}-IRS1`, lines: [{ itemId: yarn.id, initialQty: 100, lotNo: "KAP-1" }] }));
    receiptIds.push(r1);
    const lot1 = await prisma.yarnLot.findUniqueOrThrow({ where: { itemId_lotNo: { itemId: yarn.id, lotNo: "KAP-1" } }, select: { id: true, qualityStatus: true, qualityDecidedAt: true } });
    check("§1b bayrak yokken mal kabul lotu RELEASED doğar, damga yok", lot1.qualityStatus === YarnLotQualityStatus.RELEASED && lot1.qualityDecidedAt === null);
    await prisma.yarnLot.update({ where: { id: lot1.id }, data: { qualityStatus: YarnLotQualityStatus.ON_HOLD } });
    const gecti1 = await beklenenHata(() => elleCikis(yarn.id, wh.id, lot1.id));
    await setHold(false);
    const gecti2 = await beklenenHata(() => elleCikis(yarn.id, wh.id, lot1.id));
    check("§1c satır YOK ↔ `false`: ON_HOLD lottan bile çıkış GEÇER (kapı yok) — iki yanıt birebir", gecti1 === null && gecti2 === null, `${kod(gecti1)} ↔ ${kod(gecti2)}`);
    await prisma.yarnLot.update({ where: { id: lot1.id }, data: { qualityStatus: YarnLotQualityStatus.RELEASED } });

    console.log("\n── §2 Bayrak AÇIK: doğuş + kapı ──");
    await setHold(true);
    check("§2 zemin: etkin değer true", (await resolveYarnQualityHoldEnabled()) === true);
    const r2 = fisId(await goodsReceiptService.create({ warehouseId: wh.id, supplierId: supplier.id, deliveryNoteNo: `${TAG}-IRS2`, lines: [{ itemId: yarn.id, initialQty: 100, lotNo: "KAP-2" }] }));
    receiptIds.push(r2);
    const lot2 = await prisma.yarnLot.findUniqueOrThrow({ where: { itemId_lotNo: { itemId: yarn.id, lotNo: "KAP-2" } }, select: { id: true, qualityStatus: true, qualityDecidedAt: true, qualityDecidedById: true } });
    check("§2a ⭐ mal kabulde doğan lot ON_HOLD, karar damgası BOŞ (henüz karar yok)", lot2.qualityStatus === YarnLotQualityStatus.ON_HOLD && lot2.qualityDecidedAt === null && lot2.qualityDecidedById === null);
    const elle = await yarnLotService.create({ itemId: yarn.id, lotNo: "ELLE-K" });
    check("§2b elle açılan lot RELEASED doğar (bekletme yalnız mal kabul doğuşuna)", elle.data.qualityStatus === YarnLotQualityStatus.RELEASED);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: 10, lotId: elle.data.id, reason: "kalite sondası zemin" }));
    const e2c = await beklenenHata(() => elleCikis(yarn.id, wh.id, lot2.id));
    check("§2c ⭐ OUT → 400 YARN_LOT_ON_HOLD; details lotId/lotNo/qualityStatus", kod(e2c) === "YARN_LOT_ON_HOLD" && ayrinti(e2c).lotId === lot2.id && ayrinti(e2c).lotNo === "KAP-2" && ayrinti(e2c).qualityStatus === "ON_HOLD" && e2c?.statusCode === 400, JSON.stringify(ayrinti(e2c)));
    const beam = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.IN_HOUSE });
    const e2d = await beklenenHata(() => windWarpBeam(beam.data.id, { lengthM: 100, kgSource: WarpKgSource.WEIGHED, machineId: mk.id, yarnIssues: [{ warehouseId: wh.id, qtyKg: 10, lotId: lot2.id }] }));
    check("§2d ⭐ WARP_ISSUE (levent sarımı) → 400 YARN_LOT_ON_HOLD; tx geri: levent PLANNED, hareket yok", kod(e2d) === "YARN_LOT_ON_HOLD" && (await prisma.warpBeam.findUnique({ where: { id: beam.data.id }, select: { status: true } }))?.status === "PLANNED" && (await prisma.yarnMovement.count({ where: { warpBeamId: beam.data.id } })) === 0, kod(e2d));
    const e2e = await beklenenHata(() => prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.SUBCONTRACT_OUT, qtyKg: 1, lotId: lot2.id })));
    check("§2e ⭐ SUBCONTRACT_OUT → 400 YARN_LOT_ON_HOLD (kapı fason CHECK'inden önce)", kod(e2e) === "YARN_LOT_ON_HOLD", kod(e2e));
    const r2b = fisId(await goodsReceiptService.create({ warehouseId: wh.id, supplierId: supplier.id, deliveryNoteNo: `${TAG}-IRS2B`, lines: [{ itemId: yarn.id, initialQty: 5, lotNo: "KAP-2" }] }));
    receiptIds.push(r2b);
    check("§2f IN (ikinci fiş aynı lota) SERBEST — giriş kapıya takılmaz", (await prisma.yarnMovement.count({ where: { goodsReceiptId: r2b, kind: YarnMovementKind.IN, lotId: lot2.id } })) === 1);
    await goodsReceiptService.cancel(r2b, "kalite sondası");
    check("§2g fiş iptali (ADJUST_OUT) SERBEST — storno bekletmeden etkilenmez", (await prisma.yarnMovement.count({ where: { goodsReceiptId: r2b, kind: YarnMovementKind.ADJUST_OUT } })) === 1);
    const gecti = await beklenenHata(() => elleCikis(yarn.id, wh.id, elle.data.id));
    check("§2h RELEASED lottan çıkış geçer (bayrak açıkken de)", gecti === null, kod(gecti));

    console.log("\n── §3 Karar ucu ──");
    const s3 = await yarnLotService.decideQuality(lot2.id, { status: YarnLotQualityStatus.RELEASED, note: "  numune uygun  " }, karar.id);
    const l3 = await lotOku(lot2.id);
    check("§3a RELEASED kararı: damga (tarih + veren), not TRIM; DTO aynı dört alanı taşır", l3.qualityStatus === "RELEASED" && l3.qualityDecidedAt !== null && l3.qualityDecidedById === karar.id && l3.qualityNote === "numune uygun" && s3.data.qualityStatus === "RELEASED" && s3.data.qualityNote === "numune uygun" && s3.data.qualityDecidedAt !== null);
    check("§3b serbest bırakılan lottan çıkış GEÇER", (await beklenenHata(() => elleCikis(yarn.id, wh.id, lot2.id))) === null);
    const audit = await auditBekle(lot2.id);
    const chg = (audit?.changes as Array<{ field: string; old: unknown; new: unknown }> | null) ?? [];
    check("§3c audit UPDATE YARN_LOT `changes` qualityStatus ON_HOLD → RELEASED, newData note+decidedAt", chg.some((c) => c.field === "qualityStatus" && c.old === "ON_HOLD" && c.new === "RELEASED") && (audit?.newData as { note?: string; decidedAt?: unknown })?.note === "numune uygun" && !!(audit?.newData as { decidedAt?: unknown })?.decidedAt, JSON.stringify(audit));
    await yarnLotService.decideQuality(lot2.id, { status: YarnLotQualityStatus.BLOCKED }, karar.id);
    const e3d = await beklenenHata(() => elleCikis(yarn.id, wh.id, lot2.id));
    check("§3d BLOCKED: çıkış 400 YARN_LOT_ON_HOLD, qualityStatus BLOCKED, mesaj 'bloke'; not TEMİZLENDİ (karar başına)", kod(e3d) === "YARN_LOT_ON_HOLD" && ayrinti(e3d).qualityStatus === "BLOCKED" && /bloke/.test(String(e3d?.message)) && (await lotOku(lot2.id)).qualityNote === null);
    await yarnLotService.update(elle.data.id, { isActive: false });
    const e3e = await beklenenHata(() => yarnLotService.decideQuality(elle.data.id, { status: YarnLotQualityStatus.ON_HOLD }));
    check("§3e pasif lota karar → 400 YARN_LOT_INACTIVE (durum DEĞİŞMEDİ)", kod(e3e) === "YARN_LOT_INACTIVE" && (await lotOku(elle.data.id)).qualityStatus === "RELEASED");
    await yarnLotService.update(elle.data.id, { isActive: true });
    check("§3f olmayan lot → 404", (await beklenenHata(() => yarnLotService.decideQuality("00000000-0000-4000-8000-000000000000", { status: YarnLotQualityStatus.RELEASED })))?.statusCode === 404);
    await setHold(false);
    await yarnLotService.decideQuality(elle.data.id, { status: YarnLotQualityStatus.ON_HOLD, note: "bayrak kapalıyken" });
    check("§3g karar bayraktan BAĞIMSIZ yazılır (durum), ama kapı KAPALI: ON_HOLD lottan çıkış geçer", (await lotOku(elle.data.id)).qualityStatus === "ON_HOLD" && (await beklenenHata(() => elleCikis(yarn.id, wh.id, elle.data.id))) === null);
    await setHold(true);

    console.log("\n── §4 Süzgeç · DTO · tablet bağlamı ──");
    const onHold = await yarnLotService.list({ itemId: yarn.id, qualityStatus: [YarnLotQualityStatus.ON_HOLD], limit: 50 });
    const blocked = await yarnLotService.list({ itemId: yarn.id, qualityStatus: [YarnLotQualityStatus.BLOCKED, YarnLotQualityStatus.ON_HOLD], limit: 50 });
    check("§4a liste `qualityStatus` süzgeci: ON_HOLD → yalnız ELLE-K; [BLOCKED,ON_HOLD] → KAP-2 + ELLE-K", onHold.data.length === 1 && onHold.data[0]!.lotNo === "ELLE-K" && blocked.data.length === 2 && blocked.data.every((l) => l.qualityStatus !== "RELEASED"), `${onHold.data.length}/${blocked.data.length}`);
    const hepsi = await yarnLotService.list({ itemId: yarn.id, limit: 50 });
    check("§4b süzgeçsiz liste hepsini döner ve her satır dört kalite alanını taşır", hepsi.data.length === 3 && hepsi.data.every((l) => "qualityStatus" in l && "qualityDecidedAt" in l && "qualityDecidedById" in l && "qualityNote" in l));
    const ctx = await getWarpBeamTabletContext();
    const ctxLot = ctx.data.yarnLots.find((l) => l.id === lot2.id);
    check("§4c tablet bağlamı: `yarnLots[].qualityStatus` (KAP-2 BLOCKED) + `yarnQualityHold: true`", ctxLot?.qualityStatus === "BLOCKED" && ctx.data.yarnQualityHold === true);
    await setHold(false);
    check("§4d bayrak kapalı: `yarnQualityHold: false` (rozet kararı sunucudan)", (await getWarpBeamTabletContext()).data.yarnQualityHold === false);
  } finally {
    await temizle({ yarnId: yarn.id, specId: spec.id, whId: wh.id, mkId: mk.id, stId: st.id, supplierId: supplier.id, userId: karar.id, receiptIds, foto });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(f: { yarnId: string; specId: string; whId: string; mkId: string; stId: string; supplierId: string; userId: string; receiptIds: string[]; foto: Array<{ key: string; value: Prisma.JsonValue }> }): Promise<void> {
  await prisma.yarnMovement.deleteMany({ where: { itemId: f.yarnId } });
  await prisma.yarnStock.deleteMany({ where: { itemId: f.yarnId } });
  await prisma.warpBeamEvent.deleteMany({ where: { beam: { warpSpecId: f.specId } } });
  await prisma.warpBeam.deleteMany({ where: { warpSpecId: f.specId } });
  await prisma.yarnLot.deleteMany({ where: { itemId: f.yarnId } });
  await prisma.goodsReceipt.deleteMany({ where: { id: { in: f.receiptIds } } }).catch(() => undefined);
  await prisma.warpSpec.delete({ where: { id: f.specId } }).catch(() => undefined);
  await prisma.item.deleteMany({ where: { id: f.yarnId } });
  await prisma.machine.delete({ where: { id: f.mkId } }).catch(() => undefined);
  await prisma.station.delete({ where: { id: f.stId } }).catch(() => undefined);
  await prisma.warehouse.delete({ where: { id: f.whId } }).catch(() => undefined);
  await prisma.customer.delete({ where: { id: f.supplierId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: f.userId } }).catch(() => undefined);
  for (const key of FLAGS) {
    const eski = f.foto.find((x) => x.key === key);
    if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
