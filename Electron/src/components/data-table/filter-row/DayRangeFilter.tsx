import { useState } from "react";
import { DatePresetDialog, DatePresetTrigger } from "./DatePresetFilter";
import { datePresetText, dayKeysOfPreset, presetFromDayKeys } from "./date-preset";

export interface DayRangeFilterProps {
  label: string;
  /** Fabrika günü uçları (`yyyy-MM-dd`, "" = açık uç). */
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  idPrefix: string;
  autoOpen?: boolean;
}

/**
 * URL'siz (yerel durumlu) tarih kutusu: `DatePresetFilter` ile AYNI pencere ve hazır seçimler;
 * değer gün anahtarı olarak döner (sayfanın sorgusu sunucuya kendisi taşır). Temizleme `FilterChip` ✕'ünden.
 */
export function DayRangeFilter({ label, from, to, onChange, idPrefix, autoOpen }: DayRangeFilterProps) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const current = presetFromDayKeys(from, to, "date");
  return (
    <>
      <DatePresetTrigger text={`${label}: ${datePresetText(current)}`} onClick={() => setOpen(true)} />
      <DatePresetDialog open={open} onOpenChange={setOpen} title={label} value={current} idPrefix={idPrefix} onCommit={(st) => onChange(dayKeysOfPreset(st))} />
    </>
  );
}
