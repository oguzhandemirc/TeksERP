// TR biçimleri. Tarih/saat TESİSİN saat diliminden basılır (ANLIK `tesis.saatDilimi` → `lib/factory-time`),
// telefonun diliminden değil; varsayılan Europe/Istanbul. Sayılar telde ondalık DİZİ de gelebilir ("1234.5").
import { fmtDayKey, formatFactory } from "./factory-time";

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 1234567.891 → "1.234.567,89" (varsayılan 2 hane; `digits` 0 ise tam sayı). */
export function formatNumber(value: unknown, digits = 2): string {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(digits);
  const [i, f] = fixed.split(".");
  const body = f && Number(f) !== 0 ? `${group(i!)},${f.replace(/0+$/, "")}` : group(i!);
  return neg && body !== "0" ? `-${body}` : body;
}

export function formatMoney(value: unknown, currency = "TRY"): string {
  const n = formatNumber(value, 2);
  if (n === "—") return n;
  const sym: Record<string, string> = { TRY: "₺", USD: "$", EUR: "€" };
  return `${n} ${sym[currency] ?? currency}`;
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-09-29T10:05:00Z" → "29.09.2026"; takvim günü "2026-09-29" dilimsiz basılır. */
export function formatDate(iso: unknown): string {
  if (typeof iso !== "string" || iso === "") return "—";
  return DAY_ONLY.test(iso) ? fmtDayKey(iso) : formatFactory(iso, "dd.MM.yyyy");
}

/** "2026-09-29T10:05:00Z" → "29.09.2026 13:05" (tesis dilimi İstanbul iken). */
export function formatDateTime(iso: unknown): string {
  if (typeof iso !== "string" || iso === "") return "—";
  return DAY_ONLY.test(iso) ? `${fmtDayKey(iso)} 00:00` : formatFactory(iso, "dd.MM.yyyy HH:mm");
}

/** Göreli süre: "az önce" · "12 dk önce" · "3 sa önce" · aksi hâlde tarih-saat. */
export function formatAgo(iso: unknown, nowMs: number = Date.now()): string {
  if (typeof iso !== "string") return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Math.max(0, nowMs - t);
  if (diff < 60_000) return "az önce";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} dk önce`;
  if (diff < 24 * 3_600_000) return `${Math.floor(diff / 3_600_000)} sa önce`;
  return formatDateTime(iso);
}

/** Eşitleme gecikmesi eşiği: fabrika 5 dakikada bir gönderir; 30 dk sessizlik bant açar. */
export const SYNC_LATE_MS = 30 * 60_000;

export function syncIsLate(lastSyncIso: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!lastSyncIso) return true;
  const t = Date.parse(lastSyncIso);
  return !Number.isFinite(t) || nowMs - t > SYNC_LATE_MS;
}

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  BEKLIYOR: "Bekliyor",
  ISLENIYOR: "İşleniyor",
  ISLENDI: "İşlendi",
  REDDEDILDI: "Reddedildi",
  IPTAL: "İptal",
  HESAPLANIYOR: "Hesaplanıyor",
  HAZIR: "Hazır",
  HATA: "Hata",
  DAVETLI: "Davetli",
  AKTIF: "Aktif",
  KILITLI: "Kilitli",
  PASIF: "Arşiv",
};

export function statusLabel(s: unknown): string {
  return typeof s === "string" ? (STATUS_LABEL[s] ?? s) : "—";
}
