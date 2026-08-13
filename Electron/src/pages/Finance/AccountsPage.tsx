import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Wallet, Landmark } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PermissionGate } from "@/components/PermissionGate";
import {
  listCashBoxes, listBankAccounts, createCashBox, createBankAccount, money, type Currency,
} from "./service";

const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

export function AccountsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<"CASH" | "BANK" | null>(null);
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [currency, setCurrency] = useState<Currency>("TRY");

  const cashQ = useQuery({ queryKey: ["finance", "cash-boxes"], queryFn: listCashBoxes });
  const bankQ = useQuery({ queryKey: ["finance", "bank-accounts"], queryFn: listBankAccounts });

  const createM = useMutation({
    mutationFn: () =>
      open === "CASH"
        ? createCashBox({ name: name.trim(), currency })
        : createBankAccount({ name: name.trim(), bankName: bankName || null, iban: iban || null, currency }),
    onSuccess: () => {
      toast.success(open === "CASH" ? "Kasa eklendi." : "Banka hesabı eklendi.");
      setName("");
      setBankName("");
      setIban("");
      setOpen(null);
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Kasa & Banka"
        description="Her kasa/hesap TEK para birimlidir — dövizli işlem için ayrı kart açılır. Bakiye elle yazılmaz; tahsilat ve ödemelerden türetilir."
      />
      <PageBody className="space-y-8 p-6">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              Kasalar
            </h2>
            <PermissionGate permission="finance:write">
              <Button size="sm" variant="outline" onClick={() => setOpen("CASH")}>
                <Plus className="mr-1 h-4 w-4" />
                Kasa ekle
              </Button>
            </PermissionGate>
          </div>
          <AccountTable rows={cashQ.data?.data ?? []} loading={cashQ.isLoading} empty="Kasa tanımı yok." />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Landmark className="h-4 w-4 text-muted-foreground" />
              Banka Hesapları
            </h2>
            <PermissionGate permission="finance:write">
              <Button size="sm" variant="outline" onClick={() => setOpen("BANK")}>
                <Plus className="mr-1 h-4 w-4" />
                Hesap ekle
              </Button>
            </PermissionGate>
          </div>
          <AccountTable
            rows={bankQ.data?.data ?? []}
            loading={bankQ.isLoading}
            empty="Banka hesabı tanımı yok."
            showBank
          />
        </section>
      </PageBody>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{open === "CASH" ? "Yeni Kasa" : "Yeni Banka Hesabı"}</DialogTitle>
            <DialogDescription>
              Para birimi sonradan değiştirilmemeli — hesaptaki hareketler o birimde yazılır.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Ad</Label>
              <Input
                className="mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={open === "CASH" ? "Merkez Kasa" : "Ziraat — TL Hesabı"}
              />
            </div>
            {open === "BANK" && (
              <>
                <div>
                  <Label>Banka</Label>
                  <Input className="mt-1" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                </div>
                <div>
                  <Label>IBAN</Label>
                  <Input className="mt-1" value={iban} onChange={(e) => setIban(e.target.value)} />
                </div>
              </>
            )}
            <div>
              <Label>Para birimi</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>İptal</Button>
            <Button disabled={!name.trim() || createM.isPending} onClick={() => createM.mutate()}>
              {createM.isPending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function AccountTable({
  rows,
  loading,
  empty,
  showBank = false,
}: {
  rows: Array<{ id: string; code: string; name: string; bankName?: string | null; iban?: string | null; currency: Currency; balance: number; isActive: boolean }>;
  loading: boolean;
  empty: string;
  showBank?: boolean;
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{empty}</div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Kod</th>
            <th className="px-3 py-2 text-left">Ad</th>
            {showBank && <th className="px-3 py-2 text-left">Banka / IBAN</th>}
            <th className="px-3 py-2 text-left">Para Birimi</th>
            <th className="px-3 py-2 text-right">Bakiye</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className={`border-t ${a.isActive ? "" : "opacity-60"}`}>
              <td className="px-3 py-2 font-mono text-xs">{a.code}</td>
              <td className="px-3 py-2 font-medium">{a.name}</td>
              {showBank && (
                <td className="px-3 py-2 text-muted-foreground">
                  {a.bankName ?? "—"}
                  {a.iban ? <div className="font-mono text-xs">{a.iban}</div> : null}
                </td>
              )}
              <td className="px-3 py-2">{a.currency}</td>
              <td className="px-3 py-2 text-right font-medium">{money(a.balance, a.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
