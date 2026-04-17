import { useQuery } from "@tanstack/react-query";
import {
  Palette,
  RefreshCw,
  Ruler,
  Boxes,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { swatchService } from "@/services/swatchService";

export default function SwatchesPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["swatches"],
    queryFn: () => swatchService.list({ limit: 200 }),
  });

  const swatches = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Numune Kartelalar</h1>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" /> Yenile
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-5 w-5" />
            Kartela Envanteri
            <Badge variant="secondary" className="ml-1">{swatches.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />
              ))}
            </div>
          ) : swatches.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Henüz kartela basılmadı. Kartelalar Tambur ekranından üretilebilir.
            </p>
          ) : (
            <div className="space-y-2">
              {swatches.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <Palette className="h-5 w-5 text-purple-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold">
                        {s.barcode}
                      </span>
                      {s.item && (
                        <Badge variant="outline" className="text-xs">
                          {s.item.code} {s.item.name}
                        </Badge>
                      )}
                      {s.variant && (
                        <Badge variant="secondary" className="text-xs">
                          {s.variant.code}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Ruler className="h-3 w-3" /> {s.length.toFixed(2)}m
                      </span>
                      {s.width && <span>En: {s.width}cm</span>}
                      {s.workOrder && (
                        <span>Parti: {s.workOrder.batchNumber}</span>
                      )}
                      {s.parentRoll && (
                        <span>Kaynak: {s.parentRoll.barcode}</span>
                      )}
                      <span>{new Date(s.createdAt).toLocaleString("tr-TR")}</span>
                    </div>
                    {s.purpose && (
                      <p className="text-xs mt-1 text-muted-foreground italic">
                        {s.purpose}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
