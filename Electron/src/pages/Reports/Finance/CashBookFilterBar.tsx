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
import type { ReactNode } from "react";
import type { CashAccountKind, CashBookCategory } from "./cashBookService";

interface Props {
  accountKind: CashAccountKind | "";
  /** Cari çoklu seçicisi (R5b-d) — sayfa çizer, şerit yerleştirir. */
  cariSelect?: ReactNode;
  /** Hareket dökümü eksenleri — ÖZETİ değiştirmez. */
  kategori: CashBookCategory | "";
  yon: "IN" | "OUT" | "";
  onChangeKategori: (v: string) => void;
  onChangeYon: (v: string) => void;
  includeInactive: boolean;
  /** Tek hesap seçiliyken "tüm hesaplara dön" çıkışı gösterilir. */
  hasSelection: boolean;
  onChangeKind: (v: string) => void;
  onToggleInactive: () => void;
  onClearSelection: () => void;
}

export function CashBookFilterBar({
  accountKind,
  cariSelect,
  kategori,
  yon,
  onChangeKategori,
  onChangeYon,
  includeInactive,
  hasSelection,
  onChangeKind,
  onToggleInactive,
  onClearSelection,
}: Props) {
  return (
    <div className="flex flex-wrap items-end gap-1 border-b px-3 py-2 text-xs">
      <select
        value={accountKind}
        onChange={(e) => onChangeKind(e.target.value)}
        className="h-7 rounded-md border bg-background px-2 text-xs"
      >
        <option value="">Kasa + Banka</option>
        <option value="CASH">Yalnız kasa</option>
        <option value="BANK">Yalnız banka</option>
      </select>
      {/* ⚠️ Bu üç eksen YALNIZ hareket dökümünü daraltır — özet kartları ve
          devir/kapanış dönem gerçeğidir; şerh ekranda ve çıktıda yazılı. */}
      {cariSelect}

      <span className="ml-2 mr-1 text-muted-foreground">Tür</span>
      <select value={kategori} onChange={(e) => onChangeKategori(e.target.value)} className="h-7 rounded-md border bg-background px-2 text-xs">
        <option value="">Tüm hareketler</option>
        <option value="CASH_TXN">Kasa hareketi</option>
        <option value="TRANSFER">Virman</option>
        <option value="PAYMENT">Tahsilat / ödeme</option>
        <option value="CHEQUE">Çek</option>
      </select>

      <span className="ml-2 mr-1 text-muted-foreground">Yön</span>
      <select value={yon} onChange={(e) => onChangeYon(e.target.value)} className="h-7 rounded-md border bg-background px-2 text-xs">
        <option value="">Giriş + çıkış</option>
        <option value="IN">Yalnız giriş</option>
        <option value="OUT">Yalnız çıkış</option>
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
