import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { DocVersionBar } from "@/components/print/DocVersionBar";
import { PrintNoteField } from "@/components/print/PrintNoteField";
import { PrintedDocToolbar, RowFlagCheck } from "@/components/print/PrintedDocToolbar";
import { readDocPageSize, type DocPageSize } from "@/components/print/PrintPageSizeToggle";
import {
  printedDocumentService,
  type PrintedDocType,
  type PrintedDocument,
} from "@/services/printedDocumentService";
import { DOC_DEFS, DOC_TYPE_TO_KEY } from "@/services/documentConfig";

// =============================================================================
// Generic resmi belge görüntüleyici — herhangi bir PrintedDocType + sourceId için
// önizleme + versiyon çubuğu + tek araç çubuğu (yazdır / indir / baskı seçenekleri).
// =============================================================================
// Belge türüne ÖZGÜ kalemler (Excel, toplu etiket, iade uyarısı, liste seçimi)
// buraya GÖMÜLMEZ: slot olarak sayfa katmanından gelir. Aksi hâlde jenerik
// bileşen tek tek belge türlerini tanır ve `components/print/` → `pages/…`
// yönünde ters bağımlılık doğardı.
// =============================================================================

/** Sayfa katmanının sahiplendiği tek-seferlik render parametreleri. Bir anahtar
 *  verildiğinde o parametrenin YERLEŞİK kontrolü çizilmez — iki kutucuk aynı
 *  bayrağı sürerse kullanıcı hangisinin geçerli olduğunu bilemez. */
export interface PrintedDocPrintParams {
  sections?: string[];
  merge?: boolean;
  rowNotes?: boolean;
  rowTags?: boolean;
}

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
  /** "Revize Et" YALNIZ geriye-dönük (ya da şablonu bayat) belgede çıksın. */
  reissueOnlyWhenReconstructed?: boolean;
  /** "Yazdır ▾" menüsüne ek kalemler. */
  toolbarPrintMenu?: ReactNode;
  /** "İndir ▾" menüsüne ek kalemler. */
  toolbarDownloads?: ReactNode;
  /** "Baskı seçenekleri ▾" popover'ına ek gövde. */
  optionsExtras?: ReactNode;
  /** Önizlemenin üstündeki bilgi şeridi (iade uyarısı, belge notu…). */
  infoBar?: ReactNode;
  /** Sayfa katmanının sürdüğü ek tek-seferlik render parametreleri. */
  printParams?: PrintedDocPrintParams;
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
  reissueOnlyWhenReconstructed = false,
  toolbarPrintMenu,
  toolbarDownloads,
  optionsExtras,
  infoBar,
  printParams,
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
  // Tek seferlik kâğıt boyu — `undefined` = belgenin kendi (donmuş) boyutu.
  // Sayfa boyutu freeze anında snapshot'a donduğu için, ayar sonradan
  // düzeltilse bile eski belgeler eski boyutta basılırdı; bu seçici donmuş
  // katmana HİÇ dokunmadan o baskıyı doğru kâğıda çıkarır (2026-09-10 saha:
  // A5 ayarı A4 kâğıda küçük basıyordu).
  const [pageSize, setPageSize] = useState<DocPageSize | undefined>(undefined);
  const docDef = DOC_DEFS.find((d) => d.key === DOC_TYPE_TO_KEY[docType]);
  // Sayfa katmanı bayrağı sahiplendiyse yerleşik kutucuk çizilmez (çift sürücü).
  const ownRowNotes = docDef?.supportsRowNotes === true && printParams?.rowNotes === undefined;
  const ownRowTags = docDef?.supportsRowTags === true && printParams?.rowTags === undefined;

  const htmlOpts = {
    currentTemplate,
    printNote: debouncedNote,
    rowNotes: printParams?.rowNotes ?? rowNotes,
    rowTags: printParams?.rowTags ?? rowTags,
    sections: printParams?.sections,
    merge: printParams?.merge,
    pageSize,
  };

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
    queryKey: ["printed-doc-html", docType, sourceId, selectedVersion, JSON.stringify(htmlOpts)],
    queryFn: () =>
      selectedVersion != null
        ? printedDocumentService.getHtml(docType, sourceId!, selectedVersion, htmlOpts)
        : printedDocumentService.getHtml(docType, sourceId!, undefined, { draft: allowDraft, ...htmlOpts }),
    enabled: open && Boolean(sourceId),
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;

  /**
   * Belgenin KENDİ (donmuş/ayarlı) boyutu — "ezmesiz" düğmenin hangisi olduğunu
   * belirler.
   *
   * ⚠️ YALNIZ ezme YOKKEN okunur ve akılda tutulur: ezmeli HTML'in `@page`
   * kuralı EZMEYİ yansıtır, onu belgenin boyutu sanmak düğmeyi kilitlerdi
   * (A5 belge → A4 seç → A4 "kendi boyutu" olur → A5'e dönüş yolu kalmaz).
   */
  const [docPageSize, setDocPageSize] = useState<DocPageSize | undefined>(undefined);
  useEffect(() => {
    if (pageSize) return;
    const read = readDocPageSize(html);
    if (read) setDocPageSize(read);
  }, [html, pageSize]);
  // Başka bir belgeye geçildiğinde ezme de okunan boyut da sıfırlanır — aksi
  // hâlde A5 belgede seçilen A4, sonraki belgeye sessizce taşınırdı.
  useEffect(() => {
    setPageSize(undefined);
    setDocPageSize(undefined);
  }, [sourceId]);

  const shownMeta =
    selectedVersion != null
      ? ((versionQuery.data?.data ?? null) as PrintedDocument<unknown> | null)
      : currentDoc;
  const loading =
    htmlQuery.isLoading || docQuery.isLoading || (selectedVersion != null && versionQuery.isLoading);

  const optionsContent = (
    <>
      <PrintNoteField value={printNote} onChange={setPrintNote} />
      {ownRowNotes && (
        <RowFlagCheck
          id="row-notes"
          checked={rowNotes}
          onChange={setRowNotes}
          icon={<MessageSquareText className="h-3.5 w-3.5" />}
          label="Çuval notlarını bu baskıda göster"
          hint="Kalıcı ayar değişmez; notu olan çuval yoksa etkisi yok."
        />
      )}
      {ownRowTags && (
        <RowFlagCheck
          id="row-tags"
          checked={rowTags}
          onChange={setRowTags}
          icon={<Tag className="h-3.5 w-3.5" />}
          label="Çuval izlerini (etiket) bu baskıda göster"
          hint="Bu belge müşteriye gider; kalıcı ayar değişmez."
        />
      )}
      {optionsExtras}
      <p className="border-t pt-2 text-[10px] leading-relaxed text-muted-foreground">
        Seçimler yalnız bu baskı içindir — belge ayarına kaydedilmez ve yeni belge
        versiyonu doğurmaz.
      </p>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[90vh] max-h-[90vh] max-w-5xl flex-col gap-3"
      >
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
            reissueOnlyWhenReconstructed={reissueOnlyWhenReconstructed}
            currentTemplate={currentTemplate}
            onCurrentTemplateChange={setCurrentTemplate}
            templateStale={currentDoc?.templateStale ?? false}
          />
        )}

        {sourceId && (
          <PrintedDocToolbar
            html={html}
            fileName={`${title}-${shownMeta?.documentNo ?? ""}`}
            fetching={htmlQuery.isFetching}
            printMenu={toolbarPrintMenu}
            downloads={toolbarDownloads}
            optionsContent={optionsContent}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            docPageSize={docPageSize}
          />
        )}

        {infoBar}

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
      </DialogContent>
    </Dialog>
  );
}
