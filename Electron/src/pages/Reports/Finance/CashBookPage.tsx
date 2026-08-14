// =============================================================================
// KASA & BANKA DEFTERİ — devir + dönem hareketleri + yürüyen bakiye
// =============================================================================
// ⚠️ İKİ SORGU, BİLİNÇLİ: özet sorgusu TÜM hesapları getirir ("hangi hesapta ne
// kadar hareket var"), defter sorgusu YALNIZ seçileni. Tek sorguya indirmek
// imkânsız: `accountId` gönderildiğinde backend özet listesini de o hesaba
// daraltır ve "hangi hesabı seçeyim" sorusunun cevabı ekrandan kaybolur. İkinci
// sorgu hesap seçilmeden HİÇ koşmaz (`enabled`).
//
// ⚠️ ÜÇ YAZAR TEK DEFTERDE: tahsilat/ödeme (`Payment`), carisiz kasa hareketi
// (`CashTransaction`) ve çek olayı (COLLECT/PAY). Üçüncüsünü atlayan bir defter
// ilk çek tahsilatında bakiyeyle ayrışır ve "para nereden geldi" sorusunu
// cevaplayamaz.
//
// ⚠️ ÇEKİN TAHSİLE VERİLMESİ (DEPOSIT) BURADA GÖRÜNMEZ ve bu DOĞRUDUR: çek
// bankaya teslim edilmiştir ama para henüz gelmemiştir. Deftere yazılsaydı
// bakiye, hesapta olmayan parayı gösterirdi.
// =============================================================================

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Info, Landmark, Wallet } from "lucide-react";
import { MetricCard, ReportDateRange, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtDate } from "../_components/formatters";
import { formatDayKey } from "../../Finance/PeriodClose/service";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { Button } from "@/components/ui/button";
import { CashAccountsTable } from "./CashAccountsTable";
import { CashBookFilterBar } from "./CashBookFilterBar";
import { CashLedgerTable } from "./CashLedgerTable";
import { ReportErrorCard } from "./ReportErrorCard";
import { ReportNotesCard } from "./ReportNotesCard";
import { buildCashBookExport } from "./cashBookExport";
import {
  emptyCashBookReport,
  getCashBookReport,
  type CashAccountKind,
  type CashBookAccountSummary,
} from "./cashBookService";
import { moneyStr } from "./service";

const DEFAULT_DAYS = 30;

export function CashBookPage() {
  const { params, dateFrom, dateTo } = useReportDateRange(DEFAULT_DAYS);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [picked, setPicked] = useState<CashBookAccountSummary | null>(null);

  const accountKind = (sp.get("accountKind") as CashAccountKind | null) ?? "";
  const includeInactive = sp.get("inactive") === "1";
  const accountId = sp.get("accountId") ?? "";

  const patch = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next, { replace: true });
  };

  const summaryQ = useQuery({
    queryKey: ["reports", "finance", "cash-book", params, accountKind, includeInactive],
    queryFn: () =>
      getCashBookReport({ ...params, accountKind: accountKind || undefined, includeInactive }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const ledgerQ = useQuery({
    queryKey: ["reports", "finance", "cash-book-ledger", params, accountId],
    queryFn: () => getCashBookReport({ ...params, accountId }),
    enabled: Boolean(params.dateFrom && params.dateTo && accountId),
    staleTime: 30_000,
  });

  const summary = summaryQ.data?.data;
  const ledger = ledgerQ.data?.data;
  // ⚠️ SIRA: önce DEFTER yanıtının kendi özeti, sonra genel özet listesi, en son
  // `picked`. Sezgi tersini söyler ("özet listesi asıl kaynak") ama backend
  // hareket sorgusunu 5000 satırda KIRPIYOR ve kırpma TÜM hesaplara birden
  // uygulanıyor: `accountId` gönderilmeyen ÖZET sorgusu kırpılırsa o hesabın
  // `totalIn/totalOut/closing/movementCount` değerleri sessizce EKSİK çıkar.
  // Defter sorgusu ise tek hesaba daraltılmıştır, yani aynı hesap için her
  // zaman ≥ doğruluktadır. Eski sıra, defter kartının başlığındaki "Kapanış"
  // ile satır listesinin son "yürüyen bakiye"sini AYNI KARTTA çelişkiye
  // düşürebiliyordu. İkisi de aynı `params` (dönem) ile koşar; fark yalnız
  // kırpmadan doğar. `picked` tıklama anındaki kopyadır ve tarih değişince
  // BAYATLAR — bu yüzden son çaredir.
  const account =
    ledger?.accounts.find((a) => a.accountId === accountId) ??
    summary?.accounts.find((a) => a.accountId === accountId) ??
    picked;

  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const totals = summary?.totals ?? null;
  const totalsCurrency = summary?.accounts[0]?.currency;
  // Kartlar: hesap seçiliyse O hesabın rakamları, değilse genel toplam. Genel
  // toplam yalnız TEK para birimi varsa vardır (backend `totals`'ı o zaman
  // doldurur) — farklı birimli kasaları toplamak "kasada 1,2 milyon var"
  // yalanıdır ve kartları "—" ile çizmek de yanlış olurdu (okuyucu sıfır sanar).
  const cardSource = account ?? totals;
  const cardCurrency = account?.currency ?? totalsCurrency ?? "TRY";

  const spec = useMemo(
    () => () =>
      summary
        ? buildCashBookExport({
            summary,
            ledger: account && ledger?.rows ? { account, report: ledger } : null,
            periodLabel,
          })
        : null,
    [summary, ledger, account, periodLabel],
  );

  return (
    <ReportPageLayout
      title="Kasa & Banka Defteri"
      description="Devir, dönem hareketleri ve yürüyen bakiye — tahsilat, kasa hareketi ve çek tahsili birlikte."
      actions={
        <div className="flex items-center gap-2">
          {/* Defteri açıp eksik/yanlış fiş gören kişinin gideceği yer (F3 dikişi):
              masraf/gelir/virman girişi rapor değil, Kasa Hareketleri ekranıdır. */}
          <Button variant="outline" size="sm" onClick={() => navigate("/finance/cash-transactions")}>
            Kasa Hareketleri
          </Button>
          <ReportExportBar disabled={!summary} buildSpec={spec} />
        </div>
      }
      filters={
        <>
          <ReportDateRange defaultDays={DEFAULT_DAYS} />
          <CashBookFilterBar
            accountKind={accountKind}
            includeInactive={includeInactive}
            hasSelection={Boolean(accountId)}
            onChangeKind={(v) => patch("accountKind", v)}
            onToggleInactive={() => patch("inactive", includeInactive ? "" : "1")}
            onClearSelection={() => {
              patch("accountId", "");
              setPicked(null);
            }}
          />
        </>
      }
    >
      {/* ⚠️ HATA DALI EN ÜSTTE. Aksi halde 403/500'de ekran "hareketi olan
          kasa/banka hesabı yok" der — kasa raporunda bu, boş ekrandan çok daha
          kötüdür (kullanıcı "para hiç hareket etmemiş" diye okur). Fabrika
          kurulumunda en sık sebep `finance.enabled` kapalı → 403; o cümle
          YALNIZ hata gövdesinde yaşar (bkz. `ReportErrorCard`). */}
      {summaryQ.isError ? (
        <ReportErrorCard error={summaryQ.error} onRetry={() => void summaryQ.refetch()} />
      ) : null}

      {summaryQ.isError ? null : cardSource ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label={account ? "Devir" : "Devir (tüm hesaplar)"}
            value={moneyStr(cardSource.opening, cardCurrency)}
            // Kaynak notu (K5): hesabın aktif dönem kapanışı varsa devir o
            // kapanışın MÜHÜRLÜ rakamından kurulur ve kaynağı burada söylenir.
            // Alan yoksa (mühürsüz hesap / eski backend) bugünkü metin birebir.
            hint={
              account?.sealedThrough
                ? `${formatDayKey(account.sealedThrough)} kapanışından devir — hesap o güne kadar mühürlü`
                : "Dönemden ÖNCEKİ hareketlerin toplamı — saklanan bakiyeden hesaplanmaz"
            }
            icon={Wallet}
            isLoading={summaryQ.isLoading}
          />
          <MetricCard
            label="Giriş"
            value={moneyStr(cardSource.totalIn, cardCurrency)}
            icon={ArrowDownLeft}
            tone="ok"
            isLoading={summaryQ.isLoading}
          />
          <MetricCard
            label="Çıkış"
            value={moneyStr(cardSource.totalOut, cardCurrency)}
            icon={ArrowUpRight}
            tone="warn"
            isLoading={summaryQ.isLoading}
          />
          <MetricCard
            label="Kapanış"
            value={moneyStr(cardSource.closing, cardCurrency)}
            hint={account ? `${account.name} · ${account.code}` : "Tek para birimi olduğu için toplandı"}
            icon={Landmark}
            isLoading={summaryQ.isLoading}
          />
        </div>
      ) : summary ? (
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Listede farklı para birimli hesaplar var; <strong>genel toplam basılmadı</strong>. Her hesap
            kendi biriminde okunur — bir hesabın defterini açarsanız o hesabın devir/kapanış rakamlarını
            burada görürsünüz.
          </span>
        </div>
      ) : null}

      {summaryQ.isError ? null : summaryQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : (summary?.accounts.length ?? 0) === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Bu dönemde hareketi olan kasa/banka hesabı yok. Pasif ve bakiyesiz hesaplar gizlenir — “Pasif
          hesapları da göster” ile açabilirsiniz.
        </div>
      ) : summary ? (
        <CashAccountsTable
          report={summary}
          selectedAccountId={accountId || null}
          onSelect={(a) => {
            setPicked(a);
            patch("accountId", a.accountId);
          }}
        />
      ) : null}

      {accountId && ledgerQ.isError ? (
        <ReportErrorCard error={ledgerQ.error} onRetry={() => void ledgerQ.refetch()} />
      ) : accountId && account ? (
        <CashLedgerTable
          account={account}
          report={ledger ?? emptyCashBookReport()}
          isLoading={ledgerQ.isLoading}
        />
      ) : null}

      <ReportNotesCard title="Bu defter nasıl okunur" notes={summary?.notes ?? []} />
    </ReportPageLayout>
  );
}
