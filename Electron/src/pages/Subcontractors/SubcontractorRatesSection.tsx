// Fasoncu kartında tarifeleri (devere ücreti dahil) — tarife Maliyet › Fason Tarifeleri'nde yazılır, burada yalnız görünür.
// Maliyet modülü kapalı ya da `cost:read` yoksa bölüm hiç çizilmez ve sorgu atılmaz (bugünkü davranış). Tablo değil, ızgara.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useMaliyetEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { finishingRateService, FINISHING_BASIS_LABEL, finishingBasisUnit } from "@/pages/Cost/FinishingRates/service";
import { formatQty } from "@/lib/format";

export function SubcontractorRatesSection({ subcontractorId }: { subcontractorId: string }) {
  const maliyet = useMaliyetEnabled();
  const canRead = useRoleAccess().hasPermission("cost:read");
  const on = maliyet && canRead;
  const q = useQuery({
    queryKey: ["cost-finishing-rates", "subcontractor", subcontractorId],
    queryFn: () => finishingRateService.listForSubcontractor(subcontractorId),
    enabled: on,
  });
  if (!on) return null;
  const rates = (q.data ?? []).filter((r) => r.revokedAt === null);
  return (
    <section aria-label="Tarifeler" className="rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Tarifeler</h3>
        <Link to="/cost/finishing-rates" className="text-xs text-primary underline-offset-4 hover:underline">Fason Tarifeleri ekranında aç</Link>
      </div>
      {q.isLoading ? (
        <p className="mt-2 text-xs text-muted-foreground">Yükleniyor…</p>
      ) : q.isError ? (
        <p className="mt-2 text-xs text-destructive">Tarifeler okunamadı.</p>
      ) : rates.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Bu fasoncuya bağlı tarife yok.</p>
      ) : (
        <ul className="mt-2 divide-y text-sm">
          {rates.map((r) => (
            <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1.5">
              <span className="min-w-0 truncate" title={`${r.name} (${r.code})`}>
                <span className="font-medium">{r.name}</span> <span className="font-mono text-xs text-muted-foreground">{r.code} · {FINISHING_BASIS_LABEL[r.basis]}</span>
              </span>
              <span className="tabular-nums">{formatQty(r.pricePerM, 4)} {r.currency}/{finishingBasisUnit(r.basis)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
