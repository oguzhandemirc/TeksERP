// D3a (2026-10-28): eğime duyarlı satır gruplama. Prototipin ölçümü (ocr-test/yapilacaklar-listesi.md:20):
// basit y-gruplama 0245'te 6/21, eğime duyarlı gruplama 21/21. Algoritma orada tarif edilmiş, kodu burada yazıldı.
/**
 * Her kutu kendi üst kenar eğimi boyunca SAĞINDAKİ en yakın kutuya bağlanır:
 *   |cy_b − (cy_a + tan(a)·dx)| < 0,5·min(h_a, h_b)
 * Dar kutularda (genişlik < 3·yükseklik; motor onlara açı veremez, 0 döner) sayfa MEDYAN açısı kullanılır.
 * Bağlı bileşenler = satır. `buildRows` (geometry.ts) dokunulmadı: anchor/regex onu kullanmaya devam eder,
 * tablo stratejisi bunu kullanır.
 */
import type { OcrLine, OcrRect, Row } from "./types";
import { centerX, centerY, unionRect } from "./geometry";

const NARROW_RATIO = 3;
const MAX_DX_RATIO = 30;
const RIGHT_OVERLAP_TOLERANCE = 0.3;

/** Kutunun açısı (derece): geniş kutuda kendi açısı; dar kutuda ya da açı yoksa sayfa medyanı. */
export function effectiveAngle(line: OcrLine, pageMedianDeg: number): number {
  const r = line.rect;
  const own = typeof line.angle === "number" && Number.isFinite(line.angle) ? line.angle : null;
  if (own === null || r.width < NARROW_RATIO * r.height) return pageMedianDeg;
  return own;
}

/** Sayfa medyan açısı: yalnız geniş ve açısı bilinen kutular; hiç yoksa 0. */
export function pageMedianAngle(lines: OcrLine[]): number {
  const angles = lines
    .filter((l) => typeof l.angle === "number" && Number.isFinite(l.angle) && l.rect.width >= NARROW_RATIO * l.rect.height)
    .map((l) => l.angle as number)
    .sort((a, b) => a - b);
  if (angles.length === 0) return 0;
  const mid = Math.floor(angles.length / 2);
  return angles.length % 2 === 1 ? angles[mid]! : (angles[mid - 1]! + angles[mid]!) / 2;
}

/** a'nın sağındaki en yakın, eğim boyunca aynı satırda kalan kutu; yoksa -1. */
function nearestRight(i: number, lines: OcrLine[], angleDeg: number): number {
  const a = lines[i]!.rect;
  const tan = Math.tan((angleDeg * Math.PI) / 180);
  const cxA = centerX(a);
  const cyA = centerY(a);
  let best = -1;
  let bestDx = Infinity;
  for (let j = 0; j < lines.length; j++) {
    if (j === i) continue;
    const b = lines[j]!.rect;
    // Sağda başlamalı (hafif çakışmaya tolerans) ve çok uzak olmamalı
    if (b.x < a.x + a.width - RIGHT_OVERLAP_TOLERANCE * a.height) continue;
    const dx = centerX(b) - cxA;
    if (dx <= 0 || dx > MAX_DX_RATIO * Math.max(a.height, 1)) continue;
    const predicted = cyA + tan * dx;
    if (Math.abs(centerY(b) - predicted) >= 0.5 * Math.min(a.height, b.height)) continue;
    if (dx < bestDx) {
      bestDx = dx;
      best = j;
    }
  }
  return best;
}

function findRoot(parent: number[], x: number): number {
  let r = x;
  while (parent[r] !== r) r = parent[r]!;
  while (parent[x] !== r) {
    const next = parent[x]!;
    parent[x] = r;
    x = next;
  }
  return r;
}

function toRow(lines: OcrLine[]): Row {
  const sorted = [...lines].sort((a, b) => a.rect.x - b.rect.x);
  const u: OcrRect = unionRect(sorted.map((l) => l.rect));
  return { y: u.y, height: u.height, lines: sorted, text: sorted.map((l) => l.text.trim()).join("  ") };
}

/** Eğime duyarlı satırlar; üstten alta (satırın en soldaki kutusunun merkez y'si) sıralı. */
export function buildRowsTilted(input: OcrLine[]): Row[] {
  const lines = input.filter((l) => l.text.trim().length > 0);
  if (lines.length === 0) return [];
  const median = pageMedianAngle(lines);
  const parent = lines.map((_, i) => i);
  for (let i = 0; i < lines.length; i++) {
    const j = nearestRight(i, lines, effectiveAngle(lines[i]!, median));
    if (j < 0) continue;
    const ri = findRoot(parent, i);
    const rj = findRoot(parent, j);
    if (ri !== rj) parent[ri] = rj;
  }
  const groups = new Map<number, OcrLine[]>();
  lines.forEach((l, i) => {
    const r = findRoot(parent, i);
    const g = groups.get(r) ?? [];
    g.push(l);
    groups.set(r, g);
  });
  const rows = [...groups.values()].map(toRow);
  rows.sort((a, b) => centerY(a.lines[0]!.rect) - centerY(b.lines[0]!.rect));
  return rows;
}
