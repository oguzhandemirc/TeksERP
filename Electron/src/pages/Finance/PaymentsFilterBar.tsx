// =============================================================================
// TAHSİLAT / ÖDEME FİLTRE SATIRI (B4 · UI D2-f ortak kutular)
// =============================================================================
// ⚠️ Satır `PageBody`'nin DIŞINDA ve `shrink-0` (ListToolbar) — liste kaydıkça
// filtreler yukarı kaçmasın; kullanıcı hangi daraltmaya baktığını görür.
//
// ⚠️ VARSAYILAN "TÜMÜ"dür, "yalnız aktifler" DEĞİL. Burası bir DEFTERDİR: iptal
// edilmiş tahsilat silinmez, ters kayıtla kapanır ve tam da "bu para nereye
// gitti" sorusunda aranır; iptal satırları listede soluk + üstü çizili ayrışır.
//
// ⚠️ CARİ SEÇİCİ `cariPickerService` kullanır (kopya DEĞİL): uç `cariId` ister
// ve o servis `isActive` filtresini bilerek DÜŞÜRÜR — pasifleştirilmiş bir
// carinin geçmiş tahsilatı hâlâ aranır (cariyi kapatmak geçmişini kilitlemez).
// =============================================================================
import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/layout/ListPage";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { DayRangeChip, SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { cariPickerService } from "./Allocations/service";
import type { CariRow } from "./service";
import {
  EMPTY_PAYMENT_FILTERS,
  PAYMENT_METHOD_LABEL,
  isPaymentFilterDirty,
  type PaymentFilterState,
} from "./paymentFilters";

/** Modal açan seçici tetiği çip görünümünde ("Cari: Tümü") — satırın diğer kutularıyla aynı boy (DeviationFilters emsali). */
export const PICKER_CHIP =
  "h-8 min-h-8 w-auto max-w-64 gap-1 px-2.5 py-0 text-xs font-normal [&>span:first-child]:font-normal [&>span:first-child]:text-muted-foreground";

const DIRECTION_OPTIONS = [
  { value: "IN", label: "Tahsilat" },
  { value: "OUT", label: "Ödeme" },
] as const;
const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Aktif" },
  { value: "CANCELLED", label: "İptal" },
] as const;
const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }));

interface Props {
  /** Sağ uçtaki standart tablo araçları (Sütunlar + Dışa aktar). */
  tools?: ReactNode;
  value: PaymentFilterState;
  onChange: (next: PaymentFilterState) => void;
}

export function PaymentsFilterBar({ value, onChange, tools }: Props) {
  const set = <K extends keyof PaymentFilterState>(key: K, v: PaymentFilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <ListToolbar className="flex-row flex-wrap items-center">
      <ListSearchBox value={value.search} onSearchChange={(v) => set("search", v)} searchHint="Belge no / referans ara" />
      <SelectChip<string> id="payment-direction" label="Yön" value={value.direction || null} options={DIRECTION_OPTIONS} onChange={(v) => set("direction", v ?? "")} />
      <EntityPickerModal<CariRow>
        value={value.cariId}
        onChange={(id) => set("cariId", id)}
        service={cariPickerService}
        queryKey="finance-cari"
        getLabel={(c) => c.name}
        getSubLabel={(c) => c.code}
        nullable
        noneLabel="Tüm cariler"
        label="Cari:"
        placeholder="Tümü"
        title="Cari seç"
        countLabel="cari"
        triggerClassName={PICKER_CHIP}
        placeholderClassName="text-foreground"
        hideChevron
      />
      <SelectChip<string> id="payment-method" label="Yöntem" value={value.method || null} options={METHOD_OPTIONS} onChange={(v) => set("method", v ?? "")} />
      <SelectChip<string> id="payment-status" label="Durum" value={value.status || null} options={STATUS_OPTIONS} onChange={(v) => set("status", v ?? "")} />
      <DayRangeChip id="payment-date" label="Tarih" from={value.from} to={value.to} onChange={({ from, to }) => onChange({ ...value, from, to })} />

      {/* Temizle YALNIZ bir şey seçiliyken çıkar — hep duran düğme "bir şey açık" izlenimi verir. */}
      {isPaymentFilterDirty(value) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_PAYMENT_FILTERS)}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Filtreleri temizle
        </Button>
      )}
      {tools ? <div className="ml-auto flex items-center gap-1.5">{tools}</div> : null}
    </ListToolbar>
  );
}
