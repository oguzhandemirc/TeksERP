import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { matchesPermission } from "@/types/auth";
import { useFeatureFlags, useShippingInvoiceMode } from "@/hooks/usePricingEnabled";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { ShipmentDocDialog } from "@/pages/Operations/Shipments/ShipmentDocDialog";
import { InvoiceDetailDialog } from "@/pages/Finance/InvoiceDetailDialog";
import { InvoiceDialog } from "./InvoiceDialog";
import { ShipmentInvoiceDraft } from "./ShipmentInvoiceDraft";
import { dispatchRowView } from "./dispatchRowActions";
import type { DispatchRowHandlers } from "./DispatchRowCells";
import type { DispatchListItem } from "./types";

/**
 * Sevk Edilenler satır eylemlerinin durumu + diyalogları. Her yüzey MEVCUT bileşendir (irsaliye =
 * sevkiyat ekranıyla aynı ShipmentDocDialog; fatura belgesi = Faturalar sayfasıyla aynı PrintedDocDialog).
 */
export function useDispatchRowActions(queryKey: string) {
  const qc = useQueryClient();
  const [belgeFor, setBelgeFor] = useState<DispatchListItem | null>(null);
  const [traceFor, setTraceFor] = useState<DispatchListItem | null>(null);
  const [draftFor, setDraftFor] = useState<DispatchListItem | null>(null);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [printTarget, setPrintTarget] = useState<{ invoiceId: string; docNo: string } | null>(null);
  // İç fatura yalnız ticaret rejiminde (fabrikada ön muhasebe kapalı → sıfır fark).
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const invoiceMode = useShippingInvoiceMode();
  const { permissions } = useRoleAccess();

  const handlers = useMemo<DispatchRowHandlers>(
    () => ({
      onBelge: setBelgeFor,
      onTrace: setTraceFor,
      onDraft: setDraftFor,
      onOpenInvoice: setOpenInvoiceId,
      onPrintInvoice: setPrintTarget,
      view: (row) => dispatchRowView(row, { financeEnabled, invoiceMode, can: (p) => matchesPermission(permissions, p) }),
    }),
    [financeEnabled, invoiceMode, permissions],
  );

  const dialogs = (
    <>
      <ShipmentDocDialog
        shipmentId={belgeFor?.id ?? null}
        open={!!belgeFor}
        onOpenChange={(o) => !o && setBelgeFor(null)}
        kind={belgeFor?.kind}
        shipmentNo={belgeFor?.shipmentNo}
        status={belgeFor?.status}
      />
      <InvoiceDialog row={traceFor} onClose={() => setTraceFor(null)} queryKey={queryKey} />
      <ShipmentInvoiceDraft row={draftFor} onClose={() => setDraftFor(null)} onCreated={() => void qc.invalidateQueries({ queryKey: [queryKey] })} />
      {/* İç fatura detayı — liste açık kalır; "Belgeyi aç" detayı kapatıp belge diyaloğunu açar (yığılmaz). */}
      {openInvoiceId && (
        <InvoiceDetailDialog
          invoiceId={openInvoiceId}
          open
          onOpenChange={(o) => !o && setOpenInvoiceId(null)}
          onShowDocument={(inv) => {
            setOpenInvoiceId(null);
            setPrintTarget({ invoiceId: inv.id, docNo: inv.docNo });
          }}
        />
      )}
      <PrintedDocDialog
        docType="INVOICE_INTERNAL"
        sourceId={printTarget?.invoiceId ?? null}
        open={Boolean(printTarget)}
        onOpenChange={(o) => !o && setPrintTarget(null)}
        title={printTarget ? `Fatura — ${printTarget.docNo}` : "Fatura"}
        description="Belge ONAY anında dondu; iptal edilen fatura İPTAL filigranıyla basılır."
        writePermission="finance:invoice"
      />
    </>
  );

  return { handlers, dialogs };
}
