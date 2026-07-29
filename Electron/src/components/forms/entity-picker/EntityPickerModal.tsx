import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Plus, Search, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { CrudService } from "@/services/crudService";
import { useEntityPickerData } from "./useEntityPickerData";

export interface EntityPickerModalProps<T extends { id: string }> {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  service: CrudService<T>;
  /** React Query namespace — diğer kullanımlardan ayrışsın. */
  queryKey: string;
  getLabel: (item: T) => string;
  /** Satır altındaki ikincil küçük metin (örn. kod). */
  getSubLabel?: (item: T) => string | null | undefined;
  /** Satır/tetikleyici başına özel görsel (renk noktası, ikon vb.). */
  renderLeading?: (item: T) => ReactNode;
  /** `isActive: "true"` üstüne eklenir. */
  filters?: Record<string, string>;
  sortBy?: string;
  nullable?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  lockedTooltip?: string;
  /** Tetikleyici sol ikon. */
  icon?: LucideIcon;
  iconClassName?: string;
  /** Tetikleyicide ikonun yanında kalın etiket (opsiyonel). */
  label?: string;
  placeholder?: string;
  /** Placeholder metni sınıfı — renkli (solid) tetikleyicide okunur kılmak için.
   *  Verilmezse muted (varsayılan). */
  placeholderClassName?: string;
  title?: string;
  description?: string;
  triggerClassName?: string;
  /** Tetikleyicideki yukarı/aşağı ok (ChevronsUpDown) ikonunu gizle. */
  hideChevron?: boolean;
  /** Modal içinde "hızlı ekle" butonu göster. Tıklanınca modal kapanır, callback çağrılır. */
  quickAddLabel?: string;
  onQuickAdd?: () => void;
  /** Toplam sayı etiketi — "5 toplam {countLabel}" şeklinde gösterilir. Örn: "müşteri", "kumaş". */
  countLabel?: string;
}

/**
 * Genel "ara-ve-seç" modalı. Buton → modal (arama + sonsuz kaydırma). Sunucu
 * tarafı arama/sayfalama ([[useEntityPickerData]]); yüzlerce şablon/istasyon/
 * kumaş için ölçeklenir. Renk seçici [[ColorPickerModal]] ile aynı görsel dil.
 */
export function EntityPickerModal<T extends { id: string }>({
  value,
  onChange,
  service,
  queryKey,
  getLabel,
  getSubLabel,
  renderLeading,
  filters,
  sortBy,
  nullable,
  noneLabel = "— (yok)",
  disabled,
  lockedTooltip,
  icon: Icon,
  iconClassName,
  label,
  placeholder = "Seç...",
  placeholderClassName,
  title,
  description,
  triggerClassName,
  hideChevron,
  quickAddLabel,
  onQuickAdd,
  countLabel,
}: EntityPickerModalProps<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const { items, total, isLoading, hasMore, fetchNext, isFetchingNext } = useEntityPickerData<T>({
    open,
    service,
    queryKey,
    debouncedSearch,
    filters,
    sortBy,
  });

  // Seçili kaydın etiketi — listede yoksa id ile ayrı çek (arama/sayfadan bağımsız).
  const inList = value ? items.find((i) => i.id === value) : undefined;
  const selectedQ = useQuery({
    queryKey: [queryKey, "entity-picker-by-id", value],
    queryFn: () => service.getById(value as string),
    enabled: Boolean(value) && !inList,
    staleTime: 60_000,
  });
  const selected = inList ?? selectedQ.data?.data ?? null;

  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };
  const showNone = nullable && !debouncedSearch.trim();
  const nothingFound = !isLoading && items.length === 0;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setSearch("");
          setOpen(true);
        }}
        title={disabled ? lockedTooltip : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
          triggerClassName,
        )}
      >
        {Icon && <Icon className={cn("h-4 w-4 shrink-0", iconClassName ?? "text-muted-foreground")} />}
        {label && <span className="shrink-0 font-medium">{label}</span>}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {selected ? (
            <>
              {renderLeading?.(selected)}
              <span className="truncate">{getLabel(selected)}</span>
            </>
          ) : value && selectedQ.isLoading ? (
            <span className="truncate text-xs text-muted-foreground">Yükleniyor...</span>
          ) : (
            <span className={cn("truncate text-xs", placeholderClassName ?? "text-muted-foreground")}>
              {placeholder}
            </span>
          )}
        </div>
        {!hideChevron && (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[600px] max-h-[85vh] max-w-md flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              {Icon && <Icon className={cn("h-4 w-4", iconClassName ?? "text-primary")} />}
              {title ?? "Seç"}
            </DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Ara (ad veya kod)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 text-sm"
              autoFocus
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <ul className="divide-y">
              {showNone && (
                <PickerRow
                  selected={!value}
                  label={noneLabel}
                  dimmed
                  onClick={() => choose(null)}
                />
              )}
              {items.map((item) => (
                <PickerRow
                  key={item.id}
                  selected={value === item.id}
                  label={getLabel(item)}
                  subLabel={getSubLabel?.(item)}
                  leading={renderLeading?.(item)}
                  onClick={() => choose(item.id)}
                />
              ))}
              {isLoading && (
                <li className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Yükleniyor...
                </li>
              )}
              {nothingFound && (
                <li className="p-6 text-center text-xs italic text-muted-foreground">
                  {debouncedSearch.trim() ? `"${debouncedSearch}" eşleşmedi.` : "Kayıt bulunamadı."}
                </li>
              )}
            </ul>

            {hasMore && (
              <div className="border-t p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full gap-2"
                  disabled={isFetchingNext}
                  onClick={() => fetchNext()}
                >
                  {isFetchingNext ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Yükleniyor...
                    </>
                  ) : (
                    "Daha fazla"
                  )}
                </Button>
              </div>
            )}
          </div>

          {(onQuickAdd || (countLabel && total !== undefined)) && (
            <div className="flex items-center justify-between border-t pt-2">
              {countLabel && total !== undefined ? (
                <span className="text-sm text-muted-foreground">
                  Toplam <span className="font-medium text-foreground">{total}</span> {countLabel}
                </span>
              ) : <span />}
              {onQuickAdd && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="gap-1.5 shadow-sm hover:shadow-primary/40 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150"
                  onClick={() => { setOpen(false); onQuickAdd(); }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {quickAddLabel ?? "Yeni Ekle"}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PickerRow({
  selected,
  onClick,
  label,
  subLabel,
  leading,
  dimmed,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  subLabel?: string | null;
  leading?: ReactNode;
  dimmed?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50",
          selected && "bg-primary/10 hover:bg-primary/15",
        )}
      >
        {leading}
        <div className="min-w-0 flex-1">
          <div className={cn("truncate", dimmed && !selected && "italic text-muted-foreground")}>
            {label}
          </div>
          {subLabel && (
            <div className="truncate text-[11px] text-muted-foreground">{subLabel}</div>
          )}
        </div>
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </button>
    </li>
  );
}
