import { Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";

/** Top izleme aracının (Refakat Kartı İzleme) rotası ve tohum anahtarı — `TravelerTracePage` `useScanSeed("rollId")` okur. */
export const TRAVELER_TRACE_PATH = "/reports/production/traveler-trace";
export function travelerTraceTarget(rollId: string): { to: string; state: { rollId: string } } {
  return { to: TRAVELER_TRACE_PATH, state: { rollId } };
}

interface Props {
  rollId: string;
  className?: string;
}

/**
 * Top kartından "İz sür" — kartta TEK, yazılı outline düğme (2026-11-10: iki "İz sür" vardı, biri link gibiydi).
 * Önceki not: "İz sür" — katalog "top kartından da açılır" diyordu ama bağlantı yoktu
 * (R0-GECIS bulgusu). Audit `TraceLink` ile aynı kalıp: izin yoksa hiç çizilmez; sekme deposu tıklamada yüklenir.
 */
export function RollTraceLink({ rollId, className }: Props) {
  const { hasPermission } = useRoleAccess();
  if (!hasPermission("report:production")) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      data-testid="roll-trace-link"
      title="Bu topun refakat kartı hangi istasyonlarda okutuldu? (Operasyon → İz sürme → Top İzleme)"
      className={className ? `gap-1 ${className}` : "gap-1"}
      onClick={(e) => {
        e.stopPropagation();
        const target = travelerTraceTarget(rollId);
        void import("@/components/layout/tabs/use-tab-target").then(({ openTargetNow }) =>
          openTargetNow("topLevel", target.to, undefined, target.state),
        );
      }}
    >
      <Footprints className="h-3.5 w-3.5" /> İz sür
    </Button>
  );
}
