import {
  resolveDocConfig,
  DEFAULT_COMPANY_LETTERHEAD,
  type CompanyLetterhead,
  type DocumentConfig,
} from "@/services/documentConfig";
import { DEFAULT_COMPANY_NAME } from "@/services/featureFlagService";
import {
  PrintLetterhead,
  SignatureBoxes,
  DocFooterNote,
  DocWatermark,
  type DocSheetPreview,
} from "@/components/print/print-helpers";
import {
  NUM,
  NoteHeader,
  ItemTable,
  SackBreakdown,
  Section,
  Row,
  type ShipmentDoc,
} from "./shipment-note-parts";

// =============================================================================
// Donmuş sevk irsaliyesi sheet'i — snapshot.doc + DONMUŞ config/künye'den render.
// `preview` verilirse (Belge Şablonları canlı önizlemesi) config/künye taslak
// ayardan gelir; aksi halde snapshot'taki donmuş değerlerden. Yasal kayıt yolu.
// =============================================================================
export function ShipmentFrozenSheet({
  doc,
  companyName,
  letterhead,
  docConfigOverride,
  voided = false,
  preview,
}: {
  doc: ShipmentDoc;
  companyName?: string;
  letterhead?: CompanyLetterhead;
  docConfigOverride?: DocumentConfig | null;
  voided?: boolean;
  preview?: DocSheetPreview;
}) {
  const cfg = preview
    ? preview.cfg
    : resolveDocConfig(
        docConfigOverride ? { shipmentDispatch: docConfigOverride } : undefined,
        "shipmentDispatch",
      );
  const company = preview ? preview.companyName : (companyName ?? DEFAULT_COMPANY_NAME);
  const lh = preview ? preview.letterhead : (letterhead ?? DEFAULT_COMPANY_LETTERHEAD);
  const docDate = doc.dispatchedAt ?? doc.readyAt ?? null;
  const totalQty = doc.lines.reduce((s, l) => s + l.qty, 0);

  return (
    <div className="print-area relative mx-auto max-w-[210mm] bg-white p-6 text-[12px] text-black">
      {voided && <DocWatermark text="İPTAL" tone="void" />}
      {cfg.showLetterhead && <PrintLetterhead companyName={company} letterhead={lh} />}
      <NoteHeader title={cfg.title} no={doc.shipmentNo} date={docDate} />

      {(cfg.sections.customerInfo || cfg.sections.vehicleInfo) && (
        <div className="mt-3 grid grid-cols-2 gap-4">
          {cfg.sections.customerInfo && (
            <Section title="Müşteri">
              <Row label="Adı" value={doc.customer.name} />
              {doc.branch && <Row label="Şube" value={doc.branch.name} />}
            </Section>
          )}
          {cfg.sections.vehicleInfo && (
            <Section title="Sevk Bilgileri">
              <Row label="Plaka" value={doc.plateNumber || "—"} />
              <Row label="Sürücü" value={doc.driverName || "—"} />
              <Row label="Taşıyıcı" value={doc.carrier || "—"} />
            </Section>
          )}
        </div>
      )}

      {cfg.sections.itemTable && (
        <ItemTable
          lines={doc.lines.map((l) => ({
            key: l.lineId,
            orderNumber: l.orderNumber,
            itemName: l.itemName,
            colorName: l.colorName,
            width: l.width,
            qty: l.qty,
          }))}
          totalQty={totalQty}
        />
      )}

      {cfg.sections.sackBreakdown && doc.sacks.length > 0 && (
        <SackBreakdown sacks={doc.sacks} totalKg={doc.summary.totalKg} />
      )}

      {cfg.sections.totals && (
        <div className="mt-2 text-[11px]">
          <span className="font-semibold">Top sayısı:</span> {doc.summary.rollCount} ·{" "}
          <span className="font-semibold">Toplam metraj:</span>{" "}
          {NUM.format(doc.summary.totalMeters)} m
        </div>
      )}

      {cfg.showSignatures && <SignatureBoxes labels={cfg.signatureLabels} />}
      <DocFooterNote note={cfg.footerNote} />
    </div>
  );
}
