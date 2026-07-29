import { Factory } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { workOrderStatusLabels } from "@/types/enums";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { collectLinkedWorkOrders } from "./work-order-rollup";
import type { OrderLine } from "./types";

interface Props {
  lines: OrderLine[];
  /** Tıkta önce çağrılır — yan paneli kapatmak için. */
  onNavigate?: () => void;
}

/**
 * Sipariş detayında "Bağlı İş Emirleri" — kaleme bağlı distinct WO'lar (CANCELLED
 * hariç; SUPERSEDED "Devredildi" izi olarak dahil — bkz. collectLinkedWorkOrders).
 * Her satır tıklanınca İE detayı açılır (önce onNavigate → sheet kapanır). Bağ
 * yoksa kart hiç render edilmez (iade özeti kartıyla aynı görsel dil).
 */
export function LinkedWorkOrdersCard({ lines, onNavigate }: Props) {
  const openTarget = useOpenTarget();
  const workOrders = collectLinkedWorkOrders(lines);
  if (workOrders.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Factory className="h-3.5 w-3.5" /> Bağlı İş Emirleri ({workOrders.length})
        </div>
        <ul className="space-y-1.5">
          {workOrders.map((wo) => (
            <li key={wo.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50"
                title="Sol tık: bu sekmede · Shift/Ctrl+tık: yeni sekmede"
                onClick={(e) => {
                  onNavigate?.();
                  openTarget(`/operations/work-orders/${wo.id}`, e);
                }}
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  onNavigate?.();
                  openTarget(`/operations/work-orders/${wo.id}`, e);
                }}
              >
                <span className="font-mono text-xs">{wo.workOrderNumber}</span>
                <StatusBadge
                  status={wo.status}
                  labels={workOrderStatusLabels}
                  tones={workOrderStatusTones}
                />
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
