import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, Square, Palette, Sparkle } from "lucide-react";
import { stationCapabilityService } from "@/services/stationCapabilityService";
import { colorService } from "@/services/colorService";
import { fabricPropertyService } from "@/services/fabricPropertyService";
import type { Station, Color, FabricProperty } from "@/types/models";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  station: Station | null;
}

export default function StationCapabilityDialog({
  open,
  onOpenChange,
  station,
}: Props) {
  const qc = useQueryClient();
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(
    new Set(),
  );

  // Mevcut yetkinlikler
  const { data: currentData } = useQuery({
    queryKey: ["station-capability", station?.id],
    queryFn: () => stationCapabilityService.getByStation(station!.id),
    enabled: open && !!station,
  });

  // Tüm renkler + özellikler
  const { data: colorsData } = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      colorService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open,
  });
  const allColors: Color[] = colorsData?.data ?? [];

  const { data: propsData } = useQuery({
    queryKey: ["fabric-properties", "all-active"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open,
  });
  const allProperties: FabricProperty[] = propsData?.data ?? [];

  // Mevcut yetkinlikler yüklenince seçili olanları işaretle
  useEffect(() => {
    if (open && currentData?.data) {
      setSelectedColors(new Set(currentData.data.colors.map((c) => c.id)));
      setSelectedProperties(
        new Set(currentData.data.properties.map((p) => p.id)),
      );
    } else if (!open) {
      setSelectedColors(new Set());
      setSelectedProperties(new Set());
    }
  }, [open, currentData]);

  const saveMutation = useMutation({
    mutationFn: () =>
      stationCapabilityService.setForStation(station!.id, {
        colorIds: Array.from(selectedColors),
        propertyIds: Array.from(selectedProperties),
      }),
    onSuccess: () => {
      toast.success("Yetkinlikler güncellendi");
      qc.invalidateQueries({ queryKey: ["station-capability"] });
      qc.invalidateQueries({ queryKey: ["station-capabilities"] });
      onOpenChange(false);
    },
  });

  const toggleColor = (id: string) => {
    setSelectedColors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleProp = (id: string) => {
    setSelectedProperties((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!station) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Yetkinlikler — {station.name}
            <Badge variant="outline" className="ml-2 font-mono">
              {station.code}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Bu istasyonun fason adımında uygulayabileceği renk + özellikler. İş
          emri planlamada hedef renk/özelliğin atandığı adımın istasyonu bu
          listede olmalı.
        </p>

        <div className="grid grid-cols-2 gap-4">
          {/* Renkler */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              <Label>Uygulayabildiği Renkler ({selectedColors.size})</Label>
            </div>
            <div className="border rounded-md max-h-72 overflow-y-auto">
              {allColors.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Henüz renk tanımlanmamış
                </p>
              )}
              {allColors.map((c) => {
                const isSelected = selectedColors.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleColor(c.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                      isSelected ? "bg-primary/5" : ""
                    }`}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    {c.hex && (
                      <span
                        className="inline-block h-4 w-4 rounded border shrink-0"
                        style={{ backgroundColor: c.hex }}
                      />
                    )}
                    <span className="flex-1 truncate">{c.name}</span>
                    <code className="text-xs text-muted-foreground">
                      {c.code}
                    </code>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Özellikler */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkle className="h-4 w-4 text-primary" />
              <Label>
                Uygulayabildiği Özellikler ({selectedProperties.size})
              </Label>
            </div>
            <div className="border rounded-md max-h-72 overflow-y-auto">
              {allProperties.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Henüz özellik tanımlanmamış
                </p>
              )}
              {allProperties.map((p) => {
                const isSelected = selectedProperties.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProp(p.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                      isSelected ? "bg-primary/5" : ""
                    }`}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.category && (
                      <Badge variant="outline" className="text-xs">
                        {p.category}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            İptal
          </Button>
          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            isLoading={saveMutation.isPending}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
