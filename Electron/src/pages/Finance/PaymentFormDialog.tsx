import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Customer } from "@/pages/Customers/types";
import { createPayment, listCashBoxes, listBankAccounts, money, type Currency } from "./service";

interface Props {
  open: boolean;
  direction: "IN" | "OUT";
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function PaymentFormDialog({ open, direction, onOpenChange, onCreated }: Props) {
  const [party, setParty] = useState<"CUSTOMER" | "SUBCONTRACTOR">("CUSTOMER");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [subcontractorId, setSubcontractorId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");

  const cashQ = useQuery({ queryKey: ["finance", "cash-boxes"], queryFn: listCashBoxes });
  const bankQ = useQuery({ queryKey: ["finance", "bank-accounts"], queryFn: listBankAccounts });

  // Kasa ve banka TEK listede birleşir ama kimliğinde türü taşır: uç ikisini
  // ayrı alanlarla bekliyor ve "kasa VEYA banka" seddi DB'de CHECK ile kilitli.
  const accounts = useMemo(
    () => [
      ...(cashQ.data?.data ?? []).filter((a) => a.isActive).map((a) => ({ ...a, kind: "CASH" as const })),
      ...(bankQ.data?.data ?? []).filter((a) => a.isActive).map((a) => ({ ...a, kind: "BANK" as const })),
    ],
    [cashQ.data, bankQ.data],
  );
  // ⚠️ "TANIM YOK" YALNIZ OKUMA BAŞARILIYKEN SÖYLENİR. Liste düşerse `accounts`
  // boş kalır ve aşağıdaki uyarı kullanıcıyı Kasa & Banka ekranına yollar; oradaki
  // liste de aynı sebeple boş görünürse MÜKERRER KASA açılır ve sonraki tahsilatlar
  // yanlış hesaba yazılır. Hata ile boşluk ayrı cümlelerdir.
  const accountsError = cashQ.isError || bankQ.isError;
  const accountsResolved = !cashQ.isLoading && !bankQ.isLoading && !accountsError;
  const selected = accounts.find((a) => a.id === accountId);

  // ⚠️ Para birimi HESAPTAN gelir, ayrıca sorulmaz: kasa tek para birimlidir ve
  // backend uyuşmazlıkta 400 verir. İki yerden sormak, kullanıcıya sonradan
  // reddedilecek bir kombinasyon kurma imkânı vermek olurdu.
  const currency = (selected?.currency ?? "TRY") as Currency;

  useEffect(() => {
    if (!open) {
      setAmount(0);
      setReference("");
    }
  }, [open]);

  const valid =
    Boolean(selected) &&
    amount > 0 &&
    (party === "CUSTOMER" ? Boolean(customerId) : Boolean(subcontractorId));

  const createM = useMutation({
    mutationFn: () =>
      createPayment({
        direction,
        method,
        customerId: party === "CUSTOMER" ? customerId : null,
        subcontractorId: party === "SUBCONTRACTOR" ? subcontractorId : null,
        currency,
        amount,
        cashBoxId: selected?.kind === "CASH" ? selected.id : null,
        bankAccountId: selected?.kind === "BANK" ? selected.id : null,
        reference: reference || null,
        clientToken: crypto.randomUUID(),
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Kaydedildi.");
      onCreated();
      onOpenChange(false);
    },
  });

  const title = direction === "IN" ? "Tahsilat" : "Ödeme";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Yeni {title}</DialogTitle>
          <DialogDescription>
            {direction === "IN"
              ? "Müşteriden/fasondan alınan para. Carinin size olan borcunu azaltır."
              : "Fasona/müşteriye ödenen para. Sizin borcunuzu azaltır."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Cari türü</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={party}
              onChange={(e) => setParty(e.target.value as "CUSTOMER" | "SUBCONTRACTOR")}
            >
              <option value="CUSTOMER">Müşteri</option>
              <option value="SUBCONTRACTOR">Fason firma</option>
            </select>
          </div>
          <div>
            <Label>{party === "CUSTOMER" ? "Müşteri" : "Fason firma"}</Label>
            {/* ⚠️ PASİF KART DA SEÇİLEBİLİR (`includeInactive`): uç kartın
                değil `CariAccount`ın aktifliğine bakıyor — pasifleştirilmiş bir
                firmanın AÇIK BAKİYESİNE tahsilat girmek meşrudur ve mahsup
                ekranı bu kararı zaten yazılı vermiş. Süzgeç açıkken aynı firma
                Mahsup'ta bulunuyor, burada "yok" görünüyordu. Seçilen kayıt
                pasifse alan bunu rozetle ve altındaki uyarıyla söyler. */}
            <div className="mt-1">
              {party === "CUSTOMER" ? (
                <ReferenceSelect<Customer>
                  value={customerId}
                  onChange={setCustomerId}
                  service={customerService}
                  queryKey="customers"
                  getLabel={(c) => `${c.code} — ${c.name}`}
                  placeholder="Müşteri ara..."
                  includeInactive
                />
              ) : (
                <ReferenceSelect
                  value={subcontractorId}
                  onChange={setSubcontractorId}
                  service={subcontractorService}
                  queryKey="subcontractors"
                  getLabel={(s: { code: string; name: string }) => `${s.code} — ${s.name}`}
                  placeholder="Fason firma ara..."
                  includeInactive
                />
              )}
            </div>
          </div>

          <div>
            <Label>Kasa / Banka</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Seçin…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.kind === "CASH" ? "Kasa" : "Banka"} · {a.name} ({a.currency})
                </option>
              ))}
            </select>
            {accountsError && (
              <p className="mt-1 text-xs text-destructive">
                Kasa/banka listesi okunamadı — bu “tanım yok” DEMEK DEĞİLDİR. Yeni kasa açmayın;
                diyaloğu kapatıp tekrar açın.
              </p>
            )}
            {accountsResolved && accounts.length === 0 && (
              // Boş liste "bozuk" değil "henüz tanım yok" demektir — kullanıcıyı
              // doğru ekrana yönlendirmeden bırakmak en sık şikâyet sebebi.
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
                Kasa/banka tanımı yok. Önce Muhasebe → Kasa &amp; Banka ekranından ekleyin.
              </p>
            )}
          </div>
          <div>
            <Label>Yöntem</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="CASH">Nakit</option>
              <option value="BANK_TRANSFER">Havale / EFT</option>
              <option value="CREDIT_CARD">Kredi Kartı</option>
              <option value="OTHER">Diğer</option>
            </select>
          </div>

          <div>
            <Label>Tutar ({currency})</Label>
            <Input
              type="number" min={0} step="0.01"
              className="mt-1"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Açıklama / referans</Label>
            <Input
              className="mt-1"
              placeholder="Dekont no, çek no…"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button disabled={!valid || createM.isPending} onClick={() => createM.mutate()}>
            {createM.isPending ? "Kaydediliyor…" : `${title} Kaydet (${money(amount, currency)})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
