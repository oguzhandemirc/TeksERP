// METRE ↔ KG HÜCRE ÇAKIŞMASI (belge tanıt 3 aşama, 2026-11-09; saf). Ölçülen kök neden (demo u-komurhan-ceki-listesi v3):
// "Hedef kg" ile "Gelen metre" AYNI etiketten ("TOPLAM" → sağ) okunuyordu; okuyucu etiketin sağındaki İLK sayıyı aldığından
// kg = metre = 241 oldu (dokunulan kutular ayrıydı, kesişim %0). Tanıtma atlamayı öğrenir (`skipWords`); öğrenemeyen ya da
// eski şablon bu yüklemle yakalanır — tanıtmada hata (`teachErrors`), okumada kg alanı yazılmaz (`KG_FROM_METER_CELL`).
import { DEFAULT_MIN_LABEL_SIMILARITY, buildAnchorContext, findLabelMatches, findValueBelow, findValueRight } from "./anchor";
import { buildRows } from "./geometry";
import type { AnchorStrategy, DocumentTemplate, FieldSpec, NormRect, OcrRect, OcrResult } from "./types";

export const METER_FAMILY_FIELDS = ["toplamMetre", "hedefMetraj"] as const;
export const KG_FAMILY_FIELDS = ["toplamKg", "hedefKg"] as const;
/** Kutu kesişimi küçük kutunun alanına oranla bu eşik ve üstündeyse "aynı hücre". */
export const SAME_CELL_RATIO = 0.5;

export interface MeterKgClash {
  kg: string;
  meter: string;
}

function boxOf(f: FieldSpec): NormRect | null {
  for (const s of f.strategies) if (s.kind === "roi") return s.roi;
  return null;
}

function anchorKey(f: FieldSpec): string | null {
  const s = f.strategies[0];
  if (s?.kind !== "anchor") return null;
  const labels = s.labels.map((l) => l.trim().toLowerCase()).sort().join("|");
  return JSON.stringify([labels, s.direction ?? "rightOrBelow", s.window ?? null, s.skipWords ?? 0]);
}

/** İki normalize kutunun kesişimi / küçük kutunun alanı (0..1). */
export function sameCellRatio(a: NormRect, b: NormRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const small = Math.min(a.w * a.h, b.w * b.h);
  return w <= 0 || h <= 0 || small <= 0 ? 0 : (w * h) / small;
}

/** Metre ailesi ile kg ailesi alanı aynı hücreden okunuyor mu: aynı ilk etiket stratejisi ya da konum kutuları ≥ %50 kesişir. */
export function meterKgClashes(t: Pick<DocumentTemplate, "fields"> | null | undefined): MeterKgClash[] {
  const fields = t?.fields ?? [];
  const pick = (keys: readonly string[]) => fields.filter((f) => keys.includes(f.key));
  const out: MeterKgClash[] = [];
  for (const kg of pick(KG_FAMILY_FIELDS)) {
    for (const meter of pick(METER_FAMILY_FIELDS)) {
      const ka = anchorKey(kg);
      const kb = boxOf(kg);
      const mb = boxOf(meter);
      const sameAnchor = ka !== null && ka === anchorKey(meter);
      const sameBox = !!kb && !!mb && sameCellRatio(kb, mb) >= SAME_CELL_RATIO;
      if (sameAnchor || sameBox) out.push({ kg: kg.key, meter: meter.key });
    }
  }
  return out;
}

/** Çakışan kg alanları (okuma koruması bunları forma yazmaz). */
export function clashingKgFields(t: Pick<DocumentTemplate, "fields"> | null | undefined): Set<string> {
  return new Set(meterKgClashes(t).map((c) => c.kg));
}

const centerIn = (e: OcrRect, r: OcrRect) => {
  const x = e.x + e.width / 2;
  const y = e.y + e.height / 2;
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
};

/**
 * Tanıtmada atlama öğrenimi: okuyucunun bu etiketten alacağı aday kelimeler içinde dokunulan değerin ilk kelimesinin sırası.
 * 0 = değer zaten ilk sırada (atlama yok); dokunulan değer adayda yoksa 0 (konum yedeği okur).
 */
export function learnAnchorSkip(ocr: OcrResult, s: AnchorStrategy, labelRect: OcrRect, valueRect: OcrRect): number {
  const ctx = buildAnchorContext(ocr, buildRows(ocr), []);
  const own = findLabelMatches(ctx, s.labels, DEFAULT_MIN_LABEL_SIMILARITY).find((m) => centerIn(m.rect, labelRect) || centerIn(labelRect, m.rect));
  if (!own) return 0;
  const probe: AnchorStrategy = { kind: "anchor", labels: s.labels, direction: s.direction, stopAtLabels: false };
  const cand = s.direction === "below" ? findValueBelow(own, ctx, probe) : findValueRight(own, ctx, probe);
  const idx = cand ? cand.elements.findIndex((e) => centerIn(e.rect, valueRect)) : -1;
  return idx > 0 ? idx : 0;
}
