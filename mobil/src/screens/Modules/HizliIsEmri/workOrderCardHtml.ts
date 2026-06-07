import dayjs from 'dayjs';
import {
  WORK_ORDER_STATUS_LABEL,
  WORK_ORDER_TYPE_LABEL,
  STEP_STATUS_LABEL,
  STATION_TYPE_LABEL,
  trLabel,
} from '../../../utils/labels';

// =============================================================================
// İş Emri / Refakat Kartı — expo-print (Print.printAsync) için A4 belge. Mobil
// "çıktı al" akışında WO detayından üretilir. Barkod, react-native-qrcode-svg
// toDataURL ile PNG base64 olarak gömülür (scannable refakat kartı barkodu).
// =============================================================================

export interface WorkOrderCardData {
  companyName: string;
  batchNumber: string;
  status: string;
  type?: string | null;
  itemName?: string | null;
  colorName?: string | null;
  width?: number | null;
  foldType?: string | null;
  targetQuantity?: number | null;
  createdAt?: string | null;
  cardNumber?: string | null;
  /** Scannable refakat kartı barkodu (RK-...). */
  barcode?: string | null;
  /** QR PNG base64 (prefix'siz). null → QR çizilmez, barkod metni gösterilir. */
  qrBase64?: string | null;
  route: { sequence: number; stationName: string; stationType?: string; status?: string }[];
  rolls: { barcode: string | null; itemName?: string | null; qty: number }[];
  orders: { orderNumber: string; customerName: string; itemName: string; qty: number }[];
}

const esc = (s: string | null | undefined): string =>
  (s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

const num = (v: number | null | undefined): string =>
  v == null ? '—' : Math.round(Number(v) || 0).toLocaleString('tr-TR');

export function buildWorkOrderCardHtml(d: WorkOrderCardData): string {
  const dateStr = d.createdAt ? dayjs(d.createdAt).format('DD.MM.YYYY HH:mm') : '—';
  const totalQty = d.rolls.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  const infoRow = (label: string, value: string) =>
    `<tr><td class="k">${esc(label)}</td><td class="v">${esc(value)}</td></tr>`;

  const routeFlow = d.route.length
    ? d.route
        .map(
          (s, i) =>
            `<span class="step">${s.sequence}. ${esc(s.stationName)}` +
            `<small> (${esc(trLabel(STATION_TYPE_LABEL, s.stationType))} · ${esc(trLabel(STEP_STATUS_LABEL, s.status))})</small></span>` +
            (i < d.route.length - 1 ? '<span class="arrow">→</span>' : ''),
        )
        .join('')
    : '<span class="muted">Rota adımı yok</span>';

  const rollRows = d.rolls.length
    ? d.rolls
        .map(
          (r, i) =>
            `<tr><td style="text-align:center">${i + 1}</td>` +
            `<td style="font-family:monospace">${esc(r.barcode ?? '—')}</td>` +
            `<td>${esc(r.itemName ?? '—')}</td>` +
            `<td style="text-align:right">${num(r.qty)}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="4" style="text-align:center;color:#666;padding:8px">Bağlı top yok.</td></tr>`;

  const orderBlock = d.orders.length
    ? `<div class="section"><div class="sec-title">Bağlı Siparişler</div>
        <table class="grid"><thead><tr><th>Sipariş</th><th>Müşteri</th><th>Ürün</th><th style="text-align:right">İstenen</th></tr></thead>
        <tbody>${d.orders
          .map(
            (o) =>
              `<tr><td style="font-family:monospace">${esc(o.orderNumber)}</td><td>${esc(o.customerName)}</td><td>${esc(o.itemName)}</td><td style="text-align:right">${num(o.qty)}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
    : '';

  const qrBlock = d.qrBase64
    ? `<img class="qr" src="data:image/png;base64,${d.qrBase64}" alt="QR" />`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Roboto, Arial, sans-serif; color: #0f172a; font-size: 12px; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
    .company { font-size: 16px; font-weight: 800; }
    .doc { font-size: 11px; color: #475569; letter-spacing: .5px; }
    .batch { font-size: 22px; font-weight: 800; margin-top: 2px; }
    .qr { width: 110px; height: 110px; }
    .qrwrap { text-align: center; }
    .qrcode { font-family: monospace; font-size: 10px; margin-top: 2px; }
    .section { margin-top: 14px; }
    .sec-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; margin-bottom: 6px; }
    table.kv { width: 100%; border-collapse: collapse; }
    table.kv td { padding: 3px 6px; vertical-align: top; }
    table.kv td.k { width: 32%; color: #64748b; font-weight: 600; }
    table.kv td.v { font-weight: 700; }
    .flow { line-height: 2; }
    .step { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 6px; padding: 3px 8px; font-weight: 700; }
    .step small { font-weight: 500; color: #475569; }
    .arrow { margin: 0 6px; color: #94a3b8; font-weight: 700; }
    .muted { color: #94a3b8; }
    table.grid { width: 100%; border-collapse: collapse; margin-top: 4px; }
    table.grid th, table.grid td { border: 1px solid #e2e8f0; padding: 4px 6px; font-size: 11px; }
    table.grid th { background: #f1f5f9; text-align: left; }
    .totalrow td { font-weight: 800; background: #f8fafc; }
    .foot { margin-top: 18px; display: flex; justify-content: space-between; color: #94a3b8; font-size: 10px; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  </style></head><body>
    <div class="top">
      <div>
        <div class="company">${esc(d.companyName)}</div>
        <div class="doc">İŞ EMRİ / REFAKAT KARTI</div>
        <div class="batch">${esc(d.batchNumber)}</div>
      </div>
      <div class="qrwrap">
        ${qrBlock}
        ${d.barcode ? `<div class="qrcode">${esc(d.barcode)}</div>` : ''}
      </div>
    </div>

    <div class="section">
      <table class="kv">
        ${infoRow('Ürün', d.itemName ?? '—')}
        ${infoRow('Renk', d.colorName ?? 'Renksiz / Ham')}
        ${infoRow('En', d.width != null ? `${d.width} cm` : '—')}
        ${infoRow('Kat Tipi', d.foldType ?? '—')}
        ${infoRow('Tip', trLabel(WORK_ORDER_TYPE_LABEL, d.type ?? undefined))}
        ${infoRow('Durum', trLabel(WORK_ORDER_STATUS_LABEL, d.status))}
        ${infoRow('Hedef Metraj', d.targetQuantity != null ? `${num(d.targetQuantity)} m` : '—')}
        ${infoRow('Oluşturma', dateStr)}
      </table>
    </div>

    <div class="section">
      <div class="sec-title">Üretim Rotası</div>
      <div class="flow">${routeFlow}</div>
    </div>

    <div class="section">
      <div class="sec-title">Bağlı Toplar (${d.rolls.length})</div>
      <table class="grid">
        <thead><tr><th style="width:32px">#</th><th>Barkod</th><th>Ürün</th><th style="text-align:right">Metraj</th></tr></thead>
        <tbody>
          ${rollRows}
          <tr class="totalrow"><td colspan="3" style="text-align:right">Toplam</td><td style="text-align:right">${num(totalQty)} m</td></tr>
        </tbody>
      </table>
    </div>

    ${orderBlock}

    <div class="foot">
      <div>${d.cardNumber ? `Kart No: ${esc(d.cardNumber)}` : ''}</div>
      <div>Yazdırma: ${dayjs().format('DD.MM.YYYY HH:mm')}</div>
    </div>
  </body></html>`;
}
