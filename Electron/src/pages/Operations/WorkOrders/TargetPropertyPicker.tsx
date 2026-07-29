import { useMemo, useState } from "react";
import { Controller, useWatch, type Control } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Search, Settings2 } from "lucide-react";
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
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import type { ItemPropertyLink } from "@/pages/Items/types";
import type { WorkOrderFormValues } from "./schema";

/**
 * L2 — Üretim Özellikleri picker. Buton + arama + scrollable çoklu seçim liste.
 *
 * Domain kuralı: kumaşın `allowedProperties` boş ise **sınırsız** — tüm özellik
 * kataloğu seçilebilir. Doluysa sadece o liste.
 */
export function TargetPropertyPicker({
  control,
  lockedIds,
  applicableIds,
  lockedTooltip,
}: {
  control: Control<WorkOrderFormValues>;
  /** Kaldırılması yasak property ID'leri (uygulayan istasyon adımı tamamlandı). */
  lockedIds?: string[];
  /** Eklenebilir property ID'leri (route'ta uygun istasyonu olan ve adımı bitmemiş). undefined = kısıtlama yok. */
  applicableIds?: string[];
  lockedTooltip?: string;
}) {
  const lockedSet = useMemo(() => new Set(lockedIds ?? []), [lockedIds]);
  const applicableSet = useMemo(
    () => (applicableIds ? new Set(applicableIds) : null),
    [applicableIds],
  );
  const targetItemId = useWatch({ control, name: "targetItemId" });
  const targetPropertyIds = useWatch({ control, name: "targetPropertyIds" });
  const [open, setOpen] = useState(false);
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
  const itemLoaded = itemQ.isSuccess;
  const isUnrestricted = itemLoaded && allowed.length === 0;

  // Sınırlı modda formdaki ID'lerden bazıları izinli liste dışındaysa
  // (sonradan çıkarılmış) badge'de isim göstermek için tüm kataloğu çek.
  // Sınırsız modda tam kataloğu zaten kendi listemiz için çekiyoruz.
  const hasOrphan = useMemo(
    () =>
      !isUnrestricted &&
      itemLoaded &&
      (targetPropertyIds ?? []).some((id) => !allowedIdSet.has(id)),
    [isUnrestricted, itemLoaded, targetPropertyIds, allowedIdSet],
  );
  const fullPropsQ = useQuery({
    queryKey: ["fabric-properties", "picker", "wo-target"],
    queryFn: () => loadAllForPicker(fabricPropertyService),
    enabled: isUnrestricted || hasOrphan,
    staleTime: 60_000,
  });
  const fallbackPropById = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const p of fullPropsQ.data?.data ?? []) {
      map.set(p.id, { id: p.id, name: p.name });
    }
    return map;
  }, [fullPropsQ.data]);

  // Sınırsız modda effective = tüm katalog; sınırlı modda = allowed.
  const effective = useMemo<ItemPropertyLink[]>(() => {
    if (!isUnrestricted) return allowed;
    return (fullPropsQ.data?.data ?? []).map((p) => ({
      propertyId: p.id,
      property: { id: p.id, code: p.code, name: p.name },
    }));
  }, [isUnrestricted, allowed, fullPropsQ.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    if (!q) return effective;
    return effective.filter(
      (a) =>
        a.property.name.toLocaleLowerCase("tr").includes(q) ||
        a.property.code.toLocaleLowerCase("tr").includes(q),
    );
  }, [effective, search]);

  if (!targetItemId) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Hedef kumaş seçildikten sonra üretim özellikleri seçilebilir.
      </div>
    );
  }

  return (
    <Controller
      control={control}
      name="targetPropertyIds"
      render={({ field }) => {
        const value = field.value ?? [];
        const selectedEntries = value.map((id) => {
          const fromEffective = effective.find((a) => a.propertyId === id);
          if (fromEffective) {
            // Sınırlı modda effective=allowed → orphan değil.
            // Sınırsız modda effective=tüm katalog → her zaman geçerli.
            return { id, name: fromEffective.property.name, orphan: false };
          }
          // Sadece sınırlı modda ulaşılabilir: izinli listede yok ama formda var.
          const fromFallback = fallbackPropById.get(id);
          return {
            id,
            name: fromFallback?.name ?? "Bilinmeyen",
            orphan: !isUnrestricted,
          };
        });
        const toggle = (propertyId: string) => {
          const isOn = value.includes(propertyId);
          // Kilitli özellik kaldırılamaz (uygulayan istasyon adımı bitti).
          if (isOn && lockedSet.has(propertyId)) return;
          // Eklenmek isteniyor ama route'ta uygulayan adım yok / bitmiş.
          if (!isOn && applicableSet && !applicableSet.has(propertyId)) return;
          const next = isOn
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
              title={lockedTooltip}
              className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted/50"
            >
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Üretim Özellikleri</span>
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {selectedEntries.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Seçilmedi</span>
                ) : (
                  <>
                    {selectedEntries.slice(0, 3).map((e) => (
                      <Badge
                        key={e.id}
                        variant={e.orphan ? "outline" : "muted"}
                        className="text-[10px]"
                        title={
                          e.orphan
                            ? "Bu özellik kumaşın izinli özellikler listesinde yok. Açık seçim olarak kayıtlı."
                            : undefined
                        }
                      >
                        {e.name}
                        {e.orphan && <span className="ml-0.5 text-warning">!</span>}
                      </Badge>
                    ))}
                    {selectedEntries.length > 3 && (
                      <span className="text-[11px] text-muted-foreground">
                        +{selectedEntries.length - 3}
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
                    {isUnrestricted
                      ? "Kumaşın izinli özellik listesi boş — tüm özellikler seçilebilir."
                      : "Tambur sonrası üretilen rulolarda olacak özellikler. Birden fazla seçilebilir."}
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
                  {effective.length === 0 ? (
                    <div className="p-6 text-center text-xs italic text-muted-foreground">
                      {isUnrestricted
                        ? fullPropsQ.isLoading
                          ? "Özellikler yükleniyor..."
                          : "Sistemde tanımlı özellik yok."
                        : "Bu kumaşa henüz hiç özellik dahil edilmemiş."}
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="p-4 text-center text-xs italic text-muted-foreground">
                      "{search}" eşleşmedi.
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {filtered.map((a) => {
                        const isSel = value.includes(a.propertyId);
                        const isLocked = lockedSet.has(a.propertyId);
                        const notApplicable =
                          !isSel && applicableSet !== null && !applicableSet.has(a.propertyId);
                        const rowDisabled = isLocked || notApplicable;
                        const lockReason = isLocked
                          ? "Bu özelliği uygulayan istasyon adımı tamamlandı, kaldırılamaz"
                          : notApplicable
                            ? "Bu özelliği uygulayabilecek istasyon rotada yok veya adımı tamamlanmış"
                            : undefined;
                        return (
                          <li key={a.propertyId}>
                            <label
                              title={lockReason}
                              className={cn(
                                "flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50",
                                isSel && "bg-primary/10",
                                rowDisabled
                                  ? "cursor-not-allowed opacity-60"
                                  : "cursor-pointer",
                              )}
                            >
                              <Checkbox
                                checked={isSel}
                                disabled={rowDisabled}
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

                <DialogFooter>
                  <Button type="button" onClick={() => setOpen(false)}>
                    Tamam
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        );
      }}
    />
  );
}
