import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { routeService } from "@/services/routeService";
import { SlideOverPanel, SlideOverContentLoader } from "@/components/ui/SlideOverPanel";
import { Map, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface RouteDetailPanelProps {
  routeId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function RouteDetailPanel({ routeId, isOpen, onClose }: RouteDetailPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(routeId);

  useEffect(() => {
    if (routeId) setActiveId(routeId);
  }, [routeId]);

  const effectiveId = routeId || activeId;

  const { data, isLoading } = useQuery({
    queryKey: ["route-detail", effectiveId],
    queryFn: () => routeService.getById(effectiveId!),
    enabled: !!effectiveId,
  });

  const route = data?.data;

  return (
    <SlideOverPanel
      title={route ? route.name : "Rota Detayı"}
      isOpen={isOpen}
      onClose={onClose}
    >
      {isLoading ? (
        <SlideOverContentLoader />
      ) : !route ? (
        <div className="text-center text-muted-foreground p-6">Rota bulunamadı</div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-muted rounded-lg">
              <Map className="h-6 w-6 text-foreground" />
            </div>
            <div>
              <div className="font-semibold text-lg">{route.name}</div>
              <Badge variant={route.isActive ? "default" : "secondary"} className="mt-1">
                {route.isActive ? "Aktif" : "Pasif"}
              </Badge>
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-sm font-medium">
              Rota Adımları ({route.steps?.length ?? 0})
            </div>
            {route.steps && route.steps.length > 0 ? (
              <div className="space-y-2">
                {[...route.steps]
                  .sort((a, b) => a.sequence - b.sequence)
                  .map((step) => (
                    <div
                      key={step.id}
                      className="flex items-center gap-3 rounded-md border p-3"
                    >
                      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            #{step.sequence}
                          </span>
                          <span className="font-medium text-sm truncate">
                            {step.station?.code} - {step.station?.name}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Bu rotaya bağlı bir adım bulunmamaktadır.</span>
            )}
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <div>Oluşturulma: {new Date(route.createdAt).toLocaleString("tr-TR")}</div>
            <div>Son Güncelleme: {new Date(route.updatedAt).toLocaleString("tr-TR")}</div>
          </div>
        </div>
      )}
    </SlideOverPanel>
  );
}
