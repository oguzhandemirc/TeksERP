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
import { safeFormat } from "@/lib/format";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_LETTERHEAD } from "@/services/featureFlagService";
import { resolveDocConfig } from "@/services/documentConfig";
import {
  PrintLetterhead,
  SignatureBoxes,
  DocFooterNote,
  type DocSheetPreview,
} from "@/components/print/print-helpers";
import { kartelaService, type KartelaDispatchDetail } from "./service";

interface Props {
  dispatchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NUM = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/**
 * Kartela sevkinin yazdırılabilir çeki listesi. FasonSevkPrintDialog deseninin
 * aynası: canlı sevk detayını çeker, `.print-area` A4 fişi render eder,
 * `window.print()` ile çıktı alır (global @media print CSS yalnız .print-area'yı basar).
 */
export function KartelaCekiPrintDialog({ dispatchId, open, onOpenChange }: Props) {
  const query = useQuery({
    // Detay sheet ile AYNI key → açtığında cache'ten anında gelir.
    queryKey: ["kartela", "dispatch", dispatchId],
    queryFn: () => kartelaService.getDispatch(dispatchId!).then((r) => r.data),
    enabled: open && Boolean(dispatchId),
    staleTime: 5 * 60_000,
  });
  const d = query.data ?? undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Kartela Çeki Listesi</DialogTitle>
          <DialogDescription>
            Kartela firmasına gönderilen topların çeki listesi. "Yazdır" ile A4 çıktısı al.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto rounded-md border bg-muted/30 p-4">
          {query.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
          {!query.isLoading && !d && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Sevk bilgisi bulunamadı.
            </div>
          )}
          {d && <PrintableCeki d={d} />}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button type="button" className="gap-1" disabled={!d} onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PrintableCeki({
  d,
  preview,
}: {
  d: KartelaDispatchDetail;
  preview?: DocSheetPreview;
}) {
  const totalQty = d.items.reduce((s, it) => s + Number(it.dispatchedQty), 0);
  const totalWeight = d.items.reduce((s, it) => s + Number(it.dispatchedWeight ?? 0), 0);
  const flags = useFeatureFlags().data?.data;
  const cfg = preview?.cfg ?? resolveDocConfig(flags?.documentsConfig, "kartelaCeki");
  const companyName = preview?.companyName ?? flags?.companyName ?? DEFAULT_COMPANY_NAME;
  const letterhead = preview?.letterhead ?? flags?.companyLetterhead ?? DEFAULT_COMPANY_LETTERHEAD;
  return (
    <div className="print-area mx-auto max-w-[210mm] bg-white p-6 text-[12px] text-black">
      {cfg.showLetterhead && (
        <PrintLetterhead companyName={companyName} letterhead={letterhead} />
      )}
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-[18px] font-bold uppercase tracking-wide">{cfg.title}</div>
          <div className="mt-1 text-[11px]">
            Sevk No: <span className="font-mono font-semibold">{d.dispatchNo}</span>
          </div>
        </div>
        <div className="text-right text-[11px]">
          <div>
            Tarih:{" "}
            <span className="font-semibold">{safeFormat(d.dispatchedAt, "dd.MM.yyyy HH:mm")}</span>
          </div>
        </div>
      </div>

      {(cfg.sections.subcontractorInfo || cfg.sections.vehicleInfo) && (
        <div className="mt-3 grid grid-cols-2 gap-4 text-[12px]">
          {cfg.sections.subcontractorInfo && (
            <Section title="Kartela Firması">
              <Row label="Adı" value={d.subcontractor.name} />
              {d.subcontractor.code && <Row label="Kod" value={d.subcontractor.code} />}
            </Section>
          )}
          {cfg.sections.vehicleInfo && (
            <Section title="Sevk Bilgileri">
              <Row label="Plaka" value={d.plateNumber || "—"} />
              <Row label="Sürücü" value={d.driverName || "—"} />
              {d.notes && <Row label="Not" value={d.notes} />}
            </Section>
          )}
        </div>
      )}

      {d.cancelledAt && (
        <div className="mt-3 rounded border-2 border-black px-3 py-1 text-[12px] font-semibold">
          İPTAL EDİLDİ{d.cancelReason ? ` — ${d.cancelReason}` : ""}
        </div>
      )}

      {cfg.sections.rollTable && (
      <div className="mt-4">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">
          Gönderilen Toplar ({d.items.length})
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
            {d.items.map((it, i) => (
              <tr key={it.id} className="border-b border-gray-300">
                <Td className="text-center tabular-nums">{i + 1}</Td>
                <Td className="font-mono">{it.roll.barcode ?? "—"}</Td>
                <Td>
                  {it.roll.item.name}
                  {it.roll.color ? ` · ${it.roll.color.name}` : ""}
                </Td>
                <Td className="text-center tabular-nums">
                  {it.roll.width != null ? `${it.roll.width} cm` : "—"}
                </Td>
                <Td className="text-right tabular-nums">{NUM.format(Number(it.dispatchedQty))}</Td>
                <Td className="text-right tabular-nums">
                  {it.dispatchedWeight != null ? NUM.format(Number(it.dispatchedWeight)) : "—"}
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

