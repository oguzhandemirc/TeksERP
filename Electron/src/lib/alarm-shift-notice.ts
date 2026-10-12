// Dokuma alarmı vardiya şeridinin TEK metin kaynağı — ayar ekranı ve Tezgah Salonu aynı cümleyi basar.
// Karar (hangi kod) sunucudadır (`alarmShiftNotice`); burada yalnız kodun Türkçesi durur.
export type AlarmShiftNoticeCode = "NO_SHIFT_DEFINED" | "NO_SHIFT_NOW";

export const ALARM_SHIFT_NOTICE_TEXT: Record<AlarmShiftNoticeCode, string> = {
  NO_SHIFT_DEFINED: "Vardiya tanımlı değil — tezgah alarmı çalmaz.",
  NO_SHIFT_NOW: "Şu an vardiya yok — vardiya dışında açılan duruş alarm üretmez.",
};

/** Tanınmayan kod (yeni sunucu, eski panel) şerit çizmez — uydurma cümle basılmaz. */
export function alarmShiftNoticeText(code: string | null | undefined): string | null {
  return code === "NO_SHIFT_DEFINED" || code === "NO_SHIFT_NOW" ? ALARM_SHIFT_NOTICE_TEXT[code] : null;
}

export const SHIFT_DEFINITIONS_PATH = "/definitions/shift-definitions";
