import { useEffect, useState } from "react";
import { Controller, useWatch, type Control } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Check, Package, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import type { WorkOrderFormValues } from "./schema";

/**
 * Hedef Ürün picker — buton + arama + scrollable liste modalı.
 * Onlarca ürün olabilir; debounce'lu backend arama, ad/kod filtresi.
 */
export function TargetItemPicker({
  control,
  onItemChange,
  disabled,
  lockedTooltip,
}: {
  control: Control<WorkOrderFormValues>;
  /** Ürün değiştiğinde renk ve özellikleri sıfırlamak için. */
  onItemChange?: () => void;
  /** Düzenleme kilitliyse (örn. sevk yapılmış). */
  disabled?: boolean;
  /** disabled true ise neden — hover'da tooltip. */
  lockedTooltip?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const listQ = useQuery({
    queryKey: ["items", "wo-target", debounced],
    queryFn: () =>
      itemService.getAll({
        page: 1,
        pageSize: 100,
        sortBy: "name",
        sortOrder: "asc",
        search: debounced || undefined,
        filters: { isActive: "true" },
      }),
    enabled: open,
    staleTime: 30_000,
  });

  const items = listQ.data?.data ?? [];

  const targetItemId = useWatch({ control, name: "targetItemId" });
  const selectedQ = useQuery({
    queryKey: ["item", targetItemId],
    queryFn: () => itemService.getById(targetItemId as string),
    enabled: Boolean(targetItemId),
    staleTime: 60_000,
  });
  const selectedItem = selectedQ.data?.data ?? null;

  return (
    <Controller
      control={control}
      name="targetItemId"
      render={({ field }) => (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setSearch("");
              setOpen(true);
            }}
            title={disabled ? lockedTooltip : undefined}
            className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Hedef Ürün</span>
            <div className="ml-auto min-w-0 truncate text-xs">
              {selectedItem ? (
                <span>{selectedItem.name}</span>
              ) : (
                <span className="text-muted-foreground">Atanmadı</span>
              )}
            </div>
          </button>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Hedef Ürün</DialogTitle>
                <DialogDescription>
                  Ürün seç veya aramayla daralt. Atama zorunlu değil.
                </DialogDescription>
              </DialogHeader>

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Ürün ara (ad veya kod)..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 pl-8 text-sm"
                  autoFocus
                />
              </div>

              <div className="max-h-[50vh] overflow-auto rounded-md border">
                <ul className="divide-y">
                  {!search.trim() && (
                    <ItemRow
                      selected={!field.value}
                      name="Atanmadı"
                      dimmed
                      onClick={() => {
                        field.onChange(null);
                        onItemChange?.();
                        setOpen(false);
                      }}
                    />
                  )}
                  {listQ.isLoading ? (
                    <li className="p-4 text-center text-xs text-muted-foreground">
                      Yükleniyor...
                    </li>
                  ) : items.length === 0 ? (
                    <li className="p-4 text-center text-xs italic text-muted-foreground">
                      {debounced ? `"${debounced}" eşleşmedi.` : "Aktif ürün yok."}
                    </li>
                  ) : (
                    items.map((it) => (
                      <ItemRow
                        key={it.id}
                        selected={field.value === it.id}
                        name={it.name}
                        onClick={() => {
                          field.onChange(it.id);
                          onItemChange?.();
                          setOpen(false);
                        }}
                      />
                    ))
                  )}
                </ul>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    />
  );
}

function ItemRow({
  selected,
  onClick,
  name,
  code,
  dimmed,
}: {
  selected: boolean;
  onClick: () => void;
  name: string;
  code?: string;
  dimmed?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50",
          selected && "bg-primary/10",
        )}
      >
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate",
              dimmed && !selected && "text-muted-foreground italic",
            )}
          >
            {name}
          </div>
          {code && (
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {code}
            </div>
          )}
        </div>
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </button>
    </li>
  );
}
