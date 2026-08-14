// =============================================================================
// SİPARİŞ İPTALİ — YIKICI İŞLEM, SOMUT ONAY
// =============================================================================
// Kök kural: yıkıcı işlemin onayı etkilenen kayıtları SOMUT listeler; "N kayıt
// etkilenecek" gibi soyut bir sayı YETMEZ. Bu yüzden diyalog önce siparişin
// KENDİSİNİ yükler ve iptal edilecek her kalemi miktarıyla tek tek basar.
//
// ⚠️ ÖNCE ENGELİ SÖYLER, SONRA ONAY İSTER. Backend, siparişe bağlı AKTİF bir mal
// kabul fişi varsa 409 veriyor ("mal gelmişti" bilgisi sessizce kaybolmasın).
// Bunu kullanıcıya ancak toast'ta söylemek, dolu dolu bir onay ekranından sonra
// tokat gibi gelirdi; engel VARSA onay düğmesi çizilir ama KAPALIDIR ve sebebi
// fiş numaralarıyla birlikte ekranda yazar. Backend seddi yerine GEÇMEZ, onu
// kullanıcının gözü önünde tekrarlar.
//
// ⚠️ SEBEP ZORUNLU (backend'de opsiyonel). Bu bir masa başı kararıdır, vardiya
// ortasında eldivenle basılan bir düğme değil: "neden iptal edildi" sorusunun
// cevabı altı ay sonra da lazım olur ve `SystemLog` arşivlenmeden önce kaydın
// KENDİ satırına yazılmalı. Serbest metin, denetimde "aaa" doldurmalarına açık
// olduğu için placeholder somut örnek verir.
//
// ⚠️ İPTAL, "kalanı gelmeyecek, kapat" DEMEK DEĞİLDİR. Sistemde short-close
// yoktur (`CLOSED` türetilmiş bir durumdur, elle işaretlenirse ilk senkronda
// geri döner) — bu ayrım diyalogda AÇIKÇA yazılır, yoksa satın almacı yarısı
// gelmiş bir siparişi "kapatmak" için iptal eder ve gelen malın taahhüt kaydını
// yok eder.
//
// ⚠️ ÖZETTE TEK BİR "TOPLAM MİKTAR" BASILMAZ. Kalemlerin birimleri farklı olabilir
// (kumaş METRE, iplik KİLO); ikisini toplayıp "700 birim" yazmak hiçbir şeyi
// ölçmeyen bir sayıyı, üstelik yıkıcı bir onayın en üstüne koymaktır. Kural
// `fulfillment.ts` başlığında yazılı ve detay ekranı da onu uygular; burada
// gerçek rakamlar zaten hemen altta, kalem kalem ve KENDİ birimiyle duruyor.
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelPurchaseOrder, fmtQty, getPurchaseOrder } from "./service";
import { fulfillmentOf, remainingText } from "./fulfillment";

interface Props {
  orderId: string;
  onOpenChange: (open: boolean) => void;
  onCancelled: () => void;
}

export function CancelPurchaseOrderDialog({ orderId, onOpenChange, onCancelled }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const q = useQuery({
    queryKey: ["purchase-order", orderId],
    queryFn: () => getPurchaseOrder(orderId),
  });
  const po = q.data;

  const activeReceipts = po?.goodsReceipts.filter((r) => r.status === "ACTIVE") ?? [];
  const blocked = activeReceipts.length > 0;
  const alreadyCancelled = po?.status === "CANCELLED";
  // ⚠️ `po` ŞARTI LOAD-BEARING: istek düşerse `isLoading` false'a döner ve `po`
  // undefined kalır. Bu şart olmadan düğme AÇIK olur ve kullanıcı NEYİ iptal
  // ettiğini hiç görmeden iptal eder — yıkıcı işlemde soyut sayı bile yetmezken
  // boş ekran hiç yetmez (`ClosePeriodDialog` emsali).
  const canSubmit = Boolean(po) && !blocked && !alreadyCancelled && reason.trim().length >= 3;

  const cancelM = useMutation({
    mutationFn: () => cancelPurchaseOrder(orderId, reason.trim()),
    onSuccess: (res) => {
      toast.success(res.message ?? "Sipariş iptal edildi.");
      void qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      void qc.invalidateQueries({ queryKey: ["purchase-order"] });
      void qc.invalidateQueries({ queryKey: ["purchase-order-open-lines"] });
      onCancelled();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Siparişi iptal et</DialogTitle>
          <DialogDescription>
            İptal, siparişin TAAHHÜT kaydını kapatır. “Kalanı gelmeyecek, kapatalım” için bu yol
            KULLANILMAZ — o durumda sipariş kısmen karşılanmış olarak kalır ve geçmişi korunur.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Sipariş okunuyor…</p>
        ) : !po ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Sipariş okunamadı — iptal edilemez.</p>
              <p className="mt-0.5 text-xs">
                Neyi iptal ettiğinizi görmeden iptal etmek yok. Tekrar deneyin.
              </p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void q.refetch()}>
                Tekrar dene
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p>
                <b className="font-mono">{po.orderNo}</b> · {po.supplier?.name ?? "—"} ·{" "}
                {po.lines.length} kalem
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {po.lines.map((l) => {
                  const f = fulfillmentOf(l);
                  return (
                    <li key={l.id} className="flex items-baseline justify-between gap-3">
                      <span className="truncate">
                        {l.lineNo}. {l.item.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {fmtQty(l.qty, l.item.unit)} ısmarlandı · {remainingText(f, l.item.unit)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {alreadyCancelled && (
              <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Bu sipariş zaten iptal edilmiş — yapılacak bir şey yok.
              </p>
            )}

            {blocked && (
              <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Bu siparişe mal kabul edilmiş ({activeReceipts.map((r) => r.receiptNo).join(", ")}) —
                  sipariş iptal EDİLEMEZ. “Mal gelmişti” bilgisi kaybolmasın diye önce ilgili mal kabul
                  fişlerini iptal etmeniz gerekir.
                </span>
              </p>
            )}

            <div>
              <Label>İptal sebebi</Label>
              <Textarea
                className="mt-1"
                rows={2}
                maxLength={300}
                placeholder="Örn. tedarikçi fiyatı revize etti, sipariş yenilendi (AS1408260007)."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={blocked || alreadyCancelled}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Sebep kaydın kendi satırına yazılır ve altı ay sonra da okunur — “neden iptal edildi”
                sorusunun tek cevabı budur.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={!canSubmit || cancelM.isPending}
            onClick={() => cancelM.mutate()}
          >
            {cancelM.isPending ? "İptal ediliyor…" : "Siparişi iptal et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
