// Fason kabulünden alış faturası TASLAĞI (F6): sevkin kabulü seçilir → sunucu önizlemesi (kalem, miktar, tarife fiyatı,
// uyarılar, mevcut fatura) → taslak. Taslak deftere işlemez; onay Faturalar ekranında. Kabul başına tek aktif fatura.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { apiErrorText } from "@/lib/api-error";
import { fmtFactoryDate } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { money, type Currency } from "@/pages/Finance/service";
import { PURCHASE_UNIT_LABEL, canCreatePurchaseDraft, createPurchaseDraft, listWorkOrderReceipts, previewPurchaseDraft, type SubcontractorPurchaseDraftPreview } from "./service";

const INVOICE_STATUS: Record<string, string> = { DRAFT: "taslak", CONFIRMED: "onaylı", CANCELLED: "iptal" };

interface Props {
  workOrderId: string;
  dispatch: { dispatchNo: string; subcontractorName: string; receipts: { receiptNo: string }[] };
  onClose: () => void;
}

export function FasonPurchaseDraftDialog({ workOrderId, dispatch, onClose }: Props) {
  const qc = useQueryClient();
  const receiptsQ = useQuery({ queryKey: ["fason-receipts", workOrderId], queryFn: () => listWorkOrderReceipts(workOrderId) });
  const nos = new Set(dispatch.receipts.map((r) => r.receiptNo));
  const receipts = (receiptsQ.data ?? []).filter((r) => nos.has(r.receiptNo));
  const [picked, setPicked] = useState<string | null>(null);
  const receiptId = picked ?? receipts[0]?.id ?? null;
  const previewQ = useQuery({
    queryKey: ["fason-purchase-draft", receiptId],
    queryFn: () => previewPurchaseDraft(receiptId as string),
    enabled: Boolean(receiptId),
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => createPurchaseDraft(receiptId as string),
    onSuccess: (inv) => {
      toast.success(`${inv.docNo ?? "Alış faturası"} taslağı oluşturuldu — Finans › Faturalar'dan onaylayın.`);
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      onClose();
    },
    // Hata toast'ını apiClient basar; önizleme tazelenir (başka yoldan faturalanmış olabilir).
    onSettled: () => void previewQ.refetch(),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Alış faturası taslağı — {dispatch.dispatchNo}</DialogTitle>
          <DialogDescription>
            {dispatch.subcontractorName} için fason kabulünden alış faturası taslağı. Miktar kabul edilen metre ya da kg, fiyat sevk tarihindeki tarifedir.
          </DialogDescription>
        </DialogHeader>
        {receipts.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kabul">
            {receipts.map((r) => (
              <Button key={r.id} size="sm" variant={r.id === receiptId ? "default" : "outline"} role="radio" aria-checked={r.id === receiptId} onClick={() => setPicked(r.id)}>
                {r.receiptNo} · {fmtFactoryDate(r.receivedAt)}
              </Button>
            ))}
          </div>
        )}
        <div className="min-h-[7rem] rounded-md border p-3 text-sm" aria-live="polite">
          {receiptsQ.isLoading || previewQ.isLoading ? (
            <p className="text-muted-foreground">Önizleme hazırlanıyor…</p>
          ) : !receiptId ? (
            <p className="text-muted-foreground">Bu sevkin aktif kabulü yok.</p>
          ) : previewQ.isError ? (
            <p className="text-destructive">{apiErrorText(previewQ.error, "Önizleme okunamadı.")}</p>
          ) : previewQ.data ? (
            <PreviewBody p={previewQ.data} />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <PermissionGate permission="finance:write">
            <Button disabled={!canCreatePurchaseDraft(previewQ.data) || create.isPending} onClick={() => create.mutate()}>
              <FileText className="mr-1 h-4 w-4" />
              {create.isPending ? "Oluşturuluyor…" : "Taslağı oluştur"}
            </Button>
          </PermissionGate>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ p }: { p: SubcontractorPurchaseDraftPreview }) {
  const cur = p.currency as Currency;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>Kabul <b className="font-mono">{p.receiptNo}</b></span>
        <span>Ara toplam (KDV hariç): <b>{money(p.subtotal, cur)}</b></span>
      </div>
      {p.existingInvoice && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs">
          Bu kabulün faturası zaten var: <b>{p.existingInvoice.docNo}</b> ({INVOICE_STATUS[p.existingInvoice.status] ?? "kayıtlı"}). Kabul başına tek fatura kesilir.
        </p>
      )}
      {p.lines.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr><th className="py-1 pr-2">Kalem</th><th className="py-1 pr-2 text-right">Miktar</th><th className="py-1 pr-2 text-right whitespace-nowrap">Birim fiyat</th><th className="py-1 text-right">KDV</th></tr>
          </thead>
          <tbody>
            {p.lines.map((l, i) => (
              <tr key={`${l.serviceItemId ?? "x"}:${i}`} className="border-t">
                <td className={cn("py-1 pr-2", !l.serviceItemId && "text-amber-700 dark:text-amber-400")}>{l.description}</td>
                <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{Number(l.qty).toLocaleString("tr-TR", { maximumFractionDigits: 3 })} {PURCHASE_UNIT_LABEL[l.unit] ?? ""}</td>
                <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{money(l.unitPrice, cur)}</td>
                <td className="py-1 text-right tabular-nums">%{l.vatRate}{l.withholdingRate > 0 ? ` · tevk. ${l.withholdingRate}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.warnings.length > 0 && (
        <ul className="space-y-1 text-amber-700 dark:text-amber-400">
          {p.warnings.map((w) => (
            <li key={w} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
