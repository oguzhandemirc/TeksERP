// Biçim yardımcıları — tarih Europe/Istanbul, TR yerel ayarı.
const DT = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" });
const D = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const t = Date.parse(v);
  return Number.isFinite(t) ? DT.format(t) : "—";
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const t = Date.parse(v);
  return Number.isFinite(t) ? D.format(t) : "—";
}

export function fmtBytes(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDuration(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d} gün ${h} sa` : `${h} sa ${Math.floor((seconds % 3600) / 60)} dk`;
}

/** <input type="date"> değeri → gün sonu değil gün BAŞI (İstanbul) ISO; boşsa undefined. */
export function dateInputToIso(v: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const t = Date.parse(`${v}T00:00:00+03:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

export function isoToDateInput(v: string | null | undefined): string {
  if (!v) return "";
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  return parts;
}

export function shortId(v: string | null | undefined, n = 8): string {
  return v ? v.slice(0, n) : "—";
}
