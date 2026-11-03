import { ChevronDown, ChevronRight, CornerDownRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { genitive, variantsOf } from "./hierarchy";
import type { FabricProperty } from "./types";

interface Props {
  row: FabricProperty;
  collapsed: boolean;
  onToggle: (id: string) => void;
}

/**
 * Ad hücresi (K21): çeşit satırı girintili ↳ + "Kurşunlu'nun çeşidi"; ebeveynde "N çeşit"
 * rozeti ve ağaç sırasında daraltma düğmesi. Düz sıralamada girinti yok, alt yazı kalır.
 */
export function PropertyNameCell({ row, collapsed, onToggle }: Props) {
  const variants = variantsOf(row);
  const nested = row.listLevel === 1;
  const canToggle = row.listLevel === 0 && variants.length > 0;
  return (
    <div className={nested ? "flex items-start gap-1 pl-5" : "flex items-start gap-1"} data-testid={`ad-${row.id}`}>
      {nested && <CornerDownRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      {canToggle && (
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? "Çeşitleri göster" : "Çeşitleri gizle"}
          aria-expanded={!collapsed}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(row.id);
          }}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{row.name}</span>
          {variants.length > 0 && (
            <Badge variant="outline" className="text-[10px]" title={variants.map((v) => v.name).join(", ")}>
              {variants.length} çeşit
            </Badge>
          )}
          {row.listContext && <span className="text-[10px] text-muted-foreground">(kendisi uymuyor — uyan çeşidinin bağlamı)</span>}
        </div>
        {row.variantOf && <div className="text-[11px] text-muted-foreground">{genitive(row.variantOf.name)} çeşidi</div>}
      </div>
    </div>
  );
}
