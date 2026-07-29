import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Tıklanabilir sıralama başlığı — tıkla: bu alana geç / aynı alandaysa yön çevir.
 *  Tablo başlıklarında (iade/sipariş modalları, çuval içi top tablosu) paylaşılır. */
export function SortableTh<F extends string>({
  field,
  label,
  align = "left",
  activeField,
  dir,
  onSort,
}: {
  field: F;
  label: string;
  align?: "left" | "right";
  activeField: F | null;
  dir: "asc" | "desc";
  onSort: (f: F) => void;
}) {
  const active = activeField === field;
  return (
    <th className={align === "right" ? "text-right" : "text-left"}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-0.5 font-medium hover:text-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-30" />
        )}
      </button>
    </th>
  );
}
