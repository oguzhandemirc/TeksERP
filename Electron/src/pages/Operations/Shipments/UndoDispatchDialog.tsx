import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Undo2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/forms/FormField";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import { shipmentService } from "./service";
import { UndoAffectedList } from "./UndoAffectedList";

interface Props {
  /** Geri alınacak sevkiyat id'si — null ise dialog kapalı. */
  shipmentId: string | null;
  onOpenChange: (open: boolean) => void;
}

const shelfLabel = (s: string) => rollStatusLabels[s as RollStatus] ?? s;

/**
 * "Sevki Geri Al" (storno) — İADE DEĞİL.
 *
 * Kullanım anı: mal FİZİKSEL olarak çıkmadı (araç kapıda, yanlış sevkiyat
 * onaylandı). Sevk irsaliyesi İPTAL edilir, toplar sevk ÖNCESİ rafına döner,
 * sipariş karşılanması geri alınır. İade defterine kayıt GİRMEZ.
 *
 * Mal müşteriye ulaşıp geri geldiyse burası DEĞİL, "İade Takibi → Yeni İade"
 * kullanılır (çıkış belgesi düzeltilmez, ayrı iade irsaliyesi kesilir).
 *
 * Yıkıcı onay kuralı: etkilenen kayıtlar SOMUT listelenir (çuval/top/sipariş +
 * hangi rafa döneceği) ve gerekçe zorunludur. Engel sebebi backend'in TEK
 * kaynağından (`blockReason`) gelir — istemci kendi kuralını kurmaz.
 *
 * "Sevkiyatı da kapat" (2026-08-22, `releaseSacks`): geri alınan sevkiyat PLANNED'da
 * beklemek yerine aynı işlemde iptal edilir, çuvallar depoya döner. Varsayılan
 * REJİME bağlı ve backend önizlemesinden gelir (`confirmationEnabled`): sevk onayı
 * KAPALI fabrikada PLANNED beklemenin karşılığı yok (Sevk Kapısı ekranı görünmez,
 * çuval kilitli kalır) → işaretli; AÇIK fabrikada PLANNED doğal durum → işaretsiz.
 * Kullanıcı her iki rejimde de değiştirebilir. Yetki: storno izni kapanışı da kapsar.
 */
export function UndoDispatchDialog({ shipmentId, onOpenChange }: Props) {
  const qc = useQueryClient();
  const open = !!shipmentId;
  const [reason, setReason] = useState("");
  // null = kullanıcı dokunmadı → varsayılan önizlemeden (rejim) çözülür.
  const [releaseChoice, setReleaseChoice] = useState<boolean | null>(null);

  const previewQ = useQuery({
    queryKey: ["shipment-undo-preview", shipmentId],
    queryFn: () => shipmentService.undoDispatchPreview(shipmentId!),
    enabled: open,
    gcTime: 0, // her açılışta taze — bayat dökümle geri alma onaylanmasın
  });
  const p = previewQ.data?.data;
  // ⭐ SEVK ONAYI KAPALIYSA SEÇENEK YOKTUR (2026-09-07 saha turu).
  //
  // Kullanıcının sözü: *"planlı sevkiyat diye bir şey yok ama şu an planlı
  // sevkiyat durumuna düşüyor, onu da iptal edince çuvallar ekranına geliyor."*
  //
  // `shipping.confirmationEnabled` KAPALI olan bir kurulumda PLANNED bir ARA
  // DURAK değildir: sevkiyat kurulur kurulmaz sevk edilir, "Sevk Kapısı" diye
  // bir adım yoktur. Geri almada onay kutusunun işaretini kaldırmak, o
  // kurulumda karşılığı olmayan bir duruma düşürüyor ve operatör bunu ikinci
  // bir iptalle temizlemek zorunda kalıyordu — iki adımda yapılan şey aslında
  // tek adımdı.
  //
  // Bu yüzden kutu YALNIZ onay AÇIKKEN çizilir; kapalıyken geri alma daima
  // serbest bırakır ve diyalog bunu cümleyle söyler. Varsayılan zaten buydu;
  // değişen şey, yanlış seçimin artık MÜMKÜN OLMAMASI.
  const secimVar = !!p?.confirmationEnabled;
  const release = secimVar ? (releaseChoice ?? false) : true;

  const undoMut = useMutation({
    mutationFn: () => shipmentService.undoDispatch(shipmentId!, reason.trim(), release),
    onSuccess: (r) => {
      toast.success(r.message ?? `Sevk geri alındı: ${p?.shipmentNo ?? ""}`);
      // Stok + karşılanma + belge durumu değişti — dokunan tüm cache'ler tazelensin.
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["shipment-detail", shipmentId] });
      void qc.invalidateQueries({ queryKey: ["sack-store"] });
      void qc.invalidateQueries({ queryKey: ["sack-search"] });
      void qc.invalidateQueries({ queryKey: ["packing"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      setReason("");
      setReleaseChoice(null);
      onOpenChange(false);
    },
  });

  const reasonOk = reason.trim().length >= 3;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (undoMut.isPending) return; // çift-tık/kaza kapanma kilidi
        if (!o) {
          setReason("");
          setReleaseChoice(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sevki Geri Al — {p?.shipmentNo ?? ""}</DialogTitle>
          <DialogDescription>
            {p ? (
              <>
                {p.customerName}
                {p.branchName ? ` · ${p.branchName}` : ""} — mal <strong>fiziksel olarak çıkmadıysa</strong>{" "}
                kullanılır. Müşteriye ulaşıp geri geldiyse bunun yerine <strong>İade</strong> alın.
              </>
            ) : (
              "Önizleme yükleniyor…"
            )}
          </DialogDescription>
        </DialogHeader>

        {previewQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !p ? (
          <p className="text-sm text-destructive">
            Önizleme yüklenemedi — döküm görülmeden geri alma onaylanamaz.
          </p>
        ) : !p.canUndo ? (
          <p className="text-sm text-destructive">{p.blockReason}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {release ? "Depoya dönecek:" : "Geri alınacak:"}{" "}
              <span className="font-semibold tabular-nums text-foreground">{p.sackCount}</span> çuval ·{" "}
              <span className="font-semibold tabular-nums text-foreground">{p.rollCount}</span> top
              {p.swatchCount > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold tabular-nums text-foreground">{p.swatchCount}</span> kartela
                </>
              )}
            </div>

            <UndoAffectedList preview={p} />

            {p.returnTargets.length > 0 && (
              <div className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Toplar hangi rafa dönecek
                </div>
                <ul className="divide-y text-xs">
                  {p.returnTargets.map((t) => (
                    <li key={t.status} className="flex items-center justify-between px-3 py-1">
                      <span>{shelfLabel(t.status)}</span>
                      <span className="tabular-nums">{t.rollCount} top</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p.affectedOrders.length > 0 && (
              <div className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Karşılanması geri alınacak siparişler
                </div>
                <ul className="max-h-32 divide-y overflow-y-auto text-xs">
                  {p.affectedOrders.map((o) => (
                    <li key={o} className="px-3 py-1 font-mono">
                      {o}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sonrası ne olacak. Onay AÇIKSA kullanıcı seçer; KAPALIYSA seçenek
                yoktur ve tek cümleyle söylenir (bkz. `secimVar` notu). */}
            {secimVar ? (
              <label
                htmlFor="undo-release-sacks"
                className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2"
              >
                <Checkbox
                  id="undo-release-sacks"
                  className="mt-0.5"
                  checked={release}
                  onCheckedChange={(c) => setReleaseChoice(Boolean(c))}
                />
                <span className="text-xs">
                  <span className="font-medium text-foreground">
                    Sevkiyatı da kapat — çuvallar depoya dönsün
                  </span>
                  <br />
                  <span className="text-muted-foreground">
                    {release
                      ? "Sevkiyat iptal olur; çuvallar ve toplar depoda serbest kalır, sipariş bağı kalkar. Yeniden göndermek için Paketleme'den yeni sevkiyat kurulur (yeni sevk no)."
                      : "Sevkiyat planlı durumda bekler (çuvallar üstünde kilitli kalır); Sevk Kapısı'ndan ya da Sevkiyatlar'dan \"Sevk Et\" ile aynı numarayla yeniden çıkarılır."}
                  </span>
                </span>
              </label>
            ) : (
              <div className="rounded-md border px-3 py-2 text-xs">
                <span className="font-medium text-foreground">
                  Sevkiyat kapanır — çuvallar çuval hazırlamaya döner
                </span>
                <br />
                <span className="text-muted-foreground">
                  Bu kurulumda sevk onayı kapalı, yani “planlı sevkiyat” diye bir ara durak yok.
                  Çuvallar ve toplar depoda serbest kalır, sipariş bağı kalkar. Yeniden göndermek
                  için Paketleme’den yeni sevkiyat kurulur (yeni sevk no).
                </span>
              </div>
            )}

            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Sevk irsaliyesi <strong>İPTAL</strong> edilecek (silinmez — İPTAL filigranıyla basılabilir
              kalır).
              {!release && (
                <>
                  {" "}
                  Yeniden sevk edildiğinde yeni bir versiyon üretilir.
                  {(p.plateNumber || p.driverName) && (
                    <>
                      {" "}
                      Araç/şoför bilgisi ({[p.plateNumber, p.driverName].filter(Boolean).join(" · ")}) korunur.
                    </>
                  )}
                </>
              )}
            </div>

            <FormField label="Geri alma gerekçesi" required>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Örn: araç yüklenmeden sevk onaylandı, 2 top eksik çıktı"
              />
            </FormField>
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button variant="outline" disabled={undoMut.isPending} onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={undoMut.isPending || previewQ.isLoading || !p?.canUndo || !reasonOk}
            onClick={() => undoMut.mutate()}
          >
            {undoMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Undo2 className="mr-1 h-4 w-4" />
            )}
            {release ? "Geri Al ve Kapat" : "Sevki Geri Al"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
