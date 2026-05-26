import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, Palette, Sparkles, Lock } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MultiSelectCheckboxList, type MultiSelectItem } from "@/components/forms/MultiSelectCheckboxList";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { stationCapabilityService } from "./service";
import type { StationCapabilitySummary } from "./types";

const QUERY_KEY = "station-capabilities";

interface Props {
  station: StationCapabilitySummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function emptyStateMessage(station: StationCapabilitySummary): string {
  if (!station.hasDefaultCategory) {
    return "Bu istasyonun atanmış kategorisi yok. Kategori atanmadan da renk/özellik atanabilir — sayfayı yenileyin.";
  }
  return "Atanmış kategori renk veren (appliesColor) veya özellik veren (appliesProperty) değil. Kategori bayraklarını Fason Kategorileri sayfasından değiştirin.";
}

export function CapabilitiesEditSheet({ station, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const canApplyColor = !!station?.canApplyColor;
  const canApplyProperty = !!station?.canApplyProperty;
  const editable = canApplyColor || canApplyProperty;

  const detail = useQuery({
    queryKey: [QUERY_KEY, station?.stationId],
    queryFn: () => stationCapabilityService.getByStation(station!.stationId),
    enabled: open && Boolean(station?.stationId) && editable,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const colorsQuery = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      colorService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled: open && canApplyColor,
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
    enabled: open && canApplyProperty,
  });

  const [colorIds, setColorIds] = useState<string[]>([]);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [initialColorIds, setInitialColorIds] = useState<string[]>([]);
  const [initialPropertyIds, setInitialPropertyIds] = useState<string[]>([]);

  useEffect(() => {
    if (detail.data) {
      const c = detail.data.data.colors.map((x) => x.id);
      const p = detail.data.data.properties.map((x) => x.id);
      setColorIds(c);
      setPropertyIds(p);
      setInitialColorIds(c);
      setInitialPropertyIds(p);
    }
  }, [detail.data]);

  const colorItems: MultiSelectItem[] = (colorsQuery.data?.data ?? []).map((c) => ({
    id: c.id,
    label: c.name,
    hint: c.code,
    swatch: c.hex,
  }));

  const propertyItems: MultiSelectItem[] = (propsQuery.data?.data ?? []).map((p) => ({
    id: p.id,
    label: p.name,
    hint: p.description ?? p.code,
    group: p.category ?? "Diğer",
    swatch: p.color,
  }));

  const dirty =
    colorIds.length !== initialColorIds.length ||
    propertyIds.length !== initialPropertyIds.length ||
    colorIds.some((id) => !initialColorIds.includes(id)) ||
    initialColorIds.some((id) => !colorIds.includes(id)) ||
    propertyIds.some((id) => !initialPropertyIds.includes(id)) ||
    initialPropertyIds.some((id) => !propertyIds.includes(id));

  const mutation = useMutation({
    mutationFn: () =>
      stationCapabilityService.setCapabilities(station!.stationId, colorIds, propertyIds),
    onSuccess: () => {
      toast.success("İstasyon yetkinlikleri güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      onOpenChange(false);
    },
  });

  const loading =
    detail.isLoading ||
    (canApplyColor && colorsQuery.isLoading) ||
    (canApplyProperty && propsQuery.isLoading);

  const defaultTab = canApplyColor ? "colors" : "properties";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-hidden">
        <SheetHeader>
          <SheetTitle>{station?.stationName ?? "—"}</SheetTitle>
          <SheetDescription>
            <span className="font-mono">{station?.stationCode}</span>
            {" · "}İstasyonun uygulayabileceği renkleri ve kazandırabileceği özellikleri seç.
          </SheetDescription>
        </SheetHeader>

        {!editable ? (
          <div className="mt-8 flex flex-col items-center justify-center gap-3 rounded-md border border-dashed p-8 text-center">
            <Lock className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">Bu istasyon için yetkinlik atanamaz</div>
            <div className="max-w-sm text-xs text-muted-foreground">
              {station ? emptyStateMessage(station) : null}
            </div>
          </div>
        ) : loading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="mt-4 flex h-[calc(100vh-180px)] flex-col">
            <Tabs defaultValue={defaultTab} className="flex flex-1 flex-col">
              <TabsList>
                {canApplyColor && (
                  <TabsTrigger value="colors" className="gap-1.5">
                    <Palette className="h-3.5 w-3.5" />
                    Renkler
                    <Badge variant="muted" className="ml-1 text-[10px]">
                      {colorIds.length}
                    </Badge>
                  </TabsTrigger>
                )}
                {canApplyProperty && (
                  <TabsTrigger value="properties" className="gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    Özellikler
                    <Badge variant="muted" className="ml-1 text-[10px]">
                      {propertyIds.length}
                    </Badge>
                  </TabsTrigger>
                )}
              </TabsList>

              {canApplyColor && (
                <TabsContent value="colors" className="flex-1 mt-3">
                  <MultiSelectCheckboxList
                    items={colorItems}
                    value={colorIds}
                    onChange={setColorIds}
                    placeholder="Renk ara..."
                    emptyHint="Tanımlı renk yok."
                  />
                </TabsContent>
              )}

              {canApplyProperty && (
                <TabsContent value="properties" className="flex-1 mt-3">
                  <MultiSelectCheckboxList
                    items={propertyItems}
                    value={propertyIds}
                    onChange={setPropertyIds}
                    placeholder="Özellik ara..."
                    emptyHint="Tanımlı özellik yok."
                  />
                </TabsContent>
              )}
            </Tabs>

            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!dirty || mutation.isPending}
                onClick={() => {
                  setColorIds(initialColorIds);
                  setPropertyIds(initialPropertyIds);
                }}
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
