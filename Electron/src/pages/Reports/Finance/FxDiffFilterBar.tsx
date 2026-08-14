// =============================================================================
// KUR FARKI — ek filtre şeridi (tarih aralığının ALTINDA)
// =============================================================================
// ⚠️ Bu şerit ortak `ReportDateRange`'in YERİNE GEÇMEZ, ONUN ALTINA eklenir:
// `ReportPageLayout` `filters` verildiğinde tarih aralığını çizmez, o yüzden
// sayfa ikisini bir fragment içinde birlikte gönderir (`CashBookFilterBar`
// emsali). Yalnız bu şeridi göndermek, raporun en temel filtresini (dönem)
// ekrandan silerdi.
//
// ⚠️ CARİ SEÇENEKLERİ VERİDEN GELİR, CARİ KATALOĞUNDAN DEĞİL. `/api/finance/cari`
// ucu `finance:read` ister; yalnız `report:finance` taşıyan yönetim kullanıcısı
// orada 403 alır ve filtre sessizce ölürdü (`AgingFilterBar` başlığındaki aynı
// gerekçe). Seçenekleri dönemin satırlarından türetmek ayrıca "hiç kur farkı
// doğurmamış cariyi seçtirme" faydasını da verir.
//
// ⚠️ SEÇİLİ CARİ LİSTEDE YOKSA SENTETİK SATIR BASILIR. Derin bağlantıyla
// (`?cariId=…`) gelen ya da dönemi değiştirdikten sonra artık satırı kalmayan
// cari, aksi hâlde BOŞ bir seçici + boş tablo üretirdi — kullanıcı bunu "filtre
// bozuk" diye okur. "Temizle" düğmesi de bu yüzden yalnız filtre AÇIKKEN çıkar.
// =============================================================================

import { Button } from "@/components/ui/button";
import type { Currency } from "./service";
import { FX_CURRENCIES } from "./fxDiffService";

export interface CariOption {
  id: string;
  name: string;
}

interface Props {
  cariId: string;
  cariOptions: CariOption[];
  currency: Currency | "";
  /** Seçenekler henüz yüklenmediyse seçici pasif — boş liste "cari yok" der. */
  optionsLoading?: boolean;
  onChangeCari: (v: string) => void;
  onChangeCurrency: (v: string) => void;
  onClear: () => void;
}

export function FxDiffFilterBar({
  cariId,
  cariOptions,
  currency,
  optionsLoading,
  onChangeCari,
  onChangeCurrency,
  onClear,
}: Props) {
  const hasFilter = Boolean(cariId || currency);
  const selectedMissing = Boolean(cariId) && !cariOptions.some((c) => c.id === cariId);

  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs">
      <span className="mr-1 text-muted-foreground">Cari</span>
      <select
        value={cariId}
        onChange={(e) => onChangeCari(e.target.value)}
        disabled={optionsLoading}
        className="h-7 max-w-[260px] rounded-md border bg-background px-2 text-xs disabled:opacity-50"
        title="Seçenekler dönemin kur farkı satırlarından gelir"
      >
        <option value="">Tüm cariler</option>
        {selectedMissing ? (
          <option value={cariId}>Seçili cari (bu dönemde satırı yok)</option>
        ) : null}
        {cariOptions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
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
