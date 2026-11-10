import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tag, Pencil, Ruler, Wrench, ChevronRight } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { RollLabelDialog } from "@/components/labels/RollLabelDialog";
import { RollEditDialog } from "./RollEditDialog";
import { RescueStuckDialog } from "./RescueStuckDialog";
import { RollQtyAdjustDialog } from "./RollQtyAdjustDialog";
import { RollLabelTextsCard } from "./RollLabelTextsCard";
import { canAdjustRollQty } from "./qtyAdjustService";
import { useEmanetEnabled, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { RollCancelCard } from "./RollCancelCard";
import { LabTestsCard } from "@/pages/Quality/LabTests/LabTestsCard";
import { RollInspectionCard } from "@/pages/Quality/Inspections/RollInspectionCard";
import { rollService } from "./service";
import type { Roll } from "./types";
import { PrintHistoryLink } from "@/components/print/PrintHistoryLink";
import { RollTraceLink } from "./RollTraceLink";
import { RollMeasurementsCard } from "./measurements/RollMeasurementsCard";
import { RollIdentitySection } from "./card/RollIdentitySection";
import { RollInfoTable } from "./card/RollInfoTable";
import { RollOriginSection } from "./card/RollOriginSection";
import { RollLocationSection } from "./card/RollLocationSection";
import { RollStateCards } from "./card/RollStateCards";
import { RollRecentEvents } from "./card/RollRecentEvents";

interface Props {
  roll: Roll | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * TOP KARTI — barkod başlığı + "Top bilgileri" tablosu (asıl bilgiler tek kaynak, 2026-11-10) · durum kartları ·
 * son hareketler · etiket/kalite kartları; köken ve konum ayrıntıları katlanır "Diğer ayrıntılar"da.
 */
export function RollDetailSheet({ roll, open, onOpenChange }: Props) {
  const [labelRollId, setLabelRollId] = useState<string | null>(null);
  const [editRollId, setEditRollId] = useState<string | null>(null);
  const [rescueRollId, setRescueRollId] = useState<string | null>(null);
  const [qtyAdjustOpen, setQtyAdjustOpen] = useState(false);
  // Ana top bağlantısı: o topun kartı bu kartın üstünde açılır (kapatınca buraya dönülür).
  const [linkedRoll, setLinkedRoll] = useState<Roll | null>(null);
  const openLinkedRoll = (id: string) => {
    void rollService.getById(id).then((res) => { if (res.data) setLinkedRoll(res.data); });
  };
  const { hasPermission } = useRoleAccess();
  const canManualAdjust = hasPermission("roll:manual-adjust");
  const emanetEnabled = useEmanetEnabled();
  // G4 — "Metraj Düzelt" (sayım) YALNIZ ticaret rejiminde (yüklem bekçili: qtyAdjust.test.ts).
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const canQtyAdjust = canManualAdjust && !!roll && canAdjustRollQty(roll, financeEnabled);
  // Yaşam döngüsü AYRI izinle (roll:history); izin yoksa bölüm çizilmez, istek atılmaz.
  const canSeeHistory = hasPermission("roll:history");

  const detailQuery = useQuery({
    queryKey: ["roll-detail", roll?.id],
    queryFn: () => rollService.getById(roll!.id),
    enabled: open && !!roll?.id,
    staleTime: 30_000,
  });
  const historyQuery = useQuery({
    queryKey: ["roll-history", roll?.id],
    queryFn: () => rollService.getHistory(roll!.id),
    enabled: open && !!roll?.id && canSeeHistory,
    staleTime: 30_000,
  });
  const detail = detailQuery.data?.data ?? undefined;
  // GÖSTERİM KAYNAĞI TEK: taze detay (liste satırının üst kümesi) varsa o, yoksa liste satırı; kapalıyken null.
  const r = roll ? (detail ?? roll) : null;
  const canEditAttributes = !!r && r.status !== "SCRAP" && r.status !== "CANCELLED";
  const canRescue = !!r && r.status === "IN_PRODUCTION";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-auto">
        <SheetHeader>
          <SheetTitle>Top Kartı</SheetTitle>
          <SheetDescription className="sr-only">
            Top {roll?.barcode ?? ""} · {roll?.item?.name ?? ""} detayı
          </SheetDescription>
        </SheetHeader>

        {roll && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PermissionGate permission="label:read">
              <Button type="button" size="sm" className="gap-1" onClick={() => setLabelRollId(roll.id)}>
                <Tag className="h-3.5 w-3.5" /> Etiket
              </Button>
            </PermissionGate>
            {/* TEK "Düzelt": renk/metraj/kalite/en/özellik; üretimdeki topta sebep + izin diyalogda. */}
            {canEditAttributes && (
              <Button type="button" size="sm" className="gap-1" onClick={() => setEditRollId(roll.id)}>
                <Pencil className="h-3.5 w-3.5" /> Düzelt
              </Button>
            )}
            {canManualAdjust && canRescue && (
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setRescueRollId(roll.id)}>
                <Wrench className="h-3.5 w-3.5" /> İstasyondan Kurtar
              </Button>
            )}
            {canQtyAdjust && (
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setQtyAdjustOpen(true)}>
                <Ruler className="h-3.5 w-3.5" /> Metraj Düzelt
              </Button>
            )}
            {/* TEK "İz sür" (kullanıcı 2026-11-10: kartta iki tane vardı). */}
            <RollTraceLink rollId={roll.id} />
            <PrintHistoryLink subjectId={roll.id} className="ml-auto" />
          </div>
        )}

        <RollLabelDialog rollId={labelRollId} onOpenChange={(o) => !o && setLabelRollId(null)} />
        <RollEditDialog rollId={editRollId} onOpenChange={(o) => !o && setEditRollId(null)} onSaved={() => void detailQuery.refetch()} />
        <RescueStuckDialog rollId={rescueRollId} onOpenChange={(o) => !o && setRescueRollId(null)} onRescued={() => void detailQuery.refetch()} />
        <RollQtyAdjustDialog roll={qtyAdjustOpen ? roll : null} onOpenChange={(o) => !o && setQtyAdjustOpen(false)} onAdjusted={() => void detailQuery.refetch()} />

        {r && roll && (
          <div className="mt-4 space-y-4">
            <RollIdentitySection roll={r} />
            <RollInfoTable roll={r} emanetEnabled={emanetEnabled} onOpenRoll={openLinkedRoll} />
            {/* İptal edilmiş topta asıl soru "neden ölü, düzeltebilir miyim" — tablonun hemen ardında. */}
            {detail?.status === "CANCELLED" && <RollCancelCard roll={detail} />}
            <RollStateCards r={r} detail={detail} roll={roll} detailLoading={detailQuery.isLoading} />
            {canSeeHistory && (
              <RollRecentEvents events={historyQuery.data?.data?.events} isLoading={historyQuery.isLoading} isError={historyQuery.isError} />
            )}
            {/* Etikete basılan ad/renk/parti tabloda; burada yalnız "Düzelt" (sevk edilene kadar). */}
            <RollLabelTextsCard roll={r} showValues={false} onSaved={() => void detailQuery.refetch()} />
            <RollInspectionCard rollId={r.id} barcode={r.barcode ?? null} />
            <LabTestsCard rollId={r.id} />
            {canSeeHistory && historyQuery.data?.data?.measurements && (
              <RollMeasurementsCard measurements={historyQuery.data.data.measurements} onChanged={() => void historyQuery.refetch()} />
            )}
            <details className="group rounded-md border" data-testid="roll-card-more">
              <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-2 text-xs font-medium text-muted-foreground">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" /> Diğer ayrıntılar
              </summary>
              <div className="space-y-4 px-3 pb-3">
                <RollOriginSection roll={r} />
                <RollLocationSection roll={r} />
                <div className="text-[11px] text-muted-foreground">
                  Oluşturma: {safeFormat(r.createdAt, "dd.MM.yyyy HH:mm")} · Son güncelleme: {safeFormat(r.updatedAt, "dd.MM.yyyy HH:mm")}
                </div>
              </div>
            </details>
          </div>
        )}
      </SheetContent>
      {open && linkedRoll && <RollDetailSheet roll={linkedRoll} open onOpenChange={(o) => !o && setLinkedRoll(null)} />}
    </Sheet>
  );
}
