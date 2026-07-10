import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
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
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

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
    queryKey: ["printed-doc-html", DOC_TYPE, shipmentId, selectedVersion],
    queryFn: () =>
      selectedVersion != null
        ? printedDocumentService.getHtml(DOC_TYPE, shipmentId!, selectedVersion)
        : printedDocumentService.getHtml(DOC_TYPE, shipmentId!, undefined, { draft: true }),
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
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Sevk İrsaliyesi</DialogTitle>
          <DialogDescription>
            {currentDoc
              ? "Sevk anında dondurulan resmi belge. Düzeltme için 'Revize Et'."
              : "Sevkiyat henüz sevk edilmedi — taslak önizleme (sevk edilince resmî belge donar)."}
          </DialogDescription>
        </DialogHeader>

        {!loading && shownMeta && shipmentId && (
          <DocVersionBar
            docType={DOC_TYPE}
            sourceId={shipmentId}
            current={shownMeta}
            activeVersion={currentDoc?.version ?? shownMeta.version}
            onSelectVersion={setSelectedVersion}
            canReissue={hasPermission("shipping:write")}
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
