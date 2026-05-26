import dayjs from 'dayjs';
import type { LabelTemplate, Roll } from '../types/models';

interface BuildLabelArgs {
  roll: Roll;
  qrDataUrl: string;
  /** Backend `/labels/barcode` endpoint'inden auth'lu çekilen Code128 SVG'nin
   *  base64 data-URL'i. null → fallback olarak sadece mono font text. */
  barcodeDataUrl: string | null;
  /** Electron "Etiket Standartları"nda admin'in tanımladığı default şablon.
   *  null → mevcut hardcoded tüm-alanlar davranışı (geriye uyumluluk). */
  template: LabelTemplate | null;
  batchNumber?: string | null;
}

/**
 * Top etiketi — A6 portrait (105×148mm). Şablon kontrolü altında alan
 * visibility + label override + bold + fontSize uygulanır. Görsel iskelet
 * (qty merkez, qr alt, vs.) sabit; admin sadece "hangi alan görünür, ne
 * etiketle, ne kalınlıkta/boyutta" yönetir.
 */
export function buildRollLabelHtml({
  roll,
  qrDataUrl,
  barcodeDataUrl,
  template,
  batchNumber,
}: BuildLabelArgs): string {
  const itemName = escapeHtml(roll.item?.name ?? '—');
  const color = roll.color ?? null;
  const colorName = color?.name ? escapeHtml(color.name) : '';
  const colorHex = color?.hex ?? '#94a3b8';
  const qty = formatNumber(roll.currentQty ?? roll.initialQty);
  const widthLabel =
    roll.width != null ? `${formatNumber(roll.width)} cm` : '—';
  const quality = escapeHtml(roll.qualityGrade ?? '');
  const date = dayjs(roll.createdAt ?? new Date()).format('DD.MM.YYYY HH:mm');
  const safeBatch = batchNumber ? escapeHtml(batchNumber) : '';
  const barcode = escapeHtml(roll.barcode ?? '');

  // Şablon helper'ları — template null ise tüm alanlar görünür (geriye uyum).
  const vis = (key: string) => isVisible(template, key);
  const lbl = (key: string, fallback: string) => fieldLabel(template, key, fallback);
  const sty = (key: string) => fieldStyle(template, key);

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>Top Etiketi · ${barcode || '—'}</title>
<style>
  @page { size: A6 portrait; margin: 4mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #0f172a; }
  .label {
    width: 97mm;
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
  .color-dot {
    width: 5mm;
    height: 5mm;
    border-radius: 50%;
    border: 0.5mm solid #0f172a;
    display: inline-block;
  }
  .qr-row {
    display: flex;
    align-items: center;
    gap: 3mm;
    margin-top: 1mm;
  }
  .qr {
    width: 32mm;
    height: 32mm;
    flex-shrink: 0;
  }
  .qr-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1mm;
    min-width: 0;
  }
  .barcode-img {
    width: 100%;
    max-height: 14mm;
    object-fit: contain;
    display: block;
  }
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
    font-size: 7pt;
    color: #94a3b8;
    border-top: 0.5px solid #cbd5e1;
    padding-top: 1.5mm;
  }
</style>
</head>
<body>
  <div class="label">
    <div class="top">
      <span class="brand">A.Şahin Tekstil</span>
      ${safeBatch && vis('batchNumber') ? `<span class="batch">${safeBatch}</span>` : ''}
    </div>

    ${vis('itemName') ? `<div class="item-name" style="${sty('itemName')}">${itemName}</div>` : ''}

    ${
      colorName && vis('colorName')
        ? `<div class="color-line" style="${sty('colorName')}">
             <span class="color-dot" style="background:${escapeHtml(colorHex)};"></span>
             <span>${colorName}</span>
           </div>`
        : ''
    }

    ${vis('lengthMeters') ? `<div class="qty" style="${sty('lengthMeters')}">${qty}<span class="unit"> mt</span></div>` : ''}

    <div class="qr-row">
      ${vis('qrCode') ? `<img class="qr" src="${qrDataUrl}" alt="QR" />` : ''}
      <div class="qr-info">
        ${vis('widthCm') ? `<div class="meta-row" style="${sty('widthCm')}"><span class="k">${lbl('widthCm', 'En')}</span><span>${widthLabel}</span></div>` : ''}
        ${vis('qualityGrade') ? `<div class="meta-row" style="${sty('qualityGrade')}"><span class="k">${lbl('qualityGrade', 'Kalite')}</span><span>${quality}</span></div>` : ''}
        ${vis('itemCode') && roll.item?.code ? `<div class="meta-row"><span class="k">${lbl('itemCode', 'Kod')}</span><span>${escapeHtml(roll.item.code)}</span></div>` : ''}
      </div>
    </div>

    ${
      vis('barcode')
        ? `<div class="barcode-block" style="${sty('barcode')}">
             ${barcodeDataUrl ? `<img class="barcode-img" src="${barcodeDataUrl}" alt="${barcode || ''}" />` : ''}
             <div class="barcode-text">${barcode || '—'}</div>
           </div>`
        : ''
    }

    <div class="footer">
      ${vis('printedAt') ? `<span>${date}</span>` : '<span></span>'}
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

function isVisible(template: LabelTemplate | null, key: string): boolean {
  if (!template) return true;
  const f = template.fields.find((x) => x.key === key);
  return f ? f.isVisible : false;
}

function fieldLabel(template: LabelTemplate | null, key: string, fallback: string): string {
  if (!template) return fallback;
  return template.fields.find((x) => x.key === key)?.label ?? fallback;
}

const FONT_SIZE_MAP: Record<string, string> = {
  sm: '8pt',
  md: '10pt',
  lg: '14pt',
  xl: '20pt',
};

function fieldStyle(template: LabelTemplate | null, key: string): string {
  if (!template) return '';
  const f = template.fields.find((x) => x.key === key);
  if (!f) return '';
  const parts: string[] = [];
  if (f.isBold) parts.push('font-weight:700');
  if (f.fontSize) parts.push(`font-size:${FONT_SIZE_MAP[f.fontSize] ?? '10pt'}`);
  return parts.join(';');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(n: number | string | null | undefined): string {
  if (n == null) return '—';
  const num = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}
