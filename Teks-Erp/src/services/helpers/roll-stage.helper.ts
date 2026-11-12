// =============================================================================
// TOP AŞAMASI — tek kaynak (2026-11-10, plan "Top aşaması").
// -----------------------------------------------------------------------------
// `Roll.stage` (RAW | SEMI_FINISHED | FINISHED) doğuşta ve depoya inişte bu
// dosyanın kararlarıyla yazılır; etiket türü (ROLL_RAW/ROLL_FINISHED) yalnız
// `rollLabelKindOf` ile aşamadan türer — renkten (`colorId`) DEĞİL: renksiz
// bitmiş top "ham etiket", renkli ham top "bitmiş etiket" basıyordu.
// Adım `outputStage` null = otomatik: ara adım doğumu atanın aşamasını, son
// adım / depoya iniş FINISHED yazar. Bekçiler: `test_roll_asama_dogus`,
// `test_roll_asama_etiket`.
// =============================================================================
import { LabelKind, RollEntrySource, RollStage, RollStatus } from "@prisma/client";

/** Etiket türü aşamadan: ham ve yarı mamul → ROLL_RAW, bitmiş → ROLL_FINISHED. */
export function rollLabelKindOf(stage: RollStage): LabelKind {
  return stage === RollStage.FINISHED ? LabelKind.ROLL_FINISHED : LabelKind.ROLL_RAW;
}

/** Elle seçim (`?kind=` / gövde `kind`) kazanır; yoksa aşamadan. */
export function resolveRollLabelKind(stage: RollStage, kindOverride?: LabelKind | null): LabelKind {
  return kindOverride ?? rollLabelKindOf(stage);
}

/** Bitmiş stok kümesi — bu statüye doğan/inen top FINISHED aşamasındadır. */
const FINISHED_STOCK_STATUSES: ReadonlySet<RollStatus> = new Set([RollStatus.WAREHOUSE, RollStatus.A1_STOCK]);

/**
 * Giriş doğumu (KK1 · manuel · mal kabul · gelen belge · fason dokuma · Tambur manuel):
 * açık değer > yarı mamul girişi > bitmiş stoğa doğuş > ham ("aşama stok sekmesini izler").
 */
export function birthStageForEntry(input: {
  explicit?: RollStage | null;
  entrySource: RollEntrySource;
  status: RollStatus;
}): RollStage {
  if (input.explicit) return input.explicit;
  if (input.entrySource === RollEntrySource.SEMI_FINISHED) return RollStage.SEMI_FINISHED;
  if (FINISHED_STOCK_STATUSES.has(input.status)) return RollStage.FINISHED;
  return RollStage.RAW;
}

/** Üretimden çıkış (son adım finalize · depoya iniş · Tambur çocuğu): adım söylemezse FINISHED. */
export function stageForProductionExit(stepOutputStage: RollStage | null | undefined): RollStage {
  return stepOutputStage ?? RollStage.FINISHED;
}

/** Üretim içi doğum (ara adım, fason dönüşü, kesim çocuğu): adım söylemezse atanın aşaması. */
export function stageForStepBirth(stepOutputStage: RollStage | null | undefined, parentStage: RollStage): RollStage {
  return stepOutputStage ?? parentStage;
}

const STAGE_ORDER: Record<RollStage, number> = { RAW: 0, SEMI_FINISHED: 1, FINISHED: 2 };

/** Birden çok kaynaktan doğan top (makbuzdan açık kumaş): kaynakların EN DÜŞÜK aşaması; kaynaksız RAW. */
export function lowestStage(stages: readonly RollStage[]): RollStage {
  let low: RollStage | null = null;
  for (const s of stages) if (low == null || STAGE_ORDER[s] < STAGE_ORDER[low]) low = s;
  return low ?? RollStage.RAW;
}

/**
 * Var olan topun yeniden konumlanması (Konumu Düzelt · QC yeniden açma · kurtarma ·
 * partiden düşürme · İE kapanış dispozisyonu): bitmiş stoğa inen FINISHED olur,
 * başka hedefte aşama DEĞİŞMEZ (aşama geri sarılmaz; yeniden işlenen top çıkışta
 * yeniden yazılır).
 */
export function stageOnReentry(currentStage: RollStage, targetStatus: RollStatus): RollStage {
  return FINISHED_STOCK_STATUSES.has(targetStatus) ? RollStage.FINISHED : currentStage;
}

/** `stageOnReentry`in toplu yazım (updateMany) ikizi: bitmiş stoğa inişte `{stage: FINISHED}`, aksi boş (değişmez). */
export function reentryStageData(targetStatus: RollStatus): { stage?: RollStage } {
  return FINISHED_STOCK_STATUSES.has(targetStatus) ? { stage: RollStage.FINISHED } : {};
}
