import type { ReactNode } from "react";
import type { NavSubgroup } from "@/components/layout/nav-subgroups";
import { HubGrid } from "./HubCard";

/**
 * Hub kart ızgarası, yan menüyle AYNI süreç alt grup başlıklarıyla (`nav-subgroups.ts`). Başlıksız tek grup
 * düz ızgara çizer; kart sırası menü sırasıdır. Kart çizimi çağırana kalır (hub'ların kart alanları farklı).
 */
export function HubSubgroups<T>({
  groups,
  renderCard,
  gridClassName,
}: {
  groups: NavSubgroup<T>[];
  renderCard: (item: T, index: number) => ReactNode;
  gridClassName?: string;
}) {
  let index = 0;
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label || undefined}>
          {g.label ? (
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.label}</h3>
          ) : null}
          <HubGrid className={gridClassName}>{g.items.map((item) => renderCard(item, index++))}</HubGrid>
        </section>
      ))}
    </div>
  );
}
