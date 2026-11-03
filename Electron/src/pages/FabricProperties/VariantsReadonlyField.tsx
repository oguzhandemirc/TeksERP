import { CornerDownRight } from "lucide-react";
import { variantsOf } from "./hierarchy";
import type { FabricProperty } from "./types";

interface Props {
  property: FabricProperty;
  /** Sayfanın tam listesi — çeşidin formu tam kayıtla açılır. */
  allProperties: FabricProperty[];
  onOpen?: (row: FabricProperty) => void;
}

/** Ebeveyn formunda salt-okuma "Çeşitleri" (K21); tıklayınca çeşidin formu açılır. Bağ çeşidin formundan kurulur. */
export function VariantsReadonlyField({ property, allProperties, onOpen }: Props) {
  const variants = variantsOf(property);
  if (variants.length === 0) return null;
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm" data-testid="cesitleri">
      <div className="text-xs font-medium text-muted-foreground">Çeşitleri</div>
      <ul className="mt-1 space-y-0.5">
        {variants.map((v) => {
          const full = allProperties.find((p) => p.id === v.id);
          return (
            <li key={v.id} className="flex items-center gap-1">
              <CornerDownRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              {full && onOpen ? (
                <button type="button" className="text-primary hover:underline" onClick={() => onOpen(full)}>
                  {v.name}
                </button>
              ) : (
                <span>{v.name}</span>
              )}
              {!v.isActive && <span className="text-[10px] text-muted-foreground">(pasif)</span>}
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[11px] text-muted-foreground">Bağ çeşidin formundaki "Şunun çeşidi" alanından kurulur.</p>
    </div>
  );
}
