import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { printHtmlString } from "@/lib/print";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { DocVersionBar } from "@/components/print/DocVersionBar";
import { DispatchNoteEditor } from "./DispatchNoteEditor";
import { printedDocumentService, type PrintedDocument } from "@/services/printedDocumentService";

interface Props {
  shipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DOC_TYPE = "SHIPMENT_DISPATCH" as const;

/**
 * Sevk İrsaliyesi — TEK KAYNAK: önizleme + baskı backend `renderShipmentDispatchHtml`
 * çıktısıdır (muhasebe "Sevk Fişi" ile BİREBİR aynı). Donmuş belge varsa resmî;
 * yoksa ?draft=1 ile canlı TASLAK. Versiyon çubuğu (revize/geçmiş) belge meta'sından.
 */
export function ShipmentDispatchNote({ shipmentId, open, onOpenChange }: Props) {
  const { hasPermission } = useRoleAccess();
  const qc = useQueryClient();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  // "Güncel şablonla" — içerik donuk, görünüm canlı Belge Şablonları ayarından.
  const [currentTemplate, setCurrentTemplate] = useState(false);

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
    queryKey: ["printed-doc-html", DOC_TYPE, shipmentId, selectedVersion, currentTemplate],
    queryFn: () =>
      selectedVersion != null
        ? printedDocumentService.getHtml(DOC_TYPE, shipmentId!, selectedVersion, {
            currentTemplate,
          })
        : printedDocumentService.getHtml(DOC_TYPE, shipmentId!, undefined, {
            draft: true,
            currentTemplate,
          }),
    enabled: open && Boolean(shipmentId),
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
        {shipmentId && (
          <DispatchNoteEditor
            shipmentId={shipmentId}
            onSaved={() =>
              void qc.invalidateQueries({ queryKey: ["printed-doc-html", DOC_TYPE, shipmentId] })
            }
          />
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
