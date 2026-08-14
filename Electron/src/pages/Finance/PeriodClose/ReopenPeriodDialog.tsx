// =============================================================================
// DÖNEMİ YENİDEN AÇ — mührü kırar, GEREKÇE ister
// =============================================================================
// ⚠️ Bu bir "geri alma" değil, KAYDA GEÇEN bir karardır. Kapanış satırı
// SİLİNMEZ: `reopenedAt` + gerekçe ile işaretlenir ve listede soluk satır olarak
// durmaya devam eder. Denetimde aranan şey tam olarak budur — "bu dönem bir kez
// kapandı, sonra şu gerekçeyle açıldı".
//
// ⚠️ GEREKÇE NEDEN AYRI BİR DİYALOG: ortak `ConfirmDialog` metin alanı taşımaz.
// Gerekçeyi sonradan sormak (önce aç, sonra "neden?") en kötü sıradır — iş
// yapılmış olur ve boş gerekçe kaydı kalır. Backend zaten en az 3 karakter
// istiyor; buton o şart sağlanana kadar kapalıdır ki kullanıcı 400 yemesin.
//
// ⚠️ LIFO: daha YENİ bir aktif kapanış varken eski dönem açılamaz ve backend
// bunu somut tarihle söyler ("Önce daha yeni kapanışı açın (31.01.2026)").
// O mesaj YUTULMAZ — interceptor toast'ı olduğu gibi basar.
// =============================================================================

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Unlock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDayKey, moneyOf, reopenPeriod, type PeriodCloseRow } from "./service";

interface Props {
  row: PeriodCloseRow | null;
  onOpenChange: (open: boolean) => void;
}

const MIN_REASON = 3;

export function ReopenPeriodDialog({ row, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  // Hedef değişince gerekçe sıfırlanır: bir dönem için yazılan gerekçenin
  // başka bir döneme taşınması, izin kendisini yalan yapardı.
  useEffect(() => {
    setReason("");
  }, [row?.id]);

  const reopenM = useMutation({
    mutationFn: () => reopenPeriod(row?.id as string, reason.trim()),
    onSuccess: (r) => {
      toast.success(r.message ?? "Dönem yeniden açıldı.");
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });

  const valid = reason.trim().length >= MIN_REASON;

  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Dönemi yeniden aç</DialogTitle>
          <DialogDescription>
            Mühür kırılır ve bu döneme tekrar kayıt girilebilir hale gelir. Kapanış kaydı SİLİNMEZ —
            &quot;yeniden açıldı&quot; olarak işaretlenir ve gerekçesiyle birlikte listede kalır.
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="space-y-1 rounded-md border bg-muted/30 p-4 text-sm">
            <div className="font-medium">
              {row.cariCode} — {row.cariName}
            </div>
            <div className="text-muted-foreground">
              Dönem sonu: <span className="text-foreground">{formatDayKey(row.periodEnd)}</span> · Para birimi:{" "}
              <span className="text-foreground">{row.currency}</span>
            </div>
            <div className="text-muted-foreground">
              Mühürlü bakiye:{" "}
              <span className="font-medium text-foreground">{moneyOf(row.closingBalance, row.currency)}</span> ·{" "}
              {row.txnCount} hareket
            </div>
          </div>
        )}

        <div>
          <Label>Gerekçe (zorunlu)</Label>
          <Textarea
            className="mt-1"
            rows={3}
            maxLength={300}
            autoFocus
            placeholder="Örn. Aralık faturası eksik girilmiş, düzeltme yapılacak."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            En az {MIN_REASON} karakter. Bu metin kalıcı denetim izine yazılır.
          </p>
        </div>

        <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Daha yeni bir kapanış varsa önce o açılmalıdır — sistem hangi dönemi açmanız gerektiğini
          tarihiyle söyler.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={!valid || reopenM.isPending}
            onClick={() => reopenM.mutate()}
          >
            <Unlock className="mr-1 h-4 w-4" />
            {reopenM.isPending ? "Açılıyor…" : "Mührü kır ve aç"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
