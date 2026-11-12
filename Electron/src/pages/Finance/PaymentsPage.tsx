import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { cancelledPaymentRow, usePaymentTable } from "./PaymentTable";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { listPayments, cancelPayment, money, partyName, type PaymentRow } from "./service";
import { PaymentFormDialog } from "./PaymentFormDialog";
import { PaymentsFilterBar } from "./PaymentsFilterBar";
import {
  EMPTY_PAYMENT_FILTERS,
  buildPaymentListQuery,
  isPaymentFilterDirty,
  paymentFilterKey,
  type PaymentFilterState,
} from "./paymentFilters";
import { RefreshButton } from "@/components/RefreshButton";

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

  const rows = useMemo(() => q.data?.data ?? [], [q.data]);
  const table = usePaymentTable(rows, { onPrint: setPrintTarget, onCancel: setCancelTarget });
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
          <div className="flex gap-2">
            <RefreshButton queryKey={["finance", "payments"]} />
            <PermissionGate permission="finance:payment">
              <Button onClick={() => openForm("IN")}>
                <ArrowDownLeft className="mr-1 h-4 w-4" />
                Tahsilat
              </Button>
              <Button variant="outline" onClick={() => openForm("OUT")}>
                <ArrowUpRight className="mr-1 h-4 w-4" />
                Ödeme
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <PaymentsFilterBar value={filters} onChange={setFilters} tools={<DataTableTools table={table} compact exportName="Tahsilat ve ödemeler" />} />

      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} rowClassName={cancelledPaymentRow} exportName="Tahsilat ve ödemeler" />
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          /* "HATA" ile "KAYIT YOK" AYRI EKRANLAR: boş diziyi "kayıt yok" diye
             basmak, kullanıcıyı aynı tahsilatı ikinci kez girmeye iter. */
          <ListMessage>
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
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {isPaymentFilterDirty(filters)
                ? "Bu filtreyle kayıt yok. Daraltmayı gevşetin ya da “Filtreleri temizle” deyin."
                : "Kayıt yok. Tahsilat veya ödeme girmek için üstteki düğmeleri kullanın."}
            </div>
          </ListMessage>
        ) : null}
      </ListBody>
      )}
        {/* ⚠️ KIRPMA SESSİZ DEĞİL: sunucudaki toplam gösterilen satırı aşarsa
            yazılır. Aksi halde 100. satırdan sonrası "yok" sanılır ve aranan
            tahsilat ikinci kez girilir. */}
        {rows.length > 0 && total > rows.length && (
          <p className="shrink-0 border-t px-4 py-2 text-xs text-amber-700 dark:text-amber-500">
            {total} kaydın ilk {rows.length} tanesi gösteriliyor. Aradığınızı bulmak için tarih, cari
            ya da yöntem filtresini kullanın.
          </p>
        )}
      <ListFooter loaded={rows.length} total={q.data ? total : null} />

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
