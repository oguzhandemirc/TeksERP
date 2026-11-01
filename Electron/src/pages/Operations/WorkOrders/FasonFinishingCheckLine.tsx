import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useMaliyetEnabled } from "@/hooks/usePricingEnabled";
import { fmtDec, fmtDecFull } from "@/pages/Cost/shared/format";

/** SY-E2 — `GET /api/cost/subcontractor-dispatches/:id/finishing-check` yanıtı (yalnız okuma). */
export interface FinishingCheckLine {
  rateCode: string;
  rateName: string;
  currency: string;
  pricePerKg: string;
  /** Tarifenin seçildiği sevk fabrika günü (`YYYY-MM-DD`). Eski sunucu göndermez. */
  rateAsOf?: string | null;
  /** Sevk gününde geçerli tarife yoktu → ilk sürüm kullanıldı. Eski sunucu göndermez. */
  rateFallback?: boolean;
  totalKg: string;
  weighedCount: number;
  unweighedCount: number;
  expectedAmount: string;
  invoice: {
    docNos: string[];
    hasDraft: boolean;
    currency: string | null;
    netAmount: string | null;
    difference: string | null;
    coversOtherDispatches: boolean;
    /** Faturalı kabul sevkin yalnız bir kısmını kapsıyor → fark null. Eski sunucu alanı göndermez. */
    partial?: boolean;
    /** Fatura dövizi tarifeninkinden farklı → kur çevrilmez, fark null. Eski sunucu göndermez. */
    currencyMismatch?: boolean;
  } | null;
}
export interface FinishingCheckResult {
  line: FinishingCheckLine | null;
  reason: string | null;
}

export const fetchDispatchFinishingCheck = (dispatchId: string) =>
  apiClient
    .get<ApiResponse<FinishingCheckResult>>(`/api/cost/subcontractor-dispatches/${dispatchId}/finishing-check`)
    .then((r) => r.data);

/** `YYYY-MM-DD` → `GG.AA.YYYY` (sunucu fabrika gününü hazır verir; dilim çevrimi yok). */
function dayTr(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

/** Fark metni: pozitif = fatura beklenenden fazla. */
function differenceText(inv: NonNullable<FinishingCheckLine["invoice"]>, currency: string): string {
  if (inv.difference !== null) {
    const sign = inv.difference.startsWith("-") || /^0(\.0*)?$/.test(inv.difference) ? "" : "+";
    return `Fark ${sign}${fmtDec(inv.difference)} ${currency}`;
  }
  if (inv.currencyMismatch) return "Farklı döviz — kur çevrilmez, fark hesaplanmadı";
  if (inv.partial) return "Fatura sevkin yalnız bir kısmını kapsıyor — fark hesaplanmadı";
  if (inv.coversOtherDispatches) return "Fatura başka sevkleri de kapsıyor — fark hesaplanmadı";
  return "Para birimi farklı — fark hesaplanmadı";
}

/**
 * Fason sevk kg kontrolü bilgi satırı — beklenen boyahane tutarı = Σ sevk kg × sevk tarihindeki kg tarifesi.
 * Maliyet modülü kapalıysa ya da `cost:read` yoksa sorgu atılmaz; tarife yoksa satır çizilmez (0 gösterilmez).
 * Fatura parçası finans kapılı: sunucu `finance:read` ∧ ön muhasebe açık değilse göndermez; panel de izinsiz çizmez.
 */
export function FasonFinishingCheckLine({ dispatchId, open }: { dispatchId: string; open: boolean }) {
  const { hasPermission } = useRoleAccess();
  const maliyet = useMaliyetEnabled();
  const enabled = open && maliyet && hasPermission("cost:read");
  const q = useQuery({
    queryKey: ["dispatch-finishing-check", dispatchId],
    queryFn: () => fetchDispatchFinishingCheck(dispatchId),
    enabled,
    staleTime: 30_000,
  });
  const line = enabled ? (q.data?.data?.line ?? null) : null;
  if (!line) return null;
  const inv = hasPermission("finance:read") ? line.invoice : null;
  return (
    <div
      data-testid="fason-kg-kontrol"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm"
    >
      <Scale className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>
        Beklenen boyahane tutarı:{" "}
        <strong>
          {fmtDec(line.expectedAmount)} {line.currency}
        </strong>
      </span>
      <span className="text-muted-foreground">
        {fmtDec(line.totalKg, 3)} kg × {fmtDecFull(line.pricePerKg, 4)} {line.currency}/kg ({line.rateName}
        {line.rateAsOf ? `, ${dayTr(line.rateAsOf)} sevk tarihindeki tarife` : ""}
        {line.rateFallback ? " — o gün tarife yoktu, ilk tarife kullanıldı" : ""})
        {line.unweighedCount > 0 ? ` · ${line.unweighedCount} top tartısız, hesaba girmedi` : ""}
      </span>
      {inv && (
        <span className="text-muted-foreground">
          Fatura {inv.docNos.join(", ")}
          {inv.hasDraft ? " (taslak var)" : ""}: {fmtDec(inv.netAmount)} {inv.currency ?? ""} ·{" "}
          {differenceText(inv, line.currency)}
        </span>
      )}
    </div>
  );
}
