// =============================================================================
// TARİH + SAAT GİRDİSİ DEĞER KATMANI (saf) — `DateTimeInput` tek yerden birleştirir/ayırır
// =============================================================================
// Yerleşik `datetime-local` değeri "YYYY-MM-DDTHH:mm" (yerel, ofsetsiz) idi; bileşen aynı sözleşmeyi
// korur ki çağıranların dönüştürücüleri (`new Date(v)`, `toISOString`) değişmesin. Tarih parçası
// `DatePickerInput` ("YYYY-MM-DD"), saat parçası yerleşik `<input type="time">` ("HH:mm").
// =============================================================================
export interface DateTimeParts {
  date: string;
  time: string;
}

/** "YYYY-MM-DDTHH:mm[:ss]" → { date, time }; boş/bozuk → boş parçalar. */
export function splitDateTime(value: string | null | undefined): DateTimeParts {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value ?? "");
  return { date: m?.[1] ?? "", time: m?.[2] ?? "" };
}

/** Parçalar → "YYYY-MM-DDTHH:mm"; tarih yoksa "" (saat tek başına bir an değildir); saat yoksa `defaultTime`. */
export function joinDateTime(date: string, time: string, defaultTime = "00:00"): string {
  if (!date) return "";
  return `${date}T${time || defaultTime}`;
}
