import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PermissionGate } from "@/components/PermissionGate";
import { GramajChoiceButtons } from "@/components/kursun/GramajChoiceButtons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import {
  fetchProcessSummary,
  processSummaryKey,
  putWorkOrderTargetValues,
  useKursunGramajCatalog,
  type KursunSummaryRow,
  type ProcessSummaryScope,
} from "@/lib/kursun-gramaj";
import { cn } from "@/lib/utils";
import { DeliveryNoteGramajHint } from "./DeliveryNoteGramajHint";

interface Props {
  scope: ProcessSummaryScope;
  /** Hedef değiştirme düğmesi yalnız iş emri kapsamında (parti izinde salt okunur). */
  editableTarget?: boolean;
}

const SOURCE_LABEL: Record<KursunSummaryRow["source"], string> = { TABLET: "Tablet", KAGIT: "Kâğıt" };

/**
 * Kurşun gramaj özeti — İE detayı ve parti izinde AYNI kart, AYNI uç ailesi
 * (`process-summary`). Sapma turuncu; kâğıt ve "gramaj bilinmiyor" gri. Sapma
 * yalnız bilgidir, üretimi durdurmaz.
 */
export function ProcessSummaryCard({ scope, editableTarget = false }: Props) {
  const q = useQuery({ queryKey: processSummaryKey(scope), queryFn: () => fetchProcessSummary(scope) });
  const { catalog } = useKursunGramajCatalog();
  const [editOpen, setEditOpen] = useState(false);

  // Çerçeve rengi sabit nötr: v3 sayfası `--border`ı hex yapar, `border-border` (hsl) orada bozulur.
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.isError || !q.data) {
    return <p className="text-sm text-muted-foreground">Gramaj özeti yüklenemedi.</p>;
  }
  const s = q.data.kursun;
  const noteSuggestion = q.data.deliveryNoteGramaj ?? null;
  const canEdit = editableTarget && "workOrderId" in scope && catalog.propertyId !== null;

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/15 bg-card p-4 text-sm text-card-foreground" data-testid="process-summary-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <span className="text-muted-foreground">Hedef gramaj: </span>
          <span className="font-semibold">{s.target?.valueName ?? "Hedef yok"}</span>
        </div>
        <div className="text-muted-foreground">
          Toplam <span className="font-semibold text-foreground tabular-nums">{s.totals.rollCount}</span> top ·{" "}
          <span className="font-semibold text-foreground tabular-nums">{formatNumber(s.totals.meters, 0)}</span> m
        </div>
        {canEdit && (
          <PermissionGate permission="workorder:write">
            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setEditOpen(true)}>
              Hedefi değiştir
            </Button>
          </PermissionGate>
        )}
      </div>

      {noteSuggestion && "workOrderId" in scope && (
        <DeliveryNoteGramajHint
          suggestion={noteSuggestion}
          workOrderId={scope.workOrderId}
          propertyId={canEdit ? (catalog.propertyId as string) : null}
          currentValueId={s.target?.valueId ?? null}
        />
      )}

      {s.rows.length === 0 ? (
        <p className="mt-3 text-muted-foreground">Henüz kurşun basılmadı.</p>
      ) : (
        <ul className="mt-3 divide-y divide-black/10 rounded-md border border-black/10 dark:border-white/15 dark:divide-white/10">
          {s.rows.map((r) => {
            const muted = r.source === "KAGIT" || r.valueId === null;
            return (
              <li
                key={`${r.source}:${r.valueId ?? "-"}`}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2",
                  r.deviatesFromTarget && "bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
                  !r.deviatesFromTarget && muted && "text-muted-foreground",
                )}
              >
                <span className="min-w-[6rem] font-semibold">{r.valueName}</span>
                <span className="rounded border border-current/30 px-1.5 py-0.5 text-xs opacity-80">{SOURCE_LABEL[r.source]}</span>
                {r.deviatesFromTarget && <span className="text-xs font-medium">Hedeften farklı</span>}
                <span className="ml-auto tabular-nums">
                  {r.rollCount} top · {formatNumber(r.meters, 0)} m
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && "workOrderId" in scope && (
        <TargetEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          workOrderId={scope.workOrderId}
          propertyId={catalog.propertyId as string}
          options={catalog.options}
          current={s.target?.valueId ?? null}
        />
      )}
    </div>
  );
}

function TargetEditDialog({
  open,
  onOpenChange,
  workOrderId,
  propertyId,
  options,
  current,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workOrderId: string;
  propertyId: string;
  options: { id: string; name: string }[];
  current: string | null;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState<string | null>(current);
  const mut = useMutation({
    mutationFn: () => putWorkOrderTargetValues(workOrderId, value ? [{ propertyId, valueId: value }] : []),
    onSuccess: (r) => {
      toast.success(r.changed ? "Hedef gramaj güncellendi" : "Hedef zaten aynı");
      void qc.invalidateQueries({ queryKey: ["process-summary"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setValue(current);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hedef kurşun gramajı</DialogTitle>
          <DialogDescription>
            Basılan gramaj hedeften farklıysa kartta turuncu görünür; üretim durmaz.
          </DialogDescription>
        </DialogHeader>
        <GramajChoiceButtons options={options} value={value} onChange={setValue} emptyLabel="Hedef yok" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
