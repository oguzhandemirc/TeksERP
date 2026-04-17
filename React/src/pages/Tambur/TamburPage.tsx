import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CircleDot,
  AlertTriangle,
  PackageCheck,
  Ruler,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { tamburService } from "@/services/tamburService";
import type { Roll } from "@/types/models";
import TamburDecisionPanel from "./TamburDecisionPanel";
import AllocateDialog from "./AllocateDialog";

export default function TamburPage() {
  const [selectedRollId, setSelectedRollId] = useState<string | null>(null);
  const [allocateRoll, setAllocateRoll] = useState<Roll | null>(null);

  const { data: pendingData, isLoading } = useQuery({
    queryKey: ["tambur-pending"],
    queryFn: () => tamburService.getPendingRolls(),
    refetchInterval: 20000,
  });

  const pendingRolls = pendingData?.data ?? [];

  if (selectedRollId) {
    return (
      <div className="max-w-2xl mx-auto">
        <TamburDecisionPanel
          rollId={selectedRollId}
          onBack={() => setSelectedRollId(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CircleDot className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">
            Tambur İstasyonu
          </h1>
        </div>
        <Badge variant="default" className="text-sm px-3 py-1">
          {pendingRolls.length} Bekleyen
        </Badge>
      </div>

      {/* Pending Rolls */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-24 bg-muted animate-pulse rounded-xl"
            />
          ))}
        </div>
      ) : pendingRolls.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <PackageCheck className="h-12 w-12 mx-auto mb-3 text-green-500 opacity-60" />
            <p className="text-lg font-medium text-muted-foreground">
              Bekleyen top bulunmuyor
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Tüm toplar işlendi. Her 20 saniyede otomatik kontrol yapılır.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pendingRolls.map((roll) => {
            const errorCount = roll.errors?.length ?? 0;
            const totalErrorMeters =
              roll.errors?.reduce(
                (sum, e) => sum + (e.endMeter - e.startMeter),
                0,
              ) ?? 0;

            return (
              <button
                key={roll.id}
                type="button"
                onClick={() => setSelectedRollId(roll.id)}
                className="w-full text-left cursor-pointer"
              >
                <Card className="hover:border-primary/50 hover:shadow-md transition-all active:scale-[0.99]">
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0 space-y-2">
                        {/* Top Info */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-base sm:text-lg truncate">
                            {roll.barcode}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {roll.item?.code}
                          </Badge>
                        </div>

                        {/* Metrics Row */}
                        <div className="flex items-center gap-4 text-sm">
                          <span className="flex items-center gap-1">
                            <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">
                              {roll.currentQty}m
                            </span>
                          </span>
                          <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span className="font-medium">
                              {errorCount} hata
                            </span>
                          </span>
                          <span className="text-muted-foreground text-xs">
                            ({totalErrorMeters.toFixed(1)}m hatalı)
                          </span>
                        </div>

                        {/* Error Types */}
                        {roll.errors && roll.errors.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap">
                            {roll.errors.slice(0, 4).map((e) => (
                              <Badge
                                key={e.id}
                                variant="outline"
                                className="text-xs"
                              >
                                {e.errorType ?? "Bilinmiyor"}{" "}
                                {e.startMeter}–{e.endMeter}m
                              </Badge>
                            ))}
                            {roll.errors.length > 4 && (
                              <Badge variant="outline" className="text-xs">
                                +{roll.errors.length - 4} daha
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>

                      <ChevronRight className="h-6 w-6 text-muted-foreground shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Actions */}
      <div className="pt-2">
        <Button
          variant="outline"
          className="w-full h-12"
          disabled
        >
          <PackageCheck className="h-4 w-4 mr-2" />
          Üretilmiş Top Tahsisi (Detay ekranından yapılır)
        </Button>
      </div>

      {/* Allocate Dialog */}
      <AllocateDialog
        open={!!allocateRoll}
        onOpenChange={(open) => !open && setAllocateRoll(null)}
        roll={allocateRoll}
      />
    </div>
  );
}
