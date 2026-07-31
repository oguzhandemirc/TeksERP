import { useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Factory, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import { formatNumber, safeFormat } from "@/lib/format";
import { RowIdentity } from "./RowIdentity";
import type { KursunDistributionAssignedRow } from "./types";

export interface AssignedStationGroupData {
  stationId: string;
  stationName: string;
  rows: KursunDistributionAssignedRow[];
}

/**
 * Dağıtılmış satırları İSTASYONA göre gruplar. Sıra: payload sırası korunur
 * (backend acil + öncelik sırasıyla döner), grup sırası ilk görülen istasyon.
 */
export function groupAssignedByStation(
  rows: KursunDistributionAssignedRow[],
): AssignedStationGroupData[] {
  const groups = new Map<string, AssignedStationGroupData>();
  for (const row of rows) {
    const existing = groups.get(row.stationId);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(row.stationId, {
        stationId: row.stationId,
        stationName: row.stationName,
        rows: [row],
      });
    }
  }
  return [...groups.values()];
}

interface Props {
  group: AssignedStationGroupData;
  busy: boolean;
  onCancel: (row: KursunDistributionAssignedRow) => void;
  onToggleUrgent: (row: KursunDistributionAssignedRow) => void;
  onComplete: (row: KursunDistributionAssignedRow) => void;
}

/**
 * PLANLAMACI MONİTÖRÜ — bir fiziksel kurşun istasyonunun yükü. Başlıkta rollup
 * (iş emri adedi / top / metraj) var çünkü dağıtım kararı "hangi istasyon boş"
 * sorusuna dayanır; satır satır toplamak zorunda kalmak kararı geciktirir.
 */
export function AssignedStationGroup({
  group,
  busy,
  onCancel,
  onToggleUrgent,
  onComplete,
}: Props) {
  const [cancelTarget, setCancelTarget] = useState<KursunDistributionAssignedRow | null>(
    null,
  );

  const totalRolls = group.rows.reduce((s, r) => s + r.openRollCount, 0);
  const totalMeters = group.rows.reduce((s, r) => s + r.totalMeters, 0);

  return (
    <div className="rounded-md border">
      <div className="bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        <Factory className="text-muted-foreground h-4 w-4 shrink-0" />
        <span className="font-medium">{group.stationName}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {group.rows.length} iş emri · {totalRolls} top ·{" "}
          {formatNumber(totalMeters, 0)} m
        </span>
      </div>

      <ul className="divide-y">
        {group.rows.map((row) => (
          <li key={row.assignmentId}>
            <Card
              className={cn(
                "rounded-none border-0 shadow-none",
                row.isUrgent && "bg-destructive/5",
                row.stale && "bg-warning/5",
              )}
            >
              <CardContent className="flex flex-wrap items-center gap-3 p-3">
                <RowIdentity row={row} />

                <div className="text-muted-foreground shrink-0 text-right text-[11px]">
                  <div>{safeFormat(row.assignedAt, "dd.MM HH:mm")}</div>
                  <div>{row.assignedByName ?? "—"}</div>
                </div>

                <PermissionGate permission="workorder:distribute">
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={row.isUrgent ? "destructive" : "outline"}
                      className="gap-1"
                      disabled={busy}
                      onClick={() => onToggleUrgent(row)}
                    >
                      <AlertOctagon className="h-3.5 w-3.5" />
                      {row.isUrgent ? "Acil Kaldır" : "Acil Yap"}
                    </Button>

                    {row.isLastStep && (
                      <Button
                        type="button"
                        size="sm"
                        className="bg-success text-success-foreground hover:bg-success/90 gap-1"
                        disabled={busy}
                        onClick={() => onComplete(row)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        İşi Bitir
                      </Button>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={busy}
                      onClick={() => setCancelTarget(row)}
                    >
                      <X className="h-3.5 w-3.5" />
                      Kaldır
                    </Button>
                  </div>
                </PermissionGate>

                {row.stale && (
                  <div className="text-warning-foreground border-warning/50 bg-warning/10 flex w-full items-start gap-2 rounded-md border p-2 text-[11px]">
                    <AlertTriangle className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      <Badge variant="outline" className="mr-1 text-[10px]">
                        Bayat dağıtım
                      </Badge>
                      {row.staleReason ??
                        "Bu atama artık anlamsız — kaldırılması önerilir."}
                    </span>
                  </div>
                )}

                {row.notes && (
                  <div className="text-muted-foreground w-full text-[11px]">
                    Not: {row.notes}
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="Dağıtımı kaldır"
        description={
          cancelTarget
            ? `${cancelTarget.workOrderNumber} iş emrinin kurşun dağıtımı "${group.stationName}" istasyonundan kaldırılacak.\n\n` +
              `Kapsam: ${cancelTarget.openRollCount} top · ${formatNumber(cancelTarget.totalMeters, 0)} m` +
              (cancelTarget.batchNumbers.length > 0
                ? `\nParti: ${cancelTarget.batchNumbers.join(", ")}`
                : "") +
              `\nKart: ${cancelTarget.travelerCardNumber ?? "—"}\n\n` +
              "İş normal (tabletli) kurşun akışına döner, adımın istasyonu atama öncesine geri yüklenir. Toplara DOKUNULMAZ."
            : undefined
        }
        confirmLabel="Dağıtımı kaldır"
        destructive
        isPending={busy}
        onConfirm={() => {
          if (!cancelTarget) return;
          onCancel(cancelTarget);
          setCancelTarget(null);
        }}
      />
    </div>
  );
}
