// Rapor sayfalarında tekrar tekrar kullanılan formatlayıcılar.

const trNum = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const trInt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

export const fmtNum = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return trNum.format(n);
};

export const fmtInt = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return trInt.format(n);
};

export const fmtMeters = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${trNum.format(n)} m`;
};

export const fmtMinutes = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n < 60) return `${trNum.format(n)} dk`;
  const h = Math.floor(n / 60);
  const m = Math.round(n - h * 60);
  return `${h} sa ${m} dk`;
};

export const fmtPercent = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${trNum.format(n)}%`;
};

export const fmtDate = (s: string | Date | null | undefined): string => {
  if (!s) return "—";
  const d = typeof s === "string" ? new Date(s) : s;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export const fmtDateTime = (s: string | Date | null | undefined): string => {
  if (!s) return "—";
  const d = typeof s === "string" ? new Date(s) : s;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** YYYY-MM-DD → "23 May" gibi kısa etiket. Chart kategorilerinde kullan. */
export const fmtDayShort = (ymd: string): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
};
