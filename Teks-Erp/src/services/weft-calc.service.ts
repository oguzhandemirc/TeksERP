// =============================================================================
// ATKI HESAP PANELİ (K4, Seyitoğlu 2026-11-25) — "1000 m kumaş için atkı ihtiyacı", YAZMAZ
// =============================================================================
// Formdaki (kaydedilmemiş) atkı satırları maliyet derleyicisinin AYNI yolundan geçer: kumaş bağlamı
// varsa atkı boyu zinciri (elle → yapı → tarak eni → ham en + kenar payı) ve fire zinciri ondan;
// kg motorun `yarnUsagePerM`inden (fireli/firesiz). Panel hesap yapmaz, yalnız basar.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { buildCostInput, COST_ITEM_SELECT, COST_YARN_SELECT, loadCostStructureSourcesForRowTx, type CostItemRow } from "./helpers/cost-assembler.helper";
import { yarnUsagePerM } from "./helpers/fabric-cost.helper";
import type { CostInput } from "./helpers/fabric-cost-types.helper";
import { resolveYarnWastePct, type YarnWasteSource } from "./helpers/yarn-waste.helper";
import { parseWeftSequence, weftLetter } from "./helpers/weft-sequence.helper";

/** Kumaşsız (Atkı Kartları ekranı) hesapta derleyiciye verilen yer tutucu kimlik — DB'de satırı yok. */
const NO_ITEM_ID = "00000000-0000-0000-0000-000000000000";
const PER_M = 1000;

export interface WeftCalcInput {
  itemId?: string;
  /** Formdaki ham en (cm) — verilirse kumaşın kayıtlı değerinin yerine (kaydedilmemiş ürün penceresi). */
  rawWidthCm?: number | null;
  /** Elle atkı boyu (cm) — zincirin en önü; kaydedilmez. */
  weftLengthCm?: number | null;
  picksPerCm?: number | null;
  sequenceCode?: string | null;
  yarns: Array<{ yarnItemId: string; picksInRepeat?: number | null }>;
}

/** Atkı boyunun nereden geldiği: elle · maliyet yapısı · çözgü kartının tarak eni · ham en + kenar payı. */
export type WeftLengthSource = "ELLE" | "YAPI" | "TARAK" | "EN";

export interface WeftCalcRow {
  letter: string; yarnItemId: string; code: string; name: string; denier: number | null; picksInRepeat: number | null;
  /** KG dışı birimli iplik (pul/payet, fantezi) kg'a girmez. */
  unit: "ADET" | "METRE" | null;
  netKg: number | null; grossKg: number | null; sharePct: number | null; wastePct: number | null; wasteSource: YarnWasteSource | null;
}

export interface WeftCalcResult {
  perMeters: number;
  picksPerCm: number | null;
  lengthCm: number | null;
  lengthSource: WeftLengthSource | null;
  wastePct: number | null;
  rows: WeftCalcRow[];
  totalNetKg: number | null;
  totalGrossKg: number | null;
  /** Hesabı eksik bırakan veri — sade Türkçe; boşsa hesap tam. */
  missing: Array<{ code: string; text: string }>;
}

const WEFT_MISSING = new Set(["WEFT_SPEC_MISSING", "PICKS_MISSING", "WEFT_LENGTH_MISSING", "DENIER_MISSING", "PARAMETER_SET_MISSING"]);
const num = (d: Prisma.Decimal | null | undefined, dp = 3): number | null => (d == null ? null : Number(d.toDecimalPlaces(dp).toString()));
const dec = (n: number | null | undefined): Prisma.Decimal | null => (n == null ? null : new Prisma.Decimal(n));

function missingText(code: string, hasItem: boolean): string {
  switch (code) {
    case "PICKS_MISSING": return "Atkı sıklığı (atkı/cm) girilmedi.";
    case "WEFT_LENGTH_MISSING":
      return hasItem
        ? "Atkı boyu bulunamadı — kumaşın maliyet yapısına atkı boyu, çözgü kartına tarak eni ya da ürüne ham en girin; ya da atkı boyunu aşağıya yazın."
        : "Atkı boyu kumaştan gelir; bu ekranda atkı boyunu (cm) aşağıya yazın.";
    case "DENIER_MISSING": return "Bir atkı ipliğinin iplik kartında denye yok.";
    case "PARAMETER_SET_MISSING": return "Atkı firesi bulunamadı (maliyet parametrelerinde atkı firesi yok) — fireli kg hesaplanmadı.";
    case "WEFT_SPEC_MISSING": return "Atkı ipliği ya da rapordaki atkı adedi girilmedi.";
    default: return code;
  }
}

function lengthSourceOf(l: NonNullable<CostInput["weft"]>["lengthCm"]): WeftLengthSource | null {
  if (l.value === null) return null;
  if (l.source === "ELLE") return "ELLE";
  if (l.source === "YAPI") return "YAPI";
  return l.flag === "WEFT_LENGTH_FROM_WIDTH" ? "EN" : "TARAK";
}

/** Sıra kodu doluysa adetler ondan (kart kaydıyla aynı türetim); okunamazsa eksik notu döner. */
function picksOf(input: WeftCalcInput): { picks: Array<number | null>; error: string | null } {
  const seq = input.sequenceCode?.trim();
  if (!seq) return { picks: input.yarns.map((y) => (y.picksInRepeat && y.picksInRepeat > 0 ? y.picksInRepeat : null)), error: null };
  try {
    return { picks: parseWeftSequence(seq, input.yarns.length).picksBySortOrder, error: null };
  } catch (e) {
    if (e instanceof AppError) return { picks: input.yarns.map(() => null), error: e.message };
    throw e;
  }
}

export async function calculateWeftNeed(input: WeftCalcInput): Promise<WeftCalcResult> {
  const ids = input.yarns.map((y) => y.yarnItemId);
  if (new Set(ids).size !== ids.length) throw AppError.badRequest("Aynı iplik atkıya iki kez yazılamaz.");
  const base = input.itemId ? await prisma.item.findUnique({ where: { id: input.itemId }, select: COST_ITEM_SELECT }) : null;
  if (input.itemId && !base) throw AppError.notFound("Ürün bulunamadı.");
  const yarnRows = await prisma.item.findMany({ where: { id: { in: ids } }, select: { ...COST_YARN_SELECT, code: true } });
  const byId = new Map(yarnRows.map((y) => [y.id, y]));
  if (byId.size !== ids.length) throw AppError.badRequest("Atkı ipliği bulunamadı.");
  const { picks, error } = picksOf(input);
  const missing: WeftCalcResult["missing"] = error ? [{ code: "WEFT_SEQUENCE_INVALID", text: error }] : [];
  const ready = picks.every((p) => p !== null);
  const rawWidth = input.rawWidthCm !== undefined ? dec(input.rawWidthCm) : (base?.rawWidthCm ?? null);
  const row: CostItemRow = {
    ...(base ?? { id: NO_ITEM_ID, code: "", name: "", itemType: "FABRIC", isActive: true, warpSpec: null, costStructure: null }),
    rawWidthCm: rawWidth,
    weftSpec: {
      id: base?.weftSpec?.id ?? NO_ITEM_ID,
      picksPerCm: dec(input.picksPerCm),
      yarns: input.yarns.map((y, i) => ({ sortOrder: i, picksInRepeat: picks[i] ?? 0, yarnItem: { id: y.yarnItemId, name: byId.get(y.yarnItemId)!.name, linearDensityDen: byId.get(y.yarnItemId)!.linearDensityDen } })),
    },
  } as CostItemRow;
  const src = await loadCostStructureSourcesForRowTx(prisma, row);
  const full = buildCostInput(src, { itemId: row.id }, { weftLengthCm: dec(input.weftLengthCm) });
  // Yalnız atkı sorulur: çözgü kısmı eksik kod üretmesin.
  const costInput: CostInput = { ...full, warp: null, warpLayers: undefined };
  const weft = costInput.weft!;
  const gross = ready ? yarnUsagePerM(costInput) : null;
  const net = ready ? yarnUsagePerM(costInput, { includeWaste: false }) : null;
  for (const code of new Set([...(gross?.missing ?? []), ...(net?.missing ?? [])])) {
    if (WEFT_MISSING.has(code)) missing.push({ code, text: missingText(code, base !== null) });
  }
  if (!ready && !error) missing.push({ code: "WEFT_SPEC_MISSING", text: missingText("WEFT_SPEC_MISSING", base !== null) });
  const netBy = new Map((net?.weft ?? []).map((w) => [w.yarnItemId, w.kgPerM]));
  const grossBy = new Map((gross?.weft ?? []).map((w) => [w.yarnItemId, w]));
  const netSum = [...netBy.values()].reduce((a, v) => a.plus(v), new Prisma.Decimal(0));
  const rows = input.yarns.map((y, i): WeftCalcRow => {
    const it = byId.get(y.yarnItemId)!;
    const cy = weft.yarns[i]!;
    const n = netBy.get(y.yarnItemId) ?? null;
    const g = grossBy.get(y.yarnItemId) ?? null;
    const ws = resolveYarnWastePct(cy.wastePct, weft.wastePct);
    return {
      letter: weftLetter(i), yarnItemId: y.yarnItemId, code: it.code, name: it.name, denier: num(it.linearDensityDen, 2), picksInRepeat: picks[i] ?? null,
      unit: cy.unit ?? null,
      netKg: n ? num(n.mul(PER_M)) : null,
      grossKg: g ? num(g.kgPerM.mul(PER_M)) : null,
      sharePct: n && netSum.gt(0) ? num(n.div(netSum).mul(100), 1) : null,
      wastePct: g ? num(ws.value, 2) : null,
      wasteSource: g ? g.wasteSource : null,
    };
  });
  const kgRows = rows.filter((r) => r.unit === null);
  const total = (k: "netKg" | "grossKg") => (kgRows.length > 0 && kgRows.every((r) => r[k] !== null) ? num(kgRows.reduce((a, r) => a.plus(r[k]!), new Prisma.Decimal(0))) : null);
  return {
    perMeters: PER_M,
    picksPerCm: num(weft.picksPerCm.value, 2),
    lengthCm: num(weft.lengthCm.value, 2),
    lengthSource: lengthSourceOf(weft.lengthCm),
    wastePct: num(weft.wastePct.value, 2),
    rows,
    totalNetKg: total("netKg"),
    totalGrossKg: total("grossKg"),
    missing,
  };
}
