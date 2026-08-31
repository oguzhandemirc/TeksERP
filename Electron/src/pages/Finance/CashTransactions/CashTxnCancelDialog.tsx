// =============================================================================
// KASA HAREKETİ İPTALİ — yıkıcı işlem onayı
// =============================================================================
// ⚠️ "X kayıt etkilenecek" YETMEZ (kök CLAUDE.md, yıkıcı işlem kuralı): onay
// etkilenen HER kaydı belge no · hesap · tutar ile TEK TEK yazar. Virmanda bu
// kural tek başına özelliği tanımlar — kullanıcı çıkan bacağın "İptal"ine
// basar, GİREN bacak da iptal olur; bunu görmeden onaylamamalıdır.
//
// ⚠️ ORTAK `ConfirmDialog` KULLANILMADI ve bu bilinçli: burada üç şey birden
// gerekiyor — satır satır kapsam LİSTESİ, opsiyonel gerekçe girişi ve 409'un
// diyalog İÇİNDE kalması. ConfirmDialog düz metin `description` alır ve hata
// yüzeyi yoktur; üçünü ona sığdırmak onu her çağıran için değiştirmekti.
//
// ⚠️ KAPALI DÖNEM 409'U EKRANDA KALIR (istek `suppressErrorToast` ile gider).
// Mesaj bir yapılacak listesidir ("işlemi bugüne tarihleyin ya da dönemi
// yeniden açın — en YENİ kapanıştan başlayarak"); toast onu birkaç saniyede
// silerdi ve kullanıcı yalnız "olmadı" bilgisiyle kalırdı.
//
// ⚠️ İPTAL SİLME DEĞİLDİR: satır `CANCELLED` işaretlenir, bakiye ters yönde
// düzeltilir, kayıt defterde görünmeye devam eder. Metin bunu söyler ki
// kullanıcı "kaydı yok edeceğim" korkusuyla doğru işlemi ertelemesin.
// =============================================================================

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money } from "../service";
import { fmtDate } from "../Cheques/dates";
import { cancelCashTxn, cashTxnErrorText, type CashTxnRow } from "./service";
import { KIND_LABEL, accountNameOf, cancelScope, withSign } from "./cashTxnRules";

interface Props {
  target: CashTxnRow;
  /** O an ekranda olan satırlar — virmanın karşı bacağı buradan bulunur. */
  rows: readonly CashTxnRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

export function CashTxnCancelDialog({ target, rows, open, onOpenChange, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scope = cancelScope(rows, target);

  const cancelM = useMutation({
    mutationFn: () => cancelCashTxn(target.id, reason),
    onSuccess: (r) => {
      toast.success(r.message ?? "Kayıt iptal edildi.");
      onDone();
      onOpenChange(false);
    },
    onError: (e) => setError(cashTxnErrorText(e, "İptal edilemedi. Lütfen tekrar deneyin.")),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && cancelM.isPending) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{scope.isTransfer ? "Virmanı iptal et" : "Kasa fişini iptal et"}</DialogTitle>
          <DialogDescription>
            {scope.isTransfer
              ? "Virmanın İKİ BACAĞI da iptal edilir — tek bacağı iptal etmek “para çıktı ama girmedi” durumunu kalıcı yapardı."
              : "Kayıt silinmez: iptal işaretlenir ve hesap bakiyesi ters yönde düzeltilir. Fiş defterde görünmeye devam eder."}
          </DialogDescription>
        </DialogHeader>

        {/* Yıkıcı işlem kuralı: etkilenen HER kayıt somut olarak listelenir. */}
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">İptal edilecek kayıtlar</p>
          {scope.legs.map((r) => (
            <div key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                <span className="font-mono text-xs">{r.docNo}</span>{" "}
                <span className="text-muted-foreground">
                  · {KIND_LABEL[r.kind]} · {accountNameOf(r)} · {fmtDate(r.txnDate)}
                </span>
              </span>
              <span className="font-medium">{withSign(r.direction, money(r.amount, r.currency))}</span>
            </div>
          ))}
          {/* Listeleyemediğimizi GİZLEMEYİZ: iptal yine iki bacağı da alır. */}
          {scope.missingLeg && (
            <p className="text-xs text-amber-700 dark:text-amber-500">
              Virmanın karşı bacağı bu sayfada görünmüyor (tarih/filtre dışında olabilir). İptal yine de her
              iki bacağı birden alır.
            </p>
          )}
        </div>

        <div>
          <Label className="text-xs">Gerekçe (opsiyonel)</Label>
          <Textarea
            className="mt-1"
            rows={2}
            maxLength={300}
            placeholder="Örn. yanlış hesaba yazıldı"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {error && (
          <p className="flex items-start gap-2 whitespace-pre-line text-sm font-medium text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={cancelM.isPending} onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={cancelM.isPending} onClick={() => cancelM.mutate()}>
            {cancelM.isPending ? "İptal ediliyor…" : scope.isTransfer ? "Her İki Bacağı da İptal Et" : "İptal Et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
