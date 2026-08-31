// =============================================================================
// VİRMAN — kasadan bankaya / bankadan kasaya
// =============================================================================
// ⚠️ TEK UÇ, İKİ SATIR, AYNI TX: çıkan (TRANSFER_OUT) + giren (TRANSFER_IN),
// `transferGroupId` ile bağlı. Bu yüzden ekran da TEK forma sahiptir — iki
// ayrı fiş girdirmek "para kasadan çıktı ama bankaya girmedi" durumunu
// kullanıcının eliyle üretmekti.
//
// ⚠️ FARKLI PARA BİRİMİ GÖNDERİLMEDEN DURDURULUR. Backend 400 ile reddediyor
// (tek sed odur), ama sebep burada ÖNCEDEN yazılır: farklı birimler arası
// transfer bir KUR İŞLEMİDİR ve virman diye kaydedilirse kur farkı sessizce
// yok sayılır. Yüklem saf katmanda (`transferBlockReason`) ve bekçide.
//
// ⚠️ TEK MOUNT = TEK MANTIKSAL DENEME (`clientToken`) — `CashTxnFormDialog`
// dosya başındaki notun aynısı. Virmanda karşılığı daha da kritik: belirsiz
// hatadan sonraki ikinci basış, İKİ BACAKLI ikinci bir virman doğurabilirdi.
// =============================================================================

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money } from "../service";
import { CashAccountPicker, type CashAccountOption } from "../PeriodClose/CashAccountPicker";
import { dayStartIso, ymd } from "../Cheques/dates";
import { cashTxnErrorText, transferCash } from "./service";
import { amountHint, parseAmount, transferBlockReason, transferReady } from "./cashTxnRules";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CashTransferDialog({ open, onOpenChange, onCreated }: Props) {
  const [from, setFrom] = useState<CashAccountOption | null>(null);
  const [to, setTo] = useState<CashAccountOption | null>(null);
  const [amount, setAmount] = useState("");
  const [txnDate, setTxnDate] = useState(() => ymd(new Date()));
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tokenRef = useRef(crypto.randomUUID());

  const parsed = parseAmount(amount);
  const blockReason = transferBlockReason(from, to);
  const ready = transferReady(from, to, amount, txnDate);

  const saveM = useMutation({
    mutationFn: () =>
      transferCash({
        amount: parsed?.wire ?? "0",
        ...(from?.kind === "CASH_BOX" ? { fromCashBoxId: from.id } : {}),
        ...(from?.kind === "BANK_ACCOUNT" ? { fromBankAccountId: from.id } : {}),
        ...(to?.kind === "CASH_BOX" ? { toCashBoxId: to.id } : {}),
        ...(to?.kind === "BANK_ACCOUNT" ? { toBankAccountId: to.id } : {}),
        txnDate: dayStartIso(txnDate),
        description: description.trim() || null,
        clientToken: tokenRef.current,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Virman kaydedildi.");
      onCreated();
      onOpenChange(false);
    },
    onError: (e) => setError(cashTxnErrorText(e, "Virman kaydedilemedi. Lütfen tekrar deneyin.")),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && saveM.isPending) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Virman</DialogTitle>
          <DialogDescription>
            Kendi hesaplarınız arasında para aktarımı. Tek işlemde İKİ fiş oluşur (çıkan + giren) ve ikisi
            birbirine bağlıdır — biri iptal edilirse diğeri de iptal edilir.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Çıkan hesap (kaynak)</Label>
            <CashAccountPicker
              className="mt-1 w-full"
              value={from}
              onChange={(a) => {
                setFrom(a);
                setError(null);
              }}
            />
          </div>
          <div>
            <Label className="text-xs">Giren hesap (hedef)</Label>
            <CashAccountPicker
              className="mt-1 w-full"
              value={to}
              onChange={(a) => {
                setTo(a);
                setError(null);
              }}
            />
          </div>

          <div>
            <Label className="text-xs">Tutar {from ? `(${from.currency})` : ""}</Label>
            <Input
              className="mt-1"
              inputMode="decimal"
              placeholder="Örn. 25000"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
            />
            {/* Biçim hatası ile sıfır/negatif ayrı cümleler (saf katman). */}
            {amountHint(amount) && <p className="mt-1 text-xs text-destructive">{amountHint(amount)}</p>}
          </div>
          <div>
            <Label className="text-xs">İşlem tarihi</Label>
            <Input type="date" className="mt-1" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} />
          </div>

          <div className="col-span-2">
            <Label className="text-xs">Açıklama (opsiyonel)</Label>
            <Textarea
              className="mt-1"
              rows={2}
              maxLength={300}
              placeholder="Boş bırakılırsa “Virman → hedef hesap” yazılır."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {/* GÖNDERMEDEN sebep — dosya başı. */}
        {blockReason && (
          <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {blockReason}
          </p>
        )}

        {ready && from && to && parsed && (
          <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{from.name}</span>
            <ArrowRight className="h-4 w-4" />
            <span className="font-medium text-foreground">{to.name}</span>
            <span>·</span>
            <span className="font-medium text-foreground">{money(parsed.value, from.currency)}</span>
            <span>— iki fiş oluşacak.</span>
          </p>
        )}

        {error && <p className="whitespace-pre-line text-sm font-medium text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={saveM.isPending} onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!ready || saveM.isPending} onClick={() => saveM.mutate()}>
            {saveM.isPending ? "Kaydediliyor…" : "Virmanı Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
