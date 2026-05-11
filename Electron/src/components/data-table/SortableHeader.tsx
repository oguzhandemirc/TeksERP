import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Backend sortBy alan adı (Prisma kolon). */
  field: string;
  /** Header etiketi. */
  label: string;
  /** Header hizası — sayısal kolonlarda "right". Default "left". */
  align?: "left" | "right";
  className?: string;
}

/**
 * URL-driven sortable column header. `useDataTable` zaten
 * `sortBy/sortOrder` URL paramlarını okuyup query'ye taşıyor —
 * bu component sadece yazıyor.
 *
 * Tıklama davranışı (3-state cycle):
 *   - inactive  → desc
 *   - desc      → asc
 *   - asc       → unset (default sıraya döner)
 */
export function SortableHeader({ field, label, align = "left", className }: Props) {
  const [sp, setSp] = useSearchParams();
  const activeField = sp.get("sortBy");
  const order = sp.get("sortOrder");
  const isActive = activeField === field;
  const direction: "asc" | "desc" | null = isActive
    ? order === "asc"
      ? "asc"
      : "desc"
    : null;

  const handleClick = () => {
    const next = new URLSearchParams(sp);
    if (!isActive) {
      next.set("sortBy", field);
      next.set("sortOrder", "desc");
    } else if (direction === "desc") {
      next.set("sortBy", field);
      next.set("sortOrder", "asc");
    } else {
      next.delete("sortBy");
      next.delete("sortOrder");
    }
    setSp(next, { replace: true });
  };

  const Icon =
    direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex items-center gap-1 select-none hover:text-foreground transition-colors",
        align === "right" && "justify-end ml-auto",
        isActive ? "text-foreground" : "text-muted-foreground",
        className,
      )}
      title={
        direction === "desc"
          ? "Çoktan aza — tekrar tıklayın azdan çoka"
          : direction === "asc"
            ? "Azdan çoğa — tekrar tıklayın sıralamayı kaldır"
            : "Sıralamak için tıklayın"
      }
    >
      <span>{label}</span>
      <Icon
        className={cn(
          "h-3 w-3 shrink-0",
          isActive ? "opacity-100" : "opacity-40",
        )}
      />
    </button>
  );
}
