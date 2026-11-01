// =============================================================================
// STANDART MALİYET SÜRÜMÜ — kayıt, geri alma, liste, detay (MAL-2; plan §3.2, §4.2)
// =============================================================================
// Sürüm DONMUŞ FOTOĞRAFTIR: tutarlar, kalemler ve motor girdisi (`inputSnapshot`) yazıldığı anda
// donar; detay/geçmiş SAKLANANI okur, canlı girdiden yeniden hesaplamaz. Kayıt tek tx: önceki ACTIVE
// → SUPERSEDED (atomik updateMany) + yeni sürüm + kalemler; yarışta partial unique/versionNo P2002 →
// 409. "Geri alma" eski fotoğraftan YENİ sürüm yazar, eskisi değişmez. Audit tx DIŞINDA.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { assembleCostInputTx, buildCostInput, loadCostSourcesTx } from "./helpers/cost-assembler.helper";
import { isUniqueViolation } from "./helpers/cost-input.helper";
import { computeFabricCost, roundCost4, roundKg6, type CostInput, type CostOutcome, type FxRates } from "./helpers/fabric-cost.helper";
import {
  costInputHash,
  fxRatesSnapshotSchema,
  fxSnapshotToRates,
  parseCostInputSnapshot,
  serializeCostInput,
  type FxRatesSnapshot,
} from "./helpers/cost-snapshot.helper";
import { parseFxRates, resolveFx } from "./cost-calc.service";
import { buildTurkishSearch } from "../utils/query-parser";
import { decodeOffsetCursor, encodeOffsetCursor } from "../utils/cursor";
import { readCostPresentationCurrency, type CostPresentationCurrency } from "./system-setting.service";
import { costPresentation, frozenRate, presentationHeader, withPresentation } from "./helpers/cost-presentation.helper";

const TABLE = "STANDARD_COST_VERSION";
const versionSelect = {
  id: true, itemId: true, versionNo: true, status: true, parameterSetId: true, rawCostPerMTry: true, finishedCostPerMTry: true,
  totalCostPerMTry: true, warpKgPerM: true, weftKgPerM: true, loomMPerHour: true, fxRates: true, inputHash: true, warnings: true,
  computedAt: true, reason: true, restoredFromId: true, supersededAt: true, createdById: true,
} satisfies Prisma.StandardCostVersionSelect;
type VersionRow = Prisma.StandardCostVersionGetPayload<{ select: typeof versionSelect }>;
type LineRow = Prisma.StandardCostLineGetPayload<object>;

/** Sunum dövizi (SY-J1): kur YALNIZ sürümün donmuş `fxRates`inden; ayar TRY iken yanıt bayt-aynı. */
function presentVersion(v: VersionRow, setting: CostPresentationCurrency, lines?: LineRow[]) {
  const pres = setting === "TRY" ? null : costPresentation(setting, frozenRate(v.fxRates, setting), "SURUM");
  return withPresentation(storedVersionView(v, lines), pres);
}

/** Saklanan sürümün sunumu — DB değeri olduğu gibi (yeniden hesap YOK). */
function storedVersionView(v: VersionRow, lines?: LineRow[]) {
  return {
    id: v.id,
    surumNo: v.versionNo,
    durum: v.status,
    parametreSetiId: v.parameterSetId,
    hamTlM: v.rawCostPerMTry.toFixed(4),
    mamulTlM: v.finishedCostPerMTry?.toFixed(4) ?? null,
    standartTlM: v.totalCostPerMTry.toFixed(4),
    cozguKgM: v.warpKgPerM.toFixed(6),
    atkiKgM: v.weftKgPerM.toFixed(6),
    // MİG-2b: atkı ücreti yönteminde hız bilinmeyebilir → null (bugünkü tüm satırlar dolu).
    tezgahMSaat: v.loomMPerHour?.toFixed(4) ?? null,
    kurlar: v.fxRates,
    uyarilar: v.warnings,
    gerekce: v.reason,
    hesaplananAt: v.computedAt,
    hesaplayanId: v.createdById,
    gecersizAt: v.supersededAt,
    geriAlinanSurumId: v.restoredFromId,
    ...(lines
      ? {
          satirlar: lines.map((l) => ({
            sira: l.lineNo, bilesen: l.component, etiket: l.label, iplikId: l.yarnItemId, miktar: l.qty?.toString() ?? null,
            birim: l.qtyUnit, birimFiyatTl: l.unitPriceTry?.toFixed(4) ?? null, tutarTlM: l.amountPerMTry.toFixed(4),
          })),
        }
      : {}),
  };
}

const missingError = (out: CostOutcome) =>
  AppError.badRequest("Maliyet girdisi eksik; sürüm kaydedilemez.", { code: "COST_INPUT_MISSING", missing: out.missing });

/** Tek tx: önceki ACTIVE → SUPERSEDED + yeni ACTIVE sürüm + kalemler. */
async function writeVersion(p: {
  itemId: string; recipeId: string | null; input: CostInput; out: CostOutcome; fx: FxRatesSnapshot; reason: string | null; restoredFromId: string | null; userId?: string;
}): Promise<{ created: VersionRow; supersededId: string | null }> {
  const r = p.out.result!;
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      // Aktif tekillik (itemId, recipeId) başına (SY-MIG): desen geneli ile varyant sürümü birbirini SUPERSEDE etmez.
      const prev = await tx.standardCostVersion.findFirst({ where: { itemId: p.itemId, recipeId: p.recipeId, status: "ACTIVE" }, select: { id: true } });
      if (prev) {
        const claim = await tx.standardCostVersion.updateMany({ where: { id: prev.id, status: "ACTIVE" }, data: { status: "SUPERSEDED", supersededAt: now } });
        if (claim.count === 0) throw AppError.conflict("Maliyet sürümü aynı anda değişti; yeniden deneyin.", { code: "COST_VERSION_CONFLICT" });
      }
      const max = await tx.standardCostVersion.aggregate({ where: { itemId: p.itemId }, _max: { versionNo: true } });
      const created = await tx.standardCostVersion.create({
        data: {
          itemId: p.itemId,
          ...(p.recipeId ? { recipeId: p.recipeId } : {}),
          versionNo: (max._max.versionNo ?? 0) + 1,
          status: "ACTIVE",
          parameterSetId: p.input.parameterSetId!,
          rawCostPerMTry: roundCost4(r.rawCostPerMTry),
          finishedCostPerMTry: r.finishedCostPerMTry ? roundCost4(r.finishedCostPerMTry) : null,
          totalCostPerMTry: roundCost4(r.totalCostPerMTry),
          warpKgPerM: roundKg6(r.warpKgPerM),
          weftKgPerM: roundKg6(r.weftKgPerM),
          loomMPerHour: r.loomMPerHour === null ? null : roundCost4(r.loomMPerHour),
          fxRates: fxRatesSnapshotSchema.parse(p.fx),
          inputSnapshot: serializeCostInput(p.input),
          inputHash: costInputHash(p.input),
          warnings: p.out.warnings,
          computedAt: now,
          reason: p.reason,
          restoredFromId: p.restoredFromId,
          createdById: p.userId ?? null,
        },
        select: versionSelect,
      });
      await tx.standardCostLine.createMany({
        data: r.lines.map((l, i) => ({
          versionId: created.id, lineNo: i + 1, component: l.component, label: l.label.slice(0, 120), yarnItemId: l.yarnItemId,
          qty: l.qty ? roundKg6(l.qty) : null, qtyUnit: l.qtyUnit, unitPriceTry: l.unitPriceTry ? roundCost4(l.unitPriceTry) : null,
          amountPerMTry: roundCost4(l.amountPerMTry),
        })),
      });
      return { created, supersededId: prev?.id ?? null };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw AppError.conflict("Bu ürün için aynı anda başka bir maliyet sürümü kaydedildi.", { code: "COST_VERSION_CONFLICT" });
    throw e;
  }
}

function auditVersion(res: { created: VersionRow; supersededId: string | null }, userId?: string, recipeId: string | null = null): void {
  if (res.supersededId) {
    void AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: res.supersededId, oldData: { status: "ACTIVE" }, newData: { status: "SUPERSEDED" } });
  }
  const v = res.created;
  void AuditService.log({
    userId, action: "CREATE", tableName: TABLE, recordId: v.id, oldData: null,
    newData: { itemId: v.itemId, versionNo: v.versionNo, status: v.status, totalCostPerMTry: v.totalCostPerMTry.toString(), reason: v.reason, restoredFromId: v.restoredFromId, ...(recipeId ? { recipeId } : {}) },
  });
}

/** Pasif varyanta yeni sürüm yazılmaz (doldurma/teklif kalemi zaten atlıyor/reddediyor); aitlik derleyicide. */
async function assertRecipeActive(recipeId: string | null): Promise<void> {
  if (!recipeId) return;
  const r = await prisma.productRecipe.findUnique({ where: { id: recipeId }, select: { isActive: true, code: true } });
  if (r && !r.isActive) throw AppError.badRequest(`'${r.code}' varyantı pasif; maliyet sürümü yazılamaz.`, { code: "RECIPE_INACTIVE", recipeId });
}

/** `POST /api/cost/items/:itemId/versions` — canlı girdiden yeni ACTIVE sürüm. */
export async function createStandardCostVersion(itemId: string, body: { reason?: string | null; fxRates?: Record<string, unknown>; recipeId?: string | null }, userId?: string) {
  // Varyant sürümü (SY-N1): derleyici varyantın ürüne aitliğini doğrular (COST_RECIPE_MISMATCH); yoksa desen geneli.
  const recipeId = body.recipeId ?? null;
  await assertRecipeActive(recipeId);
  const input = await prisma.$transaction((tx) => assembleCostInputTx(tx, recipeId ? { itemId, recipeId } : { itemId }));
  const setting = await readCostPresentationCurrency();
  const fx = await resolveFx(input, parseFxRates(body.fxRates), setting);
  const out = computeFabricCost(input, fx.rates);
  if (!out.result) throw missingError(out);
  const res = await writeVersion({ itemId, recipeId, input, out, fx: fx.snapshot, reason: body.reason ?? null, restoredFromId: null, userId });
  auditVersion(res, userId, recipeId);
  return presentVersion(res.created, setting);
}

/** Geri alma: eski sürümün DONMUŞ girdisi + kuruyla YENİ sürüm; eski satır değişmez. */
export async function restoreStandardCostVersion(itemId: string, versionId: string, body: { reason?: string | null }, userId?: string) {
  const old = await prisma.standardCostVersion.findFirst({ where: { id: versionId, itemId }, select: { id: true, versionNo: true, recipeId: true, inputSnapshot: true, fxRates: true } });
  if (!old) throw AppError.notFound("Maliyet sürümü bulunamadı.");
  await assertRecipeActive(old.recipeId);
  const input = parseCostInputSnapshot(old.inputSnapshot);
  const fxSnap = fxRatesSnapshotSchema.parse(old.fxRates);
  const rates: FxRates = fxSnapshotToRates(fxSnap);
  const out = computeFabricCost(input, rates);
  if (!out.result) throw missingError(out);
  const reason = body.reason ?? `Sürüm ${old.versionNo} geri alındı`;
  const res = await writeVersion({ itemId, recipeId: old.recipeId, input, out, fx: fxSnap, reason, restoredFromId: old.id, userId });
  auditVersion(res, userId, old.recipeId);
  return presentVersion(res.created, await readCostPresentationCurrency());
}

export async function listStandardCostVersions(itemId: string, recipeId: string | null = null) {
  // Geçmiş (itemId, recipeId) zinciridir; varsayılan desen geneli (varyant sürümü yokken bugünkü liste).
  const rows = await prisma.standardCostVersion.findMany({ where: { itemId, recipeId }, orderBy: { versionNo: "desc" }, select: versionSelect });
  const setting = await readCostPresentationCurrency();
  return rows.map((v) => presentVersion(v, setting));
}

/** `GET /api/cost/items/:itemId/versions/:versionId` — saklanan sürüm + satır dökümü (teklif kaleminin dondurduğu sürüm). */
export async function getStandardCostVersion(itemId: string, versionId: string) {
  const v = await prisma.standardCostVersion.findFirst({ where: { id: versionId, itemId }, select: { ...versionSelect, lines: { orderBy: { lineNo: "asc" } } } });
  if (!v) throw AppError.notFound("Maliyet sürümü bulunamadı.");
  return presentVersion(v, await readCostPresentationCurrency(), v.lines);
}

export type StructureStatus = "YAPI_EKSIK" | "VARSAYILAN" | "TAM";
const DEFAULTED = new Set(["TAKEUP_DEFAULTED", "WARP_WASTE_DEFAULTED", "WEFT_LENGTH_FROM_WIDTH", "RPM_DEFAULTED", "SHRINK_UNKNOWN"]);

/** Yapı durumu kurdan bağımsızdır: FX eksikliği yapının değil günün sorunudur. */
function structureStatus(input: CostInput): { durum: StructureStatus; eksikler: string[]; uyarilar: string[] } {
  const out = computeFabricCost(input, {});
  const eksikler = out.missing.filter((m) => m !== "FX_RATE_MISSING");
  const status: StructureStatus = eksikler.length ? "YAPI_EKSIK" : out.warnings.some((w) => DEFAULTED.has(w)) ? "VARSAYILAN" : "TAM";
  return { durum: status, eksikler, uyarilar: out.warnings };
}

/** `GET /api/cost/items/:itemId` — yapı + canlı girdi (kaynaklı) + aktif sürüm (saklanan döküm). */
export async function getCostItem(itemId: string) {
  const input = await prisma.$transaction((tx) => assembleCostInputTx(tx, { itemId }));
  const [item, structure, active] = [
    await prisma.item.findUniqueOrThrow({ where: { id: itemId }, select: { id: true, code: true, name: true } }),
    await prisma.costStructure.findUnique({ where: { itemId }, include: { processes: { orderBy: { sortOrder: "asc" }, select: { rateCode: true, sortOrder: true } } } }),
    await prisma.standardCostVersion.findFirst({ where: { itemId, recipeId: null, status: "ACTIVE" }, select: { ...versionSelect, lines: { orderBy: { lineNo: "asc" } } } }),
  ];
  const st = structureStatus(input);
  return {
    urun: { id: item.id, kod: item.code, ad: item.name },
    yapi: structure,
    girdi: serializeCostInput(input),
    yapiDurumu: st.durum,
    eksikler: st.eksikler,
    uyarilar: st.uyarilar,
    aktifSurum: active ? presentVersion(active, await readCostPresentationCurrency(), active.lines) : null,
    girdiDegisti: active ? active.inputHash !== costInputHash(input) : false,
  };
}

export interface CostItemListQuery { q?: string; durum?: StructureStatus[]; girdiDegisti?: boolean; surum?: "VAR" | "YOK"; cursor?: string; limit?: number }

/**
 * `GET /api/cost/items` — kumaşlar + yapı durumu + aktif sürüm + bayatlık. Süzme SUNUCUDA: metin/aktiflik
 * DB where'inde, türetilmiş durum/bayatlık aynı kümede bellekte; özet şeridi durum süzgecinden ÖNCEKİ kümeden.
 */
export async function listCostItems(q: CostItemListQuery) {
  const where: Prisma.ItemWhereInput = { itemType: "FABRIC", isActive: true, ...(q.q ? { OR: buildTurkishSearch<Prisma.ItemWhereInput>(q.q, ["code", "name"]) } : {}) };
  const items = await prisma.item.findMany({ where, orderBy: [{ code: "asc" }, { id: "asc" }], select: { id: true, code: true, name: true } });
  const ids = items.map((i) => i.id);
  const src = await prisma.$transaction((tx) => loadCostSourcesTx(tx, ids));
  const actives = ids.length ? await prisma.standardCostVersion.findMany({ where: { status: "ACTIVE", recipeId: null, itemId: { in: ids } }, select: versionSelect }) : [];
  const byItem = new Map(actives.map((v) => [v.itemId, v]));
  const setting = await readCostPresentationCurrency();
  const listPresentation = (v: VersionRow) => {
    const pres = setting === "TRY" ? null : costPresentation(setting, frozenRate(v.fxRates, setting), "SURUM");
    return pres ? presentationHeader(pres, v.totalCostPerMTry) : {};
  };
  const rows = items.map((it) => {
    const input = buildCostInput(src, { itemId: it.id });
    const st = structureStatus(input);
    const v = byItem.get(it.id);
    return {
      itemId: it.id, kod: it.code, ad: it.name, yapiDurumu: st.durum, eksikler: st.eksikler, uyarilar: st.uyarilar,
      aktifSurum: v ? { id: v.id, surumNo: v.versionNo, standartTlM: v.totalCostPerMTry.toFixed(4), hesaplananAt: v.computedAt, ...listPresentation(v) } : null,
      girdiDegisti: v ? v.inputHash !== costInputHash(input) : false,
    };
  });
  const summary = { toplam: rows.length, TAM: 0, VARSAYILAN: 0, YAPI_EKSIK: 0, girdiDegisti: rows.filter((r) => r.girdiDegisti).length, surumsuz: rows.filter((r) => !r.aktifSurum).length };
  for (const r of rows) summary[r.yapiDurumu]++;
  const filtered = rows.filter(
    (r) =>
      (!q.durum?.length || q.durum.includes(r.yapiDurumu)) &&
      (q.girdiDegisti === undefined || r.girdiDegisti === q.girdiDegisti) &&
      (!q.surum || (q.surum === "VAR") === !!r.aktifSurum),
  );
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = decodeOffsetCursor(q.cursor);
  const page = filtered.slice(offset, offset + limit);
  return { data: page, ozet: summary, toplamSuzulen: filtered.length, nextCursor: offset + limit < filtered.length ? encodeOffsetCursor(offset + limit) : null };
}
