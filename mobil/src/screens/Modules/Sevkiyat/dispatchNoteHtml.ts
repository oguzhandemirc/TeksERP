import dayjs from 'dayjs';
import type { ShipmentDetail } from '../../../services/packing.service';
import {
  resolveDocConfig,
  DEFAULT_COMPANY_LETTERHEAD,
  type CompanyLetterhead,
  type DocumentsConfig,
} from '../../../services/documentConfig';

// =============================================================================
// Sevk İrsaliyesi HTML — expo-print (Print.printAsync) için A4 belge. Canlı
// detaydan üretilir (DISPATCHED veri donmuş). Electron irsaliyesinin mobil eşi.
// İçerik ayarı (bölüm görünürlükleri/başlık/künye/imza/footer) panelden gelir —
// "documentsConfig" feature flag → resolveDocConfig (Electron ile aynı sözleşme).
// =============================================================================

const n = (v: number): string => Math.round(Number(v) || 0).toLocaleString('tr-TR');

const esc = (s: string | null | undefined): string =>
  (s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

/** İrsaliye içerik ayarı — panel feature flag'lerinden türetilir (ShipmentDetailView geçer). */
export interface DispatchNoteOpts {
  documentsConfig?: DocumentsConfig;
  companyName?: string;
  letterhead?: CompanyLetterhead;
}

export function buildDispatchNoteHtml(d: ShipmentDetail, opts?: DispatchNoteOpts): string {
  const cfg = resolveDocConfig(opts?.documentsConfig, 'shipmentDispatch');
  const companyName = opts?.companyName?.trim() || 'Adnan Şahin Tekstil';
  const letterhead = opts?.letterhead ?? DEFAULT_COMPANY_LETTERHEAD;
  const lines = d.orders.flatMap((o) =>
    o.lines
      .filter((l) => l.thisShipment > 0)
      .map((l) => ({ ...l, orderNumber: o.orderNumber })),
  );
  const totalQty = lines.reduce((s, l) => s + l.thisShipment, 0);
  const docDate = d.dispatchedAt ?? d.readyAt ?? null;

  const rows = lines.length
    ? lines
        .map(
          (l, i) => `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="font-family:monospace">${esc(l.orderNumber)}</td>
        <td>${esc(l.customerItemName ?? l.item.name)}</td>
        <td>${l.color ? esc(l.customerColorName ?? l.color.name) : '—'}</td>
        <td style="text-align:center">${l.width != null ? `${l.width} cm` : '—'}</td>
        <td style="text-align:right">${n(l.thisShipment)}</td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="6" style="text-align:center;color:#666;padding:8px">Bu sevkiyatta siparişe düşen metraj yok.</td></tr>`;

  // Çuval dökümü — Electron ShipmentDispatchNote ile aynı: her çuval başına
  // ürün özeti (item·renk·en·metre·top) + kartela satırları. Tek satır özet DEĞİL.
  const sackRow = (cells: string[]): string =>
    `<tr>${cells.join('')}</tr>`;
  const sackTd = (
    v: string,
    align: 'left' | 'center' | 'right' = 'left',
    muted = false,
  ): string =>
    `<td style="padding:2px 6px;text-align:${align}${muted ? ';color:#555' : ''}">${v}</td>`;

  const sackBox = (s: ShipmentDetail['sacks'][number]): string => {
    const head = `<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #999;background:#f3f4f6;padding:3px 6px;font-size:11px;font-weight:700">
        <span>Çuval #${s.seq}${s.manualCode ? ` · ${esc(s.manualCode)}` : ''}</span>
        <span style="font-weight:400;color:#555">${s.weightKg != null ? `${n(s.weightKg)} kg` : 'tartılmadı'} · ${s.rollCount} top${s.swatchCount > 0 ? ` · ${s.swatchCount} kartela` : ''}</span>
      </div>`;
    if (s.productSummary.length === 0 && s.swatchCount === 0) {
      return `<div style="border:1px solid #999;margin-bottom:6px">${head}<div style="padding:4px 6px;color:#666;font-size:10px">boş</div></div>`;
    }
    const productRows = s.productSummary
      .map((p) =>
        sackRow([
          sackTd(esc(p.itemName)),
          sackTd(p.colorName ? esc(p.colorName) : '—'),
          sackTd(p.width != null ? `${p.width} cm` : '—', 'center'),
          sackTd(n(p.totalQty), 'right'),
          sackTd(String(p.rollCount), 'right'),
        ]),
      )
      .join('');
    const swatchRows = s.swatches
      .map((sw) =>
        sackRow([
          sackTd(`Kartela · ${sw.item?.name ? esc(sw.item.name) : '—'}`, 'left', true),
          sackTd(sw.color?.name ? esc(sw.color.name) : '—', 'left', true),
          sackTd(sw.width != null ? `${sw.width} cm` : '—', 'center', true),
          sackTd(sw.length != null ? `${n(sw.length)} cm` : '—', 'right', true),
          sackTd('1', 'right', true),
        ]),
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

  const sacks = d.sacks.length
    ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">Çuval Dökümü (${d.sacks.length} çuval · ${n(d.summary.totalKg)} kg brüt)</div>${d.sacks
        .map(sackBox)
        .join('')}`
    : 'Çuval yok';

  // ── Panel ayarına göre bölümler (gating) ──
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
        <div><b>${esc(d.customer.name)}</b></div>
        ${d.branch ? `<div>${esc(d.branch.name)}</div>` : ''}
      </div>`
    : '';
  const vehicleBox = cfg.sections.vehicleInfo
    ? `<div class="box"><h4>Sevk Bilgileri</h4>
        <div>Plaka: ${esc(d.plateNumber) || '—'}</div>
        <div>Şoför: ${esc(d.driverName) || '—'}</div>
        <div>Taşıyıcı: ${esc(d.carrier) || '—'}</div>
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

  const sacksHtml = cfg.sections.sackBreakdown
    ? `<div style="margin-top:10px">${sacks}</div>`
    : '';

  const totalsHtml = cfg.sections.totals
    ? `<div style="margin-top:4px">Top sayısı: <b>${d.summary.rollCount}</b> · Toplam metraj: <b>${n(d.summary.totalMeters)} m</b></div>`
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

  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, "Helvetica Neue", sans-serif; color:#000; font-size:12px; padding:16px; }
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
</style></head><body>
  ${letterheadHtml}
  <div class="head">
    <div>
      <div class="title">${esc(cfg.title)}</div>
      <div style="margin-top:4px">Sevkiyat No: <b style="font-family:monospace">${esc(d.shipmentNo)}</b></div>
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
