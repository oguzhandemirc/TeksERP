import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Printer, Save } from "lucide-react";
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
import { printHtmlString } from "@/lib/print";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { DocVersionBar } from "@/components/print/DocVersionBar";
import { PrintNoteField } from "@/components/print/PrintNoteField";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  printedDocumentService,
  type PrintedDocument,
} from "@/services/printedDocumentService";
import { workOrderService, type FasonDispatchDoc, type DispatchDyeOverlay } from "./service";
import { fasonNoteLabel } from "./fasonNote";

interface Props {
  dispatchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Belgeler modalından açıldıysa "geri dön" — verilirse footer'da buton çıkar. */
  onBack?: () => void;
}

const DOC_TYPE = "SUBCONTRACTOR_DISPATCH" as const;

/**
 * Fason Sevk İrsaliyesi (çeki) — ÖNİZLEME = PDF = MOBİL (tek kaynak). Hem ekran
 * önizlemesi hem baskı backend `renderFasonCekiHtml` çıktısını (iframe srcDoc /
 * printHtmlString) kullanır → eski React şablonu (FasonSevkSheet) ile sapma yok.
 * İstenen renk + fason talimatı belgeye DONAR; canlı düzeltme InstructionEditor +
 * "Revize Et" (reissue) ile yeni versiyon dondurur.
 */
export function FasonSevkPrintDialog({ dispatchId, open, onOpenChange, onBack }: Props) {
  const { hasPermission } = useRoleAccess();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  // "Güncel şablonla" — içerik donuk, görünüm canlı Belge Şablonları ayarından.
  const [currentTemplate, setCurrentTemplate] = useState(false);
  // Tek seferlik baskı notu — kalıcı şablona yazılmaz, yalnız bu baskıya girer.
  const [printNote, setPrintNote] = useState("");
  const debouncedNote = useDebouncedValue(printNote, 400);

  // Donmuş içerik meta'sı (versiyon çubuğu + ACTIVE/VOIDED/SUPERSEDED ayrımı).
  const docQuery = useQuery({
    queryKey: ["printed-doc", DOC_TYPE, dispatchId],
    queryFn: () => printedDocumentService.getCurrent<FasonDispatchDoc>(DOC_TYPE, dispatchId!),
    enabled: open && Boolean(dispatchId),
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

  // CANLI talimat overlay'i — yalnız DÜZENLEME yüzeyi (editör) için; belge içeriği
  // artık donmuş HTML'den gelir (talimat sevkte donar).
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
  const shownVersion = shown?.version ?? null;

  // ÖNİZLEME + BASKI tek kaynak: donmuş versiyonun backend HTML'i (KUMAŞ İRSALİYESİ).
  const htmlQuery = useQuery({
    queryKey: ["printed-doc-html", DOC_TYPE, dispatchId, shownVersion, currentTemplate, debouncedNote],
    queryFn: () =>
      printedDocumentService.getHtml(DOC_TYPE, dispatchId!, shownVersion ?? undefined, {
        currentTemplate,
        printNote: debouncedNote,
      }),
    enabled: open && Boolean(dispatchId) && shownVersion != null,
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;

  const loading =
    docQuery.isLoading || (selectedVersion != null && versionQuery.isLoading);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Fason Sevk İrsaliyesi</DialogTitle>
          <DialogDescription>
            Sevk anında dondurulan resmi belge — önizleme baskıyla birebir aynı. İçerik
            (renk/talimat) düzeltmesi için "Revize Et".
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 space-y-2 rounded-md border bg-muted/30 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !shown || !dispatchId ? (
          <div className="flex flex-1 items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
            Sevk bilgisi bulunamadı.
          </div>
        ) : (
          <>
            <div className="shrink-0 space-y-2">
              <DocVersionBar
                docType={DOC_TYPE}
                sourceId={dispatchId}
                current={shown}
                activeVersion={currentDoc?.version ?? shown.version}
                onSelectVersion={setSelectedVersion}
                canReissue={hasPermission("workorder:write")}
                currentTemplate={currentTemplate}
                onCurrentTemplateChange={setCurrentTemplate}
                templateStale={currentDoc?.templateStale ?? false}
              />
              <PrintNoteField value={printNote} onChange={setPrintNote} />
              {/* Fason talimatı editörü — yalnız güncel ACTIVE belgede, kilitli değilse.
                  Kaydet + Revize Et ile yeni versiyon donar; iframe o versiyonu gösterir. */}
              {!viewingOld && shown.status === "ACTIVE" && overlay && (
                <InstructionEditor
                  dispatchId={dispatchId}
                  value={overlay.instruction}
                  stepNote={overlay.stepNote}
                  locked={overlay.instructionLocked}
                  stationName={shown.snapshot.doc.step.station.name}
                />
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
              {htmlQuery.isLoading ? (
                <div className="p-4">
                  <Skeleton className="h-64 w-full" />
                </div>
              ) : html ? (
                <iframe
                  title="Fason Çeki Önizleme"
                  srcDoc={html}
                  className="h-full w-full border-0 bg-white"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Belge yüklenemedi.
                </div>
              )}
            </div>
          </>
        )}

        <DialogFooter className="sm:justify-between">
          {onBack ? (
            <Button
              type="button"
              variant="outline"
              className="gap-1 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" /> Belgeler'e Dön
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Kapat
            </Button>
            <Button
              type="button"
              className="gap-1"
              disabled={!html}
              onClick={() => html && printHtmlString(html)}
            >
              <Printer className="h-4 w-4" /> Yazdır
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Fason talimatı düzenleyici — `.print-area` DIŞINDA durur, baskıya girmez.
 * Kaydedince overlay query'sini invalidate eder; aşağıdaki fişte not güncel
 * görünür. Bu alan sevkin KENDİ notunu (override) düzenler; boş bırakılırsa
 * fişte sevkin adımının notu (`stepNote`) basılır.
 */
function InstructionEditor({
  dispatchId,
  value,
  stepNote,
  locked,
  stationName,
}: {
  dispatchId: string;
  value: string | null;
  stepNote: string | null;
  locked: boolean;
  stationName: string;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(value ?? "");
  const title = fasonNoteLabel(stationName);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value, dispatchId]);

  const mutation = useMutation({
    mutationFn: (note: string | null) =>
      workOrderService.updateDispatchInstruction(dispatchId, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-overlay", dispatchId] });
      toast.success(`${title} kaydedildi`);
    },
  });

  const trimmed = draft.trim();
  const dirty = trimmed !== (value ?? "").trim();

  return (
    <div className="mb-3 rounded-md border bg-background p-3">
      <div className="mb-1 flex items-center justify-between">
        <label
          htmlFor="fason-instruction"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {title}
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
        id="fason-instruction"
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={1000}
        disabled={locked}
        placeholder="Fasona talimat (örn. yıkama yapma, matlaştır)…"
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      />
      {locked ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Sevk kabul/iptal edilmiş — talimat kilitli, değiştirilemez.
        </p>
      ) : !trimmed && stepNote?.trim() ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Boş bırakılırsa adım talimatı basılır:{" "}
          <span className="font-medium text-orange-700">«{stepNote.trim()}»</span>
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Fişe işlenir ve baskıda görünür. Genel sevk notundan ayrıdır.
        </p>
      )}
    </div>
  );
}
