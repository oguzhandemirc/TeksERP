// =============================================================================
// DEVERE DÖNÜŞ KABUL BELGESİ — kayıt sayfası (devere ek E2) · `operations/devere-donus/:id`
// =============================================================================
// Başlık (devereci · irsaliye · tarih · toplam) + sipariş başı kabul (leventler; iptal edilen üstü çizili) + aynı
// irsaliye no ile yapılmış DİĞER kabuller (belgeli + eski tek-sipariş). "Belgeyi iptal et" (E6) bütün siparişleri
// hep-ya-hiç geri alır; tek siparişin kabulü sipariş sayfasından (kabul başına, LIFO).
// =============================================================================
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { ReceiveDocCancelDialog } from "./ReceiveDocCancelDialog";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/services/apiClient";
import { fmtKg, fmtM } from "@/pages/Operations/WarpingOrders/order-model";
import { useDeliveryNoteGroup, useWarpingReceiveDoc, WARPING_RECEIVE_DOCS_PATH, warpingReceiveDocPath } from "@/pages/Operations/WarpingOrders/receive-doc-service";
import { warpingOrderPath } from "@/pages/Operations/WarpingOrders/service";
import type { WarpingReceipt } from "@/pages/Operations/WarpingOrders/receive-types";
import type { WarpingReceiveDoc } from "@/pages/Operations/WarpingOrders/receive-doc-types";

const num = "text-right tabular-nums";
const kgOr = (v: string | null) => (v === null ? "—" : fmtKg(v));

function BeamsTable({ r, label }: { r: WarpingReceipt; label: string }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHead>Levent</TableHead>
            <TableHead>Gövde</TableHead>
            <TableHead className={num}>Metre</TableHead>
            <TableHead className={num} title="Tel × denye × metre">Hesap kg</TableHead>
            <TableHead className={num}>Tartı net</TableHead>
            <TableHead>Durum</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.beams.map((b) => (
            <TableRow key={b.id} className={cn(b.cancelled && "text-muted-foreground line-through decoration-muted-foreground/40")}>
              <TableCell className="font-mono text-xs">{b.beamNo}</TableCell>
              <TableCell className="font-mono text-xs">{b.physicalBeamNo ?? "—"}</TableCell>
              <TableCell className={num}>{b.lengthM === null ? "—" : fmtM(b.lengthM)}</TableCell>
              <TableCell className={num}>{kgOr(b.nominalKg)}</TableCell>
              <TableCell className={num}>{kgOr(b.weighedNetKg)}</TableCell>
              <TableCell className="text-xs">{b.cancelled ? "Geri alındı" : b.status === "REJECTED" ? "Reddedildi" : ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OtherUses({ doc }: { doc: WarpingReceiveDoc }) {
  const openTarget = useOpenTarget();
  const g = useDeliveryNoteGroup(doc.subcontractor.id, doc.deliveryNoteNo ?? "", Boolean(doc.deliveryNoteNo));
  const others = (g.data?.docs ?? []).filter((d) => d.id !== doc.id);
  const legacy = g.data?.receipts ?? [];
  if (others.length === 0 && legacy.length === 0) return null;
  return (
    <section className="space-y-2 rounded-xl border border-amber-300/60 bg-amber-50/40 p-4 dark:bg-amber-950/10" aria-label="Aynı irsaliye no ile diğer kabuller">
      <h2 className="text-sm font-semibold">Aynı irsaliye no ({doc.deliveryNoteNo}) ile diğer kabuller</h2>
      <ul className="space-y-1 text-sm">
        {others.map((d) => (
          <li key={d.id}>
            <button type="button" className="font-mono text-primary hover:underline" onClick={(e) => openTarget(warpingReceiveDocPath(d.id), e)}>{d.docNo}</button>
            {" "}· {d.orders.map((o) => o.orderNo).join(", ")} · {d.totals.liveBeamCount} levent · {fmtFactoryDateTime(d.createdAt)}
          </li>
        ))}
        {legacy.map((r) => (
          <li key={r.receipt.receiptKey}>
            <button type="button" className="font-mono text-primary hover:underline" onClick={(e) => openTarget(warpingOrderPath(r.warpingOrderId), e)}>{r.orderNo}</button>
            {" "}· belgesiz kabul · {r.receipt.liveBeamCount} levent · {fmtFactoryDateTime(r.receipt.receivedAt)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WarpingReceiveDocPage() {
  const { id = "" } = useParams<{ id: string }>();
  const openTarget = useOpenTarget();
  const q = useWarpingReceiveDoc(id);
  const d = q.data;
  const [cancelOpen, setCancelOpen] = useState(false);
  return (
    <PageShell>
      <PageHeader
        title={d ? d.docNo : "Dönüş kabul belgesi"}
        description={d ? `Devereci ${d.subcontractor.name} · ${d.deliveryNoteNo ? `irsaliye ${d.deliveryNoteNo}` : "irsaliyesiz"} · ${fmtFactoryDateTime(d.createdAt)}` : undefined}
        onBack={() => openTarget(WARPING_RECEIVE_DOCS_PATH)}
        parent={{ label: "Devere Dönüş Kabulleri", to: WARPING_RECEIVE_DOCS_PATH }}
        actions={d && d.totals.liveBeamCount > 0 ? (
          <PermissionGate permission="warpbeam:cancel">
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}><Undo2 className="mr-1 h-4 w-4" /> Belgeyi iptal et</Button>
          </PermissionGate>
        ) : undefined}
      />
      <PageBody className="space-y-6 p-4 sm:p-6">
        {q.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
        {q.isError && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
        {d && (
          <>
            <p className="text-sm">
              <b>{d.totals.orderCount} sipariş</b> · <b>{d.totals.liveBeamCount} levent</b>{d.totals.beamCount !== d.totals.liveBeamCount ? ` (${d.totals.beamCount - d.totals.liveBeamCount} geri alındı)` : ""} · <b>{fmtM(d.totals.lengthM)} m</b>
            </p>
            {d.orders.map((o) => (
              <section key={o.warpingOrderId} className="space-y-2" aria-label={`Sipariş ${o.orderNo}`}>
                <div className="flex items-baseline gap-2">
                  <button type="button" className="text-base font-semibold text-primary hover:underline" onClick={(e) => openTarget(warpingOrderPath(o.warpingOrderId), e)}>{o.orderNo}</button>
                  <span className="text-xs text-muted-foreground">{o.receipt.liveBeamCount} levent · {fmtM(o.receipt.lengthM)} m — geri alma ve ret sipariş sayfasında</span>
                </div>
                <BeamsTable r={o.receipt} label={`${o.orderNo} leventleri`} />
              </section>
            ))}
            <OtherUses doc={d} />
            {cancelOpen && <ReceiveDocCancelDialog doc={d} onClose={() => setCancelOpen(false)} />}
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
