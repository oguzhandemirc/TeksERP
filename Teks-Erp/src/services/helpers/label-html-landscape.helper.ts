// =============================================================================
// Kumaş etiketi — 100×60 mm YATAY (landscape) iki-kolon HTML düzeni
// =============================================================================
// `buildRollLabelHtml`'in landscape dalı. Medya 100 geniş × 60 yüksek; topa YATAY
// yapıştırılır, içerik yatay okunur. İki kolon:
//   - SOL (~30mm): QR + Code128 barkod + okunur barkod metni
//   - SAĞ (kalan): marka/parti, kartela şeridi, ürün/renk, BÜYÜK metraj, kompakt
//     bilgi satırları (En/Kalite/Ağırlık/Müşteri/Sipariş), footer (tarih)
//
// Üç LabelKind'ı da tek düzen render eder (kind-bilinçli):
//   ROLL_RAW / ROLL_FINISHED → metraj + (renk/müşteri ROLL_FINISHED'de)
//   SWATCH (kartela)         → metraj yerine En×Boy, ek satırlar (Kart No / Boy /
//                              Ana Top Barkodu) + üstte sabit "KARTELA" şeridi
// Tüm alanlar template `vis()/lbl()/sty()` ile geçirgen — admin Electron'da yönetir.
// =============================================================================

import type { LabelPayload } from "../label.service";
import type { LabelTemplate } from "@prisma/client";
import { LabelKind } from "@prisma/client";
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

interface LandscapeBuildArgs {
  payload: LabelPayload;
  template: LabelTemplate | null;
  barcodeSvg: string;
  qrSvg: string;
  copies?: number;
  format?: LabelFormatGeometry;
}

export function buildLandscapeRollLabelHtml({
  payload,
  template,
  barcodeSvg,
  qrSvg,
  copies = 1,
  format,
}: LandscapeBuildArgs): string {
  const fmt = { ...DEFAULT_LABEL_FORMAT, ...(format ?? {}) };
  // Medyanın gerçek basılan ölçüsü (takas yok). 100×60 → içerik 94×54mm.
  const pageW = fmt.widthMm;
  const pageH = fmt.heightMm;
  const contentWidthMm = Math.max(0, pageW - fmt.marginMm * 2);
  const contentHeightMm = Math.max(0, pageH - fmt.marginMm * 2);
  // Ekran önizlemesi: küçük mm-etiketi büyük iframe'in köşesinde kaybolmasın diye
  // ekrana sığacak şekilde ölçekle (yalnız @media screen; baskıyı @page yönetir).
  const pxPerMm = 96 / 25.4;
  const fitScale = Math.max(1, Math.min(4,
    Math.min(520 / ((contentWidthMm || 1) * pxPerMm), 360 / ((contentHeightMm || 1) * pxPerMm)),
  ));

  const fields: TemplateField[] | null = template
    ? (template.fields as unknown as TemplateField[])
    : null;
  const { vis, lbl, sty } = makeFieldHelpers(fields);

  const kind: LabelKind =
    payload.kind ?? (template?.kind as LabelKind | undefined) ?? LabelKind.ROLL_FINISHED;
  const isSwatch = kind === LabelKind.SWATCH;

  // --- Değerler (hepsi escape) ---
  const itemName = escapeHtml(payload.itemName || "—");
  const itemNameDefault = payload.itemNameDefault ? escapeHtml(payload.itemNameDefault) : "";
  const colorName = payload.colorName ? escapeHtml(payload.colorName) : "";
  const colorCode = payload.colorCode ? escapeHtml(payload.colorCode) : "";
  const qty = formatNumber(payload.lengthMeters);
  const widthLabel = payload.widthCm != null ? `${formatNumber(payload.widthCm)} cm` : "—";
  const lengthCmLabel = payload.lengthCm != null ? `${formatNumber(payload.lengthCm)} cm` : "—";
  const weightLabel = payload.weightKg != null ? `${formatNumber(payload.weightKg)} kg` : "";
  const quality = escapeHtml(payload.qualityGrade ?? "");
  const date = formatDate(payload.printedAt);
  const safeBatch = payload.batchNumber ? escapeHtml(payload.batchNumber) : "";
  const barcode = escapeHtml(payload.barcode || "");
  const customerName = payload.customerName ? escapeHtml(payload.customerName) : "";
  const orderNumber = payload.orderNumber ? escapeHtml(payload.orderNumber) : "";
  const cardNumber = payload.cardNumber ? escapeHtml(payload.cardNumber) : "";
  const parentRollBarcode = payload.parentRollBarcode ? escapeHtml(payload.parentRollBarcode) : "";

  // Kartela şeridi: SWATCH'te her zaman; roll'da yalnız işaretliyse (kartelaMark).
  const visKartela = isVisibleDefaultOn(fields, "kartelaMark");
  const showStamp = isSwatch ? true : payload.markedForKartela && visKartela;
  const stampText = isSwatch ? "KARTELA" : lbl("kartelaMark", "Kartelalık");
  const stampStyle = isSwatch ? "" : sty("kartelaMark");

  // --- Kompakt bilgi satırları (sağ kolon) ---
  const row = (key: string, fallback: string, value: string): string =>
    `<div class="row" style="${sty(key)}"><span class="k">${lbl(key, fallback)}</span><span class="v">${value}</span></div>`;

  const rows: string[] = [];
  if (vis("widthCm")) rows.push(row("widthCm", "En", widthLabel));
  if (isSwatch && vis("lengthCm")) rows.push(row("lengthCm", "Boy", lengthCmLabel));
  if (vis("qualityGrade") && quality) rows.push(row("qualityGrade", "Kalite", quality));
  if (vis("weightKg") && weightLabel) rows.push(row("weightKg", "Ağırlık", weightLabel));
  if (vis("itemCode") && payload.itemCode) rows.push(row("itemCode", "Kod", escapeHtml(payload.itemCode)));
  if (vis("customerName") && customerName) rows.push(row("customerName", "Müşteri", customerName));
  if (vis("orderNumber") && orderNumber) rows.push(row("orderNumber", "Sipariş", orderNumber));
  if (isSwatch && vis("cardNumber") && cardNumber) rows.push(row("cardNumber", "Kart No", cardNumber));
  if (isSwatch && vis("parentRollBarcode") && parentRollBarcode)
    rows.push(row("parentRollBarcode", "Ana Top", parentRollBarcode));

  // Büyük blok: roll → metraj; swatch → En×Boy.
  const bigBlock = isSwatch
    ? vis("widthCm") || vis("lengthCm")
      ? `<div class="metraj">${widthLabel}<span class="x"> × </span>${lengthCmLabel}</div>`
      : ""
    : vis("lengthMeters")
      ? `<div class="metraj" style="${sty("lengthMeters")}">${qty}<span class="unit"> mt</span></div>`
      : "";

  const fullHtml = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>Kumaş Etiketi · ${barcode || "—"}</title>
<style>
  @page { size: ${pageW}mm ${pageH}mm; margin: ${fmt.marginMm}mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #0f172a; }
  /* Ekran önizlemesi — etiketi gri zeminde ortala + sığacak kadar büyüt (baskıyı etkilemez). */
  @media screen {
    html { background: #eef2f7; }
    body { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 12px; }
    .label { zoom: ${fitScale.toFixed(3)}; background: #fff; box-shadow: 0 2px 12px rgba(15,23,42,0.18); }
  }
  .label {
    width: ${contentWidthMm}mm;
    height: ${contentHeightMm}mm;
    display: flex;
    flex-direction: row;
    gap: 2mm;
    border: 1px solid #0f172a;
    border-radius: 2mm;
    padding: 2mm;
    overflow: hidden;
  }
  .col-left {
    width: 30mm;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1mm;
  }
  .qr { width: 26mm; height: 26mm; }
  .qr svg { width: 100%; height: 100%; }
  .barcode-img { width: 30mm; height: 11mm; }
  .barcode-img svg { width: 100%; height: 100%; }
  .barcode-text {
    font-family: ui-monospace, monospace;
    font-size: 6.5pt;
    font-weight: 700;
    text-align: center;
    letter-spacing: 0.3px;
    word-break: break-all;
    line-height: 1;
  }
  .col-right {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6mm;
  }
  .brand-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 7pt;
    color: #475569;
    border-bottom: 0.4px solid #cbd5e1;
    padding-bottom: 0.5mm;
  }
  .brand-row .brand { font-weight: 700; letter-spacing: 0.5px; }
  .brand-row .batch { font-family: ui-monospace, monospace; font-weight: 700; color: #0f172a; }
  .kartela-stamp {
    background: #7c3aed;
    color: #ffffff;
    font-size: 8pt;
    font-weight: 900;
    letter-spacing: 1.5px;
    text-align: center;
    text-transform: uppercase;
    padding: 0.5mm 0;
    border-radius: 1mm;
  }
  .item-name { font-size: 10pt; font-weight: 700; line-height: 1.05; }
  .color-line { font-size: 8.5pt; font-weight: 700; color: #1e293b; }
  .color-line .code { font-weight: 600; color: #475569; margin-left: 1.5mm; }
  .metraj { font-size: 17pt; font-weight: 900; line-height: 1; margin: 0.5mm 0; }
  .metraj .unit { font-size: 8pt; font-weight: 600; color: #475569; }
  .metraj .x { font-size: 11pt; font-weight: 700; color: #475569; }
  .rows { display: flex; flex-direction: column; gap: 0.3mm; }
  .row { display: flex; justify-content: space-between; gap: 2mm; font-size: 8pt; color: #1e293b; }
  .row .k { font-weight: 600; color: #475569; }
  .row .v { text-align: right; word-break: break-word; }
  .footer {
    margin-top: auto;
    font-size: 6.5pt;
    color: #475569;
    font-weight: 600;
    border-top: 0.4px solid #cbd5e1;
    padding-top: 0.5mm;
  }
</style>
</head>
<body>
  <div class="label">
    <div class="col-left">
      ${vis("qrCode") ? `<div class="qr">${qrSvg}</div>` : ""}
      ${
        vis("barcode")
          ? `<div class="barcode-img" style="${sty("barcode")}">${barcodeSvg}</div>
             <div class="barcode-text">${barcode || "—"}</div>`
          : ""
      }
    </div>

    <div class="col-right">
      <div class="brand-row">
        <span class="brand">Adnan Şahin Tekstil</span>
        ${safeBatch && vis("batchNumber") ? `<span class="batch">${safeBatch}</span>` : ""}
      </div>

      ${showStamp ? `<div class="kartela-stamp" style="${stampStyle}">${stampText}</div>` : ""}

      ${vis("itemName") ? `<div class="item-name" style="${sty("itemName")}">${itemName}</div>` : ""}
      ${
        itemNameDefault && vis("itemNameDefault")
          ? `<div class="row" style="${sty("itemNameDefault")}"><span class="k">${lbl("itemNameDefault", "Ürün (bizdeki ad)")}</span><span class="v">${itemNameDefault}</span></div>`
          : ""
      }

      ${
        colorName && vis("colorName")
          ? `<div class="color-line" style="${sty("colorName")}">${colorName}${colorCode && vis("colorCode") ? `<span class="code">${colorCode}</span>` : ""}</div>`
          : ""
      }

      ${bigBlock}

      <div class="rows">${rows.join("\n")}</div>

      <div class="footer">${vis("printedAt") ? date : ""}</div>
    </div>
  </div>
</body>
</html>`;

  return applyCopies(fullHtml, copies);
}
