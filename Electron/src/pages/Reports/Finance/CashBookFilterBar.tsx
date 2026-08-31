// =============================================================================
// KASA / BANKA DEFTERİ — ek filtre şeridi (tarih aralığının ALTINDA)
// =============================================================================
// ⚠️ Bu şerit ortak `ReportDateRange`'in YERİNE GEÇMEZ, ONUN ALTINA eklenir:
// `ReportPageLayout` `filters` verildiğinde tarih aralığını çizmez, o yüzden
// sayfa ikisini bir fragment içinde birlikte gönderir. Yalnız bu şeridi
// göndermek, defterin en temel filtresini (dönem) ekrandan silerdi.
//
// ⚠️ "Pasif hesapları da göster" bir SÜS DEĞİL: backend, hareketi/bakiyesi
// olmayan pasif hesabı listeden düşürür. Kullanıcı kapatılmış bir kasayı
// arıyorsa onu bulmasının TEK yolu bu düğmedir; olmasaydı "hesap kayboldu"
// diye bildirilirdi.
// =============================================================================

import { Button } from "@/components/ui/button";
import type { CashAccountKind } from "./cashBookService";

interface Props {
  accountKind: CashAccountKind | "";
  includeInactive: boolean;
  /** Tek hesap seçiliyken "tüm hesaplara dön" çıkışı gösterilir. */
  hasSelection: boolean;
  onChangeKind: (v: string) => void;
  onToggleInactive: () => void;
  onClearSelection: () => void;
}

export function CashBookFilterBar({
  accountKind,
  includeInactive,
  hasSelection,
  onChangeKind,
  onToggleInactive,
  onClearSelection,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs">
      <select
        value={accountKind}
        onChange={(e) => onChangeKind(e.target.value)}
        className="h-7 rounded-md border bg-background px-2 text-xs"
      >
        <option value="">Kasa + Banka</option>
        <option value="CASH">Yalnız kasa</option>
        <option value="BANK">Yalnız banka</option>
      </select>
      <Button
        type="button"
        size="sm"
        variant={includeInactive ? "default" : "outline"}
        className="h-7 px-2 text-xs"
        onClick={onToggleInactive}
      >
        Pasif hesapları da göster
      </Button>
      {hasSelection ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-2 h-7 px-2 text-xs"
          onClick={onClearSelection}
        >
          Tüm hesaplara dön
        </Button>
      ) : null}
    </div>
  );
}
