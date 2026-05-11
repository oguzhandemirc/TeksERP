import { useMemo, useState } from "react";
import { Controller, useWatch, type Control } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiSelectCheckboxList, type MultiSelectItem } from "@/components/forms/MultiSelectCheckboxList";
import { itemService } from "@/pages/Items/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import type { WorkOrderFormValues } from "./schema";

export function TargetItemSummary({ control }: { control: Control<WorkOrderFormValues> }) {
  const targetItemId = useWatch({ control, name: "targetItemId" });
  const itemQuery = useQuery({
    queryKey: ["item-preview", targetItemId],
    queryFn: () => itemService.getById(targetItemId as string),
    enabled: Boolean(targetItemId),
    staleTime: 60_000,
  });
  const item = itemQuery.data?.data;
  if (!targetItemId || !item) return null;
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs">
      <div className="mb-1.5 font-medium uppercase tracking-wide text-muted-foreground">
        Hedef ürün
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono">{item.code}</span>
        <span>{item.name}</span>
        {item.color && (
          <Badge variant="muted" className="gap-1">
            {item.color.hex && (
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: item.color.hex }}
              />
            )}
            {item.color.name}
          </Badge>
        )}
      </div>
    </div>
  );
}

export function TargetPropertiesField({ control }: { control: Control<WorkOrderFormValues> }) {
  const targetItemId = useWatch({ control, name: "targetItemId" });
  const selectedIds = useWatch({ control, name: "targetPropertyIds" }) ?? [];
  const [open, setOpen] = useState(false);

  const itemQuery = useQuery({
    queryKey: ["item-allowed", targetItemId],
    queryFn: () => itemService.getById(targetItemId as string),
    enabled: Boolean(targetItemId),
    staleTime: 60_000,
  });
  const item = itemQuery.data?.data;
  const allowedIds = useMemo(
    () => (item?.allowedProperties ?? []).map((p) => p.propertyId),
    [item?.allowedProperties],
  );

  const propsQ = useQuery({
    queryKey: ["fabric-properties", "all"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
  });
  const allProps = useMemo(() => propsQ.data?.data ?? [], [propsQ.data?.data]);

  // Item allowed dolu ise sadece o set, boş ise tüm aktifler
  const candidateProps = useMemo(() => {
    if (!targetItemId) return [];
    if (allowedIds.length === 0) return allProps;
    const set = new Set(allowedIds);
    return allProps.filter((p) => set.has(p.id));
  }, [targetItemId, allowedIds, allProps]);

  const propMultiItems: MultiSelectItem[] = useMemo(
    () =>
      candidateProps.map((p) => ({
        id: p.id,
        label: p.name,
        group: p.category ?? undefined,
        hint: p.code,
        swatch: p.color ?? null,
      })),
    [candidateProps],
  );

  if (!targetItemId) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Hedef ürün seçildikten sonra üretim özellikleri seçilebilir.
      </div>
    );
  }

  const selectedNames = candidateProps
    .filter((p) => selectedIds.includes(p.id))
    .map((p) => p.name);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
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
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Üretim Özellikleri</DialogTitle>
            <DialogDescription>
              Tambur sonrası üretilen rulolarda olacak özellikler.{" "}
              {allowedIds.length > 0
                ? "Bu ürün için tanımlı olası özelliklerden seçilir."
                : "Sınırlama yok — tüm aktif özellikler seçilebilir."}
            </DialogDescription>
          </DialogHeader>
          <Controller
            control={control}
            name="targetPropertyIds"
            render={({ field }) => (
              <div className="h-[60vh]">
                <MultiSelectCheckboxList
                  items={propMultiItems}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="Özellik ara..."
                  emptyHint={
                    candidateProps.length === 0 && allowedIds.length > 0
                      ? "Bu ürün için tanımlı özellik yok."
                      : undefined
                  }
                />
              </div>
            )}
          />
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)}>
              Tamam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
