// =============================================================================
// Tambur etiket önizlemesi — SAF kompozisyon (DB'siz; bekçi `test_tambur_etiket_onizleme`)
// =============================================================================
// Taslak değerleri payload'a uygular ve kanvas elemanlarını HTML render'ının metin fonksiyonlarıyla
// çizilebilir biçime çevirir. Servis (`label-preview.ts`) DB okumasını yapar, burayı çağırır.
// =============================================================================
import type { LabelKind } from "@prisma/client";
import type { LabelPayload } from "../../types/label.types";
import type { LabelTemplateOption } from "../helpers/label-template-options.helper";
import { elementSupported, prepareElements, type LabelElement } from "../../config/label-elements";
import { elementText } from "../helpers/label-canvas-native.helper";
import { bannerValueText, qrFootprintDots } from "../helpers/native-label.shared";
import { previewSeriesCode, resolveSeriesFormat } from "../number-series.service";

export interface TamburLabelDraft {
  /** Boş = kalanı kes → ana topun kalanı basılır. */
  lengthMeters?: number | null;
  weightKg?: number | null;
  widthCm?: number | null;
  /** Kalite KODU (showIf koşulu kodla çalışır). */
  qualityGrade?: string | null;
  labelItemName?: string | null;
  labelColorName?: string | null;
  labelBatchNo?: string | null;
}

export type TamburPreviewElement =
  // empty: değeri olmayan veri alanı — YALNIZ önizlemede işaretlenir (basımda bugünkü gibi hiç çizilmez); text = alan etiketi.
  // auto: değeri kesimde SİSTEMİN atadığı alan (barkod metni, basım tarihi) — eksik değil, elle girilmez (2026-11-11).
  | { type: "text"; x: number; y: number; hMm: number; bold: boolean; align: "left" | "center" | "right"; rot: number; wr: number; text: string; bind: string | null; empty?: true; auto?: true }
  | { type: "line" | "box"; x: number; y: number; wMm: number; hMm: number; thickMm: number }
  | { type: "code128"; x: number; y: number; wMm: number; hMm: number; human: boolean; humanHMm: number; value: string | null }
  | { type: "qr"; x: number; y: number; sizeMm: number }
  | { type: "banner"; x: number; y: number; wMm: number; hMm: number; rot: number; text: string; bind: "lengthMeters" };

export interface TamburLabelPreview {
  kind: LabelKind;
  templateId: string | null;
  templateName: string | null;
  widthMm: number;
  heightMm: number;
  /** Taslaksız (miras) en — ekrandaki En kutusunun ipucu; kesime gönderilmez. */
  sourceWidthCm: number | null;
  /** Kanvas varyantı → konumlu elemanlar; akış şablonunda null. */
  elements: TamburPreviewElement[] | null;
  /** Akış şablonu (ya da şablonsuz yedek) → sıralı satırlar. */
  rows: Array<{ key: string | null; text: string; size: string; bold: boolean }> | null;
  /** Seçilebilir şablonlar (varsayılan + müşteri seti + herkes için set; tekrarsız). */
  templateOptions: LabelTemplateOption[];
  defaultTemplateId: string | null;
}

/** Değeri kesim anında sistemin atadığı alanlar: önizlemede değersiz olmaları beklenendir, "boş" uyarısı değildir. */
export const SYSTEM_ASSIGNED_BINDS: ReadonlySet<string> = new Set(["barcode", "qrCode", "printedAt", "woundAt"]);

/** Eski kademeli font yüksekliği (mm, ~203 dpi) — `hMm` olmayan eski elemanlar için yaklaşık. */
const LEGACY_FONT_MM: Record<string, number> = { sm: 1.5, md: 2.2, lg: 3.0, xl: 4.2 };
/** QR/barkod ayak izi için örnek çocuk barkodu — top serisinden türetilir (biçim veri; literal bayatlar). */
const sampleRollCode = (): string => previewSeriesCode(resolveSeriesFormat("roll"), 1);

/** Taslak değerleri payload'a uygular — çocuğun kesimde alacağı ölçüler. Saf. */
export function applyTamburDraft(payload: LabelPayload, draft: TamburLabelDraft): LabelPayload {
  return {
    ...payload,
    // Çocuğun barkodu kesimde doğar; ana topun barkodu BASILMAZ.
    barcode: "",
    lengthMeters: draft.lengthMeters != null && draft.lengthMeters > 0 ? draft.lengthMeters : payload.lengthMeters,
    weightKg: draft.weightKg != null && draft.weightKg > 0 ? draft.weightKg : null,
    widthCm: draft.widthCm != null && draft.widthCm > 0 ? draft.widthCm : payload.widthCm,
    qualityGrade: draft.qualityGrade ?? "",
  };
}

/** Taslak uygulanmadan önceki (miras) en; yoksa/≤0 null. Saf. */
export function sourceWidthOf(payload: LabelPayload): number | null {
  return payload.widthCm != null && payload.widthCm > 0 ? payload.widthCm : null;
}

/** Kanvas elemanlarını çizilebilir biçime çevirir — metin baskı fonksiyonlarından. Saf. */
export function composeCanvasElements(
  elements: LabelElement[],
  payload: LabelPayload,
  opts: { language: string; heightMm: number; dpi: number },
): TamburPreviewElement[] {
  const dotsPerMm = (opts.dpi || 203) / 25.4;
  const out: TamburPreviewElement[] = [];
  for (const el of prepareElements(elements, payload)) {
    if (!elementSupported(el.type, opts.language)) continue;
    switch (el.type) {
      case "field":
      case "text": {
        const text = elementText(el, payload);
        const unset = !text && el.type === "field";
        const auto = unset && SYSTEM_ASSIGNED_BINDS.has(el.bind);
        const empty = unset && !auto;
        if (!text && !unset) break;
        out.push({
          type: "text", x: el.x, y: el.y,
          hMm: el.hMm ?? LEGACY_FONT_MM[el.font ?? "md"] ?? 2.2,
          bold: el.bold === true,
          align: el.align ?? "left",
          rot: el.rot ?? 0,
          wr: el.wr ?? 1,
          text: empty && el.type === "field" ? el.label?.trim() ?? "" : text ?? "",
          bind: el.type === "field" ? el.bind : null,
          ...(empty ? { empty: true as const } : {}),
          ...(auto ? { auto: true as const } : {}),
        });
        break;
      }
      case "line":
        out.push({ type: "line", x: el.x, y: el.y, wMm: el.wMm, hMm: el.hMm, thickMm: 0 });
        break;
      case "box":
        out.push({ type: "box", x: el.x, y: el.y, wMm: el.wMm, hMm: el.hMm, thickMm: el.thickMm ?? 0.5 });
        break;
      case "code128":
        // Code128-B genişliği ≈ (11·karakter + 35) modül × modül dot'u; çocuk barkodu henüz yok → örnek uzunluk.
        out.push({
          type: "code128", x: el.x, y: el.y,
          wMm: ((sampleRollCode().length * 11 + 35) * (el.mw ?? 2)) / dotsPerMm,
          hMm: el.hMm ?? 9, human: el.human !== false, humanHMm: el.humanHMm ?? 1.5, value: null,
        });
        break;
      case "qr":
        out.push({ type: "qr", x: el.x, y: el.y, sizeMm: qrFootprintDots(sampleRollCode(), el.scale ?? 5) / dotsPerMm });
        break;
      case "lengthBanner":
        out.push({
          type: "banner", x: el.x, y: el.y,
          wMm: el.wMm ?? 10,
          hMm: el.hMm ?? Math.max(10, opts.heightMm - 2 * el.y),
          rot: el.rot ?? 90,
          text: bannerValueText(payload, el.unit !== false),
          bind: "lengthMeters",
        });
        break;
      default:
        break;
    }
  }
  return out;
}
