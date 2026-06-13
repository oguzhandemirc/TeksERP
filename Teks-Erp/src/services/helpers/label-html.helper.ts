// =============================================================================
// Roll etiketi — tek HTML render kaynağı
// =============================================================================
// Hem mobil print akışı (expo-print) hem Electron LabelPreview iframe'i bu
// HTML'i tüketir. Yalnız buradan değiştirilir → "Electron'daki ile mobil'deki
// etiket farklı" sorunu yapısal olarak çözülür.
//
// Inputs:
//   - payload: LabelPayload (effective name cascade ile)
//   - template: LabelTemplate | null — admin'in Electron'da yönettiği şablon.
//     null → catalog default'a göre tüm alanlar açık (failsafe).
//   - barcodeSvg: bwip-js Code128 SVG (scanner-okur)
//   - qrSvg: bwip-js QR SVG (mobil scanner)
// =============================================================================

import type { LabelPayload } from "../label.service";
import type { LabelTemplate } from "@prisma/client";

interface TemplateField {
  key: string;
  label: string;
  order: number;
  isVisible: boolean;
  isBold?: boolean;
  fontSize?: "sm" | "md" | "lg" | "xl";
}

interface BuildArgs {
  payload: LabelPayload;
  template: LabelTemplate | null;
  barcodeSvg: string;
  qrSvg: string;
  /** Saha #6: aynı etiket kaç sayfa basılsın (default 1; ayar default'u 2 —
   *  topun üstüne + altına yapıştırılıyor). 1-5'e kırpılır. */
  copies?: number;
}

export function buildRollLabelHtml({
  payload,
  template,
  barcodeSvg,
  qrSvg,
  copies = 1,
}: BuildArgs): string {
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

  const vis = (key: string) => isVisible(fields, key);
  const lbl = (key: string, fallback: string) => fieldLabel(fields, key, fallback);
  const sty = (key: string) => fieldStyle(fields, key);

  // Kartela damgası OPT-OUT: bu alan (kartelaMark) catalog'a sonradan eklendi,
  // dolayısıyla daha eski kayıtlı template'lerde HİÇ bulunmaz. Generic vis()
  // "alan yok = kapalı" der; burada ise "alan yok = açık" istiyoruz ki eski
  // template'ler veri migrasyonu gerektirmeden damgayı bassın. Sadece admin
  // alanı bilerek isVisible=false yaptıysa gizlenir.
  const visKartela = isVisibleDefaultOn(fields, "kartelaMark");

  const fullHtml = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>Top Etiketi · ${barcode || "—"}</title>
<style>
  @page { size: A6 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #0f172a; }
  .label {
    width: 105mm;
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
      itemNameDefault && vis("itemNameDefault")
        ? `<div class="meta-row" style="${sty("itemNameDefault")}"><span class="k">${lbl("itemNameDefault", "Ürün (bizdeki ad)")}</span><span>${itemNameDefault}</span></div>`
        : ""
    }

    ${
      colorName && vis("colorName")
        ? `<div class="color-line" style="${sty("colorName")}"><span>${colorName}</span></div>`
        : ""
    }

    ${
      colorNameDefault && vis("colorNameDefault")
        ? `<div class="meta-row" style="${sty("colorNameDefault")}"><span class="k">${lbl("colorNameDefault", "Renk (bizdeki ad)")}</span><span>${colorNameDefault}</span></div>`
        : ""
    }

    ${
      colorCode && vis("colorCode")
        ? `<div class="meta-row" style="${sty("colorCode")}"><span class="k">${lbl("colorCode", "Renk Kodu")}</span><span>${colorCode}</span></div>`
        : ""
    }

    ${
      customerName && vis("customerName")
        ? `<div class="meta-row" style="${sty("customerName")}"><span class="k">${lbl("customerName", "Müşteri")}</span><span>${customerName}</span></div>`
        : ""
    }
    ${
      orderNumber && vis("orderNumber")
        ? `<div class="meta-row" style="${sty("orderNumber")}"><span class="k">${lbl("orderNumber", "Sipariş")}</span><span>${orderNumber}</span></div>`
        : ""
    }

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

  // Saha #6: çoklu kopya — gövdedeki etiket bloğunu N sayfaya çoğalt
  // (her kopya kendi A6 sayfasında; yazıcı arka arkaya basar).
  const copiesCount = Math.max(1, Math.min(5, Math.floor(copies)));
  if (copiesCount <= 1) return fullHtml;
  const bodyOpen = fullHtml.indexOf("<body>") + "<body>".length;
  const bodyClose = fullHtml.indexOf("</body>");
  const labelMarkup = fullHtml.slice(bodyOpen, bodyClose);
  const pages = Array.from({ length: copiesCount }, (_, i) =>
    `<div style="${i < copiesCount - 1 ? "page-break-after: always;" : ""}">${labelMarkup}</div>`,
  ).join("\n");
  return fullHtml.slice(0, bodyOpen) + "\n" + pages + "\n" + fullHtml.slice(bodyClose);
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

function isVisible(fields: TemplateField[] | null, key: string): boolean {
  if (!fields) return true;
  const f = fields.find((x) => x.key === key);
  return f ? f.isVisible : false;
}

/**
 * isVisible'ın opt-out varyantı: alan template'te HİÇ yoksa AÇIK kabul eder.
 * Catalog'a sonradan eklenen alanlar (kartelaMark gibi) için — eski kayıtlı
 * template'lerde bulunmadıklarından generic isVisible onları gizlerdi.
 */
function isVisibleDefaultOn(fields: TemplateField[] | null, key: string): boolean {
  if (!fields) return true;
  const f = fields.find((x) => x.key === key);
  return f ? f.isVisible : true;
}

function fieldLabel(fields: TemplateField[] | null, key: string, fallback: string): string {
  if (!fields) return fallback;
  // L (düşük bulgu): label admin girdisidir ve HTML'e gömülür — değerler gibi
  // başlıklar da escape edilir (yazdırma penceresinde markup enjeksiyonu olmasın).
  return escapeHtml(fields.find((x) => x.key === key)?.label ?? fallback);
}

const FONT_SIZE_MAP: Record<string, string> = {
  sm: "8pt",
  md: "10pt",
  lg: "14pt",
  xl: "20pt",
};

function fieldStyle(fields: TemplateField[] | null, key: string): string {
  if (!fields) return "";
  const f = fields.find((x) => x.key === key);
  if (!f) return "";
  const parts: string[] = [];
  if (f.isBold) parts.push("font-weight:700");
  if (f.fontSize) parts.push(`font-size:${FONT_SIZE_MAP[f.fontSize] ?? "10pt"}`);
  return parts.join(";");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(n: number | string | null | undefined): string {
  if (n == null) return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return "—";
  return (num as number).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mn = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yy} ${hh}:${mn}`;
}
