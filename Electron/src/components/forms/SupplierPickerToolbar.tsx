// =============================================================================
// TEDARİKÇİ SEÇİCİ — araç şeridi: arama · rol (Radix Select, tetik "Rol: …") · hızlı ekleme
// =============================================================================
// Rol tetiği kapalıyken de süzgecin ADINI taşır ("Rol: Tümü" / "Rol: Tedarikçi"; kullanıcı 03:27 —
// yalnız "Tümü" yazan kutu hangi süzgeç olduğunu söylemiyordu). Açılır listede seçenek "Tümü" kalır.
// Dönüştürme görünümünde rol ve hızlı ekleme çizilmez: liste zaten tek tip (CUSTOMER).
// =============================================================================
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SupplierParty } from "./supplierParty";
import { roleFilterOptions, roleTriggerText, type PickerList, type PickerMode, type SupplierRoleFilter } from "./supplierPicker";
import { SupplierQuickCreate } from "./SupplierQuickCreate";

interface Props {
  mode: PickerMode;
  /** Rol seçeneklerinin okunduğu liste (kip ya da `supplier-cari`). */
  list: PickerList;
  converting: boolean;
  searchInput: string;
  onSearchInput: (v: string) => void;
  role: SupplierRoleFilter;
  onRole: (r: SupplierRoleFilter) => void;
  onCreated: (party: SupplierParty) => void;
}

export function SupplierPickerToolbar({ mode, list, converting, searchInput, onSearchInput, role, onRole, onCreated }: Props) {
  const searchLabel = converting ? "Müşteri kartı ara" : mode === "customer" ? "Müşteri ara" : "Tedarikçi ara";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[16rem] flex-1">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input aria-label={searchLabel} placeholder="Kod, ünvan, vergi no…" className="pl-8" value={searchInput} onChange={(e) => onSearchInput(e.target.value)} autoFocus />
      </div>
      {!converting && (
        <>
          <Select value={role} onValueChange={(v) => onRole(v as SupplierRoleFilter)}>
            <SelectTrigger aria-label="Rol" className="w-52">
              <SelectValue>{roleTriggerText(list, role)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {roleFilterOptions(list).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SupplierQuickCreate onCreated={onCreated} mode={mode} />
        </>
      )}
    </div>
  );
}
