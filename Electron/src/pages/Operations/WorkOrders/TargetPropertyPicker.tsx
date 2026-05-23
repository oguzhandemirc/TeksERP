import { useMemo, useState } from "react";
import { Controller, useWatch, type Control } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { itemService } from "@/pages/Items/service";
import type { ItemPropertyLink } from "@/pages/Items/types";
import { IncludePropertyDialog } from "./IncludePropertyDialog";
import type { WorkOrderFormValues } from "./schema";

/**
 * L2 — Üretim Özellikleri picker. Buton + arama + scrollable çoklu seçim liste.
 * Modal multi-select; her satır checkbox. "Listeden Dahil Et" L3'ü açar.
 */
export function TargetPropertyPicker({ control }: { control: Control<WorkOrderFormValues> }) {
  const targetItemId = useWatch({ control, name: "targetItemId" });
  const [open, setOpen] = useState(false);
  const [includeOpen, setIncludeOpen] = useState(false);
  const [search, setSearch] = useState("");

  const itemQ = useQuery({
    queryKey: ["item-allowed", targetItemId],
    queryFn: () => itemService.getById(targetItemId as string),
    enabled: Boolean(targetItemId),
    staleTime: 60_000,
  });

  const allowed = useMemo<ItemPropertyLink[]>(
    () => itemQ.data?.data?.allowedProperties ?? [],
    [itemQ.data?.data?.allowedProperties],
  );
  const allowedIdSet = useMemo(
    () => new Set(allowed.map((a) => a.propertyId)),
    [allowed],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allowed;
    return allowed.filter(
      (a) =>
        a.property.name.toLowerCase().includes(q) ||
        a.property.code.toLowerCase().includes(q),
    );
  }, [allowed, search]);

  if (!targetItemId) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Hedef ürün seçildikten sonra üretim özellikleri seçilebilir.
      </div>
    );
  }

  return (
    <Controller
      control={control}
      name="targetPropertyIds"
      render={({ field }) => {
        const value = field.value ?? [];
        const selectedNames = allowed
          .filter((a) => value.includes(a.propertyId))
          .map((a) => a.property.name);
        const toggle = (propertyId: string) => {
          const next = value.includes(propertyId)
            ? value.filter((id) => id !== propertyId)
            : [...value, propertyId];
          field.onChange(next);
        };

        return (
          <>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted/50"
            >
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Üretim Özellikleri</span>
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {selectedNames.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Seçilmedi</span>
                ) : (
                  <>
                    {selectedNames.slice(0, 3).map((name) => (
                      <Badge key={name} variant="muted" className="text-[10px]">
                        {name}
                      </Badge>
                    ))}
                    {selectedNames.length > 3 && (
                      <span className="text-[11px] text-muted-foreground">
                        +{selectedNames.length - 3}
                      </span>
                    )}
                  </>
                )}
              </div>
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Üretim Özellikleri</DialogTitle>
                  <DialogDescription>
                    Tambur sonrası üretilen rulolarda olacak özellikler. Birden fazla seçilebilir.
                  </DialogDescription>
                </DialogHeader>

                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Özellik ara..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 pl-8 text-sm"
                    autoFocus
                  />
                </div>

                <div className="max-h-[50vh] overflow-auto rounded-md border">
                  {allowed.length === 0 ? (
                    <div className="p-6 text-center text-xs italic text-muted-foreground">
                      Bu ürüne henüz hiç özellik dahil edilmemiş.
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="p-4 text-center text-xs italic text-muted-foreground">
                      "{search}" eşleşmedi.
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {filtered.map((a) => {
                        const isSel = value.includes(a.propertyId);
                        return (
                          <li key={a.propertyId}>
                            <label
                              className={cn(
                                "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50",
                                isSel && "bg-primary/10",
                              )}
                            >
                              <Checkbox
                                checked={isSel}
                                onCheckedChange={() => toggle(a.propertyId)}
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {a.property.name}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIncludeOpen(true)}
                    className="gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" /> Listeden Dahil Et
                  </Button>
                  <Button type="button" onClick={() => setOpen(false)}>
                    Tamam
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <IncludePropertyDialog
              open={includeOpen}
              onOpenChange={setIncludeOpen}
              itemId={targetItemId}
              allowedPropertyIds={allowedIdSet}
              onIncluded={(propertyId) => {
                if (!value.includes(propertyId)) field.onChange([...value, propertyId]);
              }}
            />
          </>
        );
      }}
    />
  );
}
