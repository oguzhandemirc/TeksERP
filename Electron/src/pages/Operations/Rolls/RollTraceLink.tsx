import { Footprints } from "lucide-react";
import { cn } from "@/lib/utils";
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
 * Top kartından "İz sür" — katalog "top kartından da açılır" diyordu ama bağlantı yoktu
 * (R0-GECIS bulgusu). Audit `TraceLink` ile aynı kalıp: izin yoksa hiç çizilmez; sekme deposu tıklamada yüklenir.
 */
export function RollTraceLink({ rollId, className }: Props) {
  const { hasPermission } = useRoleAccess();
  if (!hasPermission("report:production")) return null;
  return (
    <button
      type="button"
      data-testid="roll-trace-link"
      title="Bu topun refakat kartı hangi istasyonlarda okutuldu? (Operasyon → İz sürme → Top İzleme)"
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 text-xs font-medium text-primary underline-offset-2 hover:underline",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        const target = travelerTraceTarget(rollId);
        void import("@/store/tabs").then(({ useTabsStore }) =>
          useTabsStore.getState().openTab(target.to, { state: target.state }),
        );
      }}
    >
      <Footprints className="h-3.5 w-3.5" /> İz sür
    </button>
  );
}
