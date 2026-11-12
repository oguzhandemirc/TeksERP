// =============================================================================
// Top etiketi elle düzenleme — yamayı doğrula + mevcut duruma birleştir (TEK boğaz)
// =============================================================================
// Kaydetme ucu (`roll-label-edit.service`) ve taslak önizleme (`getRollLabel` `labelEdit`) AYNI
// birleştiriciden geçer: önizlemede görülen ile kaydedilip basılan ayrışmasın.
// =============================================================================
import { AppError } from "../../utils/app-error";
import {
  ROLL_LABEL_COLUMN_KEYS,
  ROLL_LABEL_EDIT_KEY_SET,
  ROLL_LABEL_OVERRIDE_TEXT_MAX,
  isRollLabelColumnKey,
  readRollLabelOverrides,
  type RollLabelColumn,
  type RollLabelOverrides,
} from "../../config/roll-label-edit";
import { normalizeLabelBatchNo, normalizeRollLabelText } from "./label-batch-no.helper";

export type RollLabelColumns = Record<RollLabelColumn, string | null>;
export interface RollLabelEditState {
  columns: RollLabelColumns;
  overrides: RollLabelOverrides;
}
/** Taslak (kaydetmeden önizleme): `templateId` undefined = topunki · null = bir seferlik şablon yok. */
export interface RollLabelDraft {
  templateId?: string | null;
  fields?: Record<string, string | null>;
}

/**
 * Yama: anahtar yok = dokunma · null = kaynağa dön · metin = yaz ("" kolon dışı alanda boş bas,
 * kolon alanında kaynağa dön). Tanınmayan anahtar 400 `LABEL_EDIT_KEY_UNKNOWN` (fail-closed).
 */
export function mergeRollLabelEdit(cur: RollLabelEditState, patch: Record<string, unknown>): RollLabelEditState {
  const columns: RollLabelColumns = { ...cur.columns };
  const overrides: RollLabelOverrides = { ...cur.overrides };
  for (const [key, raw] of Object.entries(patch)) {
    if (!ROLL_LABEL_EDIT_KEY_SET.has(key)) {
      throw AppError.badRequest(`Etikette bu alan elle yazılamaz: ${key}`, { code: "LABEL_EDIT_KEY_UNKNOWN", key });
    }
    if (raw !== null && typeof raw !== "string") {
      throw AppError.badRequest("Etiket alanı metin olmalı", { code: "LABEL_EDIT_INVALID", key });
    }
    if (isRollLabelColumnKey(key)) {
      const col = ROLL_LABEL_COLUMN_KEYS[key];
      columns[col] = col === "labelBatchNo"
        ? (normalizeLabelBatchNo(raw) ?? null)
        : normalizeRollLabelText(raw, col === "labelItemName" ? "Etiket kumaş adı" : "Etiket rengi");
      continue;
    }
    if (raw === null) {
      delete overrides[key];
      continue;
    }
    const v = raw.trim();
    if (v.length > ROLL_LABEL_OVERRIDE_TEXT_MAX) {
      throw AppError.badRequest(`Etiket alanı en çok ${ROLL_LABEL_OVERRIDE_TEXT_MAX} karakter olabilir`, {
        code: "LABEL_EDIT_INVALID",
        key,
      });
    }
    overrides[key] = v;
  }
  return { columns, overrides };
}

/** İki durum aynı mı (anahtar sırası önemsiz) — replay/no-op kararı. */
export function sameRollLabelEdit(a: RollLabelEditState, b: RollLabelEditState): boolean {
  for (const c of Object.values(ROLL_LABEL_COLUMN_KEYS)) if (a.columns[c] !== b.columns[c]) return false;
  const ka = Object.keys(a.overrides);
  if (ka.length !== Object.keys(b.overrides).length) return false;
  return ka.every((k) => b.overrides[k] === a.overrides[k]);
}

/** Topun kayıtlı düzenlemesi (+ varsa taslak yama) — `getRollLabel` her basımda bunu uygular. */
export function effectiveRollLabelEdit(
  roll: { labelItemName: string | null; labelColorName: string | null; labelBatchNo: string | null; labelOverrides: unknown },
  draft?: RollLabelDraft | null,
): RollLabelEditState {
  const cur: RollLabelEditState = {
    columns: { labelItemName: roll.labelItemName, labelColorName: roll.labelColorName, labelBatchNo: roll.labelBatchNo },
    overrides: readRollLabelOverrides(roll.labelOverrides),
  };
  return draft?.fields ? mergeRollLabelEdit(cur, draft.fields) : cur;
}
