// Fasoncu kartında iplik bakiyesi — `yarn-at-subcontractor?filter[subcontractorId]=`. Devere modülü + `warping-order:read`
// yoksa bölüm hiç çizilmez; devreden (kapanmış siparişten kalan) satırda yazıyla işaretlenir.
import { useDevereEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { HoldingSection } from "./HoldingSection";
import { ageDays, ageText, carriedKg, yarnLabel } from "./model";
import { useYarnAtSubcontractor, YARN_AT_SUB_PATH } from "./service";
import { kg } from "../Yarn/qty";

export function SubcontractorYarnSection({ subcontractorId }: { subcontractorId: string }) {
  const { hasPermission } = useRoleAccess();
  const on = useDevereEnabled() && hasPermission("warping-order:read");
  const q = useYarnAtSubcontractor({ subcontractorId }, on);
  if (!on) return null;
  const rows = [...(q.data ?? [])].sort((a, b) => yarnLabel(a).localeCompare(yarnLabel(b), "tr") || (a.lotNo ?? "").localeCompare(b.lotNo ?? "", "tr"));
  return (
    <HoldingSection
      title="Bu fasoncudaki iplik"
      totalKg={rows.reduce((s, r) => s + Number(r.kg), 0)}
      href={`${YARN_AT_SUB_PATH}?filter[subcontractorId]=${subcontractorId}`}
      hrefLabel="Fasondaki İplik ekranında aç"
      loading={q.isLoading}
      error={q.isError}
      emptyText="Bu fasoncuda bizden giden iplik yok."
      lines={rows.map((r) => {
        const carried = carriedKg(r);
        return {
          key: `${r.yarnItemId}|${r.lotId ?? ""}|${r.ownerCustomerId ?? ""}`,
          main: yarnLabel(r),
          sub: [r.lotNo ? `Lot ${r.lotNo}` : "lotsuz", r.orders.map((o) => o.orderNo).join(", "), ageText(ageDays(r.oldestDispatchedAt))].filter(Boolean).join(" · "),
          note: carried > 0 ? <span className="text-xs text-amber-700 dark:text-amber-500">{kg(carried)} devreden (sipariş kapandı)</span> : undefined,
          kg: r.kg,
        };
      })}
    />
  );
}
