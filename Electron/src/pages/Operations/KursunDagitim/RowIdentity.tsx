import { AlertOctagon, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatNumber, safeFormat } from "@/lib/format";
import type { KursunDistributionRowBase } from "./types";

interface Props {
  row: KursunDistributionRowBase;
}

/**
 * Bir dağıtım satırının KİMLİK bloğu — bekleyen ve dağıtılmış bölümlerinde
 * AYNI gösterim kullanılır (planlamacı iki listeyi yan yana okur; farklı
 * biçimler karşılaştırmayı zorlaştırır).
 *
 * İş emri no MONO ve önde: dağıtım kararı iş emri seviyesinde verilir.
 */
export function RowIdentity({ row }: Props) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{row.workOrderNumber}</span>

        {row.isUrgent && (
          <Badge variant="destructive" className="gap-1 text-[10px]">
            <AlertOctagon className="h-3 w-3" /> ACİL
          </Badge>
        )}

        <span className="truncate font-medium">{row.itemName ?? "—"}</span>

        {row.colorName ? (
          <Badge variant="muted" className="gap-1.5 px-2 text-[10px]">
            {row.colorHex && (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full border border-border"
                style={{ backgroundColor: row.colorHex }}
                aria-hidden
              />
            )}
            {row.colorName}
          </Badge>
        ) : (
          <Badge variant="muted" className="text-[10px]">
            Renk —
          </Badge>
        )}

        {row.isLastStep && (
          <Badge variant="outline" className="text-[10px]">
            Son adım
          </Badge>
        )}
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
        <span className="font-mono">Kart: {row.travelerCardNumber ?? "—"}</span>
        <span className="font-mono">
          {row.batchNumbers.length > 0
            ? `Parti: ${row.batchNumbers.join(", ")}`
            : "Parti: —"}
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Package className="h-3 w-3" />
          {row.openRollCount} top · {formatNumber(row.totalMeters, 0)} m
        </span>
        {row.oldestEnteredAt && (
          <span>İlk giriş: {safeFormat(row.oldestEnteredAt, "dd.MM HH:mm")}</span>
        )}
      </div>
    </div>
  );
}
