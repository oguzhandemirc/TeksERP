// =============================================================================
// FATURA FORMU — "Mal kabul fişleri" alanı (yalnız ALIŞ + cari kartı)
// =============================================================================
// YENİ faturada fiş seçimi = taslak sunucuda doğar (`draft-from-goods-receipts`; kalemler fişlerden, fiyat zinciri
// tek-fiş yoluyla AYNI) ve form o taslağın düzenlemesine geçer. DÜZENLEMEDE yalnız küme değişir (PATCH REPLACE);
// kalemler yeniden yazılmaz — ipucu bunu söyler. Sunucu hataları (400/409 kodları) alanın altında.
// =============================================================================
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronsUpDown, FileStack } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createDraftFromGoodsReceipts, type InvoiceGoodsReceiptRef } from "./service";
import { GoodsReceiptsPickerModal } from "./GoodsReceiptsPickerModal";
import { receiptLabel, receiptsErrorText, receiptsTriggerText } from "./invoiceReceipts";

interface Props {
  mode: "create" | "edit";
  supplierId: string | null;
  value: string[];
  onChange: (ids: string[]) => void;
  /** Kayıtlı taslağın bağlı fişleri (etiket için) — yeni faturada boş. */
  linked?: InvoiceGoodsReceiptRef[];
  /** Yeni faturada: sunucu taslağı doğurdu → çağıran formu kapatıp taslağı düzenlemeye açar. */
  onDraftCreated?: (id: string) => void;
  disabled?: boolean;
}

export function InvoiceReceiptsSection({ mode, supplierId, value, onChange, linked = [], onDraftCreated, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftM = useMutation({
    mutationFn: (ids: string[]) => createDraftFromGoodsReceipts(ids),
    onSuccess: (r) => {
      toast.success(r.message ?? "Taslak fişlerin kalemleriyle oluşturuldu.");
      onDraftCreated?.(r.data.id);
    },
    onError: (e) => setError(receiptsErrorText(e)),
  });
  const apply = (ids: string[]) => {
    setError(null);
    onChange(ids);
    if (mode === "create" && ids.length > 0) draftM.mutate(ids);
  };
  const labels = linked.filter((r) => value.includes(r.id)).map(receiptLabel);
  return (
    <div data-testid="invoice-receipts">
      <Label>Mal kabul fişleri</Label>
      <button
        type="button"
        disabled={disabled || !supplierId || draftM.isPending}
        onClick={() => setOpen(true)}
        className={cn("mt-1 flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60")}
      >
        <FileStack className="h-4 w-4 shrink-0 text-primary" />
        <span className={cn("min-w-0 flex-1 truncate", value.length === 0 && "text-muted-foreground")}>
          {draftM.isPending ? "Taslak oluşturuluyor…" : receiptsTriggerText(value.length, Boolean(supplierId))}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {labels.length > 0 && <p className="mt-1 truncate text-[11px] text-muted-foreground" title={labels.join(" · ")}>{labels.join(" · ")}</p>}
      {error ? (
        <p className="mt-1 text-xs text-destructive" data-testid="invoice-receipts-error">{error}</p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {mode === "create"
            ? "İsteğe bağlı. Fiş seçince kalemler fişlerden dolar ve taslak düzenlemeye açılır; seçmezsen fatura bağsız kesilir."
            : "Küme değişince kalemler yeniden yazılmaz; kalemleri elden geçir. Aynı cari ve para birimi şartı sunucuda."}
        </p>
      )}
      {open && supplierId && <GoodsReceiptsPickerModal open onOpenChange={setOpen} supplierId={supplierId} value={value} onApply={apply} />}
    </div>
  );
}
