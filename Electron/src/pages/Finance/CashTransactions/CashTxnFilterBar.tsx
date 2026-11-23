// =============================================================================
// KASA HAREKETLERİ FİLTRE SATIRI (UI D2-f ortak kutular)
// =============================================================================
// ⚠️ Satır `PageBody`'nin DIŞINDA ve `shrink-0` (ListToolbar) — liste kaydıkça
// filtreler yukarı kaçmasın; kullanıcı hangi daraltmaya baktığını görür.
//
// ⚠️ VARSAYILAN "TÜMÜ"dür, "yalnız aktifler" DEĞİL. Kasa defteri bir DEFTERDİR:
// iptal edilmiş fiş silinmez, iz olarak kalır ve tam da "bu para nereye gitti"
// sorusunda aranır (çek portföyünde tersi bilinçli — orası "elimde ne var" sorusu).
//
// ⚠️ Hesap seçici KOPYALANMAZ: `PeriodClose/CashAccountPicker` import edilir.
// Kasa+banka tek listede, pasif hesap gizlenmez işaretlenir.
// =============================================================================

import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/layout/ListPage";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { DayRangeChip, SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { CashAccountPicker, type CashAccountOption } from "../PeriodClose/CashAccountPicker";
import { EMPTY_FILTERS, KIND_LABEL, isFilterDirty, type CashTxnFilterState } from "./cashTxnRules";
import { CashCategoryFilter } from "./CashCategoryFilter";

// Virmanın iki bacağı AYRI seçenektir: "virman" diye tek seçenek sunmak backend'de CSV
// desteği olmadığı için sessizce tek bacağı süzerdi (uç `where.kind = <tek değer>`).
const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Aktif" },
  { value: "CANCELLED", label: "İptal" },
] as const;

interface Props {
  value: CashTxnFilterState;
  /** Seçili hesap nesnesi — filtre durumu yalnız tür+id taşır (sorgu şekli). */
  account: CashAccountOption | null;
  onAccountChange: (account: CashAccountOption | null) => void;
  onChange: (next: CashTxnFilterState) => void;
  /** Sağ uçtaki standart tablo araçları (Sütunlar + Dışa aktar). */
  tools?: ReactNode;
}

export function CashTxnFilterBar({ value, account, onAccountChange, onChange, tools }: Props) {
  const set = <K extends keyof CashTxnFilterState>(key: K, v: CashTxnFilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <ListToolbar className="flex-row flex-wrap items-center">
      <ListSearchBox value={value.search} onSearchChange={(v) => set("search", v)} searchHint="Belge no / kategori / açıklama / referans ara" />
      <CashAccountPicker
        chipLabel="Hesap:"
        nullable
        value={account}
        onChange={(a) => {
          onAccountChange(a);
          onChange({ ...value, account: a ? { kind: a.kind, id: a.id } : null });
        }}
      />
      <SelectChip<string> id="cash-kind" label="Tür" value={value.kind || null} options={KIND_OPTIONS} onChange={(v) => set("kind", v ?? "")} />
      <SelectChip<string> id="cash-status" label="Durum" value={value.status || null} options={STATUS_OPTIONS} onChange={(v) => set("status", v ?? "")} />
      <CashCategoryFilter value={value.category} onChange={(v) => set("category", v)} />
      <DayRangeChip id="cash-date" label="Tarih" from={value.from} to={value.to} onChange={({ from, to }) => onChange({ ...value, from, to })} />

      {/* Temizle YALNIZ bir şey seçiliyken çıkar — hep duran düğme "bir şey açık" izlenimi verir. */}
      {isFilterDirty(value) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onAccountChange(null);
            onChange(EMPTY_FILTERS);
          }}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Filtreleri temizle
        </Button>
      )}
      {tools ? <div className="ml-auto flex items-center gap-1.5">{tools}</div> : null}
    </ListToolbar>
  );
}
