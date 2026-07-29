import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Palette, Search, Star } from "lucide-react";
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
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ColorSwatchCard } from "./ColorSwatchCard";
import { useColorPickerData } from "./useColorPickerData";
import { QuickAddColor } from "./QuickAddColor";

export interface ColorPickerModalProps {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Seçili müşteri — renkleri üstte + vurgulu gösterilir. */
  customerId?: string | null;
  /** Kumaş izinli renk listesi. Dolu → kısıtlı mod (sadece bu set). */
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
  const { hasPermission } = useRoleAccess();

  const data = useColorPickerData({ open, customerId, allowedColorIds, debouncedSearch });
  // Saha #12: hızlı ekleme — kısıtlı modda (kumaş izinli renkleri) anlamsız,
  // yeni renk izinli listede olmayacağı için gizli.
  const canQuickAdd = hasPermission("property:write") && !data.isRestricted;

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
          "flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
          triggerClassName,
        )}
      >
        <Palette className="h-4 w-4 shrink-0 text-primary" />
        {label && <span className="shrink-0 font-medium">{label}</span>}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {selected ? (
            <>
              <span
                className={cn("h-3 w-3 shrink-0 rounded-full border", !selected.hex && "bg-muted")}
                style={selected.hex ? { backgroundColor: selected.hex } : undefined}
              />
              <span className="truncate">{selected.name}</span>
              {isOrphan && (
                <span className="text-warning" title="Kumaşın izinli renkleri dışında">
                  !
                </span>
              )}
            </>
          ) : (
            <span className="truncate text-xs text-muted-foreground">{placeholder}</span>
          )}
        </div>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[600px] max-h-[85vh] max-w-3xl flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>{label ?? "Renk Seç"}</DialogTitle>
            <DialogDescription>
              {customerId
                ? "Müşteriye atanmış renkler üstte ★ ile işaretli. Aramada tüm katalog taranır."
                : data.isRestricted
                  ? "Kumaşa dahil renklerden birini seç."
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

          <div className="min-h-0 flex-1 overflow-auto rounded-md border p-2">
            {showNone && (
              <button
                type="button"
                onClick={() => choose(null)}
                className={cn(
                  "mb-2 flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50",
                  !value && "border-primary/50 bg-primary/5 text-foreground",
                )}
              >
                <span className="h-4 w-4 shrink-0 rounded-sm border bg-muted" />
                <span className="italic">Renksiz</span>
                {!value && <Check className="ml-auto h-4 w-4 text-primary" />}
              </button>
            )}

            {data.pinned.length > 0 && (
              <>
                <SectionHeader label="Müşteri Renkleri" count={data.pinned.length} starred />
                <ColorGrid>
                  {data.pinned.map((c) => (
                    <ColorSwatchCard
                      key={`pin-${c.id}`}
                      selected={value === c.id}
                      name={c.name}
                      hex={c.hex}
                      highlighted
                      onClick={() => choose(c.id)}
                    />
                  ))}
                </ColorGrid>
              </>
            )}

            {data.listColors.length > 0 && (
              <>
                {data.pinned.length > 0 && <SectionHeader label="Tüm Renkler" />}
                <ColorGrid>
                  {data.listColors.map((c) => (
                    <ColorSwatchCard
                      key={c.id}
                      selected={value === c.id}
                      name={c.name}
                      hex={c.hex}
                      onClick={() => choose(c.id)}
                    />
                  ))}
                </ColorGrid>
              </>
            )}

            {data.isLoading && (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Renkler yükleniyor...
              </div>
            )}
            {nothingFound && (
              <div className="p-6 text-center text-xs italic text-muted-foreground">
                {debouncedSearch.trim() ? `"${debouncedSearch}" eşleşmedi.` : "Renk bulunamadı."}
              </div>
            )}

            {data.hasMore && (
              <div className="pt-1">
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

          {canQuickAdd && (
            <div className="shrink-0">
              <QuickAddColor onCreated={(id) => choose(id)} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ColorGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-1.5">
      {children}
    </div>
  );
}

function SectionHeader({
  label,
  count,
  starred,
}: {
  label: string;
  count?: number;
  starred?: boolean;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-2 mb-2 flex items-center gap-2 bg-card/95 px-3 py-1.5 backdrop-blur">
      {starred && <Star className="h-3 w-3 fill-amber-400 text-amber-500" />}
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {count !== undefined && (
        <Badge variant="muted" className="font-normal">
          {count}
        </Badge>
      )}
    </div>
  );
}
