import dayjs from 'dayjs';
import type { Roll } from '../types/models';

interface BuildLabelArgs {
  roll: Roll;
  qrDataUrl: string;
  batchNumber?: string | null;
}

/**
 * Top etiketi — A6 portrait (105×148mm). Label yazıcılarına uygun, normal
 * yazıcıda "sayfaya sığdır" ile basılır.
 * İçerik: ürün adı, renk, metraj, en, kalite, QR + barkod metni.
 */
export function buildRollLabelHtml({
  roll,
  qrDataUrl,
  batchNumber,
}: BuildLabelArgs): string {
  const itemName = escapeHtml(roll.item?.name ?? '—');
  const variantName = roll.variant?.name ? escapeHtml(roll.variant.name) : '';
  const color = roll.item?.color ?? null;
  const colorName = color?.name ? escapeHtml(color.name) : '';
  const colorHex = color?.hex ?? '#94a3b8';
  const qty = formatNumber(roll.currentQty ?? roll.initialQty);
  const widthLabel =
    roll.width != null ? `${formatNumber(roll.width)} cm` : '—';
  const quality = escapeHtml(roll.qualityGrade ?? '');
  const date = dayjs(roll.createdAt ?? new Date()).format('DD.MM.YYYY HH:mm');
  const safeBatch = batchNumber ? escapeHtml(batchNumber) : '';

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>Top Etiketi · ${escapeHtml(roll.barcode)}</title>
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
  .variant {
    font-size: 9pt;
    color: #475569;
    text-align: center;
    margin-top: -1mm;
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
  .barcode {
    font-family: ui-monospace, monospace;
    font-size: 10pt;
    font-weight: 700;
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
      ${safeBatch ? `<span class="batch">${safeBatch}</span>` : ''}
    </div>

    <div class="item-name">${itemName}</div>
    ${variantName ? `<div class="variant">${variantName}</div>` : ''}

    ${
      colorName
        ? `<div class="color-line">
             <span class="color-dot" style="background:${escapeHtml(colorHex)};"></span>
             <span>${colorName}</span>
           </div>`
        : ''
    }

    <div class="qty">${qty}<span class="unit"> mt</span></div>

    <div class="qr-row">
      <img class="qr" src="${qrDataUrl}" alt="QR" />
      <div class="qr-info">
        <div class="barcode">${escapeHtml(roll.barcode)}</div>
        <div class="meta-row"><span class="k">En</span><span>${widthLabel}</span></div>
        <div class="meta-row"><span class="k">Kalite</span><span>${quality}</span></div>
      </div>
    </div>

    <div class="footer">
      <span>${date}</span>
      <span>${escapeHtml(roll.status ?? '')}</span>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}
