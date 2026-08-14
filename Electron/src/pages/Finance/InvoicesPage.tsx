import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Check, Ban, Trash2, Printer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import {
  listInvoices,
  confirmInvoice,
  cancelInvoice,
  deleteInvoice,
  money,
  partyName,
  settlementOf,
  SETTLEMENT_LABEL,
  INVOICE_TYPE_LABEL,
  type InvoiceRow,
  type SettlementState,
} from "./service";
// Kuruş → tutar yalnız GÖSTERİM anında (allocationMath sözleşmesi).
import { fromKurus } from "./Allocations/allocationMath";
import { InvoiceFormDialog } from "./InvoiceFormDialog";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Taslak", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  CONFIRMED: { label: "Onaylı", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  CANCELLED: { label: "İptal", cls: "bg-muted text-muted-foreground line-through" },
};

/** Kapama rozeti renkleri — durum rozetinden AYRI soru: "belge ne durumda" ≠
 *  "parası geldi mi". AÇIK amber (bekleyen alacak), KISMİ mavi, KAPALI yeşil. */
const SETTLEMENT_BADGE: Record<SettlementState, string> = {
  ACIK: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  KISMI: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  KAPALI: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

export function InvoicesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [printTarget, setPrintTarget] = useState<{ id: string; docNo: string } | null>(null);
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

  return (
    <PageShell>
      <PageHeader
        title="Faturalar"
        description="Taslak serbestçe düzenlenir. Onaylanan fatura cari deftere işler ve bir daha DEĞİŞTİRİLEMEZ — düzeltme iptal (storno) + yeni fatura ile yapılır."
        actions={
          <PermissionGate permission="finance:write">
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Yeni Fatura
            </Button>
          </PermissionGate>
        }
      />

      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-3">
        <Input
          className="w-64"
          placeholder="Belge no / cari ara…"
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
      </div>

      <PageBody className="p-6">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Fatura yok. "Yeni Fatura" ile taslak oluşturabilirsiniz.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Belge No</th>
                  <th className="px-3 py-2 text-left">Tür</th>
                  <th className="px-3 py-2 text-left">Cari</th>
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-left">Durum</th>
                  <th className="px-3 py-2 text-right">Tutar</th>
                  <th className="px-3 py-2 text-right">Kapanan / Açık</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const badge = STATUS_BADGE[inv.status];
                  // Kapama TÜRETİLİR (kolon değil) ve yalnız CONFIRMED'da
                  // anlamlıdır — kural + gerekçe `settlementOf` başlığında.
                  const st = settlementOf(inv);
                  return (
                    <tr key={inv.id} className={`border-t ${inv.status === "CANCELLED" ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2 font-mono text-xs">{inv.docNo}</td>
                      <td className="px-3 py-2">{INVOICE_TYPE_LABEL[inv.type]}</td>
                      <td className="px-3 py-2 font-medium">{partyName(inv.cari)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(inv.issueDate).toLocaleDateString("tr-TR")}
                      </td>
                      <td className="px-3 py-2">
                        <Badge className={badge?.cls}>{badge?.label}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {money(inv.grandTotal, inv.currency)}
                        {/* Döviz faturada TL karşılığı ikinci satırda — dönem
                            toplamları tek birimde okunabilsin diye damgalanır. */}
                        {inv.currency !== "TRY" && (
                          <div className="text-xs text-muted-foreground">
                            ≈ {money(inv.grandTotalTry, "TRY")}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {st ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="flex items-center gap-1">
                              {/* Gecikme rozeti yalnız AÇIK tutar varken —
                                  kapalı/taslak/iptal faturada basılmaz
                                  (settlementOf bunu zaten garanti eder). */}
                              {st.overdue && (
                                <Badge className="bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">
                                  Vadesi geçti
                                </Badge>
                              )}
                              <Badge className={SETTLEMENT_BADGE[st.state]}>
                                {SETTLEMENT_LABEL[st.state]}
                              </Badge>
                            </div>
                            <span className="whitespace-nowrap text-xs text-muted-foreground">
                              {money(fromKurus(st.paidK), inv.currency)} / {money(fromKurus(st.openK), inv.currency)}
                            </span>
                          </div>
                        ) : (
                          // Taslak/iptalde kapama sorusu YOKTUR — boş bırakmak
                          // değil, "soru yok" demek ("—").
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {/* BELGE — taslakta ÇIKMAZ: belge onayda donar, taslağın
                              resmi kaydı yoktur ve düğme "yok" bir şeyi vaat eder.
                              İPTAL edilmiş fatura basılabilir KALIR (İPTAL
                              filigranıyla) — dosyaya bakan kişinin ihtiyacı. */}
                          {inv.status !== "DRAFT" && (
                            <Button
                              variant="outline"
                              size="icon"
                              title="Faturayı yazdır / önizle"
                              onClick={() => setPrintTarget(inv)}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                          )}
                          {inv.status === "DRAFT" && (
                            <>
                              <PermissionGate permission="finance:invoice">
                                <Button size="sm" onClick={() => setConfirmTarget(inv)}>
                                  <Check className="mr-1 h-3.5 w-3.5" />
                                  Onayla
                                </Button>
                              </PermissionGate>
                              <PermissionGate permission="finance:write">
                                <Button
                                  size="icon"
                                  title="Taslağı sil"
                                  className="bg-destructive text-white hover:bg-destructive/90"
                                  onClick={() => setDeleteTarget(inv)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </PermissionGate>
                            </>
                          )}
                          {inv.status === "CONFIRMED" && (
                            <PermissionGate permission="finance:invoice">
                              <Button variant="outline" size="sm" onClick={() => setCancelTarget(inv)}>
                                <Ban className="mr-1 h-3.5 w-3.5" />
                                İptal (storno)
                              </Button>
                            </PermissionGate>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>

      <InvoiceFormDialog open={formOpen} onOpenChange={setFormOpen} onCreated={invalidate} />

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
