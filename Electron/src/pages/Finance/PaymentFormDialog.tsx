import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { createPayment, listCashBoxes, listBankAccounts, money, type Currency } from "./service";
import { allocateBulk } from "./Allocations/service";
import { PaymentOpenInvoices } from "./PaymentOpenInvoices";
import { PaymentAccountSelect } from "./PaymentAccountSelect";
import { usePaymentAllocation } from "./usePaymentAllocation";

interface Props {
  open: boolean;
  direction: "IN" | "OUT";
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function PaymentFormDialog({ open, direction, onOpenChange, onCreated }: Props) {
  // Rol modeli (dilim F): taraf yalnız KART (`customerId`) — fason firma da kartıyla seçilir, hesap karta yazılır;
  // panel fason bacağını göndermez (eski istemci yolu backend'de kalır).
  const [customerId, setCustomerId] = useState<string | null>(null);
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

  // Açık fatura eşlemesi (2026-09-18): seçim yoksa bağsız ödeme (bugünkü davranış).
  const alloc = usePaymentAllocation({ customerId, currency, direction, accountSelected: Boolean(selected), amount, setAmount });
  useEffect(() => {
    if (!open) {
      setAmount(0);
      setReference("");
      alloc.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const valid = Boolean(selected) && amount > 0 && Boolean(customerId) && alloc.blockReason === null;

  const createM = useMutation({
    mutationFn: async () => {
      const created = await createPayment({
        direction,
        method,
        customerId,
        currency,
        amount,
        cashBoxId: selected?.kind === "CASH" ? selected.id : null,
        bankAccountId: selected?.kind === "BANK" ? selected.id : null,
        reference: reference || null,
        clientToken: crypto.randomUUID(),
      });
      // Seçim varsa aynı adımda faturaya eşle (mevcut motor `PaymentAllocation`); yoksa bugünkü gibi bağsız.
      const paymentId = (created.data as { id?: string } | undefined)?.id;
      if (alloc.items.length > 0 && paymentId) {
        await allocateBulk({ paymentId, items: alloc.bulkItems() });
        return { ...created, message: `${created.message ?? "Kaydedildi."} ${alloc.items.length} fatura eşlendi.` };
      }
      return created;
    },
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
              ? "Cariden alınan para. Carinin size olan borcunu azaltır."
              : "Cariye ödenen para. Sizin cariye borcunuzu azaltır."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Cari</Label>
            {/* Varsayılan liste AKTİF kartlar; pasif kartın AÇIK BAKİYESİNE tahsilat/ödeme meşrudur (uç `CariAccount.isActive`e
                bakar, karta değil) — seçicideki "Durum: Pasif / Tümü" süzgeciyle seçilir, satır "(pasif)" rozeti taşır. */}
            <div className="mt-1">
              <CustomerPickerField variant="cari" value={customerId} onChange={setCustomerId} />
            </div>
          </div>

          <PaymentAccountSelect accounts={accounts} value={accountId} onChange={setAccountId} isError={accountsError} resolved={accountsResolved} />
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
              type="number" min={0} step="0.01" aria-label="Tutar"
              className="mt-1"
              value={amount || ""}
              onChange={(e) => {
                alloc.touchAmount();
                setAmount(Number(e.target.value));
              }}
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

        {customerId && selected && (
          <PaymentOpenInvoices
            rows={alloc.rows}
            totalOpen={alloc.totalOpen}
            isLoading={alloc.isLoading}
            isError={alloc.isError}
            currency={currency}
            drafts={alloc.drafts}
            distributed={alloc.distributed}
            amount={amount}
            blockReason={alloc.blockReason}
            disabled={createM.isPending}
            onDraftChange={alloc.onDraftChange}
            onFillMax={alloc.onFillMax}
            onFifo={alloc.onFifo}
            onCloseAll={alloc.onCloseAll}
          />
        )}

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
