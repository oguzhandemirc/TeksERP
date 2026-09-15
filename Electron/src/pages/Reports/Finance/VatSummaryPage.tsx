// =============================================================================
// KDV DÖNEM ÖZETİ — satış/alış ayrı, oran kırılımlı; BEYANNAME DEĞİL
// =============================================================================
// ⚠️ İKİ BLOK, İKİ SORU: "bu dönem ne kadar KDV HESAPLADIK" (satış) ve "ne
// kadar KDV YÜKLENDİK" (alış). İkisi tek tabloya karıştırılırsa muhasebeci
// beyannameye giden iki rakamı kendisi ayıklamak zorunda kalır.
//
// ⚠️ İADE SATIRI GİZLENMEZ: iade faturası kendi bloğunda ayrı satırdır, ara
// toplam ve TL genel toplam NET (ileri − iade) yazar. Muhasebeci iki rakamı
// da ister — yalnız net göstermek "neden eksik beyan ettik" sorusunu cevapsız
// bırakır, yalnız brüt göstermek iadeyi unutturur.
//
// ⚠️ EKRAN HİÇBİR TUTARI TOPLAMAZ: string tutarlarla aritmetik kuruş kaydırır
// (Finance/service başlığı). Her toplam backend'den gelir; bu yüzden ara
// toplam satırının TL matrah/KDV hücreleri backend vermediği için BOŞtur
// (uydurma toplam basılmaz — `vatExport.ts` ile aynı kural).
//
// ⚠️ `reconDiff` "0.00" değilse KIRMIZI bant: oran satırlarının TL toplamı
// belge TL toplamından ayrışıyorsa dağıtım hatası vardır ve rakamlara
// güvenilmemelidir — sessiz kalmak bu raporun tek ölümcül hatası olurdu.
// =============================================================================

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Info, Percent } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MetricCard, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtDate } from "../_components/formatters";
import { useSearchParams } from "react-router-dom";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { ReportDateFilter, ReportFilterNotes } from "../_components";
import { filterNotes } from "../_hooks/reportAxisFilters";
import { ReportErrorCard } from "./ReportErrorCard";
import { ReportNotesCard } from "./ReportNotesCard";
import { moneyStr, type Currency } from "./service";
import { buildVatSummaryExport } from "./vatExport";
import {
  getVatSummaryReport,
  vatRateLabel,
  vatRowKindLabel,
  VAT_YONLERI,
  VAT_YON_ETIKET,
  type VatBlock,
  type VatYon,
} from "./vatService";

export function VatSummaryPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("finance/vat-summary");
  // ⚠️ CARİ EKSENİ YOK: backend şeması `.strict()` ve `cariId` KABUL ETMİYOR —
  // göndermek 400 verirdi. KDV özeti belge bazlıdır, cari bazlı değil.
  const [sp, setSp] = useSearchParams();
  const yon = (sp.get("yon") as VatYon | null) ?? "";
  const oran = sp.get("oran") ?? "";
  const patch = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next, { replace: true });
  };

  const q = useQuery({
    queryKey: ["reports", "finance", "vat-summary", params, yon, oran],
    queryFn: () => getVatSummaryReport({ ...params, yon: yon || undefined, oran: oran || undefined }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const report = q.data?.data;
  const oranSecenekleri = q.data?.meta?.secenekler?.oran ?? [];
  const suzgecNotlari = filterNotes([
    { eksen: "Yön", degerler: yon ? [VAT_YON_ETIKET[yon]] : [] },
    { eksen: "KDV oranı", degerler: oran ? [oranSecenekleri.find((o) => o.code === oran)?.ad ?? oran] : [] },
  ]);
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const empty = report && report.sales.docCount === 0 && report.purchase.docCount === 0;
  const reconBroken =
    report &&
    (report.sales.totalsTry.reconDiff !== "0.00" || report.purchase.totalsTry.reconDiff !== "0.00");

  const spec = useMemo(
    () => () => (report ? buildVatSummaryExport({ report, periodLabel, filterNotes: suzgecNotlari }) : null),
    [report, periodLabel, suzgecNotlari],
  );

  return (
    <ReportPageLayout
      reportKey="finance/vat-summary"
      title="KDV Dönem Özeti"
      description="Satış ve alış faturalarının oran kırılımlı matrah + KDV + tevkifat özeti — beyanname değildir, muhasebeciye giden dönem özetidir."
      actions={<ReportExportBar disabled={!report} buildSpec={spec} />}
      filters={
        <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs">
          <ReportDateFilter reportKey="finance/vat-summary" bare />
          <span className="ml-2 mr-1 text-muted-foreground">Yön</span>
          <select value={yon} onChange={(e) => patch("yon", e.target.value)} className="h-7 rounded-md border bg-background px-2 text-xs">
            <option value="">Tüm yönler</option>
            {VAT_YONLERI.map((y) => (
              <option key={y} value={y}>{VAT_YON_ETIKET[y]}</option>
            ))}
          </select>
          {/* Oran AÇIK küme: seçenekler dönemde GEÇEN oranlardan gelir (sunucu),
              sabit bir liste yazmak kaldırılmış bir oranı sonsuza dek çizerdi. */}
          <span className="ml-2 mr-1 text-muted-foreground">KDV oranı</span>
          <select
            value={oran}
            onChange={(e) => patch("oran", e.target.value)}
            disabled={oranSecenekleri.length === 0}
            className="h-7 rounded-md border bg-background px-2 text-xs disabled:opacity-50"
          >
            <option value="">{oranSecenekleri.length === 0 ? "Dönemde oran yok" : "Tüm oranlar"}</option>
            {oranSecenekleri.map((o) => (
              <option key={o.code} value={o.code!}>{o.ad}</option>
            ))}
          </select>
        </div>
      }
    >
      <ReportFilterNotes notes={suzgecNotlari} />
      {/* Hata dalı EN ÜSTTE — 403/500'de "fatura yok" demek, boş ekrandan
          kötüdür (fabrika kurulumunda en sık sebep `finance.enabled` kapalı). */}
      {q.isError ? <ReportErrorCard error={q.error} onRetry={() => void q.refetch()} /> : null}

      {q.isError ? null : reconBroken ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Mutabakat sapması:</strong> oran satırlarının TL toplamı, faturaların damgalı TL
            toplamından ayrışıyor (satış {report?.sales.totalsTry.reconDiff} · alış{" "}
            {report?.purchase.totalsTry.reconDiff}). Dağıtım hatası — bu rakamlara güvenmeden önce
            bildirin.
          </span>
        </div>
      ) : null}

      {q.isError ? null : report ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Hesaplanan KDV — Satış (TL)"
            value={moneyStr(report.sales.totalsTry.netVat, "TRY")}
            hint="İade düşülmüş net; her belge kendi kur damgasıyla"
            icon={ArrowUpFromLine}
            isLoading={q.isLoading}
          />
          <MetricCard
            label="Yüklenilen KDV — Alış (TL)"
            value={moneyStr(report.purchase.totalsTry.netVat, "TRY")}
            hint="İade düşülmüş net"
            icon={ArrowDownToLine}
            isLoading={q.isLoading}
          />
          <MetricCard
            label="Satış toplamı (TL, net)"
            value={moneyStr(report.sales.totalsTry.net, "TRY")}
            hint={`${report.sales.docCount} belge (iade dahil)`}
            icon={Percent}
            isLoading={q.isLoading}
          />
          <MetricCard
            label="Alış toplamı (TL, net)"
            value={moneyStr(report.purchase.totalsTry.net, "TRY")}
            hint={`${report.purchase.docCount} belge (iade dahil)`}
            icon={Percent}
            isLoading={q.isLoading}
          />
        </div>
      ) : null}

      {q.isError ? null : q.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : empty ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Bu dönemde onaylanmış fatura yok. Taslak ve iptal edilmiş faturalar rapora girmez; dönem
          çıpası fatura tarihidir.
        </div>
      ) : report ? (
        <>
          <VatBlockCard block={report.sales} />
          <VatBlockCard block={report.purchase} />
        </>
      ) : null}

      {report && !empty ? (
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Bu rapor <strong>KDV beyannamesi değildir</strong> — resmî beyan dış muhasebe
            programından yapılır. TL kolonları her faturanın <strong>kendi kur damgasıyla</strong>{" "}
            çevrilir; bugünkü kurla yeniden çevrim yapılmaz.
          </span>
        </div>
      ) : null}

      <ReportNotesCard title="Bu özet nasıl okunur" notes={report?.notes ?? []} />
    </ReportPageLayout>
  );
}

// -----------------------------------------------------------------------------
// Blok tablosu — para birimi grupları + oran satırları + net ara toplam
// -----------------------------------------------------------------------------

function VatBlockCard({ block }: { block: VatBlock }) {
  const title = block.kind === "SALES" ? "Satış KDV" : "Alış KDV";
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {block.kind === "SALES"
              ? "Satış + satış iadesi faturaları — iade satırı ayrı, toplam net."
              : "Alış + alış iadesi faturaları — tevkifat KDV üzerinden, toplam net."}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{block.docCount} belge</span>
      </div>

      {block.currencies.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Bu dönemde bu blokta onaylanmış fatura yok.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Para</th>
                <th className="px-3 py-2 text-left">Tür</th>
                <th className="px-3 py-2 text-left">Oran</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Belge</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Matrah</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">KDV</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Tevkifat</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Matrah (TL)</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">KDV (TL)</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Toplam (TL)</th>
              </tr>
            </thead>
            <tbody>
              {block.currencies.map((cur) => {
                const c = cur.currency as Currency;
                return [
                  ...cur.rows.map((r, i) => (
                    <tr
                      key={`${cur.currency}-${r.isReturn ? "r" : "f"}-${r.vatRate}`}
                      className={cn("border-t", r.isReturn && "bg-amber-500/5")}
                    >
                      <td className="px-3 py-2 text-muted-foreground">{i === 0 ? cur.currency : ""}</td>
                      <td className={cn("px-3 py-2", r.isReturn && "text-amber-700 dark:text-amber-400")}>
                        {vatRowKindLabel(block.kind, r.isReturn)}
                      </td>
                      <td className="px-3 py-2 font-medium">{vatRateLabel(r.vatRate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.docCount}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{moneyStr(r.base, c)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{moneyStr(r.vat, c)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {r.withholding === "0.00" ? "—" : moneyStr(r.withholding, c)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {moneyStr(r.baseTry, "TRY")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {moneyStr(r.vatTry, "TRY")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                        {moneyStr(r.totalTry, "TRY")}
                      </td>
                    </tr>
                  )),
                  <tr key={`${cur.currency}-net`} className="border-t bg-muted/30 font-medium">
                    <td className="px-3 py-2 text-muted-foreground">{cur.currency}</td>
                    <td className="px-3 py-2" colSpan={2}>
                      Ara toplam (net{cur.returns ? ", iade düşülmüş" : ""})
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {cur.forward.docCount + (cur.returns?.docCount ?? 0)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {moneyStr(cur.net.base, c)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {moneyStr(cur.net.vat, c)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {cur.net.withholding === "0.00" ? "—" : moneyStr(cur.net.withholding, c)}
                    </td>
                    {/* TL matrah/KDV kırılımı para birimi ara toplamında backend'den
                        gelmez; istemci TOPLAMAZ (kuruş kaydırır) → boş bırakılır. */}
                    <td className="px-3 py-2 text-right text-muted-foreground/50">—</td>
                    <td className="px-3 py-2 text-right text-muted-foreground/50">—</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {moneyStr(cur.net.grandTry, "TRY")}
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/50 font-semibold">
                <td className="px-3 py-2" colSpan={3}>
                  TL genel toplam (net)
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{block.docCount}</td>
                <td className="px-3 py-2" colSpan={3} />
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(block.totalsTry.netBase, "TRY")}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(block.totalsTry.netVat, "TRY")}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(block.totalsTry.net, "TRY")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
