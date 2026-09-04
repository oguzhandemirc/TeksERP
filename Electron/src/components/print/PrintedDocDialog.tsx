import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText, Printer, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { printHtmlString } from "@/lib/print";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { DocVersionBar } from "@/components/print/DocVersionBar";
import { PrintNoteField } from "@/components/print/PrintNoteField";
import { PdfSaveButton } from "@/components/print/PdfSaveButton";
import {
  printedDocumentService,
  type PrintedDocType,
  type PrintedDocument,
} from "@/services/printedDocumentService";
import { DOC_DEFS, DOC_TYPE_TO_KEY } from "@/services/documentConfig";

// =============================================================================
// Generic resmi belge görüntüleyici — herhangi bir PrintedDocType + sourceId için
// önizleme + versiyon çubuğu + "güncel şablon" + tek-seferlik baskı notu + yazdır/PDF.
// ShipmentDispatchNote'un docType-agnostik hali; yeni belgeler tek bileşenle bağlanır.
// =============================================================================

interface Props {
  docType: PrintedDocType;
  sourceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Revizyon (Revize Et) için gereken modül yazma izni. */
  writePermission: string;
  /** Kaynak henüz donmamışken canlı TASLAK önizlemesine izin ver (sevk öncesi). */
  allowDraft?: boolean;
}

export function PrintedDocDialog({
  docType,
  sourceId,
  open,
  onOpenChange,
  title,
  description,
  writePermission,
  allowDraft = false,
}: Props) {
  const { hasPermission } = useRoleAccess();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [currentTemplate, setCurrentTemplate] = useState(false);
  const [printNote, setPrintNote] = useState("");
  const debouncedNote = useDebouncedValue(printNote, 400);
  // Tek seferlik "çuval yorumlarını bu baskıda göster" — Belge Kişiselleştirme'deki
  // kalıcı kolon ayarını EZER (OR). Hiçbir yere yazılmaz: diyalog kapanınca sıfırlanır,
  // sonraki baskı yine kalıcı ayara döner, belge versiyonu doğurmaz.
  const [rowNotes, setRowNotes] = useState(false);
  // Tek seferlik "çuval izlerini (etiket) göster" — AYRI kutucuk, AYRI bayrak.
  // ⚠️ `rowNotes` ile birleştirilmez: iz iç takip işaretidir ve bu belge MÜŞTERİYE
  // gider; tek kutucuk "notu bas" diyene sessizce izleri de bastırırdı.
  const [rowTags, setRowTags] = useState(false);
  const docDef = DOC_DEFS.find((d) => d.key === DOC_TYPE_TO_KEY[docType]);
  const supportsRowNotes = docDef?.supportsRowNotes ?? false;
  const supportsRowTags = docDef?.supportsRowTags ?? false;

  const docQuery = useQuery({
    queryKey: ["printed-doc", docType, sourceId],
    queryFn: () => printedDocumentService.getCurrent<unknown>(docType, sourceId!),
    enabled: open && Boolean(sourceId),
    staleTime: 0,
  });
  const currentDoc = (docQuery.data?.data ?? null) as PrintedDocument<unknown> | null;

  const versionQuery = useQuery({
    queryKey: ["printed-doc", docType, sourceId, "v", selectedVersion],
    queryFn: () => printedDocumentService.getVersion<unknown>(docType, sourceId!, selectedVersion!),
    enabled: open && Boolean(sourceId) && selectedVersion != null,
    staleTime: 30_000,
  });

  const htmlQuery = useQuery({
    queryKey: ["printed-doc-html", docType, sourceId, selectedVersion, currentTemplate, debouncedNote, rowNotes, rowTags],
    queryFn: () =>
      selectedVersion != null
        ? printedDocumentService.getHtml(docType, sourceId!, selectedVersion, { currentTemplate, printNote: debouncedNote, rowNotes, rowTags })
        : printedDocumentService.getHtml(docType, sourceId!, undefined, { draft: allowDraft, currentTemplate, printNote: debouncedNote, rowNotes, rowTags }),
    enabled: open && Boolean(sourceId),
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;

  const shownMeta =
    selectedVersion != null
      ? ((versionQuery.data?.data ?? null) as PrintedDocument<unknown> | null)
      : currentDoc;
  const loading =
    htmlQuery.isLoading || docQuery.isLoading || (selectedVersion != null && versionQuery.isLoading);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {!loading && shownMeta && sourceId && (
          <DocVersionBar
            docType={docType}
            sourceId={sourceId}
            current={shownMeta}
            activeVersion={currentDoc?.version ?? shownMeta.version}
            onSelectVersion={setSelectedVersion}
            canReissue={hasPermission(writePermission)}
            currentTemplate={currentTemplate}
            onCurrentTemplateChange={setCurrentTemplate}
            templateStale={currentDoc?.templateStale ?? false}
          />
        )}
        {!loading && sourceId && <PrintNoteField value={printNote} onChange={setPrintNote} />}
        {!loading && sourceId && supportsRowNotes && (
          <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={rowNotes}
              onChange={(e) => setRowNotes(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <MessageSquareText className="h-3.5 w-3.5" />
            Çuval notlarını bu baskıda göster
            <span className="text-[10px]">(kalıcı ayar değişmez; notu olan çuval yoksa etkisi yok)</span>
          </label>
        )}
        {!loading && sourceId && supportsRowTags && (
          <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={rowTags}
              onChange={(e) => setRowTags(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <Tag className="h-3.5 w-3.5" />
            Çuval izlerini (etiket) bu baskıda göster
            <span className="text-[10px]">(bu belge müşteriye gider; kalıcı ayar değişmez)</span>
          </label>
        )}

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {loading ? (
            <div className="p-4"><Skeleton className="h-64 w-full" /></div>
          ) : html ? (
            <iframe title={`${title} Önizleme`} srcDoc={html} className="h-full w-full border-0 bg-white" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Belge henüz hazır değil.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <PdfSaveButton html={html} fileName={`${title}-${shownMeta?.documentNo ?? ""}`} disabled={!html} />
          <Button type="button" className="gap-1" disabled={!html} onClick={() => html && printHtmlString(html)}>
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
