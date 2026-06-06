import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Save } from "lucide-react";
import { toast } from "sonner";
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
import { workOrderService, type DispatchPrintSnapshot } from "./service";

interface Props {
  dispatchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NUM_FMT = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

export function FasonSevkPrintDialog({ dispatchId, open, onOpenChange }: Props) {
  const query = useQuery({
    queryKey: ["dispatch-print", dispatchId],
    queryFn: () => workOrderService.getDispatchPrintSnapshot(dispatchId!),
    enabled: open && Boolean(dispatchId),
    staleTime: 5 * 60_000,
  });

  const snap = query.data?.data as DispatchPrintSnapshot | undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Fason Sevk İrsaliyesi</DialogTitle>
          <DialogDescription>
            Sevk anında dondurulan kayıt. "Yazdır" ile A4 çıktısı al.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto rounded-md border bg-muted/30 p-4">
          {query.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
          {!query.isLoading && !snap && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Sevk bilgisi bulunamadı.
            </div>
          )}
          {snap && (
            <DyehouseNoteEditor
              dispatchId={dispatchId!}
              value={snap.dyehouseNote}
              woValue={snap.woDyehouseNote}
              locked={snap.dyehouseNoteLocked}
            />
          )}
          {snap && <PrintableSheet snap={snap} />}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button
            type="button"
            className="gap-1"
            disabled={!snap}
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Boyahane notu düzenleyici — `.print-area` DIŞINDA durur, baskıya girmez.
 * Kaydedince print snapshot query'sini invalidate eder; aşağıdaki fişte not
 * güncel görünür. Bu alan sevkin KENDİ notunu (override) düzenler; boş
 * bırakılırsa fişte iş emrindeki boyahane notu (`woValue`) basılır.
 */
function DyehouseNoteEditor({
  dispatchId,
  value,
  woValue,
  locked,
}: {
  dispatchId: string;
  value: string | null;
  woValue: string | null;
  locked: boolean;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(value ?? "");

  // Başka kayıt açıldığında / sunucudan güncel not geldiğinde alanı eşitle.
  useEffect(() => {
    setDraft(value ?? "");
  }, [value, dispatchId]);

  const mutation = useMutation({
    mutationFn: (note: string | null) =>
      workOrderService.updateDispatchDyehouseNote(dispatchId, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-print", dispatchId] });
      toast.success("Boyahane notu kaydedildi");
    },
  });

  const trimmed = draft.trim();
  const dirty = trimmed !== (value ?? "").trim();

  return (
    <div className="mb-3 rounded-md border bg-background p-3">
      <div className="mb-1 flex items-center justify-between">
        <label
          htmlFor="dyehouse-note"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Boyahane Notu
        </label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 gap-1"
          disabled={locked || !dirty || mutation.isPending}
          onClick={() => mutation.mutate(trimmed || null)}
        >
          <Save className="h-3.5 w-3.5" />
          {mutation.isPending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>
      <textarea
        id="dyehouse-note"
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={1000}
        disabled={locked}
        placeholder="Boyahaneye talimat (örn. yıkama yapma, matlaştır)…"
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      />
      {locked ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Sevk kabul/iptal edilmiş — boyahane notu kilitli, değiştirilemez.
        </p>
      ) : !trimmed && woValue?.trim() ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Boş bırakılırsa iş emrindeki boyahane notu basılır:{" "}
          <span className="font-medium text-orange-700">«{woValue.trim()}»</span>
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Fişe işlenir ve baskıda görünür. Genel sevk notundan ayrıdır.
        </p>
      )}
    </div>
  );
}

function PrintableSheet({ snap }: { snap: DispatchPrintSnapshot }) {
  // Efektif boyahane notu: sevkin kendi notu (override) → yoksa WO notu (default).
  const dyehouseNote = snap.dyehouseNote ?? snap.woDyehouseNote;
  return (
    <div className="print-area mx-auto max-w-[210mm] bg-white p-6 text-[12px] text-black">
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-[18px] font-bold uppercase tracking-wide">
            Fason Sevk İrsaliyesi
          </div>
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
            İş Emri:{" "}
            <span className="font-mono font-semibold">
              {snap.workOrder.batchNumber}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4 text-[12px]">
        <Section title="Fason Firma">
          <Row label="Adı" value={snap.subcontractor.name} />
          {snap.subcontractor.code && (
            <Row label="Kod" value={snap.subcontractor.code} />
          )}
          <Row
            label="İstasyon"
            value={`${snap.step.station.name} (Adım ${snap.step.stepSequence})`}
          />
        </Section>
        <Section title="Sevk Bilgileri">
          <Row label="Plaka" value={snap.plateNumber || "—"} />
          <Row label="Sürücü" value={snap.driverName || "—"} />
          {snap.notes && <Row label="Not" value={snap.notes} />}
        </Section>
      </div>

      <div className="mt-3 rounded border-2 border-black bg-gray-100 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-700">
          İstenen Renk
        </div>
        {snap.requestedColor ? (
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-[16px] font-bold uppercase">
              {snap.requestedColor.name}
            </span>
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

      {dyehouseNote && (
        <div className="mt-3 rounded border-2 border-black px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-700">
            Boyahane Notu
          </div>
          <div className="mt-0.5 whitespace-pre-wrap text-[12px] font-medium">
            {dyehouseNote}
          </div>
        </div>
      )}

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
              <tr key={r.rollId} className="border-b border-gray-300">
                <Td className="text-center tabular-nums">{i + 1}</Td>
                <Td className="font-mono">{r.barcode ?? "—"}</Td>
                <Td>{r.itemName ?? "—"}</Td>
                <Td className="text-center tabular-nums">
                  {r.width != null ? `${r.width} cm` : "—"}
                </Td>
                <Td className="text-right tabular-nums">
                  {NUM_FMT.format(r.dispatchedQty)}
                </Td>
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

      <div className="mt-10 grid grid-cols-3 gap-6 text-[11px]">
        <SignatureBox label="Sevkeden" />
        <SignatureBox label="Sürücü" />
        <SignatureBox label="Teslim Alan" />
      </div>
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

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
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

function SignatureBox({ label }: { label: string }) {
  return (
    <div>
      <div className="text-gray-600">{label}</div>
      <div className="mt-8 border-b border-black" />
      <div className="mt-1 text-center text-[10px] text-gray-600">Ad-Soyad / İmza</div>
    </div>
  );
}
