import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import {
  shipmentStatusLabels,
  shipmentStatusTones,
} from "@/pages/Operations/Shipments/types";
import { orderService, type OrderShipmentRow } from "./service";

interface Props {
  orderId: string;
  open: boolean;
  /** Sevkiyata gitmeden önce çağrılır (sheet'i kapatmak için). */
  onNavigate?: () => void;
}

function fmtM(n: number): string {
  return Math.round(n).toLocaleString("tr-TR", { useGrouping: true });
}

/**
 * Sipariş detayında "Sevkiyatlar" — bu siparişin hangi sevkiyatlarla (çuval +
 * fason direkt) sevk edildiği/beklediği. Bilgilendirici snapshot. Sevkiyat
 * detayına gidiş yalnız `shipping:read` yetkisi olan kullanıcıda tıklanabilir
 * (satışçı 403 sayfası görmesin — düz satıra düşer). Bağ yoksa kart görünmez.
 */
export function OrderShipmentsCard({ orderId, open, onNavigate }: Props) {
  const openTarget = useOpenTarget();
  const { hasPermission } = useRoleAccess();
  const canOpenShipment = hasPermission("shipping:read");

  const q = useQuery({
    queryKey: ["orders", "shipments", orderId],
    queryFn: () => orderService.getShipments(orderId),
    enabled: open && !!orderId,
    staleTime: 30_000,
  });

  const data = q.data?.data;
  if (!data || data.shipments.length === 0) return null;

  const routeFor = (r: OrderShipmentRow): string | null => {
    if (!r.shipmentId) return null; // legacy toplu satır
    return r.kind === "DIRECT"
      ? `/operations/shipments/direct/${r.shipmentId}`
      : `/operations/shipments/${r.shipmentId}`;
  };

  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Truck className="h-3.5 w-3.5" /> Sevkiyatlar
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            Sevk edilen:{" "}
            <span className="font-medium text-foreground">{fmtM(data.dispatchedTotal)} m</span>
            {data.plannedTotal > 0 && (
              <>
                {" · "}Bekleyen:{" "}
                <span className="font-medium text-foreground">{fmtM(data.plannedTotal)} m</span>
              </>
            )}
          </span>
        </div>
        <ul className="space-y-1.5">
          {data.shipments.map((r, i) => {
            const route = routeFor(r);
            const clickable = canOpenShipment && route !== null;
            const label = r.kind === "DIRECT" ? "Fason direkt sevk" : shipmentStatusLabels[r.status];
            const tone = r.kind === "DIRECT" ? "success" : shipmentStatusTones[r.status];
            const body = (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-xs">{r.shipmentNo}</span>
                  <StatusBadge status={label} labels={{ [label]: label }} tones={{ [label]: tone }} />
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {r.date && <span className="tabular-nums">{safeFormat(r.date, "dd.MM.yyyy")}</span>}
                  <span className="font-medium tabular-nums text-foreground">{fmtM(r.qty)} m</span>
                </span>
              </>
            );
            return (
              <li key={r.shipmentId || `legacy-${i}`}>
                {clickable ? (
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50"
                    title="Sol tık: bu sekmede · Shift/Ctrl+tık: yeni sekmede"
                    onClick={(e) => {
                      onNavigate?.();
                      openTarget(route!, e);
                    }}
                    onAuxClick={(e) => {
                      if (e.button !== 1) return;
                      e.preventDefault();
                      onNavigate?.();
                      openTarget(route!, e);
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <div
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2",
                    )}
                  >
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
