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
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { resolveDocConfig } from "@/services/documentConfig";
import { DocWatermark } from "@/components/print/print-helpers";
import { DocVersionBar } from "@/components/print/DocVersionBar";
import {
  printedDocumentService,
  type PrintedDocument,
} from "@/services/printedDocumentService";
import { shipmentService } from "./service";
import type { ShipmentDetail } from "./types";
import { NUM, NoteHeader, ItemTable, SackBreakdown, Section, Row, type ShipmentDoc } from "./shipment-note-parts";
import { ShipmentFrozenSheet } from "./ShipmentFrozenSheet";

interface Props {
  shipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DOC_TYPE = "SHIPMENT_DISPATCH" as const;

export function ShipmentDispatchNote({ shipmentId, open, onOpenChange }: Props) {
  const { hasPermission } = useRoleAccess();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  // Resmi belge (DISPATCHED'da donmuş). data=null → sevkiyat henüz TASLAK aşamasında.
  const docQuery = useQuery({
    queryKey: ["printed-doc", DOC_TYPE, shipmentId],
    queryFn: () => printedDocumentService.getCurrent<ShipmentDoc>(DOC_TYPE, shipmentId!),
    enabled: open && Boolean(shipmentId),
    staleTime: 30_000,
  });
  const currentDoc = docQuery.data?.data ?? null;

  // Geçmişten seçilen eski versiyon (varsa) — ayrı snapshot çek.
  const versionQuery = useQuery({
    queryKey: ["printed-doc", DOC_TYPE, shipmentId, "v", selectedVersion],
    queryFn: () =>
      printedDocumentService.getVersion<ShipmentDoc>(DOC_TYPE, shipmentId!, selectedVersion!),
    enabled: open && Boolean(shipmentId) && selectedVersion != null,
    staleTime: 30_000,
  });

  // TASLAK önizleme — belge yoksa canlı detaydan (henüz resmi değil).
  const draftQuery = useQuery({
    queryKey: ["shipment-detail", shipmentId],
    queryFn: () => shipmentService.getDetail(shipmentId!),
    enabled: open && Boolean(shipmentId) && !docQuery.isLoading && currentDoc === null,
    staleTime: 30_000,
  });

  const shown: PrintedDocument<ShipmentDoc> | null =
    selectedVersion != null ? (versionQuery.data?.data ?? null) : currentDoc;

  const loading =
    docQuery.isLoading ||
    (selectedVersion != null && versionQuery.isLoading) ||
    (currentDoc === null && draftQuery.isLoading);

  const draft = currentDoc === null ? draftQuery.data?.data : undefined;

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

        <div className="flex-1 overflow-auto rounded-md border bg-muted/30 p-4">
          {loading && <Skeleton className="h-64 w-full" />}

          {!loading && shown && shipmentId && (
            <>
              <DocVersionBar
                docType={DOC_TYPE}
                sourceId={shipmentId}
                current={shown}
                activeVersion={currentDoc?.version ?? shown.version}
                onSelectVersion={setSelectedVersion}
                canReissue={hasPermission("shipping:write")}
              />
              <ShipmentFrozenSheet
                doc={shown.snapshot.doc}
                companyName={shown.snapshot.company.name}
                letterhead={shown.snapshot.company.letterhead}
                docConfigOverride={shown.snapshot.docConfigOverride}
                voided={shown.status === "VOIDED"}
              />
            </>
          )}

          {!loading && currentDoc === null && draft && <DraftSheet d={draft} />}

          {!loading && !shown && !draft && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {currentDoc !== null ? "Belge bulunamadı." : "Sevkiyat bulunamadı."}
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
            disabled={!shown && !draft}
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Taslak sheet — sevk öncesi canlı detaydan, TASLAK filigranlı (donmuş belge ile
// aynı parçaları paylaşır; satır metrajı canlı `thisShipment`'tan gelir).
function DraftSheet({ d }: { d: ShipmentDetail }) {
  const cfg = resolveDocConfig(undefined, "shipmentDispatch");
  const lines = d.orders.flatMap((o) =>
    o.lines
      .filter((l) => l.thisShipment > 0)
      .map((l) => ({
        key: l.lineId,
        orderNumber: o.orderNumber,
        itemName: l.customerItemName ?? l.item.name,
        colorName: l.color ? (l.customerColorName ?? l.color.name) : null,
        width: l.width,
        qty: l.thisShipment,
      })),
  );
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const docDate = d.dispatchedAt ?? d.readyAt ?? null;

  return (
    <div className="print-area relative mx-auto max-w-[210mm] bg-white p-6 text-[12px] text-black">
      <DocWatermark text="TASLAK" tone="draft" />
      <NoteHeader title={cfg.title} no={d.shipmentNo} date={docDate} />

      <div className="mt-3 grid grid-cols-2 gap-4">
        <Section title="Müşteri">
          <Row label="Adı" value={d.customer.name} />
          {d.branch && <Row label="Şube" value={d.branch.name} />}
        </Section>
        <Section title="Sevk Bilgileri">
          <Row label="Plaka" value={d.plateNumber || "—"} />
          <Row label="Sürücü" value={d.driverName || "—"} />
          <Row label="Taşıyıcı" value={d.carrier || "—"} />
        </Section>
      </div>

      <ItemTable lines={lines} totalQty={totalQty} />

      {d.sacks.length > 0 && (
        <SackBreakdown
          sacks={d.sacks.map((s) => ({
            seq: s.seq,
            manualCode: null,
            weightKg: s.weightKg,
            productSummary: s.productSummary.map((p) => ({
              itemName: p.itemName,
              colorName: p.colorName,
              width: p.width,
              totalQty: p.totalQty,
              rollCount: p.rollCount,
            })),
            swatches: s.swatches.map((sw) => ({
              itemName: sw.item?.name ?? null,
              colorName: sw.color?.name ?? null,
              width: sw.width,
              length: sw.length,
            })),
          }))}
          totalKg={d.summary.totalKg}
        />
      )}

      <div className="mt-2 text-[11px]">
        <span className="font-semibold">Top sayısı:</span> {d.summary.rollCount} ·{" "}
        <span className="font-semibold">Toplam metraj:</span>{" "}
        {NUM.format(d.summary.totalMeters)} m
      </div>
    </div>
  );
}
