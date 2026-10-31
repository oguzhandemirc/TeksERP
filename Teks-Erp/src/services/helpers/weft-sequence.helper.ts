// =============================================================================
// Atkı sıra kodu (`WeftSpec.sequenceCode`, ör. "A4 B1 A4 C1") → satır başı rapordaki atkı adedi
// =============================================================================
// Harf = atkı kartı satırının sırası (A = 1. satır), sayı = ardışık atkı adedi. Kod doluysa
// `picksInRepeat` YALNIZ buradan türetilir (aynı yazım tx'i) — iki alan çelişemez. SAF.
// =============================================================================
import { AppError } from "../../utils/app-error";

const TOKEN = /^([A-Z])(\d{1,4})$/;

export interface ParsedWeftSequence {
  /** Boşlukları teke indirilmiş, büyük harfli kod. */
  normalized: string;
  /** Satır sırası (0 = A) başına toplam rapordaki atkı adedi. */
  picksBySortOrder: number[];
}

/** Kodu ayrıştırır; her harf bir satıra düşmeli ve her satır en az bir kez geçmeli (400). */
export function parseWeftSequence(raw: string, yarnCount: number): ParsedWeftSequence {
  const tokens = raw.trim().toUpperCase().split(/[\s,]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) throw AppError.badRequest("Atkı sıra kodu boş.", { code: "WEFT_SEQUENCE_INVALID" });
  const picks = new Array<number>(yarnCount).fill(0);
  for (const t of tokens) {
    const m = TOKEN.exec(t);
    if (!m) {
      throw AppError.badRequest(`Atkı sıra kodunda "${t}" anlaşılamadı — biçim: harf + adet (ör. A4 B1 A4 C1).`, { code: "WEFT_SEQUENCE_INVALID" });
    }
    const idx = m[1]!.charCodeAt(0) - 65;
    const n = Number(m[2]);
    if (n <= 0) throw AppError.badRequest(`Atkı sıra kodunda "${t}": adet sıfırdan büyük olmalı.`, { code: "WEFT_SEQUENCE_INVALID" });
    if (idx >= yarnCount) {
      throw AppError.badRequest(`Atkı sıra kodundaki "${m[1]}" harfine karşılık gelen atkı ipliği satırı yok (kartta ${yarnCount} satır var).`, { code: "WEFT_SEQUENCE_LETTER_UNKNOWN" });
    }
    picks[idx] = picks[idx]! + n;
  }
  const missing = picks.findIndex((p) => p === 0);
  if (missing >= 0) {
    throw AppError.badRequest(`Atkı sıra kodunda ${String.fromCharCode(65 + missing)} harfi hiç geçmiyor — her iplik satırı sırada en az bir kez yer almalı.`, { code: "WEFT_SEQUENCE_LETTER_MISSING" });
  }
  return { normalized: tokens.join(" "), picksBySortOrder: picks };
}

/** Satır sırasının harfi (0 → "A"); 26'dan sonrası sıra numarasıyla yazılır. */
export function weftLetter(sortOrder: number): string {
  return sortOrder < 26 ? String.fromCharCode(65 + sortOrder) : `#${sortOrder + 1}`;
}
