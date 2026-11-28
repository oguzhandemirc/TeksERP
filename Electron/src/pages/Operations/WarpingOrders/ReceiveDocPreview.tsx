// Dönüş kabul belgesi önizlemesi (devere ek E2): irsaliye tekrarı (sunucu kararı) + toplam + sipariş başına tek
// sipariş önizlemesiyle AYNI görünüm (metre, iplik tüketimi, devir, etkilenen sevk kalemleri, tartı). Sayılar sunucudan.
import { Callout } from "@/components/ui/callout";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { fmtM } from "./order-model";
import { noteWarnings } from "./receive-doc-model";
import { ReceivePreviewView } from "./ReceiveParts";
import type { WarpingReceiveDocPreview } from "./receive-doc-types";
import type { WarpingReceivePreview } from "./receive-types";
import { useWarpingOrder } from "./service";

export function ReceiveDocPreviewView({ p, blocked }: { p: WarpingReceiveDocPreview; blocked: boolean }) {
  const notes = noteWarnings(p);
  return (
    <div className="space-y-4" aria-label="Belge önizlemesi">
      <p className="text-sm">
        Bu belge: <b>{p.totals.orderCount} sipariş</b> · <b>{p.totals.beamCount} levent</b> · <b>{fmtM(p.totals.lengthM)} m</b>
        {p.deliveryNoteNo ? <> · irsaliye <b>{p.deliveryNoteNo}</b></> : " · irsaliyesiz"}
      </p>
      {(notes.length > 0 || p.deliveryNoteUses.length > 0) && (
        <Callout tone={blocked ? "danger" : "warning"} title={blocked ? "Bu irsaliye no ile kabul engelli" : "Bu irsaliye no daha önce kullanıldı"}>
          {notes.length > 0 && <ul className="list-disc space-y-0.5 pl-4">{notes.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {notes.length === 0 && p.deliveryNoteUses.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs" aria-label="Önceki kabuller">
              {p.deliveryNoteUses.map((u, i) => <li key={i}>{u.docNo ? `${u.docNo} · ` : ""}{u.orderNo} — {fmtFactoryDateTime(u.receivedAt)}</li>)}
            </ul>
          )}
        </Callout>
      )}
      {p.orders.map((o) => <OrderPreview key={o.warpingOrderId} orderId={o.warpingOrderId} p={o.preview} />)}
    </div>
  );
}

/** Ücret etkisi için siparişin donuk ücreti (detay önbellekte; kabul önizlemesi ücreti taşımaz — tablet de aynı ucu okur). */
function OrderPreview({ orderId, p }: { orderId: string; p: WarpingReceivePreview }) {
  const o = useWarpingOrder(orderId).data;
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4" aria-label={`${p.order.orderNo} önizlemesi`}>
      <h3 className="text-sm font-semibold">{p.order.orderNo}</h3>
      <ReceivePreviewView p={p} overrun={o ? { fee: o.fee, totalEnds: o.totals.endsCount } : undefined} />
    </section>
  );
}
