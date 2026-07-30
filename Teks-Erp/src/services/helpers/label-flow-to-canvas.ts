// =============================================================================
// Akış-modeli şablon → kanvas yerleşimi dönüştürücü (Etiket Stüdyosu migration)
// =============================================================================
// Mevcut satır-akışlı üreticilerin (label-ppla/pplb/zpl.helper) hesapladığı
// konumları koordinatlara "YAKAR": aynı iskelet — sol-üst QR, QR ayak izinden
// sağa kayan metin kolonu, otomatik satır adımı (fontYük×çarpan + boşluk), alt
// tam-genişlik Code128, opsiyonel sağ dikey metraj bandı. Sonuç eleman listesi
// kanvas emitter'larından geçince akış çıktısıyla GÖRSEL-EŞDEĞER olur
// (test_label_canvas_equivalence ±1mm toleransla kanıtlar).
//
// SAF fonksiyon — DB yok; tetikleme scripts/migrate_label_templates_to_canvas.ts.
//
// Bilinen küçük sapmalar (tolerans içinde, kabul):
// - Alt bant okunur-satır payı tek geometride 3.5mm (PPLB/ZPL paritesi); PPLA
//   akışı 4mm kullanıyordu → PPLA'da barkod bandı ~0.5mm yukarı.
// - mm'ye yuvarlama (2 ondalık) ≤0.05mm sapma ekler.
// - "Adnan Şahin Tekstil" HTML marka satırı BİLEREK taşınmaz (native'de hiç
//   yoktu; ekleseydik native çıktı değişirdi). İsteyen editörden statik metin
//   elemanı olarak ekler.
// =============================================================================

import type { LabelKind } from "@prisma/client";
import type { TemplateField } from "../../config/label-fields";
import type { ResolvedLabelFormat } from "./label-format.resolver";
import type { CanvasLayout, LabelElement } from "../../config/label-elements";
import { CANVAS_SCHEMA_VERSION } from "../../config/label-elements";
import {
  EPL_FONT,
  LINE_GAP_MM,
  mmToDots,
  qrFootprintDots,
  resolveLineStepMm,
  resolveQrScale,
} from "./native-label.shared";
import { fieldDisplayValue } from "./label-field-values";
import { mockPayload } from "./label-rawcode";

export interface FlowTemplateShape {
  kind: LabelKind;
  fields: TemplateField[];
  lineStepMm: number | null;
  qrScale: number | null;
  lengthBanner: boolean | null;
}

/** Akış üreticisiyle aynı bant glif çarpanı. */
const BANNER_MUL = 3;
/** Alt Code128 bar yüksekliği (mm) — akış üreticileriyle aynı. */
const BC_BARS_MM = 9;
/** Okunur satır payı (mm) — PPLB/ZPL paritesi (PPLA akışı 4'tü; tolerans içinde). */
const BC_HUMAN_MM = 3.5;

export function flowTemplateToCanvas(
  tpl: FlowTemplateShape,
  format: ResolvedLabelFormat,
): CanvasLayout {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const toMm = (dots: number) => Math.round((dots * 25.4 / dpi) * 100) / 100;

  const widthDots = d(format.widthMm);
  const heightDots = d(format.heightMm);
  const left = d(format.marginLeftMm);
  const top = d(format.marginTopMm);
  const right = widthDots - d(format.marginRightMm);
  const bottomEdge = heightDots - d(format.marginBottomMm);

  const qrScale = resolveQrScale(tpl.qrScale);
  const gap = d(resolveLineStepMm(tpl.lineStepMm) ?? LINE_GAP_MM);

  // Örnek payload — QR ayak izi (barkod uzunluğu) + alan rolleri (headline/row)
  // için. Gerçek barkodlar TEKS+tarih formatında benzer uzunluktadır.
  const payload = mockPayload(tpl.kind);
  const bc = payload.barcode ?? "";

  // Metraj bandı yalnız TOP etiketinde (kartela/çuval hariç — label-template.service
  // getDefaults ile aynı kural).
  const bannerOn =
    tpl.lengthBanner === true &&
    tpl.kind !== ("SWATCH" as LabelKind) &&
    tpl.kind !== ("SACK" as LabelKind);
  const bannerW = bannerOn ? EPL_FONT.xl.h * BANNER_MUL : 0;
  const contentRight = bannerOn ? right - bannerW - d(2) : right;

  const bcTop = bottomEdge - d(BC_BARS_MM) - d(BC_HUMAN_MM);

  const elements: LabelElement[] = [];

  // --- Sol-üst QR; metin kolonu ayak izinden sağa kayar (akışla birebir) ---
  let textX = left;
  if (bc.length > 0) {
    const qrPx = Math.min(qrFootprintDots(bc, qrScale), Math.round((contentRight - left) * 0.45));
    elements.push({ id: "qr", type: "qr", x: toMm(left), y: toMm(top), scale: qrScale });
    textX = left + qrPx + d(2);
  }

  // --- Metin satırları: görünür + scan-olmayan alanlar order'a göre; y akümülasyonu
  //     ve alt-banda-girmeden-kes eşiği akış üreticisiyle aynı ---
  let y = top;
  const sorted = [...tpl.fields]
    .filter((f) => f.isVisible)
    .map((f) => ({ f, dv: fieldDisplayValue(payload, f.key) }))
    .filter((x) => x.dv.role !== "scan")
    .sort((a, b) => a.f.order - b.f.order);
  for (const { f, dv } of sorted) {
    const size = f.fontSize ?? (dv.role === "headline" ? "lg" : "md");
    const bold = f.isBold ?? false;
    const cellH = (EPL_FONT[size] ?? EPL_FONT.md).h * (bold ? 2 : 1);
    if (y + cellH > bcTop - d(1)) break; // akışla aynı kesme
    elements.push({
      id: `f-${f.key}`,
      type: "field",
      bind: f.key,
      label: f.label,
      x: toMm(textX),
      y: toMm(y),
      font: size,
      bold,
    });
    y += cellH + gap;
  }

  // --- Alt tam-genişlik Code128 + okunur satır ---
  if (bc.length > 0) {
    elements.push({
      id: "bc",
      type: "code128",
      x: toMm(left),
      y: toMm(bcTop),
      hMm: BC_BARS_MM,
      human: true,
    });
  }

  // --- Sağ dikey metraj bandı (PPLB/ZPL; PPLA capability matrisi zaten atlar) ---
  if (bannerOn) {
    elements.push({
      id: "banner",
      type: "lengthBanner",
      x: toMm(right - bannerW),
      y: toMm(top),
      wMm: toMm(bannerW),
      hMm: toMm(bottomEdge - top),
    });
  }

  return { v: CANVAS_SCHEMA_VERSION, elements };
}
