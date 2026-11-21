// =============================================================================
// FASON DEVERE SİPARİŞİ — kayıt sayfası (plan E4) · `operations/fason-devere/:id`
// =============================================================================
// Bölümler: özet · iplik planı (sunucuda donmuş) · sevkler (D6b; yeni sevk, iptal, irsaliye + çözgü talimatı) · deverecide tutulan iplik (iade, aktarma, geçmiş) · dönen leventler (D7a; kabul, mutabakat, geri alma) · kapanış (D7b; kapat, geçmiş, yeniden aç). Yazma düğmeleri izinle (`PermissionGate`) ve durumla çizilir:
// düzenle OPEN/IN_PROGRESS (sevkliyken yalnız meta), iptal yalnız OPEN'da anlamlı — sevkli siparişte önizleme
// "önce sevkleri iptal edin" der. Kapalı/iptal siparişte yazma yüzeyi HİÇ çizilmez.
// =============================================================================
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Ban, FileText, Pencil } from "lucide-react";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { PermissionGate } from "@/components/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/services/apiClient";
import { cn } from "@/lib/utils";
import { BeamRejectionsSection } from "./BeamRejectionsSection";
import { CancelOrderDialog } from "./CancelOrderDialog";
import { DispatchesSection } from "./DispatchesSection";
import { FeeInvoiceSection } from "./FeeInvoiceSection";
import { HoldingsSection } from "./HoldingsSection";
import { InstructionPrintDialog } from "./InstructionPrintDialog";
import { OrderSummary } from "./OrderSummary";
import { PlanTable } from "./PlanTable";
import { ReceiptsSection } from "./ReceiptsSection";
import { SettlementsSection } from "./SettlementsSection";
import { WarpingOrderFormDialog } from "./WarpingOrderFormDialog";
import { editModeOf } from "./order-model";
import { useWarpingOrder, WARPING_ORDERS_PATH } from "./service";
import { warpingStatusMeta, type WarpingOrder } from "./types";

type DialogKind = "edit" | "cancel" | "instruction" | null;

export function WarpingOrderPage() {
  const { id } = useParams<{ id: string }>();
  const openTarget = useOpenTarget();
  const q = useWarpingOrder(id);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const o = q.data;
  const meta = o ? warpingStatusMeta(o.status) : null;
  return (
    <PageShell>
      <PageHeader
        title={o ? o.orderNo : "Fason devere siparişi"}
        titleExtra={meta && <Badge className={cn("font-normal", meta.badgeClass)}>{meta.label}</Badge>}
        description={o ? `${o.warpSpec.name} (${o.warpSpec.code}) · devereci ${o.subcontractor.name}` : undefined}
        onBack={() => openTarget(WARPING_ORDERS_PATH)}
        parent={{ label: "Fason Devere Siparişleri", to: WARPING_ORDERS_PATH }}
        actions={o && <OrderActions o={o} onOpen={setDialog} />}
      />
      <PageBody className="space-y-6 p-4 sm:p-6">
        {q.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
        {q.isError && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {apiErrorMessage(q.error)}
          </p>
        )}
        {o && (
          <>
            <OrderSummary o={o} />
            <section className="space-y-2" aria-label="İplik planı">
              <h2 className="text-base font-semibold">İplik planı</h2>
              <p className="text-xs text-muted-foreground">Sipariş açılırken hesaplandı ve saklandı; kart sonradan değişse de bu plan değişmez.</p>
              <PlanTable yarns={o.yarns} hasWaste={o.hasWaste} totals={o.totals} />
            </section>
            <DispatchesSection order={o} />
            <HoldingsSection order={o} />
            <ReceiptsSection order={o} />
            <BeamRejectionsSection orderId={o.id} />
            {o.status !== "CANCELLED" && <FeeInvoiceSection order={o} />}
            <SettlementsSection order={o} />
          </>
        )}
      </PageBody>
      {o && dialog === "edit" && <WarpingOrderFormDialog order={o} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} />}
      {o && dialog === "cancel" && <CancelOrderDialog order={o} onClose={() => setDialog(null)} />}
      {o && dialog === "instruction" && <InstructionPrintDialog orderId={o.id} onClose={() => setDialog(null)} />}
    </PageShell>
  );
}

function OrderActions({ o, onOpen }: { o: WarpingOrder; onOpen: (d: DialogKind) => void }) {
  const editable = editModeOf(o.status) !== null;
  return (
    <div className="flex items-center gap-2">
      {o.status !== "CANCELLED" && (
        <Button size="sm" variant="outline" onClick={() => onOpen("instruction")} title="Devereciye giden çözgü talimatını önizle ve yazdır">
          <FileText className="mr-1 h-4 w-4" /> Çözgü talimatı
        </Button>
      )}
      {editable && <EditCancelButtons o={o} onOpen={onOpen} />}
    </div>
  );
}

function EditCancelButtons({ o, onOpen }: { o: WarpingOrder; onOpen: (d: DialogKind) => void }) {
  return (
    <>
      <PermissionGate permission="warping-order:write">
        <Button size="sm" variant="outline" onClick={() => onOpen("edit")} title={o.status === "IN_PROGRESS" ? "Sevkli siparişte yalnız termin, ücret, tolerans, müşteri siparişi ve not değişir" : undefined}>
          <Pencil className="mr-1 h-4 w-4" /> Düzenle
        </Button>
      </PermissionGate>
      <PermissionGate permission="warping-order:cancel">
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => onOpen("cancel")}>
          <Ban className="mr-1 h-4 w-4" /> İptal et
        </Button>
      </PermissionGate>
    </>
  );
}
