// =============================================================================
// Patron raporu koşum satırı → tel biçimi (bulut `ReportRequest` / `ReportRequestDetail`, `patron/sunucu/src/wire/api.ts`)
// =============================================================================
// Ekler (eski ekran yok sayar): `baslik`, `sureMs`, `parametreOzeti`, `olusturan`. İstek eşzamanlı olduğu için
// `BEKLIYOR`/`IPTAL` durumu hiç doğmaz. Tarih özeti fabrika diliminde (`constants/time`).
// =============================================================================
import type { Prisma } from "@prisma/client";
import { REPORT_BY_KEY } from "../../constants/report-catalog";
import { factoryDateTr, resolveRangeStart } from "../../constants/time";

export const RUN_SELECT = {
  id: true, userId: true, reportKey: true, params: true, status: true, errorCode: true, durationMs: true,
  finishedAt: true, createdAt: true, deletedAt: true, clientToken: true,
  user: { select: { username: true } },
} satisfies Prisma.PatronReportRunSelect;
export type RunRow = Prisma.PatronReportRunGetPayload<{ select: typeof RUN_SELECT }>;
export type RunRowWithResult = RunRow & { result: Prisma.JsonValue | null };

const FACTORY_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_KEYS: ReadonlyArray<readonly [string, string]> = [["dateFrom", "dateTo"], ["from", "to"]];

/** Parametre değerinin gösterimi: gün/ISO tarih fabrika gününe, dizi virgülle. */
function show(v: unknown): string {
  if (typeof v === "string" && FACTORY_DAY.test(v)) return factoryDateTr(resolveRangeStart(v));
  if (typeof v === "string" && !Number.isNaN(Date.parse(v)) && v.includes("T")) return factoryDateTr(new Date(v));
  if (Array.isArray(v)) return v.map(show).join(", ");
  return String(v);
}

/** "01.11.2026 – 13.11.2026 · kiyas: onceki"; parametresiz istek "Varsayılan dönem". */
export function paramsSummary(params: unknown): string {
  const p = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  const parts: string[] = [];
  const used = new Set<string>();
  for (const [a, b] of DATE_KEYS) {
    if (p[a] === undefined && p[b] === undefined) continue;
    parts.push(`${p[a] !== undefined ? show(p[a]) : "…"} – ${p[b] !== undefined ? show(p[b]) : "…"}`);
    used.add(a).add(b);
  }
  if (p.asOf !== undefined) { parts.push(`${show(p.asOf)} itibarıyla`); used.add("asOf"); }
  for (const [k, v] of Object.entries(p)) if (!used.has(k) && v !== undefined && v !== null && v !== "") parts.push(`${k}: ${show(v)}`);
  return parts.length ? parts.join(" · ").slice(0, 300) : "Varsayılan dönem";
}

export function toRequest(r: RunRow) {
  return {
    id: r.id,
    raporAnahtari: r.reportKey,
    aile: r.reportKey.split("/")[0] ?? "",
    baslik: REPORT_BY_KEY.get(r.reportKey)?.baslik ?? r.reportKey,
    parametreler: r.params,
    parametreOzeti: paramsSummary(r.params),
    durum: r.status as "HESAPLANIYOR" | "HAZIR" | "HATA",
    hataKodu: r.errorCode,
    olusturulma: r.createdAt.toISOString(),
    tamamlanma: r.finishedAt?.toISOString() ?? null,
    sureMs: r.durationMs,
    olusturan: { id: r.userId, kullaniciAdi: r.user.username },
  };
}

export function toDetail(r: RunRowWithResult) {
  const ready = r.status === "HAZIR" && r.result !== null;
  return {
    ...toRequest(r),
    sonuc: ready ? { veri: r.result, hesaplandi: (r.finishedAt ?? r.createdAt).toISOString(), kaynakUfuk: r.createdAt.toISOString() } : null,
  };
}
