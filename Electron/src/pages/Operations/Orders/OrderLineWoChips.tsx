import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { workOrderStatusLabels } from "@/types/enums";
import type { OrderLine } from "./types";

interface Props {
  links: OrderLine["workOrderLinks"];
}

/**
 * Sipariş detay panelinde kalem başına bağlı İş Emri çipleri — "bu kalem hangi
 * İE'ye bağlı" kimliklendirmesi. CANCELLED bağ gizlenir (rozet/kart semantiğiyle
 * tutarlı); SUPERSEDED dahildir ("Devredildi" izi). SALT BİLGİ — tıklanamaz;
 * navigasyonu aynı sheet'teki LinkedWorkOrdersCard sağlar.
 */
export function OrderLineWoChips({ links }: Props) {
  const active = (links ?? []).filter((l) => l.workOrder.status !== "CANCELLED");
  if (active.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-muted-foreground">İş emri:</span>
      {active.map((l) => (
        <span key={l.workOrderId} className="inline-flex items-center gap-1">
          <span className="font-mono text-[10px] text-foreground">
            {l.workOrder.workOrderNumber}
          </span>
          <StatusBadge
            status={l.workOrder.status}
            labels={workOrderStatusLabels}
            tones={workOrderStatusTones}
          />
        </span>
      ))}
    </div>
  );
}
