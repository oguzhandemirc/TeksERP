// İplik kartında "Nerede?" — depoda (`GET /api/yarn/stocks?itemId=`) ve fasonda (`yarn-at-subcontractor?filter[yarnItemId]=`).
// Kapı devere modülü (ETKİN değeri iplik zincirini taşır) + yarı başına izin; kapalıysa bölüm hiç yok (sıfır görünür fark).
import { useQuery } from "@tanstack/react-query";
import { useDevereEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { listYarnStocks } from "../Yarn/service";
import { HoldingSection } from "./HoldingSection";
import { ageDays, ageText, subLabel } from "./model";
import { useYarnAtSubcontractor, YARN_AT_SUB_PATH } from "./service";

export function YarnWhereSection({ itemId, itemType }: { itemId: string; itemType: string }) {
  const devere = useDevereEnabled();
  const { hasPermission } = useRoleAccess();
  const on = itemType === "YARN" && devere;
  const depotOn = on && hasPermission("warehouse:read");
  const fasonOn = on && hasPermission("warping-order:read");
  const depot = useQuery({
    queryKey: ["yarn", "stocks", "item-card", itemId],
    queryFn: () => listYarnStocks({ page: 1, pageSize: 50, itemId, onlyNonZero: true }),
    enabled: depotOn,
  });
  const fason = useYarnAtSubcontractor({ yarnItemId: itemId }, fasonOn);
  if (!depotOn && !fasonOn) return null;
  const fasonRows = [...(fason.data ?? [])].sort((a, b) => subLabel(a).localeCompare(subLabel(b), "tr") || (a.lotNo ?? "").localeCompare(b.lotNo ?? "", "tr"));
  // Ürün kartında formun ALTINDA (K5): form bilgiyle (Ad) başlar, durum bilgisi sonda. Başlık "Eldeki stok":
  // hemen üstteki formun "Stok" (asgari stok) bölümüyle aynı adı taşıyınca iki "Stok" başlığı alt alta çıkıyordu.
  return (
    <section className="space-y-2 border-t pt-3" data-testid="yarn-where" aria-labelledby="yarn-where-title">
      <h3 id="yarn-where-title" className="text-sm font-medium text-muted-foreground">Eldeki stok</h3>
      <div className="grid gap-2 sm:grid-cols-2">
      {depotOn && (
        <HoldingSection
          title="Depoda"
          totalKg={Number(depot.data?.totals.balanceKg ?? 0)}
          loading={depot.isLoading}
          error={depot.isError}
          emptyText="Depoda bu iplikten bakiye yok."
          lines={(depot.data?.data ?? []).map((r) => ({ key: r.id, main: r.warehouse.name, kg: r.balanceKg }))}
        />
      )}
      {fasonOn && (
        <HoldingSection
          title="Fasonda"
          totalKg={fasonRows.reduce((s, r) => s + Number(r.kg), 0)}
          href={`${YARN_AT_SUB_PATH}?view=yarn&filter[yarnItemId]=${itemId}`}
          hrefLabel="Fasondaki İplik ekranında aç"
          loading={fason.isLoading}
          error={fason.isError}
          emptyText="Hiçbir fasoncuda bu iplikten yok."
          lines={fasonRows.map((r) => ({
            key: `${r.subcontractorId}|${r.lotId ?? ""}|${r.ownerCustomerId ?? ""}`,
            main: subLabel(r),
            sub: [r.lotNo ? `Lot ${r.lotNo}` : "lotsuz", ageText(ageDays(r.oldestDispatchedAt)), r.orders.some((o) => o.status === "COMPLETED") ? "devreden var" : null].filter(Boolean).join(" · "),
            kg: r.kg,
          }))}
        />
      )}
      </div>
    </section>
  );
}
