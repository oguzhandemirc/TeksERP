import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { printHtmlString } from "@/lib/print";
import {
  PrintPageSizeToggle,
  readDocPageSize,
  type DocPageSize,
} from "@/components/print/PrintPageSizeToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { DocVersionBar } from "@/components/print/DocVersionBar";
import { DispatchNoteEditor } from "./DispatchNoteEditor";
import {
  DispatchPrintOptions,
  DEFAULT_DISPATCH_PRINT_OPTS,
  DISPATCH_LISTS,
  type DispatchPrintOpts,
} from "./DispatchPrintOptions";
import { printedDocumentService, type PrintedDocument } from "@/services/printedDocumentService";

interface Props {
  shipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bu sevkiyattan sonra alınan (iptal edilmemiş) iadeler — çağıran zaten yüklü
   *  sevkiyat detayından geçirir (`summary.returnedCount/Meters`), ekstra istek yok.
   *  Verilmezse bant çıkmaz. */
  returns?: { count: number; meters: number };
}

const DOC_TYPE = "SHIPMENT_DISPATCH" as const;

const fmtM = (v: number) =>
  v.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * "Sevk sonrası iade" bandı — belge ile CANLI durumun neden ayrıştığını söyler.
 *
 * İrsaliye sevk anında DONAR ve iade onu değiştirmez (doğru davranış: müşteriye/
 * gümrüğe giden belge malın çıktığı anı gösterir, iade ayrı belgeyle kapanır).
 * Ama ekranda hiçbir işaret yoksa kullanıcı belgedeki metrajı listedeki/Excel'deki
 * canlı metrajla karşılaştırıp "hangisi doğru" diye takılıyor — üstelik versiyon
 * rozetindeki "Güncel" ifadesi "içerik güncel" diye okunuyor (aslında "en son
 * versiyon, hiç revize edilmedi" demek). Bant tam bu boşluğu kapatır.
 */
function ReturnsNotice({ returns }: { returns: { count: number; meters: number } }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs">
      <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <div className="min-w-0">
        <span className="font-medium">
          Bu belge sevk anına aittir — sonrasında {returns.count} top ({fmtM(returns.meters)} m)
          iade alınmıştır.
        </span>{" "}
        <span className="text-muted-foreground">
          İade belgedeki rakamlardan düşülmez (fatura irsaliyeden kesilir, iade ayrı
          belgeyle kapanır). Dökümü sevkiyat detayındaki “İadeler” bölümünde.
        </span>
      </div>
    </div>
  );
}

/**
 * Sevk İrsaliyesi — TEK KAYNAK: önizleme + baskı backend `renderShipmentDispatchHtml`
 * çıktısıdır (muhasebe "Sevk Fişi" ile BİREBİR aynı). Donmuş belge varsa resmî;
 * yoksa ?draft=1 ile canlı TASLAK. Versiyon çubuğu (revize/geçmiş) belge meta'sından.
 */
export function ShipmentDispatchNote({ shipmentId, open, onOpenChange, returns }: Props) {
  const { hasPermission } = useRoleAccess();
  const qc = useQueryClient();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  // "Güncel şablonla" — içerik donuk, görünüm canlı Belge Şablonları ayarından.
  const [currentTemplate, setCurrentTemplate] = useState(false);
  // Tek seferlik baskı seçenekleri (liste seçimi + sayfa birleştirme + çuval notu).
  // Hiçbiri Belge Kişiselleştirme ayarına ya da donmuş snapshot'a YAZILMAZ ve yeni
  // belge versiyonu doğurmaz; diyalog kapanınca sıfırlanır.
  const [printOpts, setPrintOpts] = useState<DispatchPrintOpts>(DEFAULT_DISPATCH_PRINT_OPTS);
  // Tek seferlik kâğıt boyu — `undefined` = belgenin kendi (donmuş) boyutu.
  // Sayfa boyutu freeze anında snapshot'a donduğu için ayar sonradan düzeltilse
  // bile eski irsaliyeler eski boyutta basılırdı; bu seçici donmuş katmana HİÇ
  // dokunmadan o baskıyı doğru kâğıda çıkarır (2026-09-10 saha).
  const [pageSize, setPageSize] = useState<DocPageSize | undefined>(undefined);
  const { sections, merge, rowNotes, rowTags } = printOpts;
  // Üçü de seçiliyse "seçim yok" demektir → backend kalıcı ayarı uygular.
  const sectionParam = sections.length === DISPATCH_LISTS.length ? undefined : sections;

  // Belge meta'sı (versiyon çubuğu + resmî/taslak ayrımı). data=null → TASLAK aşaması.
  const docQuery = useQuery({
    queryKey: ["printed-doc", DOC_TYPE, shipmentId],
    queryFn: () => printedDocumentService.getCurrent<unknown>(DOC_TYPE, shipmentId!),
    enabled: open && Boolean(shipmentId),
    // Resmî belge durumu başka istemciden değişebilir — her açılışta taze.
    staleTime: 0,
  });
  const currentDoc = (docQuery.data?.data ?? null) as PrintedDocument<unknown> | null;

  // Geçmişten seçilen eski versiyonun meta'sı (versiyon çubuğu rozeti için).
  const versionQuery = useQuery({
    queryKey: ["printed-doc", DOC_TYPE, shipmentId, "v", selectedVersion],
    queryFn: () => printedDocumentService.getVersion<unknown>(DOC_TYPE, shipmentId!, selectedVersion!),
    enabled: open && Boolean(shipmentId) && selectedVersion != null,
    staleTime: 30_000,
  });

  // Baskı/önizleme HTML'i (tek kaynak). Versiyon seçiliyse o versiyon; değilse
  // güncel (donmuş varsa resmî, yoksa ?draft=1 ile TASLAK).
  const htmlQuery = useQuery({
    queryKey: [
      "printed-doc-html",
      DOC_TYPE,
      shipmentId,
      selectedVersion,
      currentTemplate,
      rowNotes,
      rowTags,
      sections.join(","),
      merge,
      pageSize ?? "doc",
    ],
    queryFn: () =>
      selectedVersion != null
        ? printedDocumentService.getHtml(DOC_TYPE, shipmentId!, selectedVersion, {
            currentTemplate,
            rowNotes,
            rowTags,
            sections: sectionParam,
            merge,
            pageSize,
          })
        : printedDocumentService.getHtml(DOC_TYPE, shipmentId!, undefined, {
            draft: true,
            currentTemplate,
            rowNotes,
            rowTags,
            sections: sectionParam,
            merge,
            pageSize,
          }),
    enabled: open && Boolean(shipmentId),
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;

  /**
   * Belgenin KENDİ boyutu — "ezmesiz" düğmenin hangisi olduğunu belirler.
   * ⚠️ YALNIZ ezme YOKKEN okunur: ezmeli HTML'in `@page`i EZMEYİ yansıtır ve
   * onu belgenin boyutu sanmak düğmeyi kilitlerdi (dönüş yolu kalmaz).
   */
  const [docPageSize, setDocPageSize] = useState<DocPageSize | undefined>(undefined);
  useEffect(() => {
    if (pageSize) return;
    const read = readDocPageSize(html);
    if (read) setDocPageSize(read);
  }, [html, pageSize]);
  useEffect(() => {
    setPageSize(undefined);
    setDocPageSize(undefined);
  }, [shipmentId]);

  const shownMeta =
    selectedVersion != null
      ? ((versionQuery.data?.data ?? null) as PrintedDocument<unknown> | null)
      : currentDoc;

  const loading =
    htmlQuery.isLoading || docQuery.isLoading || (selectedVersion != null && versionQuery.isLoading);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[86vh] max-h-[86vh] max-w-5xl flex-col gap-3"
      >
        <DialogHeader>
          <DialogTitle>Sevk İrsaliyesi</DialogTitle>
        </DialogHeader>

        {!loading && shownMeta && shipmentId && (
          <DocVersionBar
            docType={DOC_TYPE}
            sourceId={shipmentId}
            current={shownMeta}
            activeVersion={currentDoc?.version ?? shownMeta.version}
            onSelectVersion={setSelectedVersion}
            canReissue={hasPermission("shipping:write")}
            reissueOnlyWhenReconstructed
            /* Sevk irsaliyesi içeriği sevk anında donar; sonradan düzenlenemez →
               normal revize aynı içeriği tekrar dondururdu. Tuş yalnız eski
               sistemden kalan geriye-dönük belgeyi resmîleştirmek için görünür. */
            currentTemplate={currentTemplate}
            onCurrentTemplateChange={setCurrentTemplate}
            templateStale={currentDoc?.templateStale ?? false}
          />
        )}
        {returns && returns.count > 0 && <ReturnsNotice returns={returns} />}
        {shipmentId && (
          <DispatchNoteEditor
            shipmentId={shipmentId}
            onSaved={() =>
              void qc.invalidateQueries({ queryKey: ["printed-doc-html", DOC_TYPE, shipmentId] })
            }
          />
        )}
        {/* Tek seferlik baskı seçenekleri — hepsi KALICI ayarı ezer, hiçbir yere
            yazılmaz. Bu diyalog sevk irsaliyesinin TEK baskı yeri; PrintedDocDialog'a
            SHIPMENT_DISPATCH hiç düşmüyor, o yüzden seçenekler burada. */}
        {shipmentId && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <DispatchPrintOptions
              value={printOpts}
              onChange={setPrintOpts}
              /* Çuval notu tiki yalnız çuval listesi basılacaksa anlamlı. */
              showRowNotes={sections.includes("cuval")}
              showRowTags={sections.includes("cuval")}
            />
            {!merge && sections.length > 1 && (
              <span className="text-[11px] text-muted-foreground">
                {sections.length} liste, her biri ayrı sayfada
              </span>
            )}
            {merge && (
              <span className="text-[11px] text-muted-foreground">
                Listeler aynı sayfada akıyor
              </span>
            )}
            {/* Kâğıt boyu diğer tek-seferlik seçeneklerin YANINDA duruyor —
                hepsi aynı rejimde (kalıcı ayara ve donmuş belgeye yazılmaz). */}
            <PrintPageSizeToggle
              value={pageSize}
              onChange={setPageSize}
              docPageSize={docPageSize}
              disabled={!html || htmlQuery.isFetching}
              label="Kâğıt:"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {loading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : html ? (
            <iframe
              title="Sevk İrsaliyesi Önizleme"
              srcDoc={html}
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Belge yüklenemedi.
            </div>
          )}
        </div>

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
