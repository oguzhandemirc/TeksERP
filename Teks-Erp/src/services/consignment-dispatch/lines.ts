// =============================================================================
// EMANET ÇIKIŞ BELGESİ — satır çözücü (önizleme ve oluşturun ORTAK yüklemi)
// =============================================================================
// Önizleme `blockedReason` doldurur, oluştur aynı çözücüyü kilitli koşup ilk engelde 409 verir — "önizleme geçer
// derken oluştur 409" ayrışması tek yüklemle kapanır. Seçilebilirlik `eligibility.ts` (aday ucuyla ortak).
// Kilit sırası (oluştur): kod kapsamı (8029) → `warp_beams` id sırasıyla → `yarn_stocks` (itemId, warehouseId) sırasıyla.
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { SETTING_KEYS, readDevereEnabled, readIplikEnabled } from "../system-setting.service";
import { licenseModuleError } from "../../lib/license/module-ceiling";
import { settingScreenPath } from "../../constants/panel-ayar-yolu";
import { beamBlockedReason, yarnBlockedReason } from "./eligibility";
import { warpBeamRemainingM } from "../helpers/warp-beam.helper";
import { yarnLotWarehouseBalancesTx } from "../helpers/yarn-lot.helper";
import type { ConsignmentDispatchCreateInput, ConsignmentDispatchErrorCode } from "./types";

type Db = Prisma.TransactionClient;
export const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

/** Belge başına kalem tavanı — tek tx'te satır kilidi sayısını sınırlar (bellek/kilit tavanı). */
export const CONSIGNMENT_MAX_ITEMS = 200;

export interface NormalizedYarnLine { yarnItemId: string; warehouseId: string; lotId: string; qtyKg: Prisma.Decimal }
export interface NormalizedDispatch {
  ownerCustomerId: string;
  /** id sırasıyla (kilit sırası). */
  beamIds: string[];
  /** (yarnItemId, warehouseId, lotId) sırasıyla (kilit sırası). */
  yarns: NormalizedYarnLine[];
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Gövdeyi kanonik biçime getirir: boş 400, tekrar 400, tavan 400, YARN lotsuz 400 (Zod'un ikinci hattı). */
export function normalizeDispatchInput(input: ConsignmentDispatchCreateInput): NormalizedDispatch {
  if (!input.items || input.items.length === 0) {
    throw AppError.badRequest("Çıkış belgesinde en az bir levent ya da iplik satırı olmalı.", { code: "CONSIGNMENT_ITEMS_EMPTY" });
  }
  if (input.items.length > CONSIGNMENT_MAX_ITEMS) {
    throw AppError.badRequest(`Bir çıkış belgesi en çok ${CONSIGNMENT_MAX_ITEMS} satır taşır — belgeyi bölün.`, { code: "CONSIGNMENT_ITEMS_TOO_MANY" });
  }
  const beamIds = new Set<string>();
  const yarnKeys = new Set<string>();
  const yarns: NormalizedYarnLine[] = [];
  for (const it of input.items) {
    if (it.kind === "WARP_BEAM") {
      if (beamIds.has(it.warpBeamId)) throw AppError.badRequest("Aynı levent belgede iki kez yazılamaz.", { code: "CONSIGNMENT_DUPLICATE_LINE", warpBeamId: it.warpBeamId });
      beamIds.add(it.warpBeamId);
      continue;
    }
    if (!it.lotId) throw AppError.badRequest("İplik satırında lot zorunlu — emanet iplik lot sahibine göre çıkar.", { code: "CONSIGNMENT_YARN_LOT_REQUIRED" });
    const key = `${it.lotId}|${it.warehouseId}`;
    if (yarnKeys.has(key)) throw AppError.badRequest("Aynı lot aynı depodan iki satırda yazılamaz — miktarı tek satırda toplayın.", { code: "CONSIGNMENT_DUPLICATE_LINE", lotId: it.lotId, warehouseId: it.warehouseId });
    yarnKeys.add(key);
    const qty = D(it.qtyKg).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
    if (!qty.isFinite() || qty.lte(0)) throw AppError.badRequest("İplik miktarı (kg) sıfırdan büyük olmalı.", { code: "CONSIGNMENT_YARN_QTY_INVALID" });
    yarns.push({ yarnItemId: it.yarnItemId, warehouseId: it.warehouseId, lotId: it.lotId, qtyKg: qty });
  }
  yarns.sort((a, b) => cmp(a.yarnItemId, b.yarnItemId) || cmp(a.warehouseId, b.warehouseId) || cmp(a.lotId, b.lotId));
  const trim = (v: string | null | undefined): string | null => v?.trim() || null;
  return {
    ownerCustomerId: input.ownerCustomerId,
    beamIds: [...beamIds].sort(cmp),
    yarns,
    plateNumber: trim(input.plateNumber),
    driverName: trim(input.driverName),
    notes: trim(input.notes),
  };
}

/** Replay kimliği: sahip + kanonik kalem imzası (sıra bağımsız). */
export function dispatchLineSignature(n: Pick<NormalizedDispatch, "beamIds" | "yarns">): string {
  return [...n.beamIds.map((id) => `B:${id}`), ...n.yarns.map((y) => `Y:${y.yarnItemId}|${y.warehouseId}|${y.lotId}|${y.qtyKg.toFixed(3)}`)].join(";");
}

/** Satır türüne göre modül kapısı — levent devere, iplik iplik modülü (yazarların ikinci hattıyla aynı 403). */
export async function assertLineModules(db: Pick<Db, "systemSetting">, n: Pick<NormalizedDispatch, "beamIds" | "yarns">): Promise<void> {
  if (n.beamIds.length > 0 && !(await readDevereEnabled(db))) {
    throw licenseModuleError(SETTING_KEYS.DEVERE_ENABLED, "Devere / levent") ?? AppError.forbidden(`Devere modülü bu kurulumda kapalı — levent sahibine çıkarılamaz. ${settingScreenPath("modules")} ekranından açılabilir.`, { code: "MODULE_DISABLED", modul: "devere" });
  }
  if (n.yarns.length > 0 && !(await readIplikEnabled(db))) {
    throw licenseModuleError(SETTING_KEYS.IPLIK_ENABLED, "İplik") ?? AppError.forbidden(`İplik modülü bu kurulumda kapalı — iplik sahibine çıkarılamaz. ${settingScreenPath("modules")} ekranından açılabilir.`, { code: "MODULE_DISABLED", modul: "iplik" });
  }
}

export interface ResolvedBeamLine {
  warpBeamId: string;
  beamNo: string;
  warpSpecName: string | null;
  ownerCustomerId: string | null;
  status: WarpBeamStatus;
  remainingM: Prisma.Decimal;
  blockedReason: ConsignmentDispatchErrorCode | null;
}
export interface ResolvedYarnLine extends NormalizedYarnLine {
  itemCode: string;
  itemName: string;
  warehouseName: string;
  lotNo: string;
  ownerCustomerId: string | null;
  balanceKg: Prisma.Decimal;
  blockedReason: ConsignmentDispatchErrorCode | null;
}
export interface ResolvedDispatch {
  owner: { id: string; code: string; name: string };
  beams: ResolvedBeamLine[];
  yarns: ResolvedYarnLine[];
}

/**
 * Satırları çözer. `lock`: oluştur tx'i — leventler ve iplik depo satırları kanonik sırada FOR UPDATE alınır, okumalar
 * kilidin ARDINDAN (bayat kalan/bakiye yazılmaz). Bulunamayan referans 404, lot-kalem uyuşmazlığı 400; engeller
 * `blockedReason`ta (önizleme gösterir, oluştur 409'a çevirir).
 */
export async function resolveDispatchLines(db: Db, n: NormalizedDispatch, opts: { lock: boolean }): Promise<ResolvedDispatch> {
  const owner = await db.customer.findUnique({ where: { id: n.ownerCustomerId }, select: { id: true, code: true, name: true } });
  // Pasif müşteriye de iade edilebilir (malı onundur) — yalnız varlık sorulur.
  if (!owner) throw AppError.notFound("Sahip müşteri bulunamadı.", { code: "OWNER_CUSTOMER_INVALID" });

  const beams: ResolvedBeamLine[] = [];
  if (n.beamIds.length > 0) {
    if (opts.lock) {
      await db.$queryRaw`SELECT id FROM warp_beams WHERE id IN (${Prisma.join(n.beamIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
    }
    const rows = await db.warpBeam.findMany({
      where: { id: { in: n.beamIds } },
      select: { id: true, beamNo: true, status: true, ownerCustomerId: true, warpSpec: { select: { name: true } } },
    });
    const events = await db.warpBeamEvent.findMany({ where: { beamId: { in: n.beamIds } }, select: { beamId: true, kind: true, lengthM: true } });
    const byBeam = new Map<string, Array<{ kind: string; lengthM: Prisma.Decimal | null }>>();
    for (const e of events) {
      const list = byBeam.get(e.beamId) ?? [];
      list.push(e);
      byBeam.set(e.beamId, list);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of n.beamIds) {
      const b = byId.get(id);
      if (!b) throw AppError.notFound(`Levent bulunamadı: ${id}`, { code: "WARP_BEAM_NOT_FOUND", warpBeamId: id });
      // Kalan `readRemainingM` ile aynı formül (tek işaret tablosu), toplu okunur.
      const remainingM = D(warpBeamRemainingM(byBeam.get(id) ?? []));
      const blockedReason = beamBlockedReason({ ownerCustomerId: b.ownerCustomerId, status: b.status, remainingM }, owner.id);
      beams.push({ warpBeamId: id, beamNo: b.beamNo, warpSpecName: b.warpSpec?.name ?? null, ownerCustomerId: b.ownerCustomerId, status: b.status, remainingM, blockedReason });
    }
  }

  const yarns: ResolvedYarnLine[] = [];
  if (n.yarns.length > 0) {
    if (opts.lock) {
      // `assertYarnBalanceCoversTx` ile AYNI satır kilidi, kanonik sırada (ABBA yok); lot okuması kilitten SONRA.
      const pairs = [...new Map(n.yarns.map((y) => [`${y.yarnItemId}|${y.warehouseId}`, y])).values()];
      await db.$queryRaw`SELECT 1 FROM "yarn_stocks" WHERE ("itemId", "warehouseId") IN (${Prisma.join(pairs.map((p) => Prisma.sql`(${p.yarnItemId}::uuid, ${p.warehouseId}::uuid)`))}) ORDER BY "itemId", "warehouseId" FOR UPDATE`;
    }
    const lotIds = [...new Set(n.yarns.map((y) => y.lotId))];
    const lots = await db.yarnLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, itemId: true, lotNo: true, ownerCustomerId: true, isActive: true } });
    const items = await db.item.findMany({ where: { id: { in: [...new Set(n.yarns.map((y) => y.yarnItemId))] } }, select: { id: true, code: true, name: true } });
    const warehouses = await db.warehouse.findMany({ where: { id: { in: [...new Set(n.yarns.map((y) => y.warehouseId))] } }, select: { id: true, name: true } });
    const balances = await yarnLotWarehouseBalancesTx(db, lotIds);
    const lotById = new Map(lots.map((l) => [l.id, l]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    const whById = new Map(warehouses.map((w) => [w.id, w]));
    for (const y of n.yarns) {
      const lot = lotById.get(y.lotId);
      const item = itemById.get(y.yarnItemId);
      const wh = whById.get(y.warehouseId);
      if (!lot) throw AppError.notFound(`İplik lotu bulunamadı: ${y.lotId}`, { code: "YARN_LOT_NOT_FOUND", lotId: y.lotId });
      if (!item) throw AppError.notFound(`İplik kalemi bulunamadı: ${y.yarnItemId}`, { code: "YARN_ITEM_NOT_FOUND", yarnItemId: y.yarnItemId });
      if (!wh) throw AppError.notFound(`Depo bulunamadı: ${y.warehouseId}`, { code: "WAREHOUSE_NOT_FOUND", warehouseId: y.warehouseId });
      if (lot.itemId !== y.yarnItemId) {
        throw AppError.badRequest(`"${lot.lotNo}" lotu seçilen iplik kalemine ait değil.`, { code: "YARN_LOT_ITEM_MISMATCH", lotId: y.lotId, yarnItemId: y.yarnItemId });
      }
      const balanceKg = balances.get(`${y.lotId}|${y.warehouseId}`) ?? D(0);
      const blockedReason = yarnBlockedReason({ ownerCustomerId: lot.ownerCustomerId, isActive: lot.isActive, balanceKg }, owner.id, y.qtyKg);
      yarns.push({ ...y, itemCode: item.code, itemName: item.name, warehouseName: wh.name, lotNo: lot.lotNo, ownerCustomerId: lot.ownerCustomerId, balanceKg, blockedReason });
    }
  }
  return { owner, beams, yarns };
}

/** Oluştur yolu: ilk engelli satır 409 — kod satırın `blockedReason`ı, mesaj somut (hangi levent/lot, neden). */
export function assertNoBlockedLines(r: ResolvedDispatch): void {
  for (const b of r.beams) {
    if (b.blockedReason === "CONSIGNMENT_OWNER_MISMATCH") {
      throw AppError.conflict(`${b.beamNo} ${r.owner.name} müşterisinin emanet leventi değil — sahibinden başkasına çıkış belgesi açılamaz.`, { code: b.blockedReason, warpBeamId: b.warpBeamId, ownerCustomerId: b.ownerCustomerId });
    }
    if (b.blockedReason === "CONSIGNMENT_BEAM_NOT_READY") {
      throw AppError.conflict(`${b.beamNo} durumu ${b.status}, kalan ${b.remainingM.toFixed(3)} m — yalnız HAZIR ve kalanı olan levent sahibine çıkar.`, { code: b.blockedReason, warpBeamId: b.warpBeamId, status: b.status });
    }
  }
  for (const y of r.yarns) {
    if (y.blockedReason === "CONSIGNMENT_OWNER_MISMATCH") {
      throw AppError.conflict(`"${y.lotNo}" lotu ${r.owner.name} müşterisinin emanet ipliği değil — sahibinden başkasına çıkış belgesi açılamaz.`, { code: y.blockedReason, lotId: y.lotId, ownerCustomerId: y.ownerCustomerId });
    }
    if (y.blockedReason === "YARN_LOT_INACTIVE") {
      throw AppError.conflict(`"${y.lotNo}" lotu pasif — pasif lottan emanet çıkışı yapılamaz.`, { code: y.blockedReason, lotId: y.lotId });
    }
    if (y.blockedReason === "CONSIGNMENT_YARN_INSUFFICIENT") {
      throw AppError.conflict(`"${y.lotNo}" lotunun ${y.warehouseName} deposundaki bakiyesi ${y.balanceKg.toFixed(3)} kg — istenen ${y.qtyKg.toFixed(3)} kg karşılanmıyor.`, { code: y.blockedReason, lotId: y.lotId, warehouseId: y.warehouseId, balanceKg: y.balanceKg.toFixed(3), requestedKg: y.qtyKg.toFixed(3) });
    }
  }
}

/** Önizleme okuması kilitsiz `prisma` ile — tip tx istemcisi. */
export const previewDb = prisma as unknown as Db;
