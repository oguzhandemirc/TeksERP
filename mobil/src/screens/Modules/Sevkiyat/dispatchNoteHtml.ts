import dayjs from 'dayjs';
import type { ShipmentDetail } from '../../../services/packing.service';
import { printedDocumentService } from '../../../services/printedDocument.service';
import {
  resolveDocConfig,
  DEFAULT_COMPANY_LETTERHEAD,
  type CompanyLetterhead,
  type DocumentConfig,
  type DocumentsConfig,
} from '../../../services/documentConfig';

// =============================================================================
// Sevk İrsaliyesi HTML — expo-print için A4 belge. Normalize edilmiş `doc`
// şeklinden üretilir (backend buildShipmentDispatchDoc ile birebir). İki kaynak:
//   • DISPATCHED → PrintedDocument.snapshot.doc (DONMUŞ resmi belge)
//   • öncesi    → canlı detay map'lenir + TASLAK filigranı (henüz resmi değil)
// Electron ShipmentDispatchNote'un mobil eşi.
// =============================================================================

const n = (v: number): string => Math.round(Number(v) || 0).toLocaleString('tr-TR');

const esc = (s: string | null | undefined): string =>
  (s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

// --- Normalize edilmiş belge payload'ı (donmuş doc ile aynı şekil) ---
export interface ShipmentNoteLine {
  orderNumber: string;
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
}
export interface ShipmentNoteSack {
  seq: number;
  manualCode: string | null;
  weightKg: number | null;
  productSummary: {
    itemName: string;
    colorName: string | null;
    width: number | null;
    totalQty: number;
    rollCount: number;
  }[];
  swatches: { itemName: string | null; colorName: string | null; width: number | null; length: number | null }[];
}
export interface ShipmentNoteDoc {
  shipmentNo: string;
  dispatchedAt: string | null;
  readyAt: string | null;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  customer: { name: string };
  branch: { name: string } | null;
  lines: ShipmentNoteLine[];
  sacks: ShipmentNoteSack[];
  summary: { rollCount: number; sackCount: number; totalMeters: number; totalKg: number };
}

/** Canlı sevkiyat detayını TASLAK belge `doc` şekline indirger (DraftSheet eşi). */
export function shipmentDetailToNoteDoc(d: ShipmentDetail): ShipmentNoteDoc {
  const lines = d.orders.flatMap((o) =>
    o.lines
      .filter((l) => l.thisShipment > 0)
      .map((l) => ({
        orderNumber: o.orderNumber,
        itemName: l.customerItemName ?? l.item.name,
        colorName: l.color ? (l.customerColorName ?? l.color.name) : null,
        width: l.width,
        qty: l.thisShipment,
      })),
  );
  const sacks = d.sacks.map((s) => ({
    seq: s.seq,
    manualCode: s.manualCode ?? null,
    weightKg: s.weightKg,
    productSummary: s.productSummary.map((p) => ({
      itemName: p.itemName,
      colorName: p.colorName,
      width: p.width,
      totalQty: p.totalQty,
      rollCount: p.rollCount,
    })),
    swatches: s.swatches.map((sw) => ({
      itemName: sw.item?.name ?? null,
      colorName: sw.color?.name ?? null,
      width: sw.width,
      length: sw.length,
    })),
  }));
  return {
    shipmentNo: d.shipmentNo,
    dispatchedAt: d.dispatchedAt,
    readyAt: d.readyAt,
    plateNumber: d.plateNumber,
    driverName: d.driverName,
    carrier: d.carrier,
    customer: { name: d.customer.name },
    branch: d.branch ? { name: d.branch.name } : null,
    lines,
    sacks,
    summary: {
      rollCount: d.summary.rollCount,
      sackCount: d.summary.sackCount,
      totalMeters: d.summary.totalMeters,
      totalKg: d.summary.totalKg,
    },
  };
}

export interface DispatchNoteOpts {
  /** Donmuş (resmi) belgenin ham config override'ı — verilirse bu kullanılır. */
  docConfigOverride?: DocumentConfig | null;
  /** Canlı panel ayarı (TASLAK yolu) — docConfigOverride yoksa kullanılır. */
  documentsConfig?: DocumentsConfig;
  companyName?: string;
  letterhead?: CompanyLetterhead;
  /** official=donmuş resmi belge · draft=TASLAK filigranı · voided=İPTAL filigranı. */
  mode?: 'official' | 'draft' | 'voided';
}

export function buildDispatchNoteHtml(doc: ShipmentNoteDoc, opts?: DispatchNoteOpts): string {
  const cfg =
    opts?.docConfigOverride !== undefined
      ? resolveDocConfig(
          opts.docConfigOverride ? { shipmentDispatch: opts.docConfigOverride } : undefined,
          'shipmentDispatch',
        )
      : resolveDocConfig(opts?.documentsConfig, 'shipmentDispatch');
  const companyName = opts?.companyName?.trim() || 'Adnan Şahin Tekstil';
  const letterhead = opts?.letterhead ?? DEFAULT_COMPANY_LETTERHEAD;
  const mode = opts?.mode ?? 'official';
  const totalQty = doc.lines.reduce((s, l) => s + l.qty, 0);
  const docDate = doc.dispatchedAt ?? doc.readyAt ?? null;

  const rows = doc.lines.length
    ? doc.lines
        .map(
          (l, i) => `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="font-family:monospace">${esc(l.orderNumber)}</td>
        <td>${esc(l.itemName)}</td>
        <td>${l.colorName ? esc(l.colorName) : '—'}</td>
        <td style="text-align:center">${l.width != null ? `${l.width} cm` : '—'}</td>
        <td style="text-align:right">${n(l.qty)}</td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="6" style="text-align:center;color:#666;padding:8px">Bu sevkiyatta siparişe düşen metraj yok.</td></tr>`;

  // Çuval dökümü — her çuval başına ürün özeti + kartela satırları.
  const sackTd = (
    v: string,
    align: 'left' | 'center' | 'right' = 'left',
    muted = false,
  ): string =>
    `<td style="padding:2px 6px;text-align:${align}${muted ? ';color:#555' : ''}">${v}</td>`;

  const sackBox = (s: ShipmentNoteSack): string => {
    const rollCount = s.productSummary.reduce((a, p) => a + p.rollCount, 0);
    const swatchCount = s.swatches.length;
    const head = `<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #999;background:#f3f4f6;padding:3px 6px;font-size:11px;font-weight:700">
        <span>Çuval #${s.seq}${s.manualCode ? ` · ${esc(s.manualCode)}` : ''}</span>
        <span style="font-weight:400;color:#555">${s.weightKg != null ? `${n(s.weightKg)} kg` : 'tartılmadı'} · ${rollCount} top${swatchCount > 0 ? ` · ${swatchCount} kartela` : ''}</span>
      </div>`;
    if (s.productSummary.length === 0 && swatchCount === 0) {
      return `<div style="border:1px solid #999;margin-bottom:6px">${head}<div style="padding:4px 6px;color:#666;font-size:10px">boş</div></div>`;
    }
    const productRows = s.productSummary
      .map((p) =>
        `<tr>${[
          sackTd(esc(p.itemName)),
          sackTd(p.colorName ? esc(p.colorName) : '—'),
          sackTd(p.width != null ? `${p.width} cm` : '—', 'center'),
          sackTd(n(p.totalQty), 'right'),
          sackTd(String(p.rollCount), 'right'),
        ].join('')}</tr>`,
      )
      .join('');
    const swatchRows = s.swatches
      .map((sw) =>
        `<tr>${[
          sackTd(`Kartela · ${sw.itemName ? esc(sw.itemName) : '—'}`, 'left', true),
          sackTd(sw.colorName ? esc(sw.colorName) : '—', 'left', true),
          sackTd(sw.width != null ? `${sw.width} cm` : '—', 'center', true),
          sackTd(sw.length != null ? `${n(sw.length)} cm` : '—', 'right', true),
          sackTd('1', 'right', true),
        ].join('')}</tr>`,
      )
      .join('');
    return `<div style="border:1px solid #999;margin-bottom:6px">${head}
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <thead><tr style="border-bottom:1px solid #ccc;color:#555">
          <th style="text-align:left;padding:2px 6px">Ürün</th>
          <th style="text-align:left;padding:2px 6px">Renk</th>
          <th style="text-align:center;padding:2px 6px">En</th>
          <th style="text-align:right;padding:2px 6px">Metre</th>
          <th style="text-align:right;padding:2px 6px">Top</th>
        </tr></thead>
        <tbody>${productRows}${swatchRows}</tbody>
      </table></div>`;
  };

  const sacks = doc.sacks.length
    ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">Çuval Dökümü (${doc.sacks.length} çuval · ${n(doc.summary.totalKg)} kg brüt)</div>${doc.sacks
        .map(sackBox)
        .join('')}`
    : 'Çuval yok';

  const lhLines = [letterhead.addressLine, letterhead.phone, letterhead.taxInfo]
    .map((x) => x?.trim())
    .filter((x): x is string => Boolean(x))
    .map(esc);
  const letterheadHtml = cfg.showLetterhead
    ? `<div class="letterhead"><div class="lh-name">${esc(companyName)}</div>${
        lhLines.length ? `<div class="lh-meta">${lhLines.join('  ·  ')}</div>` : ''
      }</div>`
    : '';

  const customerBox = cfg.sections.customerInfo
    ? `<div class="box"><h4>Müşteri</h4>
        <div><b>${esc(doc.customer.name)}</b></div>
        ${doc.branch ? `<div>${esc(doc.branch.name)}</div>` : ''}
      </div>`
    : '';
  const vehicleBox = cfg.sections.vehicleInfo
    ? `<div class="box"><h4>Sevk Bilgileri</h4>
        <div>Plaka: ${esc(doc.plateNumber) || '—'}</div>
        <div>Şoför: ${esc(doc.driverName) || '—'}</div>
        <div>Taşıyıcı: ${esc(doc.carrier) || '—'}</div>
      </div>`
    : '';
  const infoGrid =
    customerBox || vehicleBox ? `<div class="grid">${customerBox}${vehicleBox}</div>` : '';

  const tableHtml = cfg.sections.itemTable
    ? `<table>
        <thead><tr>
          <th style="text-align:center">#</th><th>Sipariş</th><th>Ürün</th><th>Renk</th>
          <th style="text-align:center">En</th><th style="text-align:right">Metre</th>
        </tr></thead>
        <tbody>
          ${rows}
          <tr class="total"><td colspan="5" style="text-align:right">TOPLAM</td><td style="text-align:right">${n(totalQty)} m</td></tr>
        </tbody>
      </table>`
    : '';

  const sacksHtml = cfg.sections.sackBreakdown ? `<div style="margin-top:10px">${sacks}</div>` : '';

  const totalsHtml = cfg.sections.totals
    ? `<div style="margin-top:4px">Top sayısı: <b>${doc.summary.rollCount}</b> · Toplam metraj: <b>${n(doc.summary.totalMeters)} m</b></div>`
    : '';

  const signHtml =
    cfg.showSignatures && cfg.signatureLabels.length
      ? `<div class="sign">${cfg.signatureLabels
          .map(
            (lbl) =>
              `<div><div>${esc(lbl)}</div><div class="line"></div><div class="cap">Ad-Soyad / İmza</div></div>`,
          )
          .join('')}</div>`
      : '';

  const footerHtml = cfg.footerNote.trim()
    ? `<div class="footer-note">${esc(cfg.footerNote)}</div>`
    : '';

  const watermark =
    mode === 'draft'
      ? `<div class="wm" style="color:rgba(120,120,120,.14)">TASLAK</div>`
      : mode === 'voided'
        ? `<div class="wm" style="color:rgba(220,38,38,.16)">İPTAL</div>`
        : '';

  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, "Helvetica Neue", sans-serif; color:#000; font-size:12px; padding:16px; position:relative; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:8px; }
  .title { font-size:18px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
  .grid { display:flex; gap:16px; margin-top:10px; }
  .box { flex:1; border:1px solid #ccc; border-radius:4px; padding:8px; }
  .box h4 { margin:0 0 4px; font-size:10px; text-transform:uppercase; color:#666; }
  .box div { margin:1px 0; }
  table { width:100%; border-collapse:collapse; margin-top:12px; font-size:11px; }
  th { text-align:left; border-bottom:2px solid #000; padding:4px 6px; font-size:10px; text-transform:uppercase; }
  td { padding:4px 6px; border-bottom:1px solid #ddd; }
  .total td { border-top:2px solid #000; font-weight:700; }
  .sign { display:flex; gap:24px; margin-top:40px; }
  .sign > div { flex:1; }
  .sign .line { border-bottom:1px solid #000; margin-top:32px; }
  .sign .cap { text-align:center; font-size:10px; color:#666; margin-top:4px; }
  .letterhead { text-align:center; border-bottom:1px solid #ccc; padding-bottom:6px; margin-bottom:8px; }
  .lh-name { font-size:15px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
  .lh-meta { font-size:10px; color:#444; margin-top:2px; }
  .footer-note { margin-top:16px; border:1px solid #ccc; border-radius:4px; padding:6px 8px; font-size:11px; white-space:pre-wrap; }
  .wm { position:fixed; top:42%; left:0; right:0; text-align:center; font-size:90px; font-weight:800; text-transform:uppercase; letter-spacing:8px; transform:rotate(-30deg); z-index:-1; }
</style></head><body>
  ${watermark}
  ${letterheadHtml}
  <div class="head">
    <div>
      <div class="title">${esc(cfg.title)}</div>
      <div style="margin-top:4px">Sevkiyat No: <b style="font-family:monospace">${esc(doc.shipmentNo)}</b></div>
    </div>
    <div style="text-align:right">Tarih: <b>${docDate ? dayjs(docDate).format('DD.MM.YYYY HH:mm') : '—'}</b></div>
  </div>
  ${infoGrid}
  ${tableHtml}
  ${sacksHtml}
  ${totalsHtml}
  ${signHtml}
  ${footerHtml}
</body></html>`;
}

/**
 * Yazdırılacak HTML'i çözer: DISPATCHED ise donmuş resmi belge (PrintedDocument),
 * değilse canlı detaydan TASLAK. Hem ShipmentDetailView hem Paketleme kullanır.
 */
export async function resolveDispatchNoteHtml(opts: {
  shipmentId: string;
  detail: ShipmentDetail;
  flags?: {
    documentsConfig?: DocumentsConfig;
    companyName?: string;
    companyLetterhead?: CompanyLetterhead;
  } | null;
}): Promise<string> {
  const frozen = await printedDocumentService
    .getCurrent<ShipmentNoteDoc>('SHIPMENT_DISPATCH', opts.shipmentId)
    .then((r) => r.data)
    .catch(() => null);

  if (frozen) {
    return buildDispatchNoteHtml(frozen.snapshot.doc, {
      docConfigOverride: frozen.snapshot.docConfigOverride,
      companyName: frozen.snapshot.company.name,
      letterhead: frozen.snapshot.company.letterhead,
      mode: frozen.status === 'VOIDED' ? 'voided' : 'official',
    });
  }
  return buildDispatchNoteHtml(shipmentDetailToNoteDoc(opts.detail), {
    documentsConfig: opts.flags?.documentsConfig,
    companyName: opts.flags?.companyName,
    letterhead: opts.flags?.companyLetterhead,
    mode: 'draft',
  });
}
