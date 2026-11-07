import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { KARTELA_TABS, type KartelaTabKey } from "./tabs-config";

export function KartelaTabBar({
  tab,
  onTab,
  trailing,
}: {
  tab: KartelaTabKey;
  onTab: (t: KartelaTabKey) => void;
  /** Aktif sekmenin araçları (ör. Sütunlar/Görünümler) — sağda, sekmelerle AYNI satırda. */
  trailing?: ReactNode;
}) {
  const { hasPermission } = useRoleAccess();
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b px-3">
      {KARTELA_TABS.filter((t) => !t.permission || hasPermission(t.permission)).map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onTab(t.key)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab === t.key
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <t.Icon className="h-4 w-4" />
          {t.label}
        </button>
      ))}
      {trailing ? <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{trailing}</div> : null}
    </div>
  );
}
