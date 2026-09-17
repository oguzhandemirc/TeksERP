// =============================================================================
// DEVİR BAKİYESİ GİRİŞİ — sisteme geçişteki mevcut borç/alacak
// =============================================================================
// Devir stornosunun (StatementDialog → "Devri İptal Et") GİRİŞ ayağı. Storno
// akışının mesajları "doğru devri şimdi girebilirsiniz" diyordu ama panelde
// giriş yüzeyi YOKTU — backend ucu (`POST /cari/:id/opening-balance`) panelde
// hiç çağrılmıyordu (2026-08-14 inceleme bulgusu). Yüzey ekstrede yaşar: devir
// zaten ekstrenin ilk satırı olarak okunur, iptali de orada.
//
// ⚠️ YÖN, İŞARETLE DEĞİL SEÇENEKLE SORULUR. Backend imzalı tutar bekler
// (pozitif = cari bize borçlu); muhasebeciye "eksi yazın" demek işaret hatasını
// davet eder — iki yönlü hataların en sessizi. Form pozitif tutar + Borç/Alacak
// seçimi alır, işareti TEK yerde kendisi kurar.
//
// ⚠️ HATA BU DİYALOGDA GÖSTERİLİR (istek `suppressErrorToast` ile gider):
// 409 "zaten girilmiş" mesajı kullanıcıyı doğru yola (önce iptal) yönlendirir;
// genel toast aynı cümlenin bağlamsız kopyasını basardı.
// =============================================================================

import { useState } from "react";
import axios from "axios";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money, setOpeningBalance, type CariRow, type Currency } from "./service";
import { DatePickerInput } from "@/components/forms/DatePickerInput";

function errorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as
      | { message?: string; errors?: Array<{ message?: string }> }
      | undefined;
    const fieldMessages = (body?.errors ?? []).map((e) => e?.message).filter((m): m is string => Boolean(m));
    if (fieldMessages.length > 0) return fieldMessages.join(" • ");
    if (body?.message) return body.message;
    if (!error.response) return "Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.";
  }
  return "Devir kaydedilemedi. Lütfen tekrar deneyin.";
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  cari: CariRow;
  /** Ekstrede o an bakılan para birimi — form onunla açılır, değiştirilebilir. */
  initialCurrency: Currency;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OpeningBalanceDialog({ cari, initialCurrency, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [txnDate, setTxnDate] = useState(() => ymdLocal(new Date()));
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(amount.replace(",", "."));
  const amountValid = Number.isFinite(parsed) && parsed > 0;

  const saveM = useMutation({
    mutationFn: () =>
      setOpeningBalance({
        cariId: cari.id,
        currency,
        // İşaret TEK yerde kurulur (dosya başı): Borç = pozitif, Alacak = negatif.
        balance: direction === "DEBIT" ? String(parsed) : String(-parsed),
        description: description.trim() || null,
        txnDate,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Devir bakiyesi kaydedildi — ekstrede ADJUSTMENT satırı olarak görünür.");
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e) => setError(errorText(e)),
  });

  const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && saveM.isPending) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Devir Bakiyesi Gir</DialogTitle>
          <DialogDescription>
            Sisteme geçiş anındaki mevcut borç/alacak, deftere DEVİR satırı olarak yazılır — bakiyeye elle
            yazılmaz, ekstrede görünür ve gerekirse ters kayıtla iptal edilir. Cari + para birimi başına tek
            aktif devir girilebilir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="font-medium">{cari.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{cari.code}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Para birimi</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Devir tarihi</Label>
            <DatePickerInput aria-label="Devir tarihi" className="mt-1" max={ymdLocal(new Date())} value={txnDate} onChange={setTxnDate} />
          </div>
          <div>
            <Label className="text-xs">Tutar</Label>
            <Input
              className="mt-1"
              inputMode="decimal"
              autoFocus
              placeholder="Örn. 42.500"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (error) setError(null);
              }}
            />
            {amount.trim() !== "" && !amountValid && (
              <p className="mt-1 text-xs text-destructive">Sıfırdan büyük bir tutar girin.</p>
            )}
          </div>
          <div>
            <Label className="text-xs">Yön</Label>
            {/* İşaret sorulmaz, yön sorulur — dosya başındaki not. */}
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "DEBIT" | "CREDIT")}
            >
              <option value="DEBIT">Borç — cari bize borçlu</option>
              <option value="CREDIT">Alacak — biz cariye borçluyuz</option>
            </select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Açıklama (opsiyonel)</Label>
            <Textarea
              className="mt-1"
              rows={2}
              maxLength={300}
              placeholder="Örn. eski sistemden devir — mutabakat 31.12 bakiyesi"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {amountValid && (
          <p className="text-sm text-muted-foreground">
            Cari bakiyesi{" "}
            <span className="font-medium text-foreground">{money(parsed, currency)}</span>{" "}
            {direction === "DEBIT" ? "borç yönünde artacak (cari size borçlu)." : "alacak yönünde artacak (siz cariye borçlusunuz)."}
          </p>
        )}

        {error && <p className="whitespace-pre-line text-sm font-medium text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={saveM.isPending} onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!amountValid || saveM.isPending} onClick={() => saveM.mutate()}>
            {saveM.isPending ? "Kaydediliyor…" : "Devri Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
