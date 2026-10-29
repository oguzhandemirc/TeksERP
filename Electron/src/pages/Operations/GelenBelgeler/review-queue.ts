// Kılavuzlu hücre girişi (saf): `needsReview` satırların hücre kuyruğu + kaynak dikdörtgenleri.
// Rect anahtarları motorun hücre anahtarlarıdır (`taslak.ts` METER_KEYS `m|metre`, `kg`, satır kutusu `row`).
import type { DeliveryNoteLine, OcrRect } from "./types";

export type ReviewField = "meters" | "weightKg";
export interface ReviewItem {
  lineId: string;
  lineNo: number;
  blockNo: number;
  field: ReviewField;
}

const METER_RECT_KEYS = ["m", "metre"];
const NON_VALUE_KEYS = new Set(["row", "topNo", "siraNo", "kg", "en", "cm"]);

type RectLine = Pick<DeliveryNoteLine, "sourceRects">;

/** Hücre dikdörtgeni: metre anahtarı → yoksa (el yazısı ızgarası) değer hücresi → yoksa satır kutusu. */
export function fieldRect(line: RectLine, field: ReviewField): OcrRect | null {
  const r = line.sourceRects ?? {};
  if (field === "weightKg") return r.kg ?? null;
  for (const k of METER_RECT_KEYS) if (r[k]) return r[k];
  const other = Object.entries(r).find(([k]) => !NON_VALUE_KEYS.has(k));
  return other?.[1] ?? r.row ?? null;
}

/** Satırın bütün kaynak kutularının birleşimi (fotoğrafta vurgu). */
export function lineRect(line: RectLine): OcrRect | null {
  const rs = Object.values(line.sourceRects ?? {}).filter((x) => x && Number.isFinite(x.x) && x.width > 0 && x.height > 0);
  if (rs.length === 0) return null;
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.width));
  const y1 = Math.max(...rs.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

type QueueLine = Pick<DeliveryNoteLine, "id" | "lineNo" | "blockNo" | "needsReview" | "status" | "rollId" | "sourceRects">;

/** Kuyruk: açık (topsuz, atlanmamış) ve `needsReview` satırlar; metre her zaman, kg yalnız kutusu varsa. Sıra blok → satır. */
export function buildReviewQueue(lines: readonly QueueLine[]): ReviewItem[] {
  return [...lines]
    .filter((l) => l.needsReview && l.status !== "SKIPPED" && !l.rollId)
    .sort((a, b) => a.blockNo - b.blockNo || a.lineNo - b.lineNo)
    .flatMap((l) => {
      const base = { lineId: l.id, lineNo: l.lineNo, blockNo: l.blockNo };
      const items: ReviewItem[] = [{ ...base, field: "meters" }];
      if (l.sourceRects?.kg) items.push({ ...base, field: "weightKg" });
      return items;
    });
}

/** Türkçe sayı girişi: virgül ondalık, nokta binlik. Geçersiz/≤0 → null. */
export function parseTrNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return null;
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d+)?$/.test(norm)) return null;
  const n = Number(norm);
  return n > 0 && Number.isFinite(n) ? n : null;
}
