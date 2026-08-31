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
//
// ⚠️ KATEGORİ KIRILIMI (H7) DEFTERİN ÜSTÜNDE durur: defter "ne oldu"yu satır
// satır, kırılım "para nereden geldi / nereye gitti"yi tek bakışta söyler ve
// operatörün ilk sorusu ikincisidir. Kapsamı seçili hesabı İZLER — hesap
// seçiliyse o hesabın kırılımı, seçili değilse tüm hesapların; altındaki defter
// tablosuyla farklı kapsamda olsaydı aynı ekranda iki farklı "dönem çıkışı"
// rakamı dururdu.
// =============================================================================

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Info, Landmark, PieChart, Wallet } from "lucide-react";
import { MetricCard, ReportDateRange, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtDate } from "../_components/formatters";
import { formatDayKey } from "../../Finance/PeriodClose/service";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CashAccountsTable } from "./CashAccountsTable";
import { CashBookFilterBar } from "./CashBookFilterBar";
import { CashLedgerTable } from "./CashLedgerTable";
import { ReportErrorCard } from "./ReportErrorCard";
import { ReportNotesCard } from "./ReportNotesCard";
import { buildCashBookExport } from "./cashBookExport";
import {
  CASH_CATEGORY_GROUP_LABEL,
  emptyCashBookReport,
  getCashBookReport,
  type CashAccountKind,
  type CashBookAccountSummary,
  type CashBookReport,
} from "./cashBookService";
import { moneyStr } from "./service";

const DEFAULT_DAYS = 30;

/**
 * KATEGORİ KIRILIMI BLOĞU — dönem hareketlerinin KAYNAK dökümü.
 *
 * ⚠️ TOPLAM SATIRI BURADA HESAPLANMAZ, backend'den gelir: satırları toplamak
 * (a) string tutarları float'a çevirip kuruş kaydırır (`service.ts` başlığı),
 * (b) çok para birimli kırılımda anlamsız bir sayı üretir. Toplam yalnız tek
 * para biriminin kesin olduğu iki durumda basılır — hesap seçiliyse o hesabın
 * rakamı, seçili değilse `totals` (backend onu zaten yalnız tek para biriminde
 * doldurur). Toplam satırının EKRANDAKİ İŞİ, "kovalar dönem toplamını verir mi"
 * sorusunu operatörün gözüyle doğrulatmaktır (bekçi aynı eşitliği mekanik
 * ölçer).
 *
 * ⚠️ "NETLEŞTİ" ROZETİ olmadan iptal edilmiş bir gider kovası "net 0" diye
 * görünür ve okuyucu onu HATA sanar; oysa bu, iptalin iki satırla defterde
 * durmasının doğal sonucudur.
 */
function CashCategoryBlock({
  report,
  account,
  scopeLabel,
}: {
  report: CashBookReport;
  /** Seçili hesap — toplam satırının backend kaynağı. Yoksa `null`. */
  account: CashBookAccountSummary | null;
  scopeLabel: string;
}) {
  // Eski backend alanı hiç göndermez → blok ÇİZİLMEZ (boş tablo değil).
  const rows = report.categories ?? [];
  if (rows.length === 0) return null;

  const currencies = [...new Set(rows.map((r) => r.currency))];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <PieChart className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Kategori kırılımı</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {scopeLabel} · Kategori yalnız kasa hareketlerinde sorulur; tahsilat/ödeme, çek ve virman
              kendi kovalarında toplanır.
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Kaynak / Kategori</th>
              <th className="px-3 py-2 text-left">Tür</th>
              <th className="px-3 py-2 text-right">Giren</th>
              <th className="px-3 py-2 text-right">Çıkan</th>
              <th className="px-3 py-2 text-right">Net</th>
              <th className="px-3 py-2 text-right">Hareket</th>
            </tr>
          </thead>
          {currencies.map((cur) => {
            const list = rows.filter((r) => r.currency === cur);
            // Toplam kaynağı: hesap → hesabın kendi rakamı; hesapsız → yalnız
            // tek para birimli kurulumda backend `totals`ı. Aksi hâlde YOK.
            const totals =
              account && account.currency === cur
                ? { totalIn: account.totalIn, totalOut: account.totalOut }
                : !account && report.totals && currencies.length === 1
                  ? { totalIn: report.totals.totalIn, totalOut: report.totals.totalOut }
                  : null;
            return (
              <tbody key={cur}>
                {currencies.length > 1 ? (
                  <tr className="border-t bg-muted/30">
                    <td className="px-3 py-1.5 text-xs font-medium" colSpan={6}>
                      {cur}
                    </td>
                  </tr>
                ) : null}
                {list.map((c) => {
                  // Gösterim dönüşümü (toplama DEĞİL) — `moneyStr`in `Number()`
                  // kullanmasıyla aynı gerekçe: tek değerin işaretine bakılır.
                  const netSign = Number(c.net);
                  const netted = c.net === "0.00" && c.totalIn !== "0.00" && c.totalOut !== "0.00";
                  return (
                    <tr key={`${cur}-${c.key}`} className="border-t">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(c.key === "CAT:" && "text-muted-foreground")}>{c.label}</span>
                          {netted ? (
                            <Badge className="bg-muted text-muted-foreground" title="Bu kovadaki bir belge iptal edildi: asıl ve ters satır birbirini götürdü.">
                              NETLEŞTİ
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {CASH_CATEGORY_GROUP_LABEL[c.group]}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-success">
                        {c.totalIn === "0.00" ? "" : moneyStr(c.totalIn, cur)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-destructive">
                        {c.totalOut === "0.00" ? "" : moneyStr(c.totalOut, cur)}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums",
                          netSign > 0 && "text-success",
                          netSign < 0 && "text-destructive",
                          netSign === 0 && "text-muted-foreground",
                        )}
                      >
                        {moneyStr(c.net, cur)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {c.movementCount}
                      </td>
                    </tr>
                  );
                })}
                {totals ? (
                  <tr className="border-t-2 bg-muted/50 font-semibold">
                    <td className="px-3 py-2" colSpan={2}>
                      DÖNEM TOPLAMI{currencies.length > 1 ? ` (${cur})` : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {moneyStr(totals.totalIn, cur)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {moneyStr(totals.totalOut, cur)}
                    </td>
                    <td className="px-3 py-2" colSpan={2} />
                  </tr>
                ) : null}
              </tbody>
            );
          })}
        </table>
      </div>
    </Card>
  );
}

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

      {/* ⚠️ KAPSAM SEÇİLİ HESABI İZLER (dosya başlığı). Hesap seçiliyken defter
          yanıtı kullanılır — hem altındaki defter tablosuyla aynı kaynak, hem de
          `summary` çok hesaplı kırpmadan etkilenebilir (üstteki "SIRA" notu). */}
      {summaryQ.isError ? null : accountId ? (
        account && ledger ? (
          <CashCategoryBlock report={ledger} account={account} scopeLabel={`${account.name} · ${account.code}`} />
        ) : null
      ) : summary ? (
        <CashCategoryBlock report={summary} account={null} scopeLabel="Tüm hesaplar" />
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
