// İE detayında desen hedefi (kurşun dışı çeşit hedefi) + müşteri partisi (D4-D2c) — kurşun kataloğundan bağımsız.
// Veri `process-summary` ucundan, kurşun kartıyla AYNI sorgu anahtarı (tek istek); ikisi de yoksa bölüm hiç çizilmez.
import { useQuery } from "@tanstack/react-query";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { fetchProcessSummary, processSummaryKey } from "@/lib/kursun-gramaj";
import { V3Section } from "./V3Section";

export function VariantTargetsSection({ workOrderId }: { workOrderId: string }) {
  const { hasPermission } = useRoleAccess();
  const scope = { workOrderId };
  const q = useQuery({ queryKey: processSummaryKey(scope), queryFn: () => fetchProcessSummary(scope), enabled: hasPermission("workorder:read") });
  const targets = q.data?.variantTargets ?? [];
  const batches = q.data?.deliveryNoteGramaj?.customerBatches ?? [];
  if (targets.length === 0 && batches.length === 0) return null;
  return (
    <V3Section title="Desen Hedefi ve Müşteri Partisi">
      <div className="flex flex-col gap-3 rounded-lg border border-black/10 bg-card p-4 text-sm text-card-foreground dark:border-white/15" data-testid="variant-targets-section">
        {targets.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="variant-targets">
            {targets.map((t) => (
              <div key={t.propertyId} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{t.propertyName} hedefi:</span>
                <span className="font-semibold">{t.valueName}</span>
              </div>
            ))}
          </div>
        )}
        {batches.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="customer-batches">
            <span className="text-muted-foreground">Müşteri partisi</span>
            <ul className="divide-y divide-black/10 rounded-md border border-black/10 dark:divide-white/10 dark:border-white/15">
              {batches.map((b) => (
                <li key={b.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="font-semibold">{b.batchNo}</span>
                  <span className="text-muted-foreground">{b.ownerName}</span>
                  <span className="ml-auto tabular-nums">{b.rollCount} top</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </V3Section>
  );
}
