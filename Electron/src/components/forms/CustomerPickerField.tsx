// =============================================================================
// CARİ SEÇİCİ ALANI — tedarikçi modalı v3'ün MÜŞTERİ KİPİ (sipariş formu ①) ya da YALNIZ-CARİ tedarikçi kipi
// =============================================================================
// Tetik kutusu "Ad — KOD" (`supplierOptionLabel`), tıkla → `SupplierPickerModal`. `variant="customer"`: yalnız cari
// CUSTOMER sonra BOTH, rol Tümü · Müşteri · Müşteri + Tedarikçi, Şehir kolonu, "Yeni müşteri". `variant="supplier-cari"`
// (fason profilinin "Bağlı cari" alanı, 2026-09-17): SUPPLIER/BOTH cari, fason bacağı yok, × ile bağ kaldırılır.
// Seçili kaydın etiketi id'den çözülür (`customerService.getById`) — kutu boş görünüp state'in dolu olması yalan sınıfı.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListFilter, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { customerService } from "@/pages/Customers/service";
import { SupplierPickerModal } from "./SupplierPickerModal";
import { supplierOptionLabel } from "./supplierParty";

type Variant = "customer" | "supplier-cari" | "cari";
const TEXT: Record<Variant, { aria: string; title: string; placeholder: string }> = {
  customer: { aria: "Müşteri seç (liste)", title: "Tıkla: müşteri ve alıcı + satıcı kartlar listede — rol süzgeci, arama, yeni müşteri", placeholder: "Müşteri seç…" },
  "supplier-cari": { aria: "Bağlı cari seç (liste)", title: "Tıkla: tedarikçi ve müşteri + tedarikçi cari kartlar listede — fason profili bu karta bağlanır", placeholder: "Bağlı cari yok — bağsız fason" },
  // Muhasebe formları (tahsilat/ödeme/fatura/çek): her rol, yalnız kart — fason firma da kartıyla seçilir, hesap karta yazılır.
  cari: { aria: "Cari seç (liste)", title: "Tıkla: müşteri, tedarikçi ve fason rollü bütün cari kartlar listede — Yön × Fason süzgeci, arama", placeholder: "Cari seç…" },
};

interface Props {
  value: string | null;
  onChange: (customerId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
  variant?: Variant;
  /** × ile boşaltma (bağ kaldırma) — yalnız isteyen alan açar. */
  clearable?: boolean;
}

export function CustomerPickerField({ value, onChange, disabled, placeholder, triggerClassName, variant = "customer", clearable = false }: Props) {
  const [open, setOpen] = useState(false);
  const text = TEXT[variant];
  const selectedQ = useQuery({
    queryKey: ["supplier-select", "by-id", "CUSTOMER", value],
    queryFn: async () => (await customerService.getById(value as string)).data as { id: string; code?: string | null; name: string },
    enabled: Boolean(value),
    staleTime: 5 * 60_000,
  });
  const label = selectedQ.data ? supplierOptionLabel(selectedQ.data) : value && selectedQ.isLoading ? "Yükleniyor…" : null;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-label={text.aria}
        aria-haspopup="dialog"
        title={text.title}
        className={cn("w-full min-w-0 justify-between font-normal", !label && "text-muted-foreground", triggerClassName)}
        onClick={() => setOpen(true)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <UserRound className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{label ?? placeholder ?? text.placeholder}</span>
        </span>
        <ListFilter className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      {clearable && value && !disabled && (
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Bağı kaldır" title="Bağı kaldır — fason bağsız kalır, kayıt silinmez" onClick={() => onChange(null)}>
          <X className="h-4 w-4" />
        </Button>
      )}
      <SupplierPickerModal
        mode={variant === "supplier-cari" ? "supplier" : variant}
        cariOnly={variant === "supplier-cari"}
        open={open}
        onOpenChange={setOpen}
        onPick={(p) => {
          if (p.kind === "CUSTOMER") onChange(p.id);
        }}
      />
    </div>
  );
}
