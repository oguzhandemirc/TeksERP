// =============================================================================
// Atkı sıra kodu (`WeftSpec.sequenceCode`, ör. "A4 B1 A4 C1") → satır başı rapordaki atkı adedi
// =============================================================================
// Harf = atkı kartı satırının sırası (A = 1. satır), sayı = ardışık atkı adedi. Kod doluysa
// `picksInRepeat` YALNIZ buradan türetilir (aynı yazım tx'i) — iki alan çelişemez. SAF.
// Tekrar kısaltması "10x(A2 B2 C1) D4" (`sequence-repeat.helper`): kayıtlı metin kısaltmayı korur,
// adetler ve açılım parantez açılarak hesaplanır.
// =============================================================================
import { LIFT_PLAN_MAX_PICKS } from "../../constants/weave-design";
import { AppError } from "../../utils/app-error";
import { splitRepeatGroups, type RepeatError } from "./sequence-repeat.helper";

const TOKEN = /^([A-Z])(\d{1,4})$/;

/** Tekrar kısaltmalı kodun açılım tavanı (armür ızgarasıyla aynı); kısaltmasız eski kodlara uygulanmaz. */
export const WEFT_SEQUENCE_MAX_PICKS = LIFT_PLAN_MAX_PICKS;

export interface ParsedWeftSequence {
  /** Boşlukları teke indirilmiş, büyük harfli kod; tekrar grubu tek biçimde ("10x(A2 B1)"). */
  normalized: string;
  /** Satır sırası (0 = A) başına toplam rapordaki atkı adedi. */
  picksBySortOrder: number[];
  /** Tekrarları açılmış koşu listesi (index 0 = A). */
  runs: Array<{ index: number; count: number }>;
}

const REPEAT_MESSAGES: Record<RepeatError, string> = {
  unclosed: "Atkı sıra kodunda parantez kapanmamış — ör. 10x(A2 B2 C1) D4.",
  nested: "Atkı sıra kodunda iç içe parantez kullanılamaz — tekrarı tek parantezle yazın (ör. 10x(A2 B2 C1) D4).",
  noCount: "Atkı sıra kodunda parantezin önüne ya da arkasına tekrar sayısı yazın (ör. 10x(A2 B2 C1)).",
  zero: "Atkı sıra kodunda tekrar sayısı sıfırdan büyük olmalı.",
  empty: "Atkı sıra kodunda parantezin içi boş.",
};

const invalid = (msg: string): AppError => AppError.badRequest(msg, { code: "WEFT_SEQUENCE_INVALID" });

/** Kodu ayrıştırır; her harf bir satıra düşmeli ve her satır en az bir kez geçmeli (400). */
export function parseWeftSequence(raw: string, yarnCount: number): ParsedWeftSequence {
  const split = splitRepeatGroups(raw.trim().toUpperCase());
  if (!split.ok) throw invalid(REPEAT_MESSAGES[split.reason]);
  const picks = new Array<number>(yarnCount).fill(0);
  const segments: Array<{ tokens: string[]; runs: Array<{ index: number; count: number }>; times: number; group: boolean }> = [];
  let total = 0;
  for (const part of split.parts) {
    const tokens = part.text.split(/[\s,]+/).filter((t) => t.length > 0);
    if (tokens.length === 0) continue;
    const runs: Array<{ index: number; count: number }> = [];
    for (const t of tokens) {
      const m = TOKEN.exec(t);
      if (!m) throw invalid(`Atkı sıra kodunda "${t}" anlaşılamadı — biçim: harf + adet (ör. A4 B1 A4 C1).`);
      const idx = m[1]!.charCodeAt(0) - 65;
      const n = Number(m[2]);
      if (n <= 0) throw invalid(`Atkı sıra kodunda "${t}": adet sıfırdan büyük olmalı.`);
      if (idx >= yarnCount) {
        throw AppError.badRequest(`Atkı sıra kodundaki "${m[1]}" harfine karşılık gelen atkı ipliği satırı yok (kartta ${yarnCount} satır var).`, { code: "WEFT_SEQUENCE_LETTER_UNKNOWN" });
      }
      picks[idx] = picks[idx]! + n * part.times;
      runs.push({ index: idx, count: n });
      total += n * part.times;
    }
    segments.push({ tokens, runs, times: part.times, group: part.group });
  }
  if (segments.length === 0) throw invalid("Atkı sıra kodu boş.");
  const grouped = segments.some((s) => s.group);
  if (grouped && total > WEFT_SEQUENCE_MAX_PICKS) {
    throw invalid(`Atkı sıra kodu açılınca ${total} atkı oluyor — tekrarlı kodda en çok ${WEFT_SEQUENCE_MAX_PICKS} atkı olabilir.`);
  }
  const missing = picks.findIndex((p) => p === 0);
  if (missing >= 0) {
    throw AppError.badRequest(`Atkı sıra kodunda ${String.fromCharCode(65 + missing)} harfi hiç geçmiyor — her iplik satırı sırada en az bir kez yer almalı.`, { code: "WEFT_SEQUENCE_LETTER_MISSING" });
  }
  const normalized = segments.map((s) => (s.group ? `${s.times}x(${s.tokens.join(" ")})` : s.tokens.join(" "))).join(" ");
  if (normalized.length > 120) throw invalid("Atkı sıra kodu en çok 120 karakter olabilir.");
  // Grup koşuları tavan altında (≤ 512) açılır; kısaltmasız kodda koşu = belirteç.
  const runs = segments.flatMap((s) => (s.times === 1 ? s.runs : Array.from({ length: s.times }, () => s.runs).flat()));
  return { normalized, picksBySortOrder: picks, runs };
}

/**
 * Atkı seçici sütunu: kodu atkı atkı açar ("A2 C1" → [1, 1, 3]; 1-tabanlı iplik satırı no).
 * Gösterim içindir (armür ızgarası + desen kartı basımı); kod geçersizse ya da tavanı aşarsa null
 * (yazım yolu zaten `parseWeftSequence` ile reddeder — eski/bozuk kayıt ekranı düşürmesin).
 */
export function expandWeftSequence(raw: string | null | undefined, yarnCount: number, maxPicks: number): number[] | null {
  if (!raw || yarnCount <= 0) return null;
  let parsed: ParsedWeftSequence;
  try {
    parsed = parseWeftSequence(raw, yarnCount);
  } catch {
    return null;
  }
  const out: number[] = [];
  for (const r of parsed.runs) {
    if (out.length + r.count > maxPicks) return null;
    for (let i = 0; i < r.count; i++) out.push(r.index + 1);
  }
  return out;
}

/** Satır sırasının harfi (0 → "A"); 26'dan sonrası sıra numarasıyla yazılır. */
export function weftLetter(sortOrder: number): string {
  return sortOrder < 26 ? String.fromCharCode(65 + sortOrder) : `#${sortOrder + 1}`;
}
