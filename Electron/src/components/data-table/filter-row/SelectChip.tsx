import { FilterChip } from "./FilterChip";
import { ViewSelect, type ViewOption } from "./ViewSelect";
import { DayRangeFilter } from "./DayRangeFilter";

/**
 * Yerel durumlu (URL'siz) sayfalar için süzgeç kutusu: "Etiket: Değer ▾" tek kontrol, seçim varken vurgulu + ✕.
 * Üstte etiket + altta açılır ya da yan yana düğme grubu YERİNE kullanılır (kullanıcı 2026-11-23). `resetValue`
 * kutunun "boş" değeridir (çoğunlukla `null` = Tümü; ör. kapsam süzgecinde varsayılan "Aktif").
 */
export function SelectChip<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  resetValue = null,
  allLabel = "Tümü",
}: {
  id: string;
  label: string;
  value: T | null;
  /** `null` değerli "Tümü" seçeneği `resetValue === null` ise başa kendiliğinden eklenir. */
  options: readonly { value: T; label: string }[];
  onChange: (v: T | null) => void;
  resetValue?: T | null;
  allLabel?: string;
}) {
  const all: ViewOption[] = resetValue === null ? [{ value: null, label: allLabel }, ...options] : [...options];
  const active = value !== resetValue && value !== undefined && value !== ("" as T);
  return (
    <FilterChip id={id} label={label} active={active} removable={active} onRemove={() => onChange(resetValue)}>
      <ViewSelect label={label} options={all} value={value || null} onChange={(v) => onChange((v as T | null) ?? null)} />
    </FilterChip>
  );
}

/** Gün aralığı kutusu (Bugün · Son 7 gün · Son 30 gün · Tarih aralığı…) — yerel durumlu sayfalar için. */
export function DayRangeChip({
  id,
  label,
  from,
  to,
  onChange,
}: {
  id: string;
  label: string;
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  const active = Boolean(from || to);
  return (
    <FilterChip id={id} label={label} active={active} removable={active} onRemove={() => onChange({ from: "", to: "" })}>
      <DayRangeFilter label={label} from={from} to={to} onChange={onChange} idPrefix={id} />
    </FilterChip>
  );
}
