// =============================================================================
// KUR FARKI — ek filtre şeridi (tarih aralığının ALTINDA)
// =============================================================================
// ⚠️ Bu şerit ortak `ReportDateRange`'in YERİNE GEÇMEZ, ONUN ALTINA eklenir:
// `ReportPageLayout` `filters` verildiğinde tarih aralığını çizmez, o yüzden
// sayfa ikisini bir fragment içinde birlikte gönderir (`CashBookFilterBar`
// emsali). Yalnız bu şeridi göndermek, raporun en temel filtresini (dönem)
// ekrandan silerdi.
//
// ⚠️ CARİ SEÇİCİSİ ARTIK RAPORUN KENDİ YANITINDAN beslenir (`meta.secenekler.cariId`,
// R5b-d) ve bileşen olarak DIŞARIDAN gelir (`cariSelect`): kaynak sunucuda, çizim
// ortak `ReportMultiSelect`te. Eski iki mekanizma (satırlardan türetme + süzgeçsiz
// ikinci sorgu) KALKTI — liste süzgeçten bağımsız döndüğü için daralma yok.
// `/api/finance/cari` ucu hâlâ kullanılmaz (o uç `finance:read` ister, rapor
// kitlesinde 403 riski).
// =============================================================================

import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import type { CariKind, Currency } from "./service";
import { FX_CURRENCIES } from "./fxDiffService";

interface Props {
  /** Cari çoklu seçicisi — sayfa çizer, şerit yerleştirir. */
  cariSelect: ReactNode;
  currency: Currency | "";
  /** Cari türü — yaşlandırmadaki eksenin kardeşi. */
  kind: CariKind | "";
  onChangeKind: (v: string) => void;
  onChangeCurrency: (v: string) => void;
  onClear: () => void;
}

export function FxDiffFilterBar({ cariSelect, currency, kind, onChangeKind, onChangeCurrency, onClear }: Props) {
  const hasFilter = Boolean(currency || kind);

  return (
    <div className="flex flex-wrap items-end gap-1 border-b px-3 py-2 text-xs">
      {cariSelect}

      <span className="ml-2 mr-1 text-muted-foreground">Cari türü</span>
      <select
        value={kind}
        onChange={(e) => onChangeKind(e.target.value)}
        className="h-7 rounded-md border bg-background px-2 text-xs"
      >
        <option value="">Tüm cariler</option>
        <option value="CUSTOMER">Müşteri</option>
        <option value="SUBCONTRACTOR">Fason</option>
      </select>

      <span className="ml-2 mr-1 text-muted-foreground">Para birimi</span>
      <select
        value={currency}
        onChange={(e) => onChangeCurrency(e.target.value)}
        className="h-7 rounded-md border bg-background px-2 text-xs"
        title="TRY yoktur: TRY faturada kur farkı tanım gereği sıfırdır"
      >
        <option value="">Tüm dövizler</option>
        {FX_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {hasFilter ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-2 h-7 px-2 text-xs"
          onClick={onClear}
        >
          Süzgeçleri temizle
        </Button>
      ) : null}
    </div>
  );
}
