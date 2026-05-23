import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Palette, Sparkles, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshButton } from "@/components/RefreshButton";
import { StationKind, stationKindLabels } from "@/types/enums";
import { stationCapabilityService } from "./service";
import { CapabilitiesEditSheet } from "./CapabilitiesEditSheet";
import type { StationCapabilitySummary } from "./types";

function disabledHint(cap: StationCapabilitySummary): string {
  if (cap.stationKind !== StationKind.SUBCONTRACTOR) {
    return "Renk ve özellik yetkinliği yalnızca fason istasyonlarına atanabilir";
  }
  if (!cap.hasDefaultCategory) {
    return "Bu istasyona varsayılan fason kategorisi atanmamış — İstasyonlar sayfasından atayın";
  }
  return "Varsayılan fason kategorisi renk veya özellik uygulamıyor (appliesColor / appliesProperty kapalı)";
}

const QUERY_KEY = "station-capabilities";

export function StationCapabilitiesPage() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StationCapabilitySummary | null>(null);

  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: stationCapabilityService.list,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const filtered = useMemo(() => {
    const list = query.data?.data ?? [];
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (s) => s.stationName.toLowerCase().includes(q) || s.stationCode.toLowerCase().includes(q),
    );
  }, [query.data, search]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="İstasyon Yetenekleri"
        description="Fason istasyonlarının uygulayabileceği renk ve kazandırabileceği özellikler burada atanır."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="İstasyon ara..."
          className="h-8 w-64 text-sm"
        />
        <div className="ml-auto text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{filtered.length}</span> istasyon
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <TooltipProvider delayDuration={150}>
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Kod</TableHead>
                <TableHead>İstasyon</TableHead>
                <TableHead>Tür</TableHead>
                <TableHead>
                  <span className="flex items-center gap-1.5">
                    <Palette className="h-3.5 w-3.5" /> Renk
                  </span>
                </TableHead>
                <TableHead>
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" /> Özellik
                  </span>
                </TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    İstasyon bulunamadı.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((cap) => {
                  const editable = cap.canApplyColor || cap.canApplyProperty;
                  return (
                    <TableRow
                      key={cap.stationId}
                      className={editable ? undefined : "opacity-60"}
                    >
                      <TableCell className="font-mono text-xs">{cap.stationCode}</TableCell>
                      <TableCell className="font-medium">{cap.stationName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {stationKindLabels[cap.stationKind]}
                      </TableCell>
                      <TableCell>
                        {cap.canApplyColor ? (
                          <Badge variant={cap.colorCount === 0 ? "secondary" : "muted"}>
                            {cap.colorCount}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {cap.canApplyProperty ? (
                          <Badge variant={cap.propertyCount === 0 ? "secondary" : "muted"}>
                            {cap.propertyCount}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {editable ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => setEditing(cap)}
                            >
                              <Settings2 className="h-3.5 w-3.5" /> Yetenekleri Düzenle
                            </Button>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5"
                                    disabled
                                  >
                                    <Settings2 className="h-3.5 w-3.5" /> Yetenekleri Düzenle
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{disabledHint(cap)}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TooltipProvider>
      </div>

      <CapabilitiesEditSheet
        station={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}
