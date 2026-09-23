import { useState, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, PackageCheck, Printer, ScanLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { printHtmlString } from "@/lib/print";
import { printedDocumentService } from "@/services/printedDocumentService";
import { sackStoreService } from "./service";
import { invalidateSackHub } from "@/pages/Operations/SackContentEdit/useSackData";

const DEC = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

/** Sevk onayının ihtiyacı olan asgari sevkiyat kimliği — her yüzey kendi tipinden eşler. */
export interface DispatchShipmentInfo {
  id: string;
  shipmentNo: string;
  customerName: string;
  branchName?: string | null;
}

interface Props {
  shipment: DispatchShipmentInfo | null;
  onOpenChange: (open: boolean) => void;
  /**
   * Başarıda çağrılır — cache tazeleme bileşen içinde, tek yerde yapılır.
   * DİKKAT: dialog başarıda KAPANMAZ (irsaliye baskı paneli gösterilir);
   * çağıran burada listesini güncellesin ama shipment prop'unu null'lamasın —
   * kapanış onOpenChange(false) ile gelir.
   */
  onDispatched?: (id: string) => void;
  /**
   * Kapıda okutulmuş çuval kodları (sackNo veya manuel kod). Verilirse eşleşen
   * çuvallar ✓ ile işaretlenir ve X/Y sayacı görünür; verilmez/boşsa "okutulmadan
   * sevk" notu çıkar (soft doğrulama — bloklamaz).
   */
  scannedCodes?: string[];
  /** Kapanışta odak buraya döner (okutma kutusu) — operatör fare aramadan devam eder. */
  returnFocusRef?: RefObject<HTMLInputElement | null>;
}

const norm = (s: string) => s.trim().toUpperCase();

/**
 * ORTAK sevk onayı — yıkıcı (stok düşer, terminal, geri alınamaz). Üç yüzey de
 * bunu kullanır: Sevk Kapısı kartı, kapı okutması, Paketleme footer'ı. CLAUDE.md
 * kuralı gereği etkilenecek her çuval CANLI çekilir (`sack-contents`, gcTime 0)
 * ve somut listelenir; döküm yüklenmeden onay verilemez. Taşıma bilgileri
 * (plaka/şoför/nakliyeci) opsiyonel.
 */
export function DispatchConfirmDialog({
  shipment,
  onOpenChange,
  onDispatched,
  scannedCodes,
  returnFocusRef,
}: Props) {
  const qc = useQueryClient();
  const open = !!shipment;
  const [plateNumber, setPlateNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [carrier, setCarrier] = useState("");
  // Sevk başarılı → onay yerine başarı paneli (kamyon irsaliyesiz çıkamaz:
  // sevk eden operatör belgeyi EKRAN DEĞİŞTİRMEDEN basar).
  const [done, setDone] = useState<{ id: string; shipmentNo: string } | null>(null);

  const reset = () => {
    setPlateNumber("");
    setDriverName("");
    setCarrier("");
    setDone(null);
  };

  const contentsQ = useQuery({
    queryKey: ["dispatch-confirm", shipment?.id],
    queryFn: () => sackStoreService.shipmentContents(shipment!.id),
    enabled: open && !done,
    gcTime: 0,
  });
  const contents = contentsQ.data?.data;

  const scannedSet = new Set((scannedCodes ?? []).map(norm));
  const isScanned = (sack: { sackNo: string }) =>
    scannedSet.has(norm(sack.sackNo));

  const scannedCount = contents ? contents.sacks.filter(isScanned).length : 0;
  const allScanned = !!contents && contents.sackCount > 0 && scannedCount === contents.sackCount;
  const totalQty = contents?.sacks.reduce((acc, s) => acc + s.totalQty, 0) ?? 0;
  const totalKg = contents?.sacks.reduce((acc, s) => acc + (s.weightKg ?? 0), 0) ?? 0;

  const dispatchMut = useMutation({
    mutationFn: () =>
      sackStoreService.dispatch(shipment!.id, {
        plateNumber: plateNumber.trim() || null,
        driverName: driverName.trim() || null,
        carrier: carrier.trim() || null,
      }),
    onSuccess: () => {
      toast.success(`Sevk edildi: ${shipment!.shipmentNo}`);
      const id = shipment!.id;
      // Dispatch stok düşürür (toplar SHIPPED) ve sevkiyat/sipariş durumlarını
      // değiştirir — dokunan tüm ekranların cache'i TEK yerden tazelenir (O1).
      void qc.invalidateQueries({ queryKey: ["sack-store"] });
      void qc.invalidateQueries({ queryKey: ["sack-search"] });
      // Sevk/iptal/geri al partiyi kapatır ya da yeniden açar — parti listesi dahil hub ailesi (K16).
      invalidateSackHub(qc);
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["shipment-detail", id] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      setDone({ id, shipmentNo: shipment!.shipmentNo });
      onDispatched?.(id);
    },
  });

  // İrsaliye sevkte dondu (freezeForSource) — güncel sürümün HTML'i basılır.
  const printMut = useMutation({
    mutationFn: async () => {
      const html = await printedDocumentService.getHtml("SHIPMENT_DISPATCH", done!.id);
      printHtmlString(html);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (dispatchMut.isPending) return; // çift-tık/kaza kapanma kilidi
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-lg overflow-y-auto"
        onCloseAutoFocus={(e) => {
          if (returnFocusRef?.current) {
            e.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" /> Sevk edildi — {done.shipmentNo}
              </DialogTitle>
              <DialogDescription>
                Stok düşüldü ve sevk irsaliyesi dondu. Kamyon çıkmadan irsaliyeyi basın.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Kapat
              </Button>
              <Button disabled={printMut.isPending} onClick={() => printMut.mutate()}>
                {printMut.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="mr-1 h-4 w-4" />
                )}
                İrsaliyeyi Bas
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Sevk Et — {shipment?.shipmentNo}</DialogTitle>
              <DialogDescription>
                {shipment?.customerName}
                {shipment?.branchName ? ` · ${shipment.branchName}` : ""} — bu sevkiyat çıkış yapacak,
                içindeki topların stoğu <strong>düşecek</strong> ve bu işlem <strong>geri alınamaz</strong>.
                Aşağıdaki çuvalların yüklendiğini doğrulayın.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {contentsQ.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : contents ? (
                <div className="rounded-md border">
                  <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span>
                      {contents.sackCount} çuval · {DEC.format(totalQty)} m
                      {totalKg > 0 ? ` · ${DEC.format(totalKg)} kg` : ""}
                    </span>
                    {scannedSet.size > 0 && (
                      <span
                        className={cn(
                          "flex items-center gap-1 tabular-nums",
                          allScanned ? "font-semibold text-emerald-600" : "text-amber-600",
                        )}
                      >
                        <ScanLine className="h-3.5 w-3.5" />
                        {scannedCount}/{contents.sackCount} okutuldu
                        {allScanned ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                      </span>
                    )}
                  </div>
                  <ul className="max-h-56 divide-y overflow-y-auto text-sm">
                    {contents.sacks.map((s) => {
                      const scanned = isScanned(s);
                      return (
                        <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                          <span className="flex min-w-0 items-center gap-1.5 font-mono">
                            {scannedSet.size > 0 &&
                              (scanned ? (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                              ) : (
                                <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/50" />
                              ))}
                            <span className="truncate">{s.sackNo}</span>
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {s.rollCount} top · {DEC.format(s.totalQty)} m
                            {s.weightKg != null ? ` · ${DEC.format(s.weightKg)} kg` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {scannedSet.size === 0 && (
                    <div className="border-t bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                      Çuvallar okutulmadan sevk ediliyor — listeyi fiziksel yükle karşılaştırın.
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-destructive">
                  Çuval dökümü yüklenemedi — döküm görülmeden sevk onaylanamaz.
                </p>
              )}

              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs">
                  <span className="block text-muted-foreground">Plaka (opsiyonel)</span>
                  <Input
                    className="mt-1"
                    value={plateNumber}
                    onChange={(e) => setPlateNumber(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  <span className="block text-muted-foreground">Şoför (opsiyonel)</span>
                  <Input
                    className="mt-1"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  <span className="block text-muted-foreground">Nakliyeci (opsiyonel)</span>
                  <Input className="mt-1" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
                </label>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button variant="outline" disabled={dispatchMut.isPending} onClick={() => onOpenChange(false)}>
                İptal
              </Button>
              <Button
                variant="destructive"
                disabled={dispatchMut.isPending || contentsQ.isLoading || !contents}
                onClick={() => dispatchMut.mutate()}
              >
                {dispatchMut.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <PackageCheck className="mr-1 h-4 w-4" />
                )}
                Sevk Et
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
