// Sipariş sayfası "Devere ücreti" bölümü (devere A2) — `GET /:id/fee-summary`: kabul başına ölçü, beklenen ücret ve
// bağlı fatura. Fatura bilgisi yalnız `finance:read` ∧ ön muhasebe açıkken gelir (yoksa sütun çizilmez). "Fatura gir"
// ALIŞ formunu devereci kartıyla, bu siparişin faturasız kabulleri seçili açar; taslak sunucuda doğar.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { apiErrorMessage } from "@/services/apiClient";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { InvoiceFormDialog } from "@/pages/Finance/InvoiceFormDialog";
import type { Currency } from "@/pages/Finance/service";
import {
  FEE_STATE_CLASS, FEE_STATE_LABEL, LUMP_INFO, expectedText, feePriceText, feeQtyText, getWarpingOrderFeeSummary, isLumpPrice, type WarpingFeeOrder,
} from "@/pages/Finance/warpingFee";
import { fmtM } from "./order-model";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingOrder } from "./types";

const num = "text-right tabular-nums";

type Launch = { kind: "new"; customerId: string } | { kind: "edit"; invoiceId: string } | null;

function FeeTable({ s }: { s: WarpingFeeOrder }) {
  const showInvoice = s.invoiceState !== null;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kabul</TableHead>
          <TableHead className="text-right">Levent</TableHead>
          <TableHead className="text-right">Metre</TableHead>
          <TableHead className="text-right">Ücret ölçüsü</TableHead>
          <TableHead className="text-right">Beklenen</TableHead>
          {showInvoice && <TableHead>Fatura</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {s.receipts.map((r) => (
          <TableRow key={r.receiptKey} className="text-sm">
            <TableCell>{r.deliveryNoteNo ? `İrsaliye ${r.deliveryNoteNo}` : "İrsaliyesiz"}<span className="block text-xs text-muted-foreground">{fmtFactoryDateTime(r.receivedAt)}</span></TableCell>
            <TableCell className={num}>{r.beamCount}</TableCell>
            <TableCell className={num}>{fmtM(r.lengthM)} m</TableCell>
            <TableCell className={num}>{feeQtyText(r.qty, s.fee.unit)}</TableCell>
            <TableCell className={num}>{expectedText(r.expectedAmount, s.fee.currency)}</TableCell>
            {showInvoice && <TableCell className={cn(!r.invoice && "text-muted-foreground")}>{r.invoice ? `${r.invoice.docNo}${r.invoice.status === "DRAFT" ? " (taslak)" : ""}` : "Faturasız"}</TableCell>}
          </TableRow>
        ))}
        <TableRow className="font-medium">
          <TableCell>Toplam</TableCell>
          <TableCell className={num}>{s.receipts.reduce((n, r) => n + r.beamCount, 0)}</TableCell>
          <TableCell className={num}>{fmtM(s.totals.lengthM)} m</TableCell>
          <TableCell className={num}>{feeQtyText(s.totals.qty, s.fee.unit)}</TableCell>
          <TableCell className={num}>{expectedText(s.totals.expectedAmount, s.fee.currency)}</TableCell>
          {showInvoice && <TableCell />}
        </TableRow>
      </TableBody>
    </Table>
  );
}

export function FeeInvoiceSection({ order }: { order: WarpingOrder }) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const [launch, setLaunch] = useState<Launch>(null);
  const [opening, setOpening] = useState(false);
  const q = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "fee-summary", order.id], queryFn: () => getWarpingOrderFeeSummary(order.id) });
  const s = q.data;
  const canInvoice = Boolean(s && s.invoiceState !== null && s.invoiceState !== "FULL") && financeEnabled && hasPermission("finance:write");
  const refresh = () => void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY, "fee-summary", order.id] });
  const openInvoice = async () => {
    setOpening(true);
    try {
      const sub = (await subcontractorService.getById(order.subcontractor.id)).data;
      if (!sub.customerId) toast.error(`"${sub.name}" fason profili bir cari karta bağlı değil — önce fason firmayı kartına bağlayın.`);
      else setLaunch({ kind: "new", customerId: sub.customerId });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Devereci kartı okunamadı."));
    } finally {
      setOpening(false);
    }
  };
  return (
    <section className="space-y-2" aria-label="Devere ücreti">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Devere ücreti</h2>
        {s?.invoiceState && <span className={cn("rounded-badge px-1.5 py-0.5 text-xs", FEE_STATE_CLASS[s.invoiceState])}>{FEE_STATE_LABEL[s.invoiceState]}</span>}
        {canInvoice && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={opening} onClick={() => void openInvoice()} data-testid="devere-fatura-gir">
            <Receipt className="mr-1 h-4 w-4" /> Fatura gir
          </Button>
        )}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {feePriceText(order.fee)} · beklenen = dönen ölçü × birim ücret; fatura farkı uyarır, engellemez.
        {isLumpPrice(order.fee.unitPrice) && <InfoPopover label="Götürü satır" desc={LUMP_INFO} />}
      </p>
      {q.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
      {q.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
      {s && (s.receipts.length === 0 ? <p className="text-sm text-muted-foreground">Henüz kabul edilen levent yok; beklenen ücret dönüşte hesaplanır.</p> : <FeeTable s={s} />)}
      {launch?.kind === "new" && (
        <InvoiceFormDialog
          open
          onOpenChange={(o) => !o && setLaunch(null)}
          onCreated={refresh}
          prefill={{ type: "PURCHASE", customerId: launch.customerId, currency: (order.fee.currency ?? undefined) as Currency | undefined, lines: [], sourceLabel: order.orderNo, warpingOrderIds: [order.id] }}
          onDraftCreated={(id) => { refresh(); setLaunch({ kind: "edit", invoiceId: id }); }}
        />
      )}
      {launch?.kind === "edit" && <InvoiceFormDialog open onOpenChange={(o) => !o && setLaunch(null)} onCreated={refresh} editInvoiceId={launch.invoiceId} />}
    </section>
  );
}
