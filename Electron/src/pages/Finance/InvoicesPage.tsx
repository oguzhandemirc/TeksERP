import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, CalendarRange } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { apiErrorText } from "@/lib/api-error";
import {
  listInvoices,
  confirmInvoice,
  cancelInvoice,
  deleteInvoice,
  money,
  partyName,
  INVOICE_TYPE_LABEL,
  type InvoiceRow,
} from "./service";
import { useInvoiceTable } from "./invoiceColumns";
import { InvoiceFormDialog } from "./InvoiceFormDialog";
import { InvoiceDetailDialog } from "./InvoiceDetailDialog";
import { ServicePeriodDraftDialog } from "./ServicePeriodDraftDialog";
import { draftBadgeText, trimNotice } from "./invoicesList";
// Kaynak belgeye TIKLA-GİT — hedef yüzeyler sahiplerinin bileşenleridir; burada
// yalnız MOUNT edilirler. (Fatura detayı onları import ETMEZ: mal kabul sheet'i
// kendi taslağını `InvoiceDetailDialog` ile açıyor ve karşılıklı import bir
// modül döngüsü olurdu — bağ bu yüzden geri çağrı ile kurulur.)
import { GoodsReceiptDetailSheet } from "@/pages/Operations/GoodsReceipts/GoodsReceiptDetailSheet";
import { ShipmentDetailSheet } from "@/pages/Operations/Shipments/ShipmentDetailSheet";
import { DirectShipmentDetailSheet } from "@/pages/Operations/Shipments/DirectShipmentDetailSheet";
import { RefreshButton } from "@/components/RefreshButton";

// ⚠️ Rozet sözlükleri 2026-08-14'te `service.ts`'e TAŞINDI (buradan kopyalanmadı,
// taşındı): detay yüzeyi ikinci tüketici oldu ve iki kopya, aynı faturayı iki
// ekranda farklı kelimeyle gösterme riskiydi.

export function InvoicesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  // H8: palet derin bağlantısı `?donemSonu=1` diyaloğu doğrudan açar.
  const [searchParams] = useSearchParams();
  const [servicePeriodOpen, setServicePeriodOpen] = useState(searchParams.get("donemSonu") === "1");
  const serviceBillingOn = useFeatureFlags().data?.data?.financeServiceBillingEnabled === true;
  // Düzenlenen TASLAK — aynı diyalog, `editInvoiceId` ile PATCH yolunda açılır.
  const [editId, setEditId] = useState<string | null>(null);
  const [printTarget, setPrintTarget] = useState<{ id: string; docNo: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Kaynak belge yüzeyleri (tıkla-git) — koşullu mount.
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [directShipmentId, setDirectShipmentId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<InvoiceRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InvoiceRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InvoiceRow | null>(null);

  const q = useQuery({
    queryKey: ["finance", "invoices", search, status, type],
    queryFn: () =>
      listInvoices({
        page: 1,
        pageSize: 100,
        search: search || undefined,
        status: status || undefined,
        type: type || undefined,
      }),
  });

  // ⭐ TASLAK SAYACI — KESİN sayı, yüklenen sayfadan DEĞİL. Otomatik doğan alış
  // taslağı `issueDate = fişin tarihi` ile doğuyor (geriye tarihli!) ve liste
  // `issueDate desc` sıralı 100 satır; o taslak ilk sayfaya hiç girmeyebilir →
  // rozet sessizce sıfırlanırdı. Aynı uç `pagination.total` döndürdüğü için
  // `pageSize: 1` ile TEK HAFİF istek yeter (satır gövdesi taşınmaz).
  // ⚠️ Kapsam ekrandaki filtrelerle AYNI (yalnız `status` TASLAĞA sabit) —
  // filtreli bir listenin üstünde global bir sayı alakasız olurdu.
  // ⚠️ Durum süzgeci zaten TASLAK iken istek HİÇ atılmaz (rozet totoloji).
  const draftCountQ = useQuery({
    queryKey: ["finance", "invoices", "draft-count", search, type],
    queryFn: () =>
      listInvoices({
        page: 1,
        pageSize: 1,
        search: search || undefined,
        status: "DRAFT",
        type: type || undefined,
      }),
    enabled: status !== "DRAFT",
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["finance"] });
  };

  const confirmM = useMutation({
    mutationFn: (id: string) => confirmInvoice(id),
    onSuccess: (r) => {
      toast.success(r.message ?? "Fatura onaylandı.");
      setConfirmTarget(null);
      invalidate();
    },
  });
  const cancelM = useMutation({
    mutationFn: (id: string) => cancelInvoice(id, "Panelden iptal edildi"),
    onSuccess: (r) => {
      toast.success(r.message ?? "Fatura iptal edildi.");
      setCancelTarget(null);
      invalidate();
    },
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteInvoice(id),
    onSuccess: (r) => {
      toast.success(r.message ?? "Taslak silindi.");
      setDeleteTarget(null);
      invalidate();
    },
  });

  const rows = q.data?.data ?? [];
  // Sayaç ve kırpma bandı saf katmanda (`invoicesList`) — ikisi de "ekranda ne
  // var" ile "sistemde ne var" ayrımını korur.
  const draftBadge = draftBadgeText(draftCountQ.data?.pagination?.total, status);
  const trimBand = trimNotice(q.data?.pagination?.total, rows.length);
  const hasRows = !q.isLoading && !q.isError && rows.length > 0;
  const table = useInvoiceTable(rows, {
    onDetail: (inv) => setDetailId(inv.id),
    onPrint: (inv) => setPrintTarget(inv),
    onEdit: (inv) => setEditId(inv.id),
    onConfirm: setConfirmTarget,
    onCancel: setCancelTarget,
    onDelete: setDeleteTarget,
  });

  return (
    <PageShell>
      <PageHeader
        title="Faturalar"
        description="Taslak serbestçe düzenlenir. Onaylanan fatura cari deftere işler ve bir daha DEĞİŞTİRİLEMEZ — düzeltme iptal (storno) + yeni fatura ile yapılır."
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton queryKey={["finance", "invoices"]} />
            {/* ⭐ "N TASLAK" — sevkten/mal kabulden OTOMATİK doğan taslakların
                tek görünür işareti. O taslaklar yalnız geçici bir toast ile
                duyuruluyor (üstelik çoğu sevk mobilden yapılıyor ve orada
                Faturalar ekranı yok) → onaylanmayı bekleyen fatura sessizce
                birikiyordu.
                ⚠️ Sayı SUNUCUDAN gelir (yüklenen sayfadan DEĞİL) ve tıklanınca
                durum süzgecini TASLAĞA çeker: sayan bir rozet, saydığı satırlara
                götürmüyorsa yarım kalır. */}
            {draftBadge && (
              <button
                type="button"
                onClick={() => setStatus("DRAFT")}
                title="Onay bekleyen taslak sayısı (aynı arama/tür süzgeciyle, sunucudan). Tıklayın: yalnız taslaklar listelenir."
              >
                <Badge className="cursor-pointer bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900">
                  {draftBadge}
                </Badge>
              </button>
            )}
            <PermissionGate permission="finance:write">
              {serviceBillingOn && (
                <Button variant="outline" onClick={() => setServicePeriodOpen(true)} title="Ayın emanet işlerini tek hizmet faturası taslağında topla">
                  <CalendarRange className="mr-1 h-4 w-4" />
                  Dönem sonu hizmet faturası
                </Button>
              )}
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Yeni Fatura
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-[var(--list-inset)] py-3">
        <Input
          className="w-64"
          placeholder="Ara…"
          title="Belge no / cari ara"
          aria-label="Belge no / cari ara"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">Tüm türler</option>
          {Object.entries(INVOICE_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Tüm durumlar</option>
          <option value="DRAFT">Taslak</option>
          <option value="CONFIRMED">Onaylı</option>
          <option value="CANCELLED">İptal</option>
        </select>
        <div className="ml-auto">
          <DataTableTools table={table} exportName="Faturalar" compact />
        </div>
      </div>

      {hasRows ? (
        <>
          <DataTable table={table} rowClassName={(inv) => (inv.status === "CANCELLED" ? "opacity-60" : undefined)} />
          {/* ⚠️ SESSİZ KIRPMA YOK: sunucu sayfası (100) dolduğunda kullanıcı
              bulamadığı faturayı "yok" sayıp ikinci kez kesebilir. */}
          {trimBand && (
            <p className="shrink-0 border-t bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {trimBand}
            </p>
          )}
        </>
      ) : (
        <ListBody>
          {q.isLoading ? (
            <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
          ) : q.isError ? (
            /* ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLAR: boş diziyi "fatura yok"
               diye basmak, kullanıcıyı AYNI FATURAYI İKİNCİ KEZ kesmeye iter —
               ve fatura, iki kez kesilmesi en pahalı belgedir. Interceptor'ın
               toast'ı birkaç saniyede kaybolur; ekranda kalan cümle doğruyu
               söylemek zorunda (emsal: PurchaseOrdersPage). */
            <ListMessage>
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
                <p className="font-medium text-destructive">Fatura listesi yüklenemedi.</p>
                {/* Backend'in KENDİ cümlesi ("Ön muhasebe modülü kapalı" gibi) ortak
                    çıkarıcıdan gelir ve yeniden yazılmaz; altındaki satır ise bu
                    ekrana özel sonucu söyler. */}
                <p className="mt-1 text-muted-foreground">
                  {apiErrorText(q.error, "İstek sunucuya ulaşamadı ya da reddedildi.")}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Bu bir “fatura yok” cevabı DEĞİLDİR. Kayıtlarınız yerinde duruyor; yeni fatura
                  kesmeden önce tekrar deneyin.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
                  Tekrar dene
                </Button>
              </div>
            </ListMessage>
          ) : (
            <ListMessage>
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                Fatura yok. "Yeni Fatura" ile taslak oluşturabilirsiniz.
              </div>
            </ListMessage>
          )}
        </ListBody>
      )}
      <ListFooter loaded={rows.length} total={q.data?.pagination?.total ?? null} />

      <ServicePeriodDraftDialog open={servicePeriodOpen} onOpenChange={setServicePeriodOpen} onCreated={(id) => { invalidate(); setDetailId(id); }} />
      <InvoiceFormDialog open={formOpen} onOpenChange={setFormOpen} onCreated={invalidate} onDraftCreated={(id) => { setFormOpen(false); setEditId(id); }} />

      {/* TASLAK DÜZENLEME — aynı form, PATCH yolunda. Koşullu mount: her açılış
          taze bileşen (form durumu kapanınca ölür, bir sonraki taslağa taşmaz). */}
      {editId && (
        <InvoiceFormDialog
          open
          editInvoiceId={editId}
          onOpenChange={(o) => !o && setEditId(null)}
          onCreated={invalidate}
        />
      )}

      {/* ⚠️ Detay ile belge önizlemesi ÜST ÜSTE AÇILMAZ: "Belgeyi aç" detayı
          kapatır ve aşağıdaki `PrintedDocDialog`'u açar. İki yığılı diyalog,
          iki ayrı odak tuzağı ve iki ESC katmanı demekti. */}
      {detailId && (
        <InvoiceDetailDialog
          invoiceId={detailId}
          open
          onOpenChange={(o) => !o && setDetailId(null)}
          onShowDocument={(inv) => {
            setDetailId(null);
            setPrintTarget({ id: inv.id, docNo: inv.docNo });
          }}
          // Düzenleme detayı KAPATIR (aynı gerekçe: iki yığılı diyalog, iki
          // odak tuzağı) ve düzenleme formunu açar.
          onEditDraft={(inv) => {
            setDetailId(null);
            setEditId(inv.id);
          }}
          // KAYNAK BELGEYE GİT — detay AÇIK KALIR: kaynağı kontrol eden kişi
          // faturaya geri dönmek ister (mal kabul → taslak akışıyla aynı karar).
          onOpenGoodsReceipt={setReceiptId}
          onOpenShipment={(t) =>
            t.kind === "DIRECT" ? setDirectShipmentId(t.id) : setShipmentId(t.id)
          }
        />
      )}

      {/* Kaynak belge yüzeyleri — sahiplerinin bileşenleri, burada yalnız mount. */}
      <GoodsReceiptDetailSheet id={receiptId} onOpenChange={(o) => !o && setReceiptId(null)} />
      <ShipmentDetailSheet
        shipmentId={shipmentId}
        open={Boolean(shipmentId)}
        onOpenChange={(o) => !o && setShipmentId(null)}
      />
      <DirectShipmentDetailSheet
        directShipmentId={directShipmentId}
        open={Boolean(directShipmentId)}
        onOpenChange={(o) => !o && setDirectShipmentId(null)}
      />

      {/* ⚠️ Yıkıcı/geri alınamaz işlemlerde onay somut: hangi belge, hangi cari,
          hangi tutar. "Emin misiniz?" tek başına yeterli değil. */}
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        onOpenChange={() => setConfirmTarget(null)}
        title="Faturayı onayla"
        description={
          confirmTarget
            ? `${confirmTarget.docNo} — ${partyName(confirmTarget.cari)} — ${money(confirmTarget.grandTotal, confirmTarget.currency)}\n\nOnaylanan fatura cari deftere işler ve BİR DAHA DÜZENLENEMEZ. Düzeltme gerekirse iptal (storno) edip yeni fatura kesmeniz gerekir.`
            : ""
        }
        confirmLabel="Onayla ve deftere işle"
        isPending={confirmM.isPending}
        onConfirm={() => {
          if (confirmTarget) confirmM.mutate(confirmTarget.id);
        }}
      />
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={() => setCancelTarget(null)}
        destructive
        title="Faturayı iptal et (storno)"
        description={
          cancelTarget
            ? `${cancelTarget.docNo} — ${partyName(cancelTarget.cari)} — ${money(cancelTarget.grandTotal, cancelTarget.currency)}\n\nCari deftere TERS kayıt yazılır ve bakiye geri alınır. Orijinal satır silinmez; ekstrede her iki satır da görünür.`
            : ""
        }
        confirmLabel="İptal et"
        isPending={cancelM.isPending}
        onConfirm={() => {
          if (cancelTarget) cancelM.mutate(cancelTarget.id);
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={() => setDeleteTarget(null)}
        destructive
        title="Taslağı sil"
        description={
          deleteTarget
            ? `${deleteTarget.docNo} taslağı silinecek. Bu taslak deftere hiç işlemediği için silmek güvenlidir; belge numarası boşta kalır.`
            : ""
        }
        confirmLabel="Sil"
        isPending={deleteM.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteM.mutate(deleteTarget.id);
        }}
      />
      <PrintedDocDialog
        docType="INVOICE_INTERNAL"
        sourceId={printTarget?.id ?? null}
        open={Boolean(printTarget)}
        onOpenChange={(o) => !o && setPrintTarget(null)}
        title={printTarget ? `Fatura — ${printTarget.docNo}` : "Fatura"}
        description="Belge ONAY anında dondu; iptal edilen fatura İPTAL filigranıyla basılır."
        writePermission="finance:invoice"
      />
    </PageShell>
  );
}
