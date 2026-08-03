import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, Sparkles, Lock } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MultiSelectCheckboxList, type MultiSelectItem } from "@/components/forms/MultiSelectCheckboxList";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { stationCapabilityService } from "./service";
import type { StationCapabilitySummary } from "./types";

const QUERY_KEY = "station-capabilities";

interface Props {
  station: StationCapabilitySummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * İstasyonun kazandırdığı ÖZELLİKLER. Renk sekmesi 2026-08-02'de kaldırıldı:
 * boyahane her rengi boyar, renk istasyon bazlı kısıt değil (bkz.
 * `schema.prisma` → StationColor). Buraya renk seçimi geri eklenirse yeni
 * tanımlanan renkler yine rota adımında görünmez olur.
 */
export function CapabilitiesEditSheet({ station, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const editable = !!station?.canApplyProperty;

  const detail = useQuery({
    queryKey: [QUERY_KEY, station?.stationId],
    queryFn: () => stationCapabilityService.getByStation(station!.stationId),
    enabled: open && Boolean(station?.stationId) && editable,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const propsQuery = useQuery({
    queryKey: ["fabric-properties", "all-active"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled: open && editable,
  });

  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [initialPropertyIds, setInitialPropertyIds] = useState<string[]>([]);

  useEffect(() => {
    if (detail.data) {
      const p = detail.data.data.properties.map((x) => x.id);
      setPropertyIds(p);
      setInitialPropertyIds(p);
    }
  }, [detail.data]);

  // Perf: türetilmiş diziyi memoize et. MultiSelectCheckboxList grouping/filter
  // işini `items` referansına göre memoize eder; her render'da yeni dizi verilince
  // (her checkbox toggle'ında) o memo geçersizleşip ~500 satırı yeniden gruplardı.
  const propertyItems = useMemo<MultiSelectItem[]>(
    () =>
      (propsQuery.data?.data ?? []).map((p) => ({
        id: p.id,
        label: p.name,
        hint: p.description ?? p.code,
        group: p.category ?? "Diğer",
        swatch: p.color,
      })),
    [propsQuery.data?.data],
  );

  const dirty =
    propertyIds.length !== initialPropertyIds.length ||
    propertyIds.some((id) => !initialPropertyIds.includes(id)) ||
    initialPropertyIds.some((id) => !propertyIds.includes(id));

  const mutation = useMutation({
    mutationFn: () =>
      stationCapabilityService.setCapabilities(station!.stationId, propertyIds),
    onSuccess: () => {
      toast.success("İstasyon yetkinlikleri güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      onOpenChange(false);
    },
  });

  const loading = detail.isLoading || propsQuery.isLoading;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-hidden">
        <SheetHeader>
          <SheetTitle>{station?.stationName ?? "—"}</SheetTitle>
          <SheetDescription>
            Bu istasyondan geçen topların kazanacağı özellikleri seç. Renk seçimi
            burada yapılmaz — her renk her boyahanede uygulanabilir.
          </SheetDescription>
        </SheetHeader>

        {!editable ? (
          <div className="mt-8 flex flex-col items-center justify-center gap-3 rounded-md border border-dashed p-8 text-center">
            <Lock className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">Bu istasyon özellik kazandırmaz</div>
            <div className="max-w-sm text-xs text-muted-foreground">
              Atanmış kategori "özellik veren" (appliesProperty) değil. Kategori
              bayrağını Fason Kategorileri sayfasından değiştirin.
            </div>
          </div>
        ) : loading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="mt-4 flex h-[calc(100vh-230px)] flex-col">
            <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
              Özellikler
              <Badge variant="muted" className="ml-1 text-[10px]">
                {propertyIds.length}
              </Badge>
            </div>

            <div className="min-h-0 flex-1">
              <MultiSelectCheckboxList
                items={propertyItems}
                value={propertyIds}
                onChange={setPropertyIds}
                placeholder="Özellik ara..."
                emptyHint="Tanımlı özellik yok."
              />
            </div>

            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={!dirty || mutation.isPending}
                onClick={() => setPropertyIds(initialPropertyIds)}
              >
                Sıfırla
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={!dirty || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                <Save className="h-4 w-4" /> {mutation.isPending ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
