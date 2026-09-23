import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bookmark, Loader2, MessageSquareText, Printer } from "lucide-react";
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
import { isDarkHex } from "@/pages/SackTags/service";
import { isAmbiguousFailure } from "@/lib/fasonReceiveAttempt";
import { sackHubService } from "./service";
import { shipmentStatusLabels, type PickListPrint, type PickListRow } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });
const locLabel = (r: PickListRow) => (r.shipment ? shipmentStatusLabels[r.shipment.status] : "Depoda");

interface Props {
  /** Basılacak çuval id'leri — null ise dialog kapalı. */
  sackIds: string[] | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Çeki listesi baskısı — seçilen çuvalların SAHADA ARANACAK dökümü. Çalışma
 * kağıdıdır (resmi/donmuş belge DEĞİL): operatör kağıtla depoya gider, bulduğu
 * çuvalın kutusunu işaretler/üstünü çizer.
 */
export function PickListPrintDialog({ sackIds, onOpenChange }: Props) {
  const open = !!sackIds && sackIds.length > 0;
  const printRef = useRef<HTMLDivElement>(null);
  // Çuval notlarını bas — opsiyonel, varsayılan KAPALI. Notlar her yerde opt-in
  // (irsaliye kolonu, etiket alanı) → burada da aynı davranış: operatör isterse açar.
  // Diyalog kapanınca sıfırlanır; hiçbir yere kaydedilmez.
  const [withNotes, setWithNotes] = useState(false);
  // ÇUVAL İZLERİ — ayrı anahtar, ayrı varsayılan (KAPALI).
  // ⚠️ `withNotes` ile TEK bayrağa BİNDİRİLMEZ: not ile iz farklı hassasiyette
  // veridir ve "notu bas" diyen operatör sessizce izi de bastırmış olmamalı.
  const [withTags, setWithTags] = useState(false);

  const fetchMut = useMutation({
    mutationFn: (ids: string[]) => sackHubService.pickList(ids),
  });

  // Dialog açılınca dökümü çek (her açılışta taze — bayat kg/içerik basılmasın).
  useEffect(() => {
    if (open && sackIds) fetchMut.mutate(sackIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stabil; yalnız açılışta
  }, [open, sackIds?.join(",")]);

  // ÇEKİ LİSTESİ NO: "Yazdır"da sunucu kaydı doğurur (aynı içerik → aynı CL); kâğıt dönen anlık
  // görüntüden çizilir ve numara sağ üstte basılır. Token MANTIKSAL DENEME başına bir kez üretilir;
  // yalnız sonucu belirsiz hatada (ağ/5xx) yapışır.
  const [baski, setBaski] = useState<PickListPrint | null>(null);
  const tokenRef = useRef<string | null>(null);
  const bekleyenBaski = useRef(false);
  const printMut = useMutation({
    mutationFn: (ids: string[]) => {
      tokenRef.current ??= crypto.randomUUID();
      return sackHubService.printPickList(ids, tokenRef.current);
    },
    onSuccess: (res) => {
      tokenRef.current = null;
      bekleyenBaski.current = true;
      setBaski(res.data ?? null);
    },
    onError: (e) => {
      if (!isAmbiguousFailure(e)) tokenRef.current = null;
    },
  });
  // Kâğıt kayıttan çizildikten SONRA basılır (aynı render turunda DOM henüz eski içeriği taşır).
  useEffect(() => {
    if (!baski || !bekleyenBaski.current || !printRef.current) return;
    bekleyenBaski.current = false;
    printDocumentArea(printRef.current);
  }, [baski]);
  // Diyalog kapanınca kayıt bağı düşer: yeniden açılış taze döküm + yeni deneme demektir.
  useEffect(() => {
    if (!open) { setBaski(null); tokenRef.current = null; }
  }, [open]);

  const rows: PickListRow[] = baski?.snapshot ?? fetchMut.data?.data ?? [];
  const totalQty = rows.reduce((a, r) => a + r.totalQty, 0);
  const totalKg = rows.reduce((a, r) => a + (r.weightKg ?? 0), 0);
  const totalRolls = rows.reduce((a, r) => a + r.rollCount, 0);
  const customers = [...new Set(rows.map((r) => r.customer?.name).filter((n): n is string => !!n))];
  // Notu OLAN çuval yoksa tuşu hiç göstermeyelim — boş bir seçenek kafa karıştırır.
  const notedCount = rows.filter((r) => r.notes).length;
  // İzi OLAN çuval yoksa kutucuk hiç çizilmez (boş seçenek kafa karıştırır) —
  // not kutucuğuyla aynı kural. Eski backend `tags` DÖNMEZ → sayı 0, kutu yok.
  const taggedCount = rows.filter((r) => (r.tags?.length ?? 0) > 0).length;

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
          <>
            <div ref={printRef} className="print-area">
            <div className="mb-2">
              <div className="flex items-start justify-between gap-4">
                <div className="text-base font-semibold">ÇEKİ LİSTESİ (saha arama kağıdı)</div>
                {baski && (
                  <div className="shrink-0 text-right text-[10px] leading-tight text-muted-foreground" data-testid="ceki-listesi-no">
                    Çeki Listesi No: <span className="font-mono font-semibold text-foreground">{baski.manifestNo}</span>
                  </div>
                )}
              </div>
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
                  <th className="py-1 pr-2 font-semibold">Yer</th>
                  <th className="py-1 pr-2 font-semibold">İçerik</th>
                  <th className="py-1 pr-2 text-right font-semibold">Top</th>
                  <th className="py-1 pr-2 text-right font-semibold">Metre</th>
                  <th className="py-1 text-right font-semibold">Kg</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b align-top">
                    <td className="py-1.5 pr-1">
                      <span className="inline-block h-4 w-4 rounded-sm border-2 border-foreground/70" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="font-mono text-sm font-bold">{r.sackNo}</span>
                    </td>
                    <td className="py-1.5 pr-2">
                      {locLabel(r)}
                      {r.shipment ? ` · ${r.shipment.shipmentNo}` : ""}
                    </td>
                    <td className="py-1.5 pr-2">
                      {r.contents.map((c, i) => (
                        <div key={i}>
                          {c.itemName}
                          {c.colorName ? ` · ${c.colorName}` : ""}
                          {c.width ? ` · ${c.width} cm` : ""} — {fmtM(c.qty)} m ({c.rollCount})
                        </div>
                      ))}
                      {r.swatchCount > 0 && <div className="text-muted-foreground">{r.swatchCount} kartela</div>}
                      {/* Not — İçerik hücresinin altına ayrı satır; tabloyu genişletmez,
                          uzun not sarar. Yalnız tuş işaretliyse basılır. */}
                      {withNotes && r.notes && (
                        <div className="mt-1 whitespace-pre-wrap break-words border-l-2 border-foreground/40 pl-1.5 font-medium">
                          Not: {r.notes}
                        </div>
                      )}
                      {/* İz — nottan AYRI satır ve AYRI anahtar. Kağıt siyah-beyaz
                          basılabilir → renk tek başına taşıyıcı değil, AD da yazılır. */}
                      {withTags && (r.tags?.length ?? 0) > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="font-medium">İz:</span>
                          {r.tags!.map((t) => (
                            <span
                              key={t.id}
                              className="rounded px-1 py-0.5 text-[10px] font-semibold"
                              style={{ backgroundColor: t.hex, color: isDarkHex(t.hex) ? "#fff" : "#000" }}
                            >
                              {t.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.rollCount}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtM(r.totalQty)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.weightKg != null ? fmtM(r.weightKg) : "tartılmadı"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-foreground/60 font-semibold">
                  <td className="py-1.5" colSpan={4}>
                    TOPLAM — {rows.length} çuval
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{totalRolls}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtM(totalQty)}</td>
                  <td className="py-1.5 text-right tabular-nums">{totalKg > 0 ? fmtM(totalKg) : "—"}</td>
                </tr>
              </tfoot>
            </table>
            </div>
          </>
        )}

        {/* Baskı seçeneği — YAZDIR tuşunun hemen üstünde, belirgin kutu içinde.
            print-area'nın DIŞINDA: aksi halde işaret kutusunun kendisi kağıda basılır.
            Notu olan çuval yoksa hiç gösterilmez (boş seçenek kafa karıştırır). */}
        {notedCount > 0 && rows.length > 0 && (
          <label
            className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 transition-colors ${
              withNotes
                ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
                : "border-input bg-muted/40 hover:bg-muted/60"
            }`}
          >
            <input
              type="checkbox"
              checked={withNotes}
              onChange={(e) => setWithNotes(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <MessageSquareText className="h-4 w-4 shrink-0" />
                Çuval notlarını yazdır
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {notedCount} çuvalda not var — işaretlerseniz her çuvalın altına “Not: …”
                satırı olarak basılır.
              </span>
            </span>
          </label>
        )}

        {taggedCount > 0 && rows.length > 0 && (
          <label
            className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 transition-colors ${
              withTags
                ? "border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/30"
                : "border-input bg-muted/40 hover:bg-muted/60"
            }`}
          >
            <input
              type="checkbox"
              checked={withTags}
              onChange={(e) => setWithTags(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Bookmark className="h-4 w-4 shrink-0" />
                Çuval izlerini yazdır
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {taggedCount} çuvalda iz var — işaretlerseniz her çuvalın altına “İz: …”
                satırı olarak basılır. Notlardan ayrı bir seçenektir.
              </span>
            </span>
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button
            disabled={fetchMut.isPending || printMut.isPending || rows.length === 0}
            onClick={() => sackIds && printMut.mutate(sackIds)}
          >
            {fetchMut.isPending || printMut.isPending ? (
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
