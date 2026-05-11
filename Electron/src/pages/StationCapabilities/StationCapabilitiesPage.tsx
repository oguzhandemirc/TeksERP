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
import { RefreshButton } from "@/components/RefreshButton";
import { stationCapabilityService } from "./service";
import { CapabilitiesEditSheet } from "./CapabilitiesEditSheet";
import type { StationCapabilitySummary } from "./types";

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
        description="Hangi istasyon hangi rengi uygulayabiliyor, hangi özelliği kazandırıyor — burada atanır."
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
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Kod</TableHead>
              <TableHead>İstasyon</TableHead>
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
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  İstasyon bulunamadı.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((cap) => (
                <TableRow key={cap.stationId}>
                  <TableCell className="font-mono text-xs">{cap.stationCode}</TableCell>
                  <TableCell className="font-medium">{cap.stationName}</TableCell>
                  <TableCell>
                    <Badge variant={cap.colorCount === 0 ? "secondary" : "muted"}>
                      {cap.colorCount}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={cap.propertyCount === 0 ? "secondary" : "muted"}>
                      {cap.propertyCount}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => setEditing(cap)}
                      >
                        <Settings2 className="h-3.5 w-3.5" /> Yetenekleri Düzenle
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CapabilitiesEditSheet
        station={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}
