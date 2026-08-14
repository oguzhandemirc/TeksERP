// =============================================================================
// KASA HAREKETLERİ — carisiz para hareketlerinin defteri (F3)
// =============================================================================
// K3 boşluğu: dört backend ucu 2026-08-14'ten beri hazırdı ama PANEL YÜZEYİ
// YOKTU — operatör masraf/gelir/virman giremiyor, dolayısıyla Kasa Defteri
// raporu da fiilen boş kalıyordu.
//
// ⚠️ EKRAN AYRIMI: Tahsilat/Ödeme = CARİ hareketi (cari defterine de yazar),
// burası = kasanın KENDİ defteri (kira, yakıt, virman, açılış). Backend'de de
// ayrı tablo/servis; aynı ekrana koymak "bu ödemenin carisi kim" sorusunu her
// satırda yeniden doğurur.
//
// ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLARDIR. İstek düşerse elimizde boş bir
// dizi kalır ve onu "hareket yok" diye basmak DÜPEDÜZ YALANDIR — kullanıcı
// fişi girmediğini sanıp ikinci kez girer. Interceptor toast'ı saniyelerde
// kaybolur; ekranda kalan cümle doğruyu söylemek zorunda.
//
// ⚠️ KIRPMA SESSİZ DEĞİL: sunucu toplamı gösterilen satırı aşarsa yazılır.
// =============================================================================

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, BookOpen, Receipt } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import type { CashAccountOption } from "../PeriodClose/CashAccountPicker";
import { CashTxnFilterBar } from "./CashTxnFilterBar";
import { CashTxnTable } from "./CashTxnTable";
import { CashTxnFormDialog } from "./CashTxnFormDialog";
import { CashTransferDialog } from "./CashTransferDialog";
import { CashTxnCancelDialog } from "./CashTxnCancelDialog";
import { EMPTY_FILTERS, isFilterDirty, type CashTxnFilterState } from "./cashTxnRules";
import { listCashTransactions, type CashTxnRow } from "./service";

const PAGE_SIZE = 100;

export function CashTransactionsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<CashTxnFilterState>(EMPTY_FILTERS);
  const [account, setAccount] = useState<CashAccountOption | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CashTxnRow | null>(null);

  const q = useQuery({
    queryKey: [
      "finance",
      "cash-transactions",
      filters.account?.kind ?? "",
      filters.account?.id ?? "",
      filters.kind,
      filters.status,
      filters.search,
      filters.from,
      filters.to,
    ],
    queryFn: () => listCashTransactions(filters, 1, PAGE_SIZE),
  });

  // Bir kasa hareketi hem listeyi hem KASA/BANKA BAKİYESİNİ hem kasa defteri
  // raporunu oynatır → dar invalidate ekranın bir yarısını bayat bırakır.
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["finance"] });

  const rows = q.data?.data ?? [];
  const total = q.data?.pagination.total ?? 0;

  return (
    <PageShell>
      <PageHeader
        title="Kasa Hareketleri"
        description="Carisi olmayan para hareketleri: masraf, gelir, hesaplar arası virman ve açılış bakiyesi. Tahsilat/ödeme buraya girilmez — onlar cari defterine de yazar."
        actions={
          <div className="flex gap-2">
            {/* Rapor bağlantısı KAPI DIŞINDA: defteri okumak finance:read işidir
                (F3 dikişi — iki ekran birbirini tanısın). */}
            <Button variant="ghost" onClick={() => navigate("/reports/finance/cash-book")}>
              <BookOpen className="mr-1 h-4 w-4" />
              Kasa Defteri
            </Button>
            <PermissionGate permission="finance:payment">
              <div className="flex gap-2">
                <Button onClick={() => setFormOpen(true)}>
                  <Receipt className="mr-1 h-4 w-4" />
                  Kasa Fişi
                </Button>
                <Button variant="outline" onClick={() => setTransferOpen(true)}>
                  <ArrowLeftRight className="mr-1 h-4 w-4" />
                  Virman
                </Button>
              </div>
            </PermissionGate>
          </div>
        }
      />

      <CashTxnFilterBar
        value={filters}
        account={account}
        onAccountChange={setAccount}
        onChange={setFilters}
      />

      <PageBody className="p-6">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">Hareket listesi yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “kayıt yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi. Kayıtlarınız
              yerinde duruyor; yeni fiş girmeden önce tekrar deneyin.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {isFilterDirty(filters)
              ? "Bu filtreyle hareket yok. Filtreleri temizleyip tekrar bakın."
              : "Kasa hareketi yok. “Kasa Fişi” ile masraf/gelir, “Virman” ile hesaplar arası aktarım girebilirsiniz."}
          </div>
        ) : (
          <>
            <CashTxnTable rows={rows} onCancel={setCancelTarget} />
            {total > rows.length && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-500">
                {total} kaydın ilk {rows.length} tanesi gösteriliyor (en yeni tarihten geriye). Aradığınızı
                bulmak için hesap, tür ya da tarih filtresini kullanın.
              </p>
            )}
          </>
        )}
      </PageBody>

      {/* Diyaloglar KOŞULLU mount: her açılış taze bileşen — ve `clientToken`
          da tazelenir (tek mount = tek mantıksal deneme). */}
      {formOpen && (
        <CashTxnFormDialog open onOpenChange={setFormOpen} onCreated={invalidate} />
      )}
      {transferOpen && (
        <CashTransferDialog open onOpenChange={setTransferOpen} onCreated={invalidate} />
      )}
      {cancelTarget && (
        <CashTxnCancelDialog
          target={cancelTarget}
          rows={rows}
          open
          onOpenChange={(o) => !o && setCancelTarget(null)}
          onDone={invalidate}
        />
      )}
    </PageShell>
  );
}
