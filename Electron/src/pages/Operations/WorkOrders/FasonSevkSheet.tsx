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
import type { FasonDispatchDoc } from "./service";

const NUM_FMT = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/** Donmuş içerik (FasonDispatchDoc) + CANLI talimat overlay'i (renk + boya notu). */
export interface FasonSheetData extends FasonDispatchDoc {
  requestedColor: { id: string; code: string; name: string; hex: string | null } | null;
  /** Efektif boyahane notu (sevkin kendi notu → yoksa WO notu). */
  dyehouseNote: string | null;
}

// =============================================================================
// Donmuş fason sevk irsaliyesi sheet'i. Donmuş içerik snapshot'tan; istenen renk
// + boyahane notu CANLI overlay (talimat alanları). `preview` verilirse config/künye
// taslak ayardan gelir (Belge Şablonları önizlemesi).
// =============================================================================
export function PrintableSheet({
  snap,
  companyName,
  letterhead,
  docConfigOverride,
  voided = false,
  preview,
}: {
  snap: FasonSheetData;
  companyName?: string;
  letterhead?: CompanyLetterhead;
  docConfigOverride?: DocumentConfig | null;
  voided?: boolean;
  preview?: DocSheetPreview;
}) {
  const cfg = preview
    ? preview.cfg
    : resolveDocConfig(
        docConfigOverride ? { fasonSevk: docConfigOverride } : undefined,
        "fasonSevk",
      );
  const company = preview ? preview.companyName : (companyName ?? DEFAULT_COMPANY_NAME);
  const lh = preview ? preview.letterhead : (letterhead ?? DEFAULT_COMPANY_LETTERHEAD);
  const dyehouseNote = snap.dyehouseNote;

  return (
    <div className="print-area relative mx-auto max-w-[210mm] bg-white p-6 text-[12px] text-black">
      {voided && <DocWatermark text="İPTAL" tone="void" />}
      {cfg.showLetterhead && <PrintLetterhead companyName={company} letterhead={lh} />}
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-[18px] font-bold uppercase tracking-wide">{cfg.title}</div>
          <div className="mt-1 text-[11px]">
            Sevk No: <span className="font-mono font-semibold">{snap.dispatchNo}</span>
          </div>
        </div>
        <div className="text-right text-[11px]">
          <div>
            Tarih:{" "}
            <span className="font-semibold">
              {safeFormat(snap.dispatchedAt, "dd.MM.yyyy HH:mm")}
            </span>
          </div>
          <div>
            İş Emri: <span className="font-mono font-semibold">{snap.workOrder.batchNumber}</span>
          </div>
        </div>
      </div>

      {(cfg.sections.subcontractorInfo || cfg.sections.vehicleInfo) && (
        <div className="mt-3 grid grid-cols-2 gap-4 text-[12px]">
          {cfg.sections.subcontractorInfo && (
            <Section title="Fason Firma">
              <Row label="Adı" value={snap.subcontractor.name} />
              {snap.subcontractor.code && <Row label="Kod" value={snap.subcontractor.code} />}
              <Row
                label="İstasyon"
                value={`${snap.step.station.name} (Adım ${snap.step.stepSequence})`}
              />
            </Section>
          )}
          {cfg.sections.vehicleInfo && (
            <Section title="Sevk Bilgileri">
              <Row label="Plaka" value={snap.plateNumber || "—"} />
              <Row label="Sürücü" value={snap.driverName || "—"} />
              {snap.notes && <Row label="Not" value={snap.notes} />}
            </Section>
          )}
        </div>
      )}

      {cfg.sections.requestedColor && (
        <div className="mt-3 rounded border-2 border-black bg-gray-100 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-700">
            İstenen Renk
          </div>
          {snap.requestedColor ? (
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-[16px] font-bold uppercase">{snap.requestedColor.name}</span>
              <span className="font-mono text-[11px] text-gray-600">
                ({snap.requestedColor.code})
              </span>
            </div>
          ) : (
            <div className="mt-0.5 text-[12px] italic text-gray-600">
              İş emrinde hedef renk belirtilmemiş.
            </div>
          )}
        </div>
      )}

      {cfg.sections.dyehouseNote && dyehouseNote && (
        <div className="mt-3 rounded border-2 border-black px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-700">
            Boyahane Notu
          </div>
          <div className="mt-0.5 whitespace-pre-wrap text-[12px] font-medium">{dyehouseNote}</div>
        </div>
      )}

      {cfg.sections.rollTable && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">
            Sevk Edilen Toplar ({snap.totals.rollCount})
          </div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b-2 border-black">
                <Th className="w-10 text-center">#</Th>
                <Th>Barkod</Th>
                <Th>Ürün</Th>
                <Th className="text-center">En</Th>
                <Th className="text-right">Metre</Th>
              </tr>
            </thead>
            <tbody>
              {snap.rolls.map((r, i) => (
                <tr key={r.id} className="border-b border-gray-300">
                  <Td className="text-center tabular-nums">{i + 1}</Td>
                  <Td className="font-mono">{r.barcode ?? "—"}</Td>
                  <Td>{r.itemName ?? "—"}</Td>
                  <Td className="text-center tabular-nums">
                    {r.width != null ? `${r.width} cm` : "—"}
                  </Td>
                  <Td className="text-right tabular-nums">{NUM_FMT.format(r.dispatchedQty)}</Td>
                </tr>
              ))}
              <tr className="border-t-2 border-black font-semibold">
                <Td colSpan={4} className="text-right">
                  TOPLAM
                </Td>
                <Td className="text-right tabular-nums">
                  {NUM_FMT.format(snap.totals.totalQty)} m
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
