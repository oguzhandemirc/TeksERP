import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Play,
  AlertTriangle,
  Activity,
  Clock,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { productionService } from "@/services/productionService";
import { stepStatusLabels } from "@/types/enums";
import type { StepStatus } from "@/types/enums";
import StepActionPanel from "./StepActionPanel";
import ReportErrorDialog from "./ReportErrorDialog";

export default function ProductionPage() {
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);

  const { data: activeStepsData, isLoading } = useQuery({
    queryKey: ["active-steps"],
    queryFn: () => productionService.getActiveSteps(),
    refetchInterval: 15000,
  });

  const activeSteps = activeStepsData?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Play className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Üretim Akışı</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => setErrorDialogOpen(true)}
        >
          <AlertTriangle className="h-4 w-4 mr-1" />
          Hata Raporla
        </Button>
      </div>

      {/* İstasyon İşlem Paneli */}
      <StepActionPanel />

      {/* Aktif Adımlar Dashboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5" />
            Aktif Üretim Adımları
            <Badge variant="default" className="ml-1">
              {activeSteps.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 bg-muted animate-pulse rounded-md"
                />
              ))}
            </div>
          ) : activeSteps.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Şu anda aktif üretim adımı bulunmuyor.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeSteps.map((step) => (
                <div
                  key={step.id}
                  className="flex items-center gap-4 rounded-lg border border-border bg-muted/50 p-4 shadow-sm border-l-4 border-l-primary dark:bg-muted/30"
                >
                  <div className="shrink-0">
                    <ArrowRight className="h-5 w-5 text-primary" aria-hidden />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">
                        {step.station?.code} - {step.station?.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs font-medium text-foreground border-border bg-background"
                      >
                        {stepStatusLabels[step.status as StepStatus] ??
                          step.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      {step.workOrder && (
                        <span>
                          Parti:{" "}
                          <span className="font-medium text-foreground tabular-nums">
                            {step.workOrder.batchNumber}
                          </span>
                        </span>
                      )}
                      <span>Sıra: #{step.stepSequence}</span>
                      {step.startedAt && (
                        <span className="tabular-nums">
                          Başlangıç:{" "}
                          {new Date(step.startedAt).toLocaleString("tr-TR")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeSteps.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              Her 15 saniyede otomatik yenilenir.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Hata Raporlama Dialog */}
      <ReportErrorDialog
        open={errorDialogOpen}
        onOpenChange={setErrorDialogOpen}
      />
    </div>
  );
}
