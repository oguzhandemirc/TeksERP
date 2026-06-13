import { useEffect, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Save } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { printDocumentArea } from "@/lib/print";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { DocVersionBar } from "@/components/print/DocVersionBar";
import {
  printedDocumentService,
  type PrintedDocument,
} from "@/services/printedDocumentService";
import { workOrderService, type FasonDispatchDoc, type DispatchDyeOverlay } from "./service";
import { PrintableSheet, type FasonSheetData } from "./FasonSevkSheet";

export { PrintableSheet } from "./FasonSevkSheet";

interface Props {
  dispatchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DOC_TYPE = "SUBCONTRACTOR_DISPATCH" as const;

export function FasonSevkPrintDialog({ dispatchId, open, onOpenChange }: Props) {
  const printRef = useRef<HTMLDivElement>(null); // Y3: izole iframe baskısının kök alanı
  const { hasPermission } = useRoleAccess();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  // Donmuş içerik (sevk anında dondu). Reissue ile yeni versiyon basılabilir.
  const docQuery = useQuery({
    queryKey: ["printed-doc", DOC_TYPE, dispatchId],
    queryFn: () => printedDocumentService.getCurrent<FasonDispatchDoc>(DOC_TYPE, dispatchId!),
    enabled: open && Boolean(dispatchId),
    // K-A2 fix: belge durumu (ACTIVE/VOIDED/SUPERSEDED) başka istemciden değişir —
    // 5dk cache, iptal edilmiş belgeyi İPTAL filigransız bastırabiliyordu.
    staleTime: 0,
  });
  const currentDoc = docQuery.data?.data ?? null;

  // Seçili eski versiyon (geçmişten).
  const versionQuery = useQuery({
    queryKey: ["printed-doc", DOC_TYPE, dispatchId, "v", selectedVersion],
    queryFn: () =>
      printedDocumentService.getVersion<FasonDispatchDoc>(DOC_TYPE, dispatchId!, selectedVersion!),
    enabled: open && Boolean(dispatchId) && selectedVersion != null,
    staleTime: 30_000,
  });

  // CANLI talimat overlay'i — istenen renk + boyahane notu (donmuş içeriğin dışında).
  const overlayQuery = useQuery({
    queryKey: ["dispatch-overlay", dispatchId],
    queryFn: () => workOrderService.getDispatchDyeOverlay(dispatchId!),
    enabled: open && Boolean(dispatchId),
    staleTime: 30_000,
  });
  const overlay = overlayQuery.data?.data as DispatchDyeOverlay | undefined;

  const shown: PrintedDocument<FasonDispatchDoc> | null =
    selectedVersion != null ? (versionQuery.data?.data ?? null) : currentDoc;
  const viewingOld = selectedVersion != null && selectedVersion !== currentDoc?.version;

  const loading =
    docQuery.isLoading ||
    overlayQuery.isLoading ||
    (selectedVersion != null && versionQuery.isLoading);

  // Efektif boyahane notu: sevkin kendi notu (override) → yoksa WO notu (default).
  const effectiveDyehouseNote = overlay
    ? (overlay.dyehouseNote ?? overlay.woDyehouseNote)
    : null;
  const sheetData: FasonSheetData | null = shown
    ? {
        ...shown.snapshot.doc,
        requestedColor: overlay?.requestedColor ?? null,
        dyehouseNote: effectiveDyehouseNote,
      }
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Fason Sevk İrsaliyesi</DialogTitle>
          <DialogDescription>
            Sevk anında dondurulan resmi belge. İstenen renk + boyahane notu canlıdır;
            içerik düzeltmesi için "Revize Et".
          </DialogDescription>
        </DialogHeader>

        <div ref={printRef} className="flex-1 overflow-auto rounded-md border bg-muted/30 p-4">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
          {!loading && !shown && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Sevk bilgisi bulunamadı.
            </div>
          )}
          {/* O4 fix: canlı overlay (istenen renk + boyahane notu) alınamadıysa
              fiş RENKSİZ/NOTSUZ basılırdı — boyahaneye yanlış talimat. Baskıyı
              blokla, yeniden dene sun. */}
          {!loading && shown && overlayQuery.isError && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <div className="font-medium text-destructive">
                Renk/boyahane notu yüklenemedi — fiş eksik talimatla BASILMAZ.
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void overlayQuery.refetch()}
              >
                Yeniden Dene
              </Button>
            </div>
          )}
          {!loading && shown && dispatchId && (
            <>
              <DocVersionBar
                docType={DOC_TYPE}
                sourceId={dispatchId}
                current={shown}
                activeVersion={currentDoc?.version ?? shown.version}
                onSelectVersion={setSelectedVersion}
                canReissue={hasPermission("workorder:write")}
              />
              {/* Boyahane notu editörü — yalnız güncel ACTIVE belgede, kilitli değilse. */}
              {!viewingOld && shown.status === "ACTIVE" && overlay && (
                <DyehouseNoteEditor
                  dispatchId={dispatchId}
                  value={overlay.dyehouseNote}
                  woValue={overlay.woDyehouseNote}
                  locked={overlay.dyehouseNoteLocked}
                />
              )}
              {sheetData && !overlayQuery.isError && (
                <PrintableSheet
                  snap={sheetData}
                  companyName={shown.snapshot.company.name}
                  letterhead={shown.snapshot.company.letterhead}
                  docConfigOverride={shown.snapshot.docConfigOverride}
                  voided={shown.status === "VOIDED"}
                superseded={shown.status === "SUPERSEDED"}
                docNo={shown.documentNo}
                docVersion={shown.version}
                />
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button
            type="button"
            className="gap-1"
            disabled={!sheetData || overlayQuery.isError}
            onClick={() => printDocumentArea(printRef.current)}
          >
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Boyahane notu düzenleyici — `.print-area` DIŞINDA durur, baskıya girmez.
 * Kaydedince overlay query'sini invalidate eder; aşağıdaki fişte not güncel
 * görünür. Bu alan sevkin KENDİ notunu (override) düzenler; boş bırakılırsa
 * fişte iş emrindeki boyahane notu (`woValue`) basılır.
 */
function DyehouseNoteEditor({
  dispatchId,
  value,
  woValue,
  locked,
}: {
  dispatchId: string;
  value: string | null;
  woValue: string | null;
  locked: boolean;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value, dispatchId]);

  const mutation = useMutation({
    mutationFn: (note: string | null) =>
      workOrderService.updateDispatchDyehouseNote(dispatchId, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-overlay", dispatchId] });
      toast.success("Boyahane notu kaydedildi");
    },
  });

  const trimmed = draft.trim();
  const dirty = trimmed !== (value ?? "").trim();

  return (
    <div className="mb-3 rounded-md border bg-background p-3">
      <div className="mb-1 flex items-center justify-between">
        <label
          htmlFor="dyehouse-note"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Boyahane Notu
        </label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 gap-1"
          disabled={locked || !dirty || mutation.isPending}
          onClick={() => mutation.mutate(trimmed || null)}
        >
          <Save className="h-3.5 w-3.5" />
          {mutation.isPending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>
      <textarea
        id="dyehouse-note"
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={1000}
        disabled={locked}
        placeholder="Boyahaneye talimat (örn. yıkama yapma, matlaştır)…"
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      />
      {locked ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Sevk kabul/iptal edilmiş — boyahane notu kilitli, değiştirilemez.
        </p>
      ) : !trimmed && woValue?.trim() ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Boş bırakılırsa iş emrindeki boyahane notu basılır:{" "}
          <span className="font-medium text-orange-700">«{woValue.trim()}»</span>
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Fişe işlenir ve baskıda görünür. Genel sevk notundan ayrıdır.
        </p>
      )}
    </div>
  );
}
