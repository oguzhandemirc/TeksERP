import { Badge } from "@/components/ui/badge";
import type { ReasonPreset } from "./service";
import { StopLossClassBadge } from "./StopLossClassField";

/** Liste satırının sol bloğu: ad + durum rozetleri + kod/tam metin. */
export function PresetRowSummary({ row }: { row: ReasonPreset }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className={row.isActive ? "font-medium" : "font-medium text-muted-foreground line-through"}>
          {row.label}
        </span>
        {!row.isActive && <Badge variant="outline">Gizli</Badge>}
        {row.requiresText && <Badge variant="secondary">Açıklama ister</Badge>}
        {row.isSystem && <Badge variant="outline">Sistem</Badge>}
        <StopLossClassBadge value={row.stopLossClass} />
      </div>
      <div className="truncate text-xs text-muted-foreground">
        <span className="font-mono">{row.code}</span>
        {row.fullText && row.fullText !== row.label ? ` · ${row.fullText}` : ""}
      </div>
    </div>
  );
}
