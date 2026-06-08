import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, Loader2, Palette, Search, Star } from "lucide-react";
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
import { colorService } from "@/pages/Colors/service";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ColorRow } from "./ColorRow";
import { useColorPickerData } from "./useColorPickerData";

export interface ColorPickerModalProps {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Seçili müşteri — renkleri üstte + vurgulu gösterilir. */
  customerId?: string | null;
  /** Ürün izinli renk listesi. Dolu → kısıtlı mod (sadece bu set). */
  allowedColorIds?: string[] | null;
  /** "Renksiz" seçeneği gösterilsin mi. Default: true. */
  allowNone?: boolean;
  disabled?: boolean;
  lockedTooltip?: string;
  /** Tetikleyici buton önüne yazılan etiket (örn. "Hedef Renk"). */
  label?: string;
  placeholder?: string;
  triggerClassName?: string;
}

export function ColorPickerModal({
  value,
  onChange,
  customerId,
  allowedColorIds,
  allowNone = true,
  disabled,
  lockedTooltip,
  label,
  placeholder = "Renk seç...",
  triggerClassName,
}: ColorPickerModalProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const data = useColorPickerData({ open, customerId, allowedColorIds, debouncedSearch });

  // --- Seçili rengin trigger gösterimi (arama/sayfalamadan bağımsız) ---
  const assignedColor = value ? data.assignedById.get(value) : undefined;
  const fallbackQ = useQuery({
    queryKey: ["color", value],
    queryFn: () => colorService.getById(value as string),
    enabled: Boolean(value) && !assignedColor,
    staleTime: 60_000,
  });
  const fallbackColor = fallbackQ.data?.data;
  const selected: { name: string; hex: string | null } | null = assignedColor
    ? { name: assignedColor.name, hex: assignedColor.hex }
    : value && fallbackColor
      ? { name: fallbackColor.name, hex: fallbackColor.hex ?? null }
      : null;
  const isCustomerColor = Boolean(assignedColor);
  const isOrphan = Boolean(
    value && data.isRestricted && !assignedColor && !data.allowedSet.has(value) && fallbackColor,
  );

  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  const showNone = allowNone && !debouncedSearch.trim();
  const nothingFound =
    !data.isLoading && data.pinned.length === 0 && data.listColors.length === 0;

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
          "flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
          triggerClassName,
        )}
      >
        <Palette className="h-4 w-4 shrink-0 text-muted-foreground" />
        {label && <span className="shrink-0 font-medium">{label}</span>}
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {selected ? (
            <>
              <span
                className={cn("h-3 w-3 shrink-0 rounded-full border", !selected.hex && "bg-muted")}
                style={selected.hex ? { backgroundColor: selected.hex } : undefined}
              />
              <span className="truncate">{selected.name}</span>
              {isCustomerColor && (
                <Badge variant="muted" className="gap-1 px-1.5">
                  <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-500" />
                  Müşteri
                </Badge>
              )}
              {isOrphan && (
                <span className="text-warning" title="Ürünün izinli renkleri dışında">
                  !
                </span>
              )}
            </>
          ) : (
            <span className="truncate text-xs text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[600px] max-h-[85vh] max-w-md flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>{label ?? "Renk Seç"}</DialogTitle>
            <DialogDescription>
              {customerId
                ? "Müşterinin renkleri üstte ★ ile işaretli. Aramada tüm katalog taranır."
                : data.isRestricted
                  ? "Ürüne dahil renklerden birini seç."
                  : "Tüm renk kataloğunda ara."}
            </DialogDescription>
          </DialogHeader>

          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Renk ara (ad veya kod)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 text-sm"
              autoFocus
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <ul className="divide-y">
              {showNone && (
                <ColorRow
                  selected={!value}
                  name="Renksiz"
                  hex={null}
                  dimmed
                  onClick={() => choose(null)}
                />
              )}

              {data.pinned.length > 0 && (
                <SectionHeader label="Müşteri Renkleri" count={data.pinned.length} />
              )}
              {data.pinned.map((c) => (
                <ColorRow
                  key={`pin-${c.id}`}
                  selected={value === c.id}
                  name={c.name}
                  code={c.code}
                  hex={c.hex}
                  highlighted
                  onClick={() => choose(c.id)}
                />
              ))}

              {data.pinned.length > 0 && data.listColors.length > 0 && (
                <SectionHeader label="Tüm Renkler" />
              )}
              {data.listColors.map((c) => (
                <ColorRow
                  key={c.id}
                  selected={value === c.id}
                  name={c.name}
                  code={c.code}
                  hex={c.hex}
                  onClick={() => choose(c.id)}
                />
              ))}

              {data.isLoading && (
                <li className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Renkler yükleniyor...
                </li>
              )}
              {nothingFound && (
                <li className="p-6 text-center text-xs italic text-muted-foreground">
                  {debouncedSearch.trim() ? `"${debouncedSearch}" eşleşmedi.` : "Renk bulunamadı."}
                </li>
              )}
            </ul>

            {data.hasMore && (
              <div className="border-t p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  disabled={data.isFetchingNext}
                  onClick={() => data.fetchNext()}
                >
                  {data.isFetchingNext ? (
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
        </DialogContent>
      </Dialog>
    </>
  );
}

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <li className="sticky top-0 z-10 flex items-center gap-2 bg-card/95 px-3 py-1.5 backdrop-blur">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {count !== undefined && (
        <Badge variant="muted" className="font-normal">
          {count}
        </Badge>
      )}
    </li>
  );
}
