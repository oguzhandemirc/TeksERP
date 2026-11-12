import { useMemo, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Wallet, Landmark } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
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
        actions={<RefreshButton queryKey={["finance", "cash-boxes"]} extraKeys={[["finance", "bank-accounts"]]} />}
        description="Her kasa/hesap TEK para birimlidir — dövizli işlem için ayrı kart açılır. Bakiye elle yazılmaz; tahsilat ve ödemelerden türetilir."
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <AccountSection
          tableKey="finance:cash-boxes"
          title="Kasalar"
          icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
          addButton={
            <PermissionGate permission="finance:write">
              <Button size="sm" variant="outline" onClick={() => setOpen("CASH")}>
                <Plus className="mr-1 h-4 w-4" />
                Kasa ekle
              </Button>
            </PermissionGate>
          }
          rows={cashQ.data?.data}
          loading={cashQ.isLoading}
          isError={cashQ.isError}
          onRetry={() => void cashQ.refetch()}
          empty="Kasa tanımı yok."
          errorTitle="Kasa listesi yüklenemedi."
        />
        <AccountSection
          tableKey="finance:bank-accounts"
          title="Banka Hesapları"
          icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
          addButton={
            <PermissionGate permission="finance:write">
              <Button size="sm" variant="outline" onClick={() => setOpen("BANK")}>
                <Plus className="mr-1 h-4 w-4" />
                Hesap ekle
              </Button>
            </PermissionGate>
          }
          rows={bankQ.data?.data}
          loading={bankQ.isLoading}
          isError={bankQ.isError}
          onRetry={() => void bankQ.refetch()}
          empty="Banka hesabı tanımı yok."
          errorTitle="Banka hesabı listesi yüklenemedi."
          showBank
        />
      </div>
      <ListFooter
        loaded={(cashQ.data?.data.length ?? 0) + (bankQ.data?.data.length ?? 0)}
        label={`${cashQ.data?.data.length ?? 0} kasa · ${bankQ.data?.data.length ?? 0} banka hesabı`}
      />

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

type AccountRow = { id: string; code: string; name: string; bankName?: string | null; iban?: string | null; currency: Currency; balance: number; isActive: boolean };

const accountColumns = (showBank: boolean): ColumnDef<AccountRow>[] => [
  { accessorKey: "code", header: "Kod", size: 110, cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
  { accessorKey: "name", header: "Ad", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
  ...(showBank
    ? ([
        { id: "bankName", header: "Banka", meta: { label: "Banka", exportValue: (a) => a.bankName ?? "" }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.bankName ?? "—"}</span> },
        { id: "iban", header: "IBAN", size: 260, meta: { label: "IBAN", exportValue: (a) => a.iban ?? "" }, cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.iban ?? "—"}</span> },
      ] satisfies ColumnDef<AccountRow>[])
    : []),
  { accessorKey: "currency", header: "Para Birimi", size: 100 },
  {
    id: "balance",
    header: "Bakiye",
    meta: { label: "Bakiye", align: "right", exportValue: (a) => money(a.balance, a.currency) },
    cell: ({ row }) => <span className="font-medium">{money(row.original.balance, row.original.currency)}</span>,
  },
];

const inactiveRow = (a: AccountRow) => (a.isActive ? undefined : "opacity-60");

/** Kasalar / Banka hesapları bölümü — başlık + standart Sütunlar menüsü + ortak DataTable (ekranı ikiye böler). */
function AccountSection({
  tableKey,
  title,
  icon,
  addButton,
  rows,
  showBank = false,
  ...state
}: {
  tableKey: string;
  title: string;
  icon: ReactNode;
  addButton: ReactNode;
  rows: AccountRow[] | undefined;
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  empty: string;
  errorTitle: string;
  showBank?: boolean;
}) {
  const data = useMemo(() => rows ?? [], [rows]);
  const columns = useMemo(() => accountColumns(showBank), [showBank]);
  const table = useLocalTable({ tableKey, data, columns });
  return (
    <section className="flex min-h-0 flex-1 flex-col border-b">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h2>
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName={title} />
          {addButton}
        </div>
      </div>
      {!state.loading && data.length > 0 ? (
        <DataTable table={table} isError={state.isError} onRetry={state.onRetry} rowClassName={inactiveRow} exportName={title} />
      ) : (
        <ListBody>
          <AccountMessage rows={data} {...state} />
        </ListBody>
      )}
    </section>
  );
}

/** Yükleniyor / hata / boş — satır varken tabloyu DataTable çizer. */
function AccountMessage({
  rows,
  loading,
  isError,
  onRetry,
  empty,
  errorTitle,
}: {
  rows: AccountRow[];
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  empty: string;
  errorTitle: string;
}) {
  if (loading) return <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>;
  // ⚠️ "TANIM YOK" ZİNCİRİNİN KÖKÜ. Tahsilat formu kasa listesini okuyamayınca
  // "Önce Muhasebe → Kasa & Banka ekranından ekleyin" der; kullanıcı buraya gelir
  // ve burası da aynı sebeple "Kasa tanımı yok." derse MÜKERRER KASA açar —
  // sonraki tahsilatlar yanlış hesaba yazılır ve iki hesabın bakiyesi de eksik
  // kalır. Hata dalı boş dalın ÖNÜNDE olmak zorunda.
  if (isError && rows.length === 0) {
    return (
      <ListMessage>
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
        <p className="font-medium text-destructive">{errorTitle}</p>
        <p className="mt-1 text-muted-foreground">
          Bu “tanım yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi. Yeni hesap
          açmadan önce tekrar deneyin; hesaplarınız duruyor olabilir.
        </p>
        {onRetry ? (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Tekrar dene
          </Button>
        ) : null}
      </div>
      </ListMessage>
    );
  }
  if (rows.length === 0) {
    return (
      <ListMessage>
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{empty}</div>
      </ListMessage>
    );
  }
  return null;
}
