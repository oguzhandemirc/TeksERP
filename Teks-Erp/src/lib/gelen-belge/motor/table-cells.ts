// Tablo hücresi okuması (D3a, table.ts'ten bölündü — dosya boyu tavanı): kolon alanı, çizgi/tire temizleyici, hücre kurucu.
import type { FieldSpec, OcrLine, TableCell, TableColumnSpec } from "./types";
import { unionRect, averageConfidence } from "./geometry";
import { isNumericText } from "./labels";
import { evaluateCandidate } from "./extract";
import { lineElements } from "./anchor";

const DEFAULT_MIN_CONFIDENCE = 0.85;

function columnField(col: TableColumnSpec): FieldSpec {
  return { key: col.key, label: col.label, type: col.type, pattern: col.pattern, strategies: [] };
}

// Hücre kenarındaki "|" "¦" "[" "]" tablo çizgisidir, rakam değil ("212,30|" → 212.301; "3.935,00|" toplamı düşürüyordu, 214279).
// YALNIZ baş/son: sayının içindeki karakter ("3.9|35,00") yutulmaz. Tablo hücresi okuması ve sayı sınaması bu tek temizleyiciden.
const RULE_EDGES = /^[|¦[\]]+\s*|\s*[|¦[\]]+$/g;
export const cellText = (text: string): string => text.trim().replace(RULE_EDGES, "");
export const isNumericCell = (text: string): boolean => isNumericText(cellText(text));
// Top satırı ve toplam satırı ölçüsü (kg/metre) eksi olmaz (kullanıcı kararı): sayıdan BOŞLUKLA ayrık baş tire çizgi gürültüsüdür
// ("- 212,30" → 212,3; GB1011260003). Yalnız bu hücrelerde; genel sayı ayrıştırıcı ve başka alanlar eksiyi korur.
const MEASURE_KEYS = new Set(["kg", "m", "metre"]);
const RULE_DASH = /^[-–—_]+\s+(?=\d)/;
export const measureText = (text: string): string => cellText(text).replace(RULE_DASH, "");
export const isMeasureCell = (text: string): boolean => isNumericText(measureText(text));

export function makeCell(col: TableColumnSpec, lines: OcrLine[], measure = MEASURE_KEYS.has(col.key)): TableCell {
  const raw = measure ? measureText(lines.map((l) => cellText(l.text)).join(" ")) : lines.map((l) => cellText(l.text)).join(" ");
  const fr = evaluateCandidate(
    columnField(col),
    { raw, ocrConfidence: averageConfidence(lines.flatMap(lineElements)), labelSimilarity: 1, strategyIndex: 0, kind: "roi" },
    DEFAULT_MIN_CONFIDENCE,
  );
  return { key: col.key, raw, value: fr.value, rect: unionRect(lines.map((l) => l.rect)), confidence: fr.confidence, needsReview: fr.needsReview };
}
