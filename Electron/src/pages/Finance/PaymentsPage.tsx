import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDrillTarget } from "@/components/layout/tabs/use-tab-target";
import { cashTxnSearchPath } from "./CashTransactions/cashTxnRules";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, ArrowDownLeft, ArrowUpRight, Printer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { listPayments, cancelPayment, money, partyName, type PaymentRow } from "./service";
import { PaymentFormDialog } from "./PaymentFormDialog";
import { PaymentsFilterBar } from "./PaymentsFilterBar";
import {
  EMPTY_PAYMENT_FILTERS,
  PAYMENT_METHOD_LABEL,
  buildPaymentListQuery,
  isPaymentFilterDirty,
  paymentFilterKey,
  type PaymentFilterState,
} from "./paymentFilters";

const PAGE_SIZE = 100;

export function PaymentsPage() {
  const qc = useQueryClient();
  // Kasa Hareketleri'nden bağla gelince (`?search=TH…`) arama tohumlanır; sonrası yerel durum.
  const [sp] = useSearchParams();
  const [filters, setFilters] = useState<PaymentFilterState>(() => ({ ...EMPTY_PAYMENT_FILTERS, search: sp.get("search") ?? "" }));
  const [formOpen, setFormOpen] = useState(false);
  const [formDirection, setFormDirection] = useState<"IN" | "OUT">("IN");
  const [cancelTarget, setCancelTarget] = useState<PaymentRow | null>(null);
  const [printTarget, setPrintTarget] = useState<PaymentRow | null>(null);

  const q = useQuery({
    queryKey: ["finance", "payments", paymentFilterKey(filters)],
    queryFn: () =>
      listPayments({ page: 1, pageSize: PAGE_SIZE, ...buildPaymentListQuery(filters) }),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["finance"] });

  const cancelM = useMutation({
    mutationFn: (id: string) => cancelPayment(id, "Panelden iptal edildi"),
    onSuccess: (r) => {
      toast.success(r.message ?? "Kayıt iptal edildi.");
      setCancelTarget(null);
      invalidate();
    },
  });

  const rows = q.data?.data ?? [];
  const total = q.data?.pagination?.total ?? 0;

  const openForm = (d: "IN" | "OUT") => {
    setFormDirection(d);
    setFormOpen(true);
  };

  return (
    <PageShell>
      <PageHeader
        title="Tahsilat / Ödeme"
        description="Tahsilat carinin borcunu azaltır, ödeme sizin borcunuzu. İptal, kaydı silmez — ters kayıtla geri alır."
        actions={
          <PermissionGate permission="finance:payment">
            <div className="flex gap-2">
              <Button onClick={() => openForm("IN")}>
                <ArrowDownLeft className="mr-1 h-4 w-4" />
                Tahsilat
              </Button>
              <Button variant="outline" onClick={() => openForm("OUT")}>
                <ArrowUpRight className="mr-1 h-4 w-4" />
                Ödeme
              </Button>
            </div>
          </PermissionGate>
        }
      />

      <PaymentsFilterBar value={filters} onChange={setFilters} />

      <PageBody className="p-6">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          /* "HATA" ile "KAYIT YOK" AYRI EKRANLAR: boş diziyi "kayıt yok" diye
             basmak, kullanıcıyı aynı tahsilatı ikinci kez girmeye iter. */
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">Tahsilat/ödeme listesi yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “kayıt yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi.
              Kayıtlarınız yerinde duruyor; yeni kayıt girmeden önce tekrar deneyin.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {isPaymentFilterDirty(filters)
              ? "Bu filtreyle kayıt yok. Daraltmayı gevşetin ya da “Filtreleri temizle” deyin."
              : "Kayıt yok. Tahsilat veya ödeme girmek için üstteki düğmeleri kullanın."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Belge No</th>
                  <th className="px-3 py-2 text-left">Yön</th>
                  <th className="px-3 py-2 text-left">Cari</th>
                  <th className="px-3 py-2 text-left">Yöntem</th>
                  <th className="px-3 py-2 text-left">Kasa / Banka</th>
                  <th className="px-3 py-2 text-left">Kasa defteri</th>
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-right">Tutar</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={`border-t ${p.status === "CANCELLED" ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs">{p.docNo}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={p.direction === "IN" ? "text-emerald-600" : "text-amber-700"}>
                        {p.direction === "IN" ? "Tahsilat" : "Ödeme"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-medium">{partyName(p.cari)}</td>
                    <td className="px-3 py-2">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {p.cashBox?.name ?? p.bankAccount?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2">{p.cashTransaction ? <CashLedgerLink docNo={p.cashTransaction.docNo} /> : <span className="text-xs text-muted-foreground" title="Defter satırı yok — geçmiş kayıt (backfill bekliyor) ya da eski sunucu">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(p.paymentDate).toLocaleDateString("tr-TR")}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {p.status === "CANCELLED" ? (
                        <span className="line-through">{money(p.amount, p.currency)}</span>
                      ) : (
                        money(p.amount, p.currency)
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* Makbuz KAYIT anında donduğu için her satırda basılabilir
                          (iptal edilmiş olan İPTAL filigranıyla) — faturadan farkı
                          budur: makbuzun taslak hâli YOKTUR. */}
                      <Button
                        variant="outline"
                        size="icon"
                        className="mr-1"
                        title="Makbuzu yazdır / önizle"
                        onClick={() => setPrintTarget(p)}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                      {p.status === "ACTIVE" && (
                        <PermissionGate permission="finance:payment">
                          <Button variant="outline" size="sm" onClick={() => setCancelTarget(p)}>
                            <Ban className="mr-1 h-3.5 w-3.5" />
                            İptal
                          </Button>
                        </PermissionGate>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* ⚠️ KIRPMA SESSİZ DEĞİL: sunucudaki toplam gösterilen satırı aşarsa
            yazılır. Aksi halde 100. satırdan sonrası "yok" sanılır ve aranan
            tahsilat ikinci kez girilir. */}
        {rows.length > 0 && total > rows.length && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-500">
            {total} kaydın ilk {rows.length} tanesi gösteriliyor. Aradığınızı bulmak için tarih, cari
            ya da yöntem filtresini kullanın.
          </p>
        )}
      </PageBody>

      <PaymentFormDialog
        open={formOpen}
        direction={formDirection}
        onOpenChange={setFormOpen}
        onCreated={invalidate}
      />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={() => setCancelTarget(null)}
        destructive
        title={cancelTarget?.direction === "IN" ? "Tahsilatı iptal et" : "Ödemeyi iptal et"}
        description={
          cancelTarget
            ? `${cancelTarget.docNo} — ${partyName(cancelTarget.cari)} — ${money(cancelTarget.amount, cancelTarget.currency)}\n\nCari deftere ve ${cancelTarget.cashBox?.name ?? cancelTarget.bankAccount?.name ?? "hesaba"} TERS kayıt yazılır. Kayıt silinmez, geçmişte görünmeye devam eder.`
            : ""
        }
        confirmLabel="İptal et"
        isPending={cancelM.isPending}
        onConfirm={() => {
          if (cancelTarget) cancelM.mutate(cancelTarget.id);
        }}
      />
      <PrintedDocDialog
        docType="PAYMENT_RECEIPT"
        sourceId={printTarget?.id ?? null}
        open={Boolean(printTarget)}
        onOpenChange={(o) => !o && setPrintTarget(null)}
        title={printTarget ? `Makbuz — ${printTarget.docNo}` : "Makbuz"}
        description="Belge KAYIT anında dondu; iptal edilen makbuz İPTAL filigranıyla basılır."
        writePermission="finance:payment"
      />
    </PageShell>
  );
}

/** Ödemenin kasa/banka defteri satırı — tıklayınca Kasa Hareketleri o belge no ile açılır. */
function CashLedgerLink({ docNo }: { docNo: string }) {
  const drill = useDrillTarget(cashTxnSearchPath(docNo));
  return (
    <button type="button" className="font-mono text-xs text-primary hover:underline" title="Kasa defteri satırını aç" onClick={drill.onClick} onAuxClick={drill.onAuxClick} onContextMenu={drill.onContextMenu}>
      {docNo}
    </button>
  );
}
