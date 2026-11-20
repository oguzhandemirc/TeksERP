import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { LifeBuoy, MessageSquareWarning } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { useDestekStore } from "./destek-store";
import { DISCLOSURE, STATUS_FILTERS } from "./labels";
import { TicketDetailPane } from "./TicketDetailPane";
import { TicketListPane } from "./TicketListPane";
import { startReport, useCanSeeTenant } from "./useDestekShell";
import type { TicketScope } from "./types";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent/60",
      )}
    >
      {children}
    </button>
  );
}

/** Destek talepleri: solda liste (kapsam + durum süzgeci), sağda yazışma. Seçim adres çubuğunda (`?talep=`). */
export function DestekPage() {
  const enabled = useDestekStore((s) => s.enabled);
  const unreadMine = useDestekStore((s) => s.unreadMine);
  const unreadTenant = useDestekStore((s) => s.unreadTenant);
  const canTenant = useCanSeeTenant();
  const [params, setParams] = useSearchParams();
  const scope: TicketScope = canTenant && params.get("kapsam") === "tenant" ? "tenant" : "mine";
  const filter = STATUS_FILTERS.find((f) => f.key === params.get("durum")) ?? STATUS_FILTERS[0]!;
  const selectedId = params.get("talep");

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (cur) => {
        const next = new URLSearchParams(cur);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );

  const header = (
    <PageHeader
      title="Destek"
      description="Bildirdiğiniz sorunlar ve destek ekibinin yanıtları"
      parent={null}
      actions={
        enabled ? (
          <Button type="button" onClick={() => void startReport()}>
            <MessageSquareWarning className="mr-1.5 h-4 w-4" /> Sorun bildir
          </Button>
        ) : undefined
      }
    />
  );

  if (!enabled) {
    return (
      <PageShell>
        {header}
        <EmptyState icon={LifeBuoy} title="Destek bu kurulumda kapalı" description="Destek talepleri için sistem yöneticinize başvurun." className="m-6" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      {header}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 md:px-6">
        {canTenant && (
          <div className="mr-2 flex gap-1" role="tablist" aria-label="Kapsam">
            <Chip active={scope === "mine"} onClick={() => update({ kapsam: null, talep: null })}>
              Benim{unreadMine ? ` (${unreadMine})` : ""}
            </Chip>
            <Chip active={scope === "tenant"} onClick={() => update({ kapsam: "tenant", talep: null })}>
              Firmanın{unreadTenant ? ` (${unreadTenant})` : ""}
            </Chip>
          </div>
        )}
        {STATUS_FILTERS.map((f) => (
          <Chip key={f.key} active={f.key === filter.key} onClick={() => update({ durum: f.key, talep: null })}>
            {f.label}
          </Chip>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">{DISCLOSURE}</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,22rem)_1fr]">
        <div className="min-h-0 border-r">
          <TicketListPane scope={scope} statuses={filter.statuses} filterKey={filter.key} selectedId={selectedId} onSelect={(id) => update({ talep: id })} />
        </div>
        <div className="min-h-0">
          <TicketDetailPane key={selectedId ?? "none"} id={selectedId} canTenant={canTenant} />
        </div>
      </div>
    </PageShell>
  );
}
