import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Printer } from "lucide-react";
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
import { printDocumentArea } from "@/lib/print";
import { sackSearchService } from "./service";
import { shipmentStatusLabels, type PickListRow } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("tr-TR") : "—");

interface Props {
  /** Basılacak çuval id'leri — null ise dialog kapalı. */
  sackIds: string[] | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Çeki listesi baskısı — seçilen çuvalların SAHADA ARANACAK dökümü. Çalışma
 * kağıdıdır (resmi/donmuş belge DEĞİL — PrintedDocument'a girmez): operatör
 * kağıtla depoya gider, bulduğu çuvalın kutusunu işaretler/üstünü çizer.
 * Çuval etiketi basılmaya başlanınca aynı iş Sevk Kapısı'nda okutma sayacıyla
 * yapılır — bu kağıt o güne kadarki köprüdür.
 */
export function PickListPrintDialog({ sackIds, onOpenChange }: Props) {
  const open = !!sackIds && sackIds.length > 0;
  const printRef = useRef<HTMLDivElement>(null);

  const fetchMut = useMutation({
    mutationFn: (ids: string[]) => sackSearchService.pickList(ids),
  });

  // Dialog açılınca dökümü çek (her açılışta taze — bayat kg/içerik basılmasın).
  useEffect(() => {
    if (open && sackIds) fetchMut.mutate(sackIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stabil; yalnız açılışta
  }, [open, sackIds?.join(",")]);

  const rows: PickListRow[] = fetchMut.data?.data ?? [];
  const totalQty = rows.reduce((a, r) => a + r.totalQty, 0);
  const totalKg = rows.reduce((a, r) => a + (r.weightKg ?? 0), 0);
  const totalRolls = rows.reduce((a, r) => a + r.rollCount, 0);
  const customers = [...new Set(rows.map((r) => r.shipment.customer.name))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Çeki Listesi — {rows.length || sackIds?.length || 0} çuval</DialogTitle>
          <DialogDescription>
            Sahada aranacak çuvalların dökümü. Yazdırıp depoya götürün; bulduğunuz çuvalın kutusunu
            işaretleyin. (Çalışma kağıdıdır — resmi belge değildir.)
          </DialogDescription>
        </DialogHeader>

        {fetchMut.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Döküm yüklenemedi.</p>
        ) : (
          <div ref={printRef} className="print-area">
            <div className="mb-2">
              <div className="text-base font-semibold">ÇEKİ LİSTESİ (saha arama kağıdı)</div>
              <div className="text-xs text-muted-foreground">
                {customers.join(", ")} · {rows.length} çuval · {totalRolls} top · {fmtM(totalQty)} m
                {totalKg > 0 ? ` · ${fmtM(totalKg)} kg` : ""} · Basım: {new Date().toLocaleString("tr-TR")}
              </div>
            </div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-foreground/60 text-left">
                  <th className="w-8 py-1 pr-1 font-semibold">✓</th>
                  <th className="py-1 pr-2 font-semibold">Çuval Kodu</th>
                  <th className="py-1 pr-2 font-semibold">Sevk No</th>
                  <th className="py-1 pr-2 font-semibold">Yer</th>
                  <th className="py-1 pr-2 font-semibold">İçerik</th>
                  <th className="py-1 pr-2 text-right font-semibold">Top</th>
                  <th className="py-1 pr-2 text-right font-semibold">Metre</th>
                  <th className="py-1 pr-2 text-right font-semibold">Kg</th>
                  <th className="py-1 text-right font-semibold">Hazır</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b align-top">
                    {/* Üstünü çizme/işaretleme kutusu — kağıdın asıl kullanım şekli */}
                    <td className="py-1.5 pr-1">
                      <span className="inline-block h-4 w-4 rounded-sm border-2 border-foreground/70" />
                    </td>
                    <td className="py-1.5 pr-2">
                      {/* Sahada çuvalın üstünde ELLE YAZILI kod var — büyük/kalın o basılır */}
                      <span className="font-mono text-sm font-bold">{r.manualCode ?? `Çuval ${r.seq}`}</span>
                      {r.manualCode && (
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">({r.sackNo})</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 font-mono">{r.shipment.shipmentNo}</td>
                    <td className="py-1.5 pr-2">{shipmentStatusLabels[r.shipment.status]}</td>
                    <td className="py-1.5 pr-2">
                      {r.contents.map((c, i) => (
                        <div key={i}>
                          {c.itemName}
                          {c.colorName ? ` · ${c.colorName}` : ""}
                          {c.width ? ` · ${c.width} cm` : ""} — {fmtM(c.qty)} m ({c.rollCount})
                        </div>
                      ))}
                      {r.swatchCount > 0 && (
                        <div className="text-muted-foreground">{r.swatchCount} kartela</div>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.rollCount}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtM(r.totalQty)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.weightKg != null ? fmtM(r.weightKg) : "tartılmadı"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDate(r.shipment.readyAt)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-foreground/60 font-semibold">
                  <td className="py-1.5" colSpan={5}>
                    TOPLAM — {rows.length} çuval
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{totalRolls}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtM(totalQty)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{totalKg > 0 ? fmtM(totalKg) : "—"}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button
            disabled={fetchMut.isPending || rows.length === 0}
            onClick={() => printRef.current && printDocumentArea(printRef.current)}
          >
            {fetchMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-1 h-4 w-4" />
            )}
            Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
