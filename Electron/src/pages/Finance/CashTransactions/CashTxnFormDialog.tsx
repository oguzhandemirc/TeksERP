// =============================================================================
// MASRAF / GELİR / AÇILIŞ FİŞİ
// =============================================================================
// ⚠️ PARA BİRİMİ SORULMAZ — HESAPTAN gelir (kasa/banka tek para birimlidir).
// İki yerden sormak, kullanıcıya sonradan reddedilecek bir kombinasyon
// kurdurmaktı (`PaymentFormDialog` kararının aynası). Kur da sorulmaz: TRY'de 1,
// dövizde günün kuru sunucuda çözülür ve kur yoksa gelen 400 YOL GÖSTERİR
// ("Kurlar ekranından girin") — o cümle bu diyalogda basılır.
//
// ⚠️ TEK MOUNT = TEK MANTIKSAL DENEME. `clientToken` diyalog açılırken BİR KEZ
// üretilir ve tekrar denemede AYNISI gider: belirsiz sonuçlu bir hatadan
// (timeout/5xx) sonra ikinci basış mükerrer fiş DEĞİL, aynı kaydın onayını
// döndürür ("Kayıt zaten oluşturulmuş."). Her `mutate` çağrısında yeni token
// üretmek korumayı tamamen boşa düşürür (2026-08-03 KK1 dersi) — sayfa
// diyaloğu KOŞULLU mount eder, başarıdan sonra yeni token doğar.
//
// ⚠️ AÇILIŞ HESAP BAŞINA TEKTİR ve bu ekranda ÖNCEDEN SÖYLENİR. Backend 409'u
// da ("… zaten girilmiş (KH…). Düzeltmek için önce onu iptal edin.") burada,
// diyaloğun içinde basılır — toast'a bırakılırsa kullanıcı yapması gerekeni
// birkaç saniyede kaybeder.
// =============================================================================

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
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
import { cashTxnErrorText, createCashTxn } from "./service";
import {
  ENTRY_KINDS, ENTRY_KIND_DIRECTION, KIND_LABEL, amountHint, entryBlockReason, entryReady,
  parseAmount, type EntryKind,
} from "./cashTxnRules";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CashTxnFormDialog({ open, onOpenChange, onCreated }: Props) {
  const [kind, setKind] = useState<EntryKind>("EXPENSE");
  const [account, setAccount] = useState<CashAccountOption | null>(null);
  const [amount, setAmount] = useState("");
  const [txnDate, setTxnDate] = useState(() => ymd(new Date()));
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Mantıksal deneme kimliği — dosya başındaki nota bak.
  const tokenRef = useRef(crypto.randomUUID());

  const parsed = parseAmount(amount);
  const blockReason = entryBlockReason(account);
  const ready = entryReady(account, amount, txnDate) && !blockReason;
  const direction = ENTRY_KIND_DIRECTION[kind];

  const saveM = useMutation({
    mutationFn: () =>
      createCashTxn({
        kind,
        amount: parsed?.wire ?? "0",
        ...(account?.kind === "CASH_BOX" ? { cashBoxId: account.id } : {}),
        ...(account?.kind === "BANK_ACCOUNT" ? { bankAccountId: account.id } : {}),
        // Gün sınırı İSTEMCİNİNDİR: yerel 00:00 (bkz. Cheques/dates).
        txnDate: dayStartIso(txnDate),
        category: category.trim() || null,
        description: description.trim() || null,
        reference: reference.trim() || null,
        clientToken: tokenRef.current,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Fiş kaydedildi.");
      onCreated();
      onOpenChange(false);
    },
    onError: (e) => setError(cashTxnErrorText(e, "Fiş kaydedilemedi. Lütfen tekrar deneyin.")),
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
          <DialogTitle>Kasa Fişi</DialogTitle>
          <DialogDescription>
            Carisi olmayan para hareketi — kira, yakıt, personel avansı, kasaya bulunan gelir… Tahsilat ve
            ödeme BURADA DEĞİL, Tahsilat/Ödeme ekranında kaydedilir (onlar cari borcunu da oynatır).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Fiş türü</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as EntryKind);
                setError(null);
              }}
            >
              {ENTRY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">İşlem tarihi</Label>
            <Input type="date" className="mt-1" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} />
          </div>

          <div className="col-span-2">
            <Label className="text-xs">Kasa / Banka hesabı</Label>
            <CashAccountPicker
              className="mt-1 w-full"
              value={account}
              onChange={(a) => {
                setAccount(a);
                setError(null);
              }}
            />
          </div>

          <div>
            <Label className="text-xs">Tutar {account ? `(${account.currency})` : ""}</Label>
            <Input
              className="mt-1"
              inputMode="decimal"
              placeholder="Örn. 1250,50"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
            />
            {/* Sebep AYRIŞTIRILIR: biçim hatası ile sıfır/negatif aynı cümleyle
                geçiştirilirse kullanıcı olmayan bir sorunu arar (saf katman). */}
            {amountHint(amount) && <p className="mt-1 text-xs text-destructive">{amountHint(amount)}</p>}
          </div>
          <div>
            <Label className="text-xs">Kategori (opsiyonel)</Label>
            <Input
              className="mt-1"
              maxLength={120}
              placeholder="Kira · Yakıt · Elektrik…"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          <div>
            <Label className="text-xs">Referans (opsiyonel)</Label>
            <Input
              className="mt-1"
              maxLength={120}
              placeholder="Dekont / fiş no"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Açıklama (opsiyonel)</Label>
            <Textarea
              className="mt-1"
              rows={2}
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {kind === "OPENING" && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Açılış (devir) bakiyesi hesap başına <span className="font-medium">TEK</span> girilir. Zaten
            girilmişse kayıt reddedilir; düzeltmek için önce mevcut açılış fişini iptal edin.
          </p>
        )}

        {blockReason && (
          <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {blockReason}
          </p>
        )}

        {parsed && account && !blockReason && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{account.name}</span> bakiyesi{" "}
            <span className="font-medium text-foreground">{money(parsed.value, account.currency)}</span>{" "}
            {direction === "IN" ? "ARTACAK." : "AZALACAK."}
          </p>
        )}

        {/* Backend cümlesi AYNEN — istek `suppressErrorToast` ile gitti. */}
        {error && <p className="whitespace-pre-line text-sm font-medium text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={saveM.isPending} onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!ready || saveM.isPending} onClick={() => saveM.mutate()}>
            {saveM.isPending ? "Kaydediliyor…" : "Fişi Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
