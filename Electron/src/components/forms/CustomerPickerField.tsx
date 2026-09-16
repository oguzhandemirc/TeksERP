// =============================================================================
// MÜŞTERİ SEÇİCİ ALANI — tedarikçi modalı v3'ün MÜŞTERİ KİPİ (sipariş formu ①, 2026-09-17)
// =============================================================================
// Tetik kutusu "Ad — KOD" (`supplierOptionLabel`), tıkla → `SupplierPickerModal mode="customer"` (yalnız cari:
// CUSTOMER sonra BOTH, rol Tümü · Müşteri · Alıcı + Satıcı, Şehir kolonu, "Yeni müşteri" hızlı ekleme). Seçili
// kaydın etiketi id'den çözülür (`customerService.getById`) — kutu boş görünüp state'in dolu olması yalan sınıfı.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListFilter, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { customerService } from "@/pages/Customers/service";
import { SupplierPickerModal } from "./SupplierPickerModal";
import { supplierOptionLabel } from "./supplierParty";

interface Props {
  value: string | null;
  onChange: (customerId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
}

export function CustomerPickerField({ value, onChange, disabled, placeholder = "Müşteri seç…", triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const selectedQ = useQuery({
    queryKey: ["supplier-select", "by-id", "CUSTOMER", value],
    queryFn: async () => (await customerService.getById(value as string)).data as { id: string; code?: string | null; name: string },
    enabled: Boolean(value),
    staleTime: 5 * 60_000,
  });
  const label = selectedQ.data ? supplierOptionLabel(selectedQ.data) : value && selectedQ.isLoading ? "Yükleniyor…" : null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-label="Müşteri seç (liste)"
        aria-haspopup="dialog"
        title="Tıkla: müşteri ve alıcı + satıcı kartlar listede — rol süzgeci, arama, yeni müşteri"
        className={cn("w-full min-w-0 justify-between font-normal", !label && "text-muted-foreground", triggerClassName)}
        onClick={() => setOpen(true)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <UserRound className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{label ?? placeholder}</span>
        </span>
        <ListFilter className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      <SupplierPickerModal
        mode="customer"
        open={open}
        onOpenChange={setOpen}
        onPick={(p) => {
          if (p.kind === "CUSTOMER") onChange(p.id);
        }}
      />
    </>
  );
}
