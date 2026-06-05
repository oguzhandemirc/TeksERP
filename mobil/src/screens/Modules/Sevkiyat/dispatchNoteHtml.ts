import dayjs from 'dayjs';
import type { ShipmentDetail } from '../../../services/packing.service';

// =============================================================================
// Sevk İrsaliyesi HTML — expo-print (Print.printAsync) için A4 belge. Canlı
// detaydan üretilir (DISPATCHED veri donmuş). Electron irsaliyesinin mobil eşi.
// =============================================================================

const n = (v: number): string => Math.round(Number(v) || 0).toLocaleString('tr-TR');

const esc = (s: string | null | undefined): string =>
  (s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

export function buildDispatchNoteHtml(d: ShipmentDetail): string {
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

  const sacks = d.sacks.length
    ? `Çuvallar: ${d.sacks.length} adet · Toplam ${n(d.summary.totalKg)} kg (${d.sacks
        .map(
          (s) =>
            `#${s.seq}${s.manualCode ? ` [${esc(s.manualCode)}]` : ''}:${s.weightKg != null ? n(s.weightKg) : '—'}kg`,
        )
        .join(', ')})`
    : 'Çuval yok';

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
</style></head><body>
  <div class="head">
    <div>
      <div class="title">Sevk İrsaliyesi</div>
      <div style="margin-top:4px">Sevkiyat No: <b style="font-family:monospace">${esc(d.shipmentNo)}</b></div>
    </div>
    <div style="text-align:right">Tarih: <b>${docDate ? dayjs(docDate).format('DD.MM.YYYY HH:mm') : '—'}</b></div>
  </div>
  <div class="grid">
    <div class="box"><h4>Müşteri</h4>
      <div><b>${esc(d.customer.name)}</b></div>
      ${d.branch ? `<div>${esc(d.branch.name)}</div>` : ''}
    </div>
    <div class="box"><h4>Sevk Bilgileri</h4>
      <div>Plaka: ${esc(d.plateNumber) || '—'}</div>
      <div>Şoför: ${esc(d.driverName) || '—'}</div>
      <div>Taşıyıcı: ${esc(d.carrier) || '—'}</div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th style="text-align:center">#</th><th>Sipariş</th><th>Ürün</th><th>Renk</th>
      <th style="text-align:center">En</th><th style="text-align:right">Metre</th>
    </tr></thead>
    <tbody>
      ${rows}
      <tr class="total"><td colspan="5" style="text-align:right">TOPLAM</td><td style="text-align:right">${n(totalQty)} m</td></tr>
    </tbody>
  </table>
  <div style="margin-top:10px">${sacks}</div>
  <div style="margin-top:4px">Top sayısı: <b>${d.summary.rollCount}</b> · Toplam metraj: <b>${n(d.summary.totalMeters)} m</b></div>
  <div class="sign">
    <div><div>Sevkeden</div><div class="line"></div><div class="cap">Ad-Soyad / İmza</div></div>
    <div><div>Sürücü</div><div class="line"></div><div class="cap">Ad-Soyad / İmza</div></div>
    <div><div>Teslim Alan</div><div class="line"></div><div class="cap">Ad-Soyad / İmza</div></div>
  </div>
</body></html>`;
}
