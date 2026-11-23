// =============================================================================
// KAPAMA KAPSAMI — cari · para birimi · yön
// =============================================================================
// ⚠️ ÜÇÜ DE ZORUNLU ve bu bir arayüz tercihi değil, UCUN SÖZLEŞMESİDİR: açık
// fatura ve serbest tahsilat uçları `cariId` + `currency` ister, yön ise fatura
// türünü belirler (Tahsilat ↔ SATIŞ, Ödeme ↔ ALIŞ). "Hepsi" diye bir seçenek
// bilinçli olarak YOK: iki para birimini tek listede kapatmak KUR FARKI doğurur
// ve o fark bir yere yazılmak zorundadır (bu sürümde desteklenmiyor).
//
// ⚠️ Üçünden biri değişince SEÇİM ve YAZILAN TUTARLAR sıfırlanır (`onScopeChange`).
// Sıfırlanmasaydı, başka bir cari için yazılmış tutarlar ekranda kalır ve
// gönderildiğinde uç "başka bir cariye ait" derdi — kullanıcı ise ekranda
// doğru cariyi görüyor olurdu.
import { ListToolbar } from "@/components/layout/ListPage";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import type { CariRow, Currency } from "../service";
import { PICKER_CHIP } from "../PaymentsFilterBar";
import { cariPickerService, type Direction } from "./service";

const CURRENCY_OPTIONS = (["TRY", "USD", "EUR", "GBP", "RUB"] as const).map((c) => ({ value: c, label: c }));
const DIRECTION_OPTIONS = [
  { value: "IN", label: "Tahsilat → Satış faturası" },
  { value: "OUT", label: "Ödeme → Alış faturası" },
] as const;

interface Props {
  cariId: string | null;
  currency: Currency;
  direction: Direction;
  /** Seçili carinin okunur özeti — seçim doğru mu, tek bakışta görünsün. */
  cariLabel: string | null;
  onCariChange: (cariId: string | null) => void;
  onCurrencyChange: (currency: Currency) => void;
  onDirectionChange: (direction: Direction) => void;
}

export function AllocationFilters({
  cariId,
  currency,
  direction,
  cariLabel,
  onCariChange,
  onCurrencyChange,
  onDirectionChange,
}: Props) {
  return (
    <ListToolbar className="flex-row flex-wrap items-center">
      {/* Üçü de zorunlu: "Tümü" seçeneği yok (dosya başı); çip yalnız biçimdir. */}
      <EntityPickerModal<CariRow>
        value={cariId}
        onChange={(id) => onCariChange(id)}
        service={cariPickerService}
        queryKey="finance-cari"
        getLabel={(c) => c.name}
        getSubLabel={(c) => c.code}
        label="Cari:"
        placeholder="Seçin"
        title="Cari seç"
        countLabel="cari"
        triggerClassName={PICKER_CHIP}
        hideChevron
      />
      <SelectChip<Currency> id="allocation-currency" label="Para birimi" value={currency} options={CURRENCY_OPTIONS} resetValue="TRY" onChange={(v) => onCurrencyChange(v ?? "TRY")} />
      <SelectChip<Direction> id="allocation-direction" label="Yön" value={direction} options={DIRECTION_OPTIONS} resetValue="IN" onChange={(v) => onDirectionChange(v ?? "IN")} />
      {cariLabel && <p className="ml-auto text-xs text-muted-foreground">{cariLabel}</p>}
    </ListToolbar>
  );
}
