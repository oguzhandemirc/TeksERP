// =============================================================================
// Roll etiketi — tek HTML render kaynağı
// =============================================================================
// Hem mobil print akışı (expo-print) hem Electron LabelPreview iframe'i bu
// HTML'i tüketir. Yalnız buradan değiştirilir → "Electron'daki ile mobil'deki
// etiket farklı" sorunu yapısal olarak çözülür.
//
// Yön: format profilinin orientation'ına göre düzen seçilir.
//   - LANDSCAPE (kumaş etiketi 100×60) → iki-kolon yatay düzen
//     (`label-html-landscape.helper`): solda QR+Code128, sağda metin.
//   - PORTRAIT (eski A6 100×148 / kod fallback) → aşağıdaki dikey istif.
// Sayfa boyutu = medyanın gerçek basılan ölçüsü (widthMm × heightMm) — takas YOK;
// orientation yalnız DÜZEN dalını seçer.
//
// Inputs:
//   - payload: LabelPayload (effective name cascade ile)
//   - template: LabelTemplate | null — admin'in Electron'da yönettiği şablon.
//     null → catalog default'a göre tüm alanlar açık (failsafe).
//   - barcodeSvg: bwip-js Code128 SVG (scanner-okur)
//   - qrSvg: bwip-js QR SVG (mobil scanner)
// =============================================================================

import type { LabelPayload } from "../../types/label.types";
import type { LabelTemplate } from "@prisma/client";
import {
  type TemplateField,
  type LabelFormatGeometry,
  DEFAULT_LABEL_FORMAT,
  makeFieldHelpers,
  isVisibleDefaultOn,
  escapeHtml,
  formatNumber,
  formatDate,
  applyCopies,
} from "./label-html.shared";
import { buildLandscapeRollLabelHtml } from "./label-html-landscape.helper";

// Resolver (label-format.resolver) bunları buradan import ediyor → re-export.
export { DEFAULT_LABEL_FORMAT };
export type { LabelFormatGeometry };

export interface BuildArgs {
  payload: LabelPayload;
  template: LabelTemplate | null;
  barcodeSvg: string;
  qrSvg: string;
  /** Saha #6: aynı etiket kaç sayfa basılsın (default 1; ayar default'u 2 —
   *  topun üstüne + altına yapıştırılıyor). 1-5'e kırpılır. */
  copies?: number;
  /** Fiziksel baskı geometrisi (medya + pay). Verilmezse DEFAULT_LABEL_FORMAT. */
  format?: LabelFormatGeometry;
}

export function buildRollLabelHtml(args: BuildArgs): string {
  const fmt = { ...DEFAULT_LABEL_FORMAT, ...(args.format ?? {}) };
  // Yatay (kumaş etiketi 100×60) → iki-kolon builder; aksi halde dikey istif.
  if (fmt.orientation === "LANDSCAPE") {
    return buildLandscapeRollLabelHtml(args);
  }
  return buildPortraitRollLabelHtml(args, fmt);
}

// ---------------------------------------------------------------------------
// PORTRAIT (dikey A6 istif) — eski düzen; kod fallback ve dikey profiller için.
// ---------------------------------------------------------------------------
function buildPortraitRollLabelHtml(
  { payload, template, barcodeSvg, qrSvg, copies = 1 }: BuildArgs,
  fmt: Required<LabelFormatGeometry>,
): string {
  const pageW = fmt.widthMm;
  const pageH = fmt.heightMm;
  const contentWidthMm = Math.max(0, pageW - fmt.marginMm * 2);
  const fields: TemplateField[] | null = template
    ? (template.fields as unknown as TemplateField[])
    : null;

  const itemName = escapeHtml(payload.itemName || "—");
  const itemNameDefault = payload.itemNameDefault
    ? escapeHtml(payload.itemNameDefault)
    : "";
  const colorName = payload.colorName ? escapeHtml(payload.colorName) : "";
  const colorNameDefault = payload.colorNameDefault
    ? escapeHtml(payload.colorNameDefault)
    : "";
  const colorCode = payload.colorCode ? escapeHtml(payload.colorCode) : "";
  const qty = formatNumber(payload.lengthMeters);
  const widthLabel =
    payload.widthCm != null ? `${formatNumber(payload.widthCm)} cm` : "—";
  const weightLabel =
    payload.weightKg != null ? `${formatNumber(payload.weightKg)} kg` : "";
  const quality = escapeHtml(payload.qualityGrade ?? "");
  const date = formatDate(payload.printedAt);
  const safeBatch = payload.batchNumber ? escapeHtml(payload.batchNumber) : "";
  const barcode = escapeHtml(payload.barcode || "");
  const customerName = payload.customerName ? escapeHtml(payload.customerName) : "";
  const orderNumber = payload.orderNumber ? escapeHtml(payload.orderNumber) : "";

  const { vis, lbl, sty } = makeFieldHelpers(fields);

  // Kartela damgası OPT-OUT: bu alan (kartelaMark) catalog'a sonradan eklendi,
  // dolayısıyla daha eski kayıtlı template'lerde HİÇ bulunmaz. Generic vis()
  // "alan yok = kapalı" der; burada ise "alan yok = açık" istiyoruz ki eski
  // template'ler veri migrasyonu gerektirmeden damgayı bassın. Sadece admin
  // alanı bilerek isVisible=false yaptıysa gizlenir.
  const visKartela = isVisibleDefaultOn(fields, "kartelaMark");

  // "Serbest" metin satırları (başlık/scan değil) — şablon `order`'ına göre dizilir
  // (kullanıcı kararı #4). Default/null şablon = katalog sırası → bugünküyle aynı.
  const orderOf = (key: string) => fields?.find((f) => f.key === key)?.order ?? 999;
  const freeRows = [
    { key: "itemNameDefault", value: itemNameDefault, def: "Ürün (bizdeki ad)" },
    { key: "colorNameDefault", value: colorNameDefault, def: "Renk (bizdeki ad)" },
    { key: "colorCode", value: colorCode, def: "Renk Kodu" },
    { key: "customerName", value: customerName, def: "Müşteri" },
    { key: "orderNumber", value: orderNumber, def: "Sipariş" },
  ]
    .filter((r) => r.value && vis(r.key))
    .sort((a, b) => orderOf(a.key) - orderOf(b.key))
    .map((r) => `<div class="meta-row" style="${sty(r.key)}"><span class="k">${lbl(r.key, r.def)}</span><span>${r.value}</span></div>`)
    .join("\n    ");

  const fullHtml = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>Top Etiketi · ${barcode || "—"}</title>
<style>
  @page { size: ${pageW}mm ${pageH}mm; margin: ${fmt.marginMm}mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #0f172a; }
  .label {
    width: ${contentWidthMm}mm;
    margin: 0;
    border: 1.5px solid #0f172a;
    border-radius: 4mm;
    padding: 3mm;
    display: flex;
    flex-direction: column;
    gap: 2mm;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 9pt;
    color: #475569;
    border-bottom: 0.5px solid #cbd5e1;
    padding-bottom: 1.5mm;
  }
  .top .brand { font-weight: 700; letter-spacing: 1px; }
  .top .batch { font-family: ui-monospace, monospace; font-weight: 700; color: #0f172a; }
  .kartela-stamp {
    background: #7c3aed;
    color: #ffffff;
    font-size: 11pt;
    font-weight: 900;
    letter-spacing: 2px;
    text-align: center;
    text-transform: uppercase;
    padding: 1.5mm 0;
    border-radius: 2mm;
  }
  .qty {
    font-size: 32pt;
    font-weight: 900;
    line-height: 1;
    text-align: center;
    padding: 2mm 0;
  }
  .qty .unit { font-size: 14pt; font-weight: 600; color: #475569; }
  .item-name {
    font-size: 12pt;
    font-weight: 700;
    text-align: center;
    line-height: 1.2;
  }
  .color-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2mm;
    font-size: 11pt;
    font-weight: 700;
  }
  .qr-row {
    display: flex;
    align-items: center;
    gap: 3mm;
    margin-top: 1mm;
  }
  .qr {
    width: 28mm;
    height: 28mm;
    flex-shrink: 0;
  }
  .qr svg { width: 100%; height: 100%; }
  .qr-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1mm;
    min-width: 0;
  }
  .barcode-block {
    margin-top: 1mm;
    padding-top: 1.5mm;
    border-top: 0.5px solid #cbd5e1;
  }
  .barcode-img {
    width: 100%;
    max-height: 14mm;
    display: block;
  }
  .barcode-img svg { width: 100%; height: 100%; }
  .barcode-text {
    font-family: ui-monospace, monospace;
    font-size: 8pt;
    font-weight: 700;
    text-align: center;
    letter-spacing: 0.5px;
    margin-top: 0.5mm;
    word-break: break-all;
    line-height: 1.1;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    font-size: 9pt;
    color: #334155;
  }
  .meta-row .k { font-weight: 600; }
  .footer {
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #0f172a;
    font-weight: 600;
    border-top: 0.5px solid #cbd5e1;
    padding-top: 1.5mm;
  }
</style>
</head>
<body>
  <div class="label">
    <div class="top">
      <span class="brand">Adnan Şahin Tekstil</span>
      ${safeBatch && vis("batchNumber") ? `<span class="batch">${safeBatch}</span>` : ""}
    </div>

    ${
      payload.markedForKartela && visKartela
        ? `<div class="kartela-stamp" style="${sty("kartelaMark")}">${lbl("kartelaMark", "Kartelalık")}</div>`
        : ""
    }

    ${vis("itemName") ? `<div class="item-name" style="${sty("itemName")}">${itemName}</div>` : ""}

    ${
      colorName && vis("colorName")
        ? `<div class="color-line" style="${sty("colorName")}"><span>${colorName}</span></div>`
        : ""
    }

    ${freeRows}

    ${vis("lengthMeters") ? `<div class="qty" style="${sty("lengthMeters")}">${qty}<span class="unit"> mt</span></div>` : ""}

    <div class="qr-row">
      ${vis("qrCode") ? `<div class="qr">${qrSvg}</div>` : ""}
      <div class="qr-info">
        ${vis("widthCm") ? `<div class="meta-row" style="${sty("widthCm")}"><span class="k">${lbl("widthCm", "En")}</span><span>${widthLabel}</span></div>` : ""}
        ${weightLabel && vis("weightKg") ? `<div class="meta-row" style="${sty("weightKg")}"><span class="k">${lbl("weightKg", "Ağırlık")}</span><span>${weightLabel}</span></div>` : ""}
        ${vis("qualityGrade") ? `<div class="meta-row" style="${sty("qualityGrade")}"><span class="k">${lbl("qualityGrade", "Kalite")}</span><span>${quality}</span></div>` : ""}
        ${vis("itemCode") && payload.itemCode ? `<div class="meta-row" style="${sty("itemCode")}"><span class="k">${lbl("itemCode", "Kod")}</span><span>${escapeHtml(payload.itemCode)}</span></div>` : ""}
      </div>
    </div>

    ${
      vis("barcode")
        ? `<div class="barcode-block" style="${sty("barcode")}">
             <div class="barcode-img">${barcodeSvg}</div>
             <div class="barcode-text">${barcode || "—"}</div>
           </div>`
        : ""
    }

    <div class="footer">
      ${vis("printedAt") ? `<span>${date}</span>` : "<span></span>"}
    </div>
  </div>
</body>
</html>`;

  return applyCopies(fullHtml, copies);
}
