import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CatalogField } from "@/services/labelTemplateService";

interface Props {
  available: CatalogField[];
  onAdd: (f: CatalogField) => void;
}

export function CatalogPanel({ available, onAdd }: Props) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Eklenebilir Alanlar ({available.length})
      </div>
      {available.length === 0 ? (
        <div className="text-xs italic text-muted-foreground">
          Tüm alanlar şablonda zaten ekli.
        </div>
      ) : (
        <ul className="space-y-1">
          {available.map((f) => (
            <li key={f.key}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-full justify-start gap-1 text-xs"
                onClick={() => onAdd(f)}
              >
                <Plus className="h-3 w-3" />
                <span className="truncate">{f.defaultLabel}</span>
                <Badge variant="muted" className="ml-auto text-[9px]">
                  {f.type}
                </Badge>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
