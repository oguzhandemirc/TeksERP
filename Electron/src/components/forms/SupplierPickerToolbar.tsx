// =============================================================================
// TEDARİKÇİ SEÇİCİ — araç şeridi: arama · İKİ süzgeç (Yön × Fason, `LabeledSelect`) · hızlı ekleme
// =============================================================================
// Rol modeli (kullanıcı 16:43): fason bir tür değil ROLDÜR — tek eksenli "Rol" menüsü kalktı, Cariler şeridiyle
// aynı iki süzgeç: "Yön: Tümü" (kipin rolü taban) · "Fason: Tümü" (Fason yapan / Yapmayan). Tetik kapalıyken de
// süzgecin adını taşır (kullanıcı 03:27). Seçim → sunucu süzgeci tek kaynaktan (`lib/partnerRoles`).
// Dönüştürme görünümünde süzgeçler ve hızlı ekleme çizilmez: liste zaten tek küme (yalnız müşteri).
// =============================================================================
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LabeledSelect } from "./LabeledSelect";
import { SUBCONTRACTOR_OPTIONS, pickerDirectionOptions, type DirectionFilter, type SubcontractorFilter } from "@/lib/partnerRoles";
import type { SupplierParty } from "./supplierParty";
import type { PickerMode, PickerRoleFilter } from "./supplierPicker";
import { SupplierQuickCreate } from "./SupplierQuickCreate";

interface Props {
  mode: PickerMode;
  converting: boolean;
  searchInput: string;
  onSearchInput: (v: string) => void;
  filters: PickerRoleFilter;
  onFilters: (f: PickerRoleFilter) => void;
  onCreated: (party: SupplierParty) => void;
}

export function SupplierPickerToolbar({ mode, converting, searchInput, onSearchInput, filters, onFilters, onCreated }: Props) {
  const searchLabel = converting ? "Müşteri kartı ara" : mode === "customer" ? "Müşteri ara" : "Tedarikçi ara";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[16rem] flex-1">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input aria-label={searchLabel} placeholder="Kod, ünvan, vergi no…" className="pl-8" value={searchInput} onChange={(e) => onSearchInput(e.target.value)} autoFocus />
      </div>
      {!converting && (
        <>
          <LabeledSelect label="Yön" value={filters.direction} options={pickerDirectionOptions(mode)} onChange={(v) => onFilters({ ...filters, direction: v as DirectionFilter })} title="Ticari yön: kipin rolü taban; Müşteri + Tedarikçi = iki rolü de taşıyan" />
          <LabeledSelect label="Fason" value={filters.subcontractor} options={SUBCONTRACTOR_OPTIONS} onChange={(v) => onFilters({ ...filters, subcontractor: v as SubcontractorFilter })} title="Fason iş yapan kartlar (aktif fason profili); bağsız fason firmaları yalnız Yön: Tümü'de" />
          <SupplierQuickCreate onCreated={onCreated} mode={mode} />
        </>
      )}
    </div>
  );
}
