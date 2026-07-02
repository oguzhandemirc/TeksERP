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
import {
  printedDocumentService,
  type PrintedDocument,
} from "@/services/printedDocumentService";
import { type KartelaDispatchDoc } from "./kartela-doc.types";

interface Props {
  dispatchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DOC_TYPE = "KARTELA_DISPATCH" as const;

/**
 * Kartela çeki listesi — ÖNİZLEME = BASKI = MOBİL (tek kaynak). Hem ekran
 * önizlemesi hem baskı backend `renderKartelaCekiHtml` çıktısını (iframe srcDoc /
 * printHtmlString) kullanır. Sevk anında dondurulan resmi belge; içerik düzeltmesi
 * için "Revize Et" (yeni versiyon donar).
 */
export function KartelaCekiPrintDialog({ dispatchId, open, onOpenChange }: Props) {
  const { hasPermission } = useRoleAccess();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  // Donmuş içerik meta'sı (versiyon çubuğu + ACTIVE/VOIDED/SUPERSEDED).
  const docQuery = useQuery({
    queryKey: ["printed-doc", DOC_TYPE, dispatchId],
    queryFn: () => printedDocumentService.getCurrent<KartelaDispatchDoc>(DOC_TYPE, dispatchId!),
    enabled: open && Boolean(dispatchId),
    staleTime: 0,
  });
  const currentDoc = docQuery.data?.data ?? null;

  const versionQuery = useQuery({
    queryKey: ["printed-doc", DOC_TYPE, dispatchId, "v", selectedVersion],
    queryFn: () =>
      printedDocumentService.getVersion<KartelaDispatchDoc>(DOC_TYPE, dispatchId!, selectedVersion!),
    enabled: open && Boolean(dispatchId) && selectedVersion != null,
    staleTime: 30_000,
  });

  const shown: PrintedDocument<KartelaDispatchDoc> | null =
    selectedVersion != null ? (versionQuery.data?.data ?? null) : currentDoc;
  const shownVersion = shown?.version ?? null;

  // ÖNİZLEME + BASKI tek kaynak: donmuş versiyonun backend HTML'i.
  const htmlQuery = useQuery({
    queryKey: ["printed-doc-html", DOC_TYPE, dispatchId, shownVersion],
    queryFn: () => printedDocumentService.getHtml(DOC_TYPE, dispatchId!, shownVersion ?? undefined),
    enabled: open && Boolean(dispatchId) && shownVersion != null,
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;

  const loading = docQuery.isLoading || (selectedVersion != null && versionQuery.isLoading);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Kartela Çeki Listesi</DialogTitle>
          <DialogDescription>
            Sevk anında dondurulan resmi belge — önizleme baskıyla birebir aynı. Düzeltme
            için "Revize Et".
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
            <div className="shrink-0">
              <DocVersionBar
                docType={DOC_TYPE}
                sourceId={dispatchId}
                current={shown}
                activeVersion={currentDoc?.version ?? shown.version}
                onSelectVersion={setSelectedVersion}
                canReissue={hasPermission("kartela:write")}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
              {htmlQuery.isLoading ? (
                <div className="p-4">
                  <Skeleton className="h-64 w-full" />
                </div>
              ) : html ? (
                <iframe
                  title="Kartela Çeki Önizleme"
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
