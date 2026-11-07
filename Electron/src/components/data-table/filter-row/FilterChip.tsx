import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tek satır çubuğun kutusu: çerçeveyi kutu çizer, içteki tetik kenarlıksızdır (FilterBar `chip`).
 * Dolu kutu vurgulu + içinde ✕ (yalnız bu filtreyi kaldırır); eklenmiş boş kutuda ✕ kutuyu kapatır.
 */
export function FilterChip({
  id,
  label,
  active,
  removable,
  onRemove,
  className,
  children,
}: {
  id: string;
  label: string;
  active: boolean;
  removable: boolean;
  onRemove: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={`filter-chip-${id}`}
      data-active={active ? "true" : "false"}
      className={cn(
        "inline-flex h-8 max-w-[18rem] shrink-0 items-center rounded-md border text-xs",
        // Tetik yazısı uzun olursa (uzun firma adı) kutu büyümez, yazı kısalır.
        "[&>button:first-child>span:first-child]:truncate [&>button:first-child]:min-w-0",
        // Boş kutunun adı da okunur renkte (soluk yazı "pasif" sanılıyordu); pasif tetik kendi rengini korur.
        "[&>button:enabled_span]:text-foreground",
        active ? "border-primary/60 bg-primary/10 text-foreground" : "border-input bg-background",
        className,
      )}
    >
      {children}
      {removable && (
        <button
          type="button"
          aria-label={`${label} filtresini kaldır`}
          title={`${label} filtresini kaldır`}
          onClick={onRemove}
          className="mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-primary/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
