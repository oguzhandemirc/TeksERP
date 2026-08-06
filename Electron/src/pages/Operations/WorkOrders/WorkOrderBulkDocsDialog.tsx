import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, Info, Printer, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BULK_DOC_LABELS,
  BULK_DOC_LIMIT,
  BULK_DOC_ORDER,
  countByType,
  fetchDocHtmls,
  printDocs,
  savePdfDocs,
  scanWorkOrderDocuments,
  selectRows,
  type BulkDocType,
  type BulkWorkOrder,
} from "./bulkDocs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tabloda SEÇİLİ iş emirleri. */
  workOrders: BulkWorkOrder[];
  /** Baskı/PDF sonrası tablo seçimini temizlemek için. */
  onDone?: () => void;
}

/**
 * TOPLU BELGE — seçili iş emirlerinin istenen belgelerini tek seferde çıkarır.
 *
 * Belge listesi iş emri başına `GET /work-orders/:id/documents` ile TEK KAYNAKTAN
 * gelir; bu ekran hangi belgelerin var olduğunu kendisi VARSAYMAZ — tip kutuları
 * gerçekten bulunan belgelerden doğar ("Fason Kabul Makbuzu (0)" seçilemez).
 *
 * İki çıkış yolu bilinçli olarak farklıdır:
 *   • YAZDIR → tek baskı işi (40 belge için 40 yazıcı diyaloğu tıklanmaz).
 *   • PDF    → her belge ayrı dosya; her biri kendi penceresinde render edilir,
 *              yani tekil baskıyla bire bir aynı. Arşiv/e-posta yolu budur.
 */
export function WorkOrderBulkDocsDialog({ open, onOpenChange, workOrders, onDone }: Props) {
  const ids = workOrders.map((w) => w.id);
  const [scanned, setScanned] = useState(0);
  const [types, setTypes] = useState<Set<BulkDocType>>(new Set());
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [busy, setBusy] = useState<{ mode: "print" | "pdf"; done: number; total: number } | null>(null);

  const scan = useQuery({
    queryKey: ["work-order-documents-bulk", ids.join(",")],
    queryFn: () => scanWorkOrderDocuments(workOrders, (done) => setScanned(done)),
    enabled: open && ids.length > 0,
    staleTime: 15_000,
  });

  const rows = useMemo(() => scan.data?.rows ?? [], [scan.data]);
  const counts = useMemo(() => countByType(rows, includeCancelled), [rows, includeCancelled]);

  // Varsayılan seçim: belgesi olan İLK tip (pratikte refakat kartı). Yalnız
  // diyalog açılışında / yeni tarama geldiğinde kurulur.
  // ⚠️ "types boşsa doldur" YAZILMAZ: kullanıcı tüm kutuları kapattığında seçim
  // geri sıçrar ve hiçbir şeyi kapatamaz.
  useEffect(() => {
    if (!open || !scan.data) return;
    const c = countByType(scan.data.rows, false);
    const first = BULK_DOC_ORDER.find((t) => c[t] > 0);
    setTypes(new Set(first ? [first] : []));
  }, [open, scan.data]);

  useEffect(() => {
    if (!open) {
      setScanned(0);
      setBusy(null);
    }
  }, [open]);

  const selected = useMemo(
    () => selectRows(rows, types, includeCancelled),
    [rows, types, includeCancelled],
  );
  const overLimit = selected.length > BULK_DOC_LIMIT;

  const toggle = (t: BulkDocType) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const run = async (mode: "print" | "pdf") => {
    if (selected.length === 0 || overLimit) return;
    setBusy({ mode, done: 0, total: selected.length });
    try {
      const { docs, failed } = await fetchDocHtmls(selected, (done, total) =>
        setBusy({ mode, done, total }),
      );
      if (docs.length === 0) {
        toast.error(`Belge alınamadı${failed[0] ? ` — ${failed[0].error}` : ""}.`);
        return;
      }
      // Alınamayan belgeler AYRI söylenir: "N belge basıldı" deyip sebebini
      // yutmak, en kötü davranış.
      if (failed.length) {
        toast.warning(
          `${failed.length} belge alınamadı (${failed[0]!.row.doc.documentNo}${failed.length > 1 ? " ve diğerleri" : ""}): ${failed[0]!.error}`,
        );
      }

      if (mode === "print") {
        const res = await printDocs(docs);
        if (res.unmergeable.length) {
          toast.warning(
            `${res.unmergeable.length} belge bu baskıya eklenemedi (özel şablon) — tek tek yazdırın.`,
          );
        }
        if (res.printed === 0) return; // hepsi elendi — yukarıdaki uyarı sebebi söyledi
        toast.success(
          `${res.printed} belge yazdırmaya gönderildi${res.sizes.length > 1 ? ` — dikkat: ${res.sizes.join(" + ")} karışık` : ""}.`,
        );
      } else {
        const res = await savePdfDocs(docs);
        if (res.ok) toast.success(`${res.count ?? docs.length} belge PDF olarak kaydedildi.`);
        else if (res.error) toast.error(res.error);
        else return; // kullanıcı kaydet/klasör diyaloğunu iptal etti — sessiz.
      }
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error)?.message ?? "Belgeler çıkarılamadı.");
    } finally {
      setBusy(null);
    }
  };

  const empties = scan.data?.emptyWorkOrders ?? [];
  const failedScans = scan.data?.failed ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Toplu Belge Çıkar</DialogTitle>
          <DialogDescription>
            {workOrders.length} iş emri seçildi. Çıkarmak istediğiniz belge türlerini işaretleyin.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {scan.isLoading ? (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Belgeler taranıyor… {scanned}/{workOrders.length} iş emri
              </div>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : scan.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              Belgeler taranamadı: {(scan.error as Error)?.message}
            </div>
          ) : (
            <>
              <ul className="space-y-1.5">
                {BULK_DOC_ORDER.map((t) => (
                  <li key={t}>
                    <label
                      className={
                        "flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm " +
                        (counts[t] === 0 ? "cursor-not-allowed opacity-50" : "hover:bg-muted/50")
                      }
                    >
                      <Checkbox
                        checked={types.has(t)}
                        disabled={counts[t] === 0}
                        onCheckedChange={() => toggle(t)}
                      />
                      <span className="flex-1 font-medium">{BULK_DOC_LABELS[t]}</span>
                      <span className="tabular-nums text-muted-foreground">{counts[t]} belge</span>
                    </label>
                  </li>
                ))}
              </ul>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={includeCancelled}
                  onCheckedChange={(v) => setIncludeCancelled(Boolean(v))}
                />
                İptal edilmiş belgeleri de dahil et (İPTAL filigranıyla basılır)
              </label>

              {empties.length > 0 && (
                <Note icon={Info}>
                  {empties.length} iş emrinin hiç belgesi yok:{" "}
                  <span className="font-mono">
                    {empties.slice(0, 6).map((w) => w.workOrderNumber).join(", ")}
                    {empties.length > 6 ? ` … (+${empties.length - 6})` : ""}
                  </span>
                </Note>
              )}
              {failedScans.length > 0 && (
                <Note icon={TriangleAlert} tone="warn">
                  {failedScans.length} iş emrinin belge listesi alınamadı (
                  {failedScans[0]!.wo.workOrderNumber}: {failedScans[0]!.error})
                </Note>
              )}
              {overLimit && (
                <Note icon={TriangleAlert} tone="warn">
                  Seçim çok büyük ({selected.length} belge). Tek işte en fazla {BULK_DOC_LIMIT}{" "}
                  belge çıkarılır — daha az iş emri ya da daha az belge türü seçin.
                </Note>
              )}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 items-center justify-between gap-3 border-t px-6 py-4 sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {busy
              ? `Belgeler hazırlanıyor… ${busy.done}/${busy.total}`
              : `${selected.length} belge seçildi`}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={Boolean(busy)}>
              Kapat
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={selected.length === 0 || overLimit || Boolean(busy)}
              onClick={() => void run("pdf")}
              title="Her belge ayrı PDF dosyası olarak seçtiğiniz klasöre yazılır."
            >
              <FileDown className="h-4 w-4" /> PDF Kaydet
            </Button>
            <Button
              className="gap-1.5"
              disabled={selected.length === 0 || overLimit || Boolean(busy)}
              onClick={() => void run("print")}
              title="Tüm belgeler tek baskı işinde, her biri kendi sayfasında."
            >
              <Printer className="h-4 w-4" /> Yazdır
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Note({
  icon: Icon,
  tone = "info",
  children,
}: {
  icon: typeof Info;
  tone?: "info" | "warn";
  children: ReactNode;
}) {
  return (
    <div
      className={
        "flex items-start gap-2 rounded-md border p-3 text-xs " +
        (tone === "warn"
          ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
          : "text-muted-foreground")
      }
    >
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
