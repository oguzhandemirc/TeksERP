import { DatePickerInput } from "@/components/forms/DatePickerInput";

/** Bir ISO tarih, [from, to] (YYYY-MM-DD) gün aralığında mı? Uçlar dahil (bitiş gün-sonu).
 *  Aralık boşsa herkes geçer; aralık aktif ama satırda tarih yoksa (null) DIŞLANIR. */
export function inDateRange(iso: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && t > new Date(`${to}T23:59:59.999`).getTime()) return false;
  return true;
}

/** Kompakt tarih-aralığı filtresi — Yeni Sipariş modalıyla AYNI DatePickerInput
 *  (GG.AA.YYYY maskeli giriş + takvim popover + kendi temizle butonu). Modal facet
 *  satırlarında paylaşılır. Değer/onChange "YYYY-MM-DD". */
export function DateRangeFilter({
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <DatePickerInput value={from} onChange={onFrom} className="h-8 w-[150px]" />
      <span className="text-muted-foreground">–</span>
      <DatePickerInput value={to} onChange={onTo} className="h-8 w-[150px]" />
    </div>
  );
}
