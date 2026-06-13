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
import { safeFormat } from "@/lib/format";

const NUM = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/** Donmuş kartela çeki listesindeki tek top satırı. */
export interface KartelaDocRoll {
  sequence: number;
  id: string;
  barcode: string | null;
  itemCode: string | null;
  itemName: string | null;
  colorCode: string | null;
  colorName: string | null;
  dispatchedQty: number;
  dispatchedWeight: number | null;
  qualityGrade: string;
  width: number | null;
}

/** Donmuş kartela çeki listesi payload'ı (PrintedDocument.snapshot.doc). */
export interface KartelaDispatchDoc {
  dispatchNo: string;
  dispatchedAt: string;
  driverName: string | null;
  plateNumber: string | null;
  notes: string | null;
  subcontractor: { id: string; name: string; code: string | null };
  rolls: KartelaDocRoll[];
  totals: { rollCount: number; totalQty: number; totalWeight: number };
}

// =============================================================================
// Donmuş kartela çeki listesi sheet'i. `preview` verilirse config/künye taslak
// ayardan gelir (Belge Şablonları önizlemesi); aksi halde snapshot'tan.
// =============================================================================
export function PrintableCeki({
  doc,
  companyName,
  letterhead,
  docConfigOverride,
  voided = false,
  superseded = false,
  docNo,
  docVersion,
  preview,
}: {
  doc: KartelaDispatchDoc;
  companyName?: string;
  letterhead?: CompanyLetterhead;
  docConfigOverride?: DocumentConfig | null;
  voided?: boolean;
  /** Y4: revize edilmis eski versiyon — kagida REVIZE filigrani basilir. */
  superseded?: boolean;
  /** Y4: PrintedDocument.documentNo — kagit uzerinde belge kimligi. */
  docNo?: string | null;
  docVersion?: number | null;
  preview?: DocSheetPreview;
}) {
  const cfg = preview
    ? preview.cfg
    : resolveDocConfig(
        docConfigOverride ? { kartelaCeki: docConfigOverride } : undefined,
        "kartelaCeki",
      );
  const company = preview ? preview.companyName : (companyName ?? DEFAULT_COMPANY_NAME);
  const lh = preview ? preview.letterhead : (letterhead ?? DEFAULT_COMPANY_LETTERHEAD);
  const totalQty = doc.totals.totalQty;
  const totalWeight = doc.totals.totalWeight;

  return (
    <div className="print-area relative mx-auto max-w-[210mm] bg-white p-6 text-[12px] text-black">
      {voided && <DocWatermark text="İPTAL" tone="void" />}
      {/* Y4: eski versiyon guncel resmi belgeyle karistirilmasin — kagitta gorunur iz */}
      {!voided && superseded && <DocWatermark text="REVİZE EDİLDİ" tone="superseded" />}
      {docNo != null && (
        <div className="absolute right-6 top-2 text-[9px] text-neutral-500">
          Belge No: {docNo}
          {docVersion != null ? ` · Rev.${docVersion}` : ""}
        </div>
      )}
      {cfg.showLetterhead && <PrintLetterhead companyName={company} letterhead={lh} />}
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-[18px] font-bold uppercase tracking-wide">{cfg.title}</div>
          <div className="mt-1 text-[11px]">
            Sevk No: <span className="font-mono font-semibold">{doc.dispatchNo}</span>
          </div>
        </div>
        <div className="text-right text-[11px]">
          <div>
            Tarih:{" "}
            <span className="font-semibold">{safeFormat(doc.dispatchedAt, "dd.MM.yyyy HH:mm")}</span>
          </div>
        </div>
      </div>

      {(cfg.sections.subcontractorInfo || cfg.sections.vehicleInfo) && (
        <div className="mt-3 grid grid-cols-2 gap-4 text-[12px]">
          {cfg.sections.subcontractorInfo && (
            <Section title="Kartela Firması">
              <Row label="Adı" value={doc.subcontractor.name} />
              {doc.subcontractor.code && <Row label="Kod" value={doc.subcontractor.code} />}
            </Section>
          )}
          {cfg.sections.vehicleInfo && (
            <Section title="Sevk Bilgileri">
              <Row label="Plaka" value={doc.plateNumber || "—"} />
              <Row label="Sürücü" value={doc.driverName || "—"} />
              {doc.notes && <Row label="Not" value={doc.notes} />}
            </Section>
          )}
        </div>
      )}

      {cfg.sections.rollTable && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">
            Gönderilen Toplar ({doc.rolls.length})
          </div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b-2 border-black">
                <Th className="w-10 text-center">#</Th>
                <Th>Barkod</Th>
                <Th>Ürün / Renk</Th>
                <Th className="text-center">En</Th>
                <Th className="text-right">Metre</Th>
                <Th className="text-right">Kg</Th>
              </tr>
            </thead>
            <tbody>
              {doc.rolls.map((r, i) => (
                <tr key={r.id} className="border-b border-gray-300">
                  <Td className="text-center tabular-nums">{i + 1}</Td>
                  <Td className="font-mono">{r.barcode ?? "—"}</Td>
                  <Td>
                    {r.itemName ?? "—"}
                    {r.colorName ? ` · ${r.colorName}` : ""}
                  </Td>
                  <Td className="text-center tabular-nums">
                    {r.width != null ? `${r.width} cm` : "—"}
                  </Td>
                  <Td className="text-right tabular-nums">{NUM.format(r.dispatchedQty)}</Td>
                  <Td className="text-right tabular-nums">
                    {r.dispatchedWeight != null ? NUM.format(r.dispatchedWeight) : "—"}
                  </Td>
                </tr>
              ))}
              <tr className="border-t-2 border-black font-semibold">
                <Td colSpan={4} className="text-right">
                  TOPLAM
                </Td>
                <Td className="text-right tabular-nums">{NUM.format(totalQty)} m</Td>
                <Td className="text-right tabular-nums">
                  {totalWeight > 0 ? `${NUM.format(totalWeight)} kg` : "—"}
                </Td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {cfg.showSignatures && <SignatureBoxes labels={cfg.signatureLabels} />}
      <DocFooterNote note={cfg.footerNote} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-gray-300 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[70px_1fr] gap-x-2">
      <span className="text-gray-600">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-1.5 py-1 text-left text-[10px] font-semibold uppercase ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td className={`px-1.5 py-1 ${className}`} colSpan={colSpan}>
      {children}
    </td>
  );
}
