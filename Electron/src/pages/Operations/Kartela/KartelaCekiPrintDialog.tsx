import { useState, useRef } from "react";
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
import { printDocumentArea } from "@/lib/print";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { DocVersionBar } from "@/components/print/DocVersionBar";
import {
  printedDocumentService,
  type PrintedDocument,
} from "@/services/printedDocumentService";
import { PrintableCeki, type KartelaDispatchDoc } from "./KartelaCekiSheet";

export { PrintableCeki } from "./KartelaCekiSheet";

interface Props {
  dispatchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DOC_TYPE = "KARTELA_DISPATCH" as const;

/**
 * Kartela sevkinin yazdırılabilir çeki listesi — sevk anında dondurulan resmi
 * belge (PrintedDocument). İçerik düzeltmesi için "Revize Et" (yeni versiyon).
 */
export function KartelaCekiPrintDialog({ dispatchId, open, onOpenChange }: Props) {
  const printRef = useRef<HTMLDivElement>(null); // Y3: izole iframe baskısının kök alanı
  const { hasPermission } = useRoleAccess();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const docQuery = useQuery({
    queryKey: ["printed-doc", DOC_TYPE, dispatchId],
    queryFn: () => printedDocumentService.getCurrent<KartelaDispatchDoc>(DOC_TYPE, dispatchId!),
    enabled: open && Boolean(dispatchId),
    // K-A2 fix: belge durumu başka istemciden değişir — 5dk cache iptal edilmiş
    // belgeyi İPTAL filigransız bastırabiliyordu.
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
  const loading = docQuery.isLoading || (selectedVersion != null && versionQuery.isLoading);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Kartela Çeki Listesi</DialogTitle>
          <DialogDescription>
            Sevk anında dondurulan resmi belge. Düzeltme için "Revize Et".
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
          {!loading && shown && dispatchId && (
            <>
              <DocVersionBar
                docType={DOC_TYPE}
                sourceId={dispatchId}
                current={shown}
                activeVersion={currentDoc?.version ?? shown.version}
                onSelectVersion={setSelectedVersion}
                canReissue={hasPermission("kartela:write")}
              />
              <PrintableCeki
                doc={shown.snapshot.doc}
                companyName={shown.snapshot.company.name}
                letterhead={shown.snapshot.company.letterhead}
                docConfigOverride={shown.snapshot.docConfigOverride}
                voided={shown.status === "VOIDED"}
                superseded={shown.status === "SUPERSEDED"}
                docNo={shown.documentNo}
                docVersion={shown.version}
              />
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button type="button" className="gap-1" disabled={!shown} onClick={() => printDocumentArea(printRef.current)}>
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
