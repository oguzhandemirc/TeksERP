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
import { loadAllForPicker } from "@/lib/picker-loader";
import {
  STATION_PROPERTY_MODE_HINTS,
  STATION_PROPERTY_MODE_LABELS,
  type StationCapabilitySummary,
  type StationPropertyMode,
} from "./types";

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
      loadAllForPicker(fabricPropertyService, {
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled: open && editable,
  });

  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [initialPropertyIds, setInitialPropertyIds] = useState<string[]>([]);
  // propertyId → mod. Listeye YENİ eklenen özellik burada yer almaz; backend
  // onu şema varsayılanıyla (OPTIONAL) doğurur. Bu bilinçli: yeni satırın
  // sessizce OTOMATİK doğması, tam da kapatılan tuzaktı.
  const [modes, setModes] = useState<Record<string, StationPropertyMode>>({});
  const [initialModes, setInitialModes] = useState<Record<string, StationPropertyMode>>({});

  useEffect(() => {
    if (detail.data) {
      const rows = detail.data.data.properties;
      const p = rows.map((x) => x.id);
      const m = Object.fromEntries(rows.map((x) => [x.id, x.mode])) as Record<
        string,
        StationPropertyMode
      >;
      setPropertyIds(p);
      setInitialPropertyIds(p);
      setModes(m);
      setInitialModes(m);
    }
  }, [detail.data]);

  const selectedRows = useMemo(() => {
    const byId = new Map((detail.data?.data.properties ?? []).map((p) => [p.id, p]));
    const all = propsQuery.data?.data ?? [];
    return propertyIds.map((id) => {
      const known = byId.get(id);
      const cat = all.find((p) => p.id === id);
      return {
        id,
        name: known?.name ?? cat?.name ?? id,
        // Kayıtlı olmayan (bu oturumda eklenmiş) satır → backend varsayılanı.
        mode: modes[id] ?? ("OPTIONAL" as StationPropertyMode),
        isNew: !known,
        // AUTO tuşunu kilitlemek için (SEÇİM tipinde otomatik uygulanacak
        // değer yoktur — backend de 400 ile reddeder, buradaki kilit sadece
        // hatayı Kaydet'e bırakmamak için).
        valueType: known?.valueType ?? cat?.valueType ?? "FLAG",
      };
    });
  }, [propertyIds, modes, detail.data, propsQuery.data]);

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
    initialPropertyIds.some((id) => !propertyIds.includes(id)) ||
    propertyIds.some((id) => modes[id] !== initialModes[id]);

  const mutation = useMutation({
    mutationFn: () =>
      stationCapabilityService.setCapabilities(
        station!.stationId,
        // Mod YALNIZ bilinen satırlar için gönderilir; yenilerinde alan atlanır
        // ki backend varsayılanı (OPTIONAL) uygulansın.
        propertyIds.map((propertyId) => ({ propertyId, mode: modes[propertyId] })),
      ),
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

            {/* Seçilen her özelliğin bu istasyondaki DAVRANIŞI. Liste yalnız
                seçili satırları gösterir — katalogun tamamını modlamak anlamsız
                ve ekranı okunamaz yapardı. */}
            {selectedRows.length > 0 && (
              <div className="mt-3 max-h-52 shrink-0 space-y-1.5 overflow-auto rounded-md border p-2">
                <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                  Bu istasyonda nasıl teyit edilsin?
                </div>
                {selectedRows.map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm" title={row.name}>
                      {row.name}
                      {row.isNew && (
                        <span className="ml-1 text-[10px] text-muted-foreground">(yeni)</span>
                      )}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      {(["AUTO", "OPTIONAL", "REQUIRED"] as const).map((m) => {
                        // SEÇİM tipli özellik AUTO olamaz: otomatik uygulanacak
                        // tek bir değer yoktur (25GR mi 50GR mi?). Backend de
                        // reddeder; tuşu açık bırakmak hatayı Kaydet'e saklardı.
                        const autoBlocked = m === "AUTO" && row.valueType === "CHOICE";
                        return (
                          <Button
                            key={m}
                            type="button"
                            size="sm"
                            variant={row.mode === m ? "default" : "outline"}
                            className="h-7 px-2 text-[11px]"
                            disabled={autoBlocked}
                            title={
                              autoBlocked
                                ? "Değer listesi olan (SEÇİM tipli) özellik otomatik uygulanamaz — hangi değerin yazılacağı operatör kararıdır."
                                : STATION_PROPERTY_MODE_HINTS[m]
                            }
                            onClick={() => setModes((prev) => ({ ...prev, [row.id]: m }))}
                          >
                            {STATION_PROPERTY_MODE_LABELS[m]}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={!dirty || mutation.isPending}
                onClick={() => {
                  setPropertyIds(initialPropertyIds);
                  setModes(initialModes);
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
