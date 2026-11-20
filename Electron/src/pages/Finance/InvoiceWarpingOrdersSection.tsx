// =============================================================================
// FATURA FORMU — "Devere siparişlerine bağla" (yalnız ALIŞ + cari kartı + devere modülü; devere A2)
// =============================================================================
// YENİ faturada seçim = taslak sunucuda doğar (`draft-from-warping`, sipariş başı satır) ve form o taslağın
// düzenlemesine geçer. DÜZENLEMEDE yalnız kabul kümesi değişir (PATCH `warpingReceiptKeys` REPLACE); satırlar
// yeniden yazılmaz. `clientToken` mantıksal deneme başına (seçim değişince yeni deneme).
// =============================================================================
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, Layers } from "lucide-react";
import { Label } from "@/components/ui/label";
import { InfoPopover } from "@/components/ui/info-popover";
import { cn } from "@/lib/utils";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { getCariByCustomer } from "./service";
import { receiptsErrorText, sameIdSet } from "./invoiceReceipts";
import { WarpingOrdersPickerModal } from "./WarpingOrdersPickerModal";
import {
  createDraftFromWarping, getWarpingOrderFeeSummary, linkedOrdersText, listWarpingCandidates, preselectOrders, warpingTriggerText,
  type InvoiceWarpingReceiptRef, type WarpingFeeOrder,
} from "./warpingFee";

interface Props {
  mode: "create" | "edit";
  customerId: string | null;
  /** Düzenlemede faturanın cari hesabı; yeni faturada karttan çözülür. */
  cariId?: string | null;
  invoiceId?: string | null;
  value: string[];
  onChange: (keys: string[]) => void;
  linked?: InvoiceWarpingReceiptRef[];
  /** "Fatura gir" yolu: bu siparişlerin faturasız kabulleri seçili, seçici kendiliğinden açılır. */
  preselectOrderIds?: string[];
  onDraftCreated?: (id: string) => void;
  disabled?: boolean;
}

/** Aday listesi: carinin hesabı varsa aday ucu; hesap yoksa (yalnız "Fatura gir" yolunda) siparişlerin özet ucu. */
function useWarpingCandidates(p: { customerId: string | null; cariId?: string | null; invoiceId?: string | null; orderIds: string[]; enabled: boolean }) {
  const cariQ = useQuery({
    queryKey: ["finance", "cari", "by-customer", p.customerId],
    queryFn: () => getCariByCustomer(p.customerId as string),
    enabled: p.enabled && !p.cariId && Boolean(p.customerId),
    staleTime: 60_000,
  });
  const cariId = p.cariId ?? cariQ.data?.id ?? null;
  const settled = Boolean(p.cariId) || cariQ.isSuccess;
  return useQuery({
    queryKey: ["finance", "warping-candidates", cariId, p.invoiceId ?? null, cariId ? [] : p.orderIds],
    queryFn: async (): Promise<WarpingFeeOrder[]> => {
      if (cariId) return listWarpingCandidates(cariId, p.invoiceId);
      const rows = await Promise.all(p.orderIds.map((id) => getWarpingOrderFeeSummary(id)));
      return rows.filter((o) => o.receipts.length > 0);
    },
    enabled: p.enabled && settled,
  });
}

export function InvoiceWarpingOrdersSection({ mode, customerId, cariId, invoiceId, value, onChange, linked = [], preselectOrderIds = [], onDraftCreated, disabled }: Props) {
  const [open, setOpen] = useState(preselectOrderIds.length > 0 && Boolean(customerId));
  const [error, setError] = useState<string | null>(null);
  const attempt = useAttemptToken();
  const lastKeys = useRef<string[]>([]);
  const q = useWarpingCandidates({ customerId, cariId, invoiceId, orderIds: preselectOrderIds, enabled: open && Boolean(customerId) });
  const orders = q.data ?? [];
  // "Fatura gir": İLK açılışta siparişin faturasız kabulleri ön seçilir (kullanıcı yine değiştirebilir); sonra küme formdan.
  const [preDone, setPreDone] = useState(preselectOrderIds.length === 0);
  const pickerValue = preDone ? value : preselectOrders(orders, preselectOrderIds);
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) setPreDone(true);
  };

  const draftM = useMutation({
    mutationFn: (keys: string[]) => createDraftFromWarping(keys, attempt.token()),
    onSuccess: (r) => {
      attempt.onSuccess();
      toastServerSuccess(r, "Taslak devere kabullerinden oluşturuldu.");
      onDraftCreated?.(r.data.id);
    },
    onError: (e) => {
      attempt.onFailure(e);
      setError(receiptsErrorText(e));
    },
  });
  const apply = (keys: string[]) => {
    setError(null);
    onChange(keys);
    if (mode !== "create" || keys.length === 0) return;
    if (!sameIdSet(keys, lastKeys.current)) attempt.renew();
    lastKeys.current = keys;
    draftM.mutate(keys);
  };
  const summary = linkedOrdersText(linked, value);
  return (
    <div data-testid="invoice-warping">
      <Label className="flex items-center gap-1">
        Devere siparişlerine bağla
        <InfoPopover label="Devere faturası" desc="Devereci faturasını dönen leventlerin kabullerine (irsaliye) bağlar. Beklenen ücret = dönen ölçü × siparişteki birim ücret; fatura farklıysa uyarır, onayı engellemez. Faturalanan kabul başka faturaya bağlanamaz." />
      </Label>
      <button
        type="button"
        disabled={disabled || !customerId || draftM.isPending}
        onClick={() => setOpen(true)}
        className={cn("mt-1 flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60")}
      >
        <Layers className="h-4 w-4 shrink-0 text-primary" />
        <span className={cn("min-w-0 flex-1 truncate", value.length === 0 && "text-muted-foreground")}>
          {draftM.isPending ? "Taslak oluşturuluyor…" : warpingTriggerText(value.length, Boolean(customerId))}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {summary && <p className="mt-1 truncate text-[11px] text-muted-foreground" title={summary}>{summary}</p>}
      {error ? (
        <p className="mt-1 text-xs text-destructive" data-testid="invoice-warping-error">{error}</p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {mode === "create" ? "İsteğe bağlı. Kabul seçince sipariş başına bir satırlık taslak doğar ve düzenlemeye açılır." : "Küme değişince satırlar yeniden yazılmaz; tutarı elden geçir."}
        </p>
      )}
      {/* Ön seçimli açılışta seçici liste gelince bağlanır (ilk değer `useState` başlangıcıdır). */}
      {open && customerId && (preDone || !q.isPending) && (
        <WarpingOrdersPickerModal onOpenChange={onOpenChange} orders={orders} isLoading={q.isPending} isError={q.isError} value={pickerValue} applyLabel={mode === "create" ? "Taslak oluştur" : "Uygula"} onApply={apply} />
      )}
    </div>
  );
}
