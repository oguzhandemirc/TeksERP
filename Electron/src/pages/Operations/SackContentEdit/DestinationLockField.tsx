import { Globe, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { destinationLabels, type ShipmentDestination } from "./types";
import { destinationSourceLabels, type DestinationLock } from "./destinationDefault";

interface Props {
  lock: DestinationLock | undefined;
  isLoading: boolean;
  picked: ShipmentDestination | null;
  onPick: (d: ShipmentDestination) => void;
  /** Sevkiyat bir şubeye gidiyor mu — ilk seçimin yazılacağı kartı söyler. */
  hasBranch: boolean;
}

/**
 * Sevk yönü: kilitliyse ROZET (kaynağıyla), zincir boşsa TEK SEFERLİK seçici —
 * seçim sevkiyatla birlikte carinin (şubeli sevkte şubenin) kartına yazılır.
 */
export function DestinationLockField({ lock, isLoading, picked, onPick, hasBranch }: Props) {
  if (isLoading || !lock) {
    return <p className="text-xs text-muted-foreground">Sevk yönü okunuyor…</p>;
  }
  if (lock.destination) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="destination-lock-badge">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <Badge variant={lock.destination === "EXPORT" ? "default" : "secondary"} className="gap-1">
          <Lock className="h-3 w-3" /> {destinationLabels[lock.destination]}
        </Badge>
        {lock.source && <span className="text-xs text-muted-foreground">{destinationSourceLabels[lock.source]}</span>}
        {lock.exportCode && <span className="font-mono text-xs">İhracat Kodu: {lock.exportCode}</span>}
      </div>
    );
  }
  return (
    <div className="space-y-1" data-testid="destination-first-pick">
      <div className="flex items-center gap-1 rounded-md border p-0.5 text-sm">
        {(["DOMESTIC", "EXPORT"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onPick(d)}
            className={cn(
              "flex-1 rounded px-3 py-1 font-medium transition-colors",
              picked === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {destinationLabels[d]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        İlk sevk: bu seçim {hasBranch ? "şubenin" : "carinin"} kartına yazılır, sonraki sevklerde kilitli gelir.
      </p>
    </div>
  );
}
