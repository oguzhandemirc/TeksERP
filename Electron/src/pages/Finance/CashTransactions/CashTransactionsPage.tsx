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

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, BookOpen, PieChart, Receipt } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListFooter } from "@/components/layout/ListPage";
import { TruncatedHint } from "../TruncatedHint";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import type { CashAccountOption } from "../PeriodClose/CashAccountPicker";
import { CashTxnFilterBar } from "./CashTxnFilterBar";
import { CashTxnTable, useCashTxnTable } from "./CashTxnTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { CashTxnFormDialog } from "./CashTxnFormDialog";
import { CashTransferDialog } from "./CashTransferDialog";
import { CashTxnCancelDialog } from "./CashTxnCancelDialog";
import { ExpenseAllocationsDialog } from "./allocation/ExpenseAllocationsDialog";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { EMPTY_FILTERS, isFilterDirty, type CashTxnFilterState } from "./cashTxnRules";
import { listCashTransactions, type CashTxnRow } from "./service";

const PAGE_SIZE = 100;

export function CashTransactionsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Bağdan gelen açılış (`?search=KH…`, `?category=<anahtar>`): arama kutusu tohumlanır, sonrası yerel durum (bağ paylaşımı değil, geliş).
  const [sp] = useSearchParams();
  const [filters, setFilters] = useState<CashTxnFilterState>(() => ({
    ...EMPTY_FILTERS,
    search: sp.get("search") ?? "",
    category: sp.get("category") ?? "",
  }));
  const [account, setAccount] = useState<CashAccountOption | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CashTxnRow | null>(null);
  const [allocTarget, setAllocTarget] = useState<CashTxnRow | null>(null);
  const allocOn = useFeatureFlags().data?.data?.financeExpenseAllocationField === "OPTIONAL";

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
      filters.category,
    ],
    queryFn: () => listCashTransactions(filters, 1, PAGE_SIZE),
  });

  // Bir kasa hareketi hem listeyi hem KASA/BANKA BAKİYESİNİ hem kasa defteri
  // raporunu oynatır → dar invalidate ekranın bir yarısını bayat bırakır.
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["finance"] });

  const rows = useMemo(() => q.data?.data ?? [], [q.data]);
  const table = useCashTxnTable(rows, { onCancel: setCancelTarget, onAllocations: allocOn ? setAllocTarget : undefined });
  const total = q.data?.pagination.total ?? 0;

  return (
    <PageShell>
      <PageHeader
        title="Kasa Hareketleri"
        description="Carisi olmayan para hareketleri: masraf, gelir, hesaplar arası virman ve açılış bakiyesi. Tahsilat/ödeme buraya girilmez — onlar cari defterine de yazar."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["finance", "cash-transactions"]} />
            {/* Rapor bağlantısı KAPI DIŞINDA: defteri okumak finance:read işidir
                (F3 dikişi — iki ekran birbirini tanısın). */}
            <Button variant="ghost" onClick={() => navigate("/reports/finance/cash-book")}>
              <BookOpen className="mr-1 h-4 w-4" />
              Kasa Defteri
            </Button>
            {/* Masraf özeti rapor izniyle açılır — izinsize düğme çizilmez (forbidden'a düşmesin). */}
            <PermissionGate permission="report:finance">
              <Button variant="ghost" onClick={() => navigate("/reports/finance/masraf-ozeti")}>
                <PieChart className="mr-1 h-4 w-4" />
                Masraf Özeti
              </Button>
            </PermissionGate>
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
        tools={<DataTableTools table={table} compact exportName="Kasa hareketleri" />}
      />

      {/* Hata ile "kayıt yok" ayrı ekranlar (DataTable.isError) — hata anında boş liste mükerrer fiş doğurur. */}
      <CashTxnTable
        table={table}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => void q.refetch()}
        errorText="Hareket listesi yüklenemedi — istek sunucuya ulaşamadı ya da reddedildi."
        emptyText={isFilterDirty(filters) ? "Bu filtreyle hareket yok." : "Henüz kasa hareketi yok."}
        emptyDescription={isFilterDirty(filters) ? "Filtreleri temizleyip tekrar bakın." : "“Kasa Fişi” ile masraf/gelir, “Virman” ile hesaplar arası aktarım girilir."}
      />
      {/* KIRPMA SESSİZ DEĞİL — alt çubukta (en yeni tarihten geriye ilk sayfa). */}
      <ListFooter loaded={rows.length} total={q.data ? total : null}>
        {total > rows.length && rows.length > 0 ? <TruncatedHint /> : null}
      </ListFooter>

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
      {allocTarget && <ExpenseAllocationsDialog row={allocTarget} onOpenChange={(o) => !o && setAllocTarget(null)} />}
    </PageShell>
  );
}
