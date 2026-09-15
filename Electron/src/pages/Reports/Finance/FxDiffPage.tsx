// =============================================================================
// KUR FARKI RAPORU — dövizli kapamalarda gerçekleşen TL farkı (J2)
// =============================================================================
// ⚠️ RAPOR TÜRETİR, DEFTERE YAZMAZ. Kur farkı hiçbir yerde saklanmaz: kapatılan
// tutar × (kaynak kuru − fatura kuru). Kur farkı DEKONTU kesmek ayrı bir
// muhasebe kararıdır (cari bakiyeye dokunur, belge ister) ve bu ekranda YOKTUR —
// bant bunu açıkça söyler, çünkü "gördüm, demek ki işlendi" varsayımı bu ekranın
// yapabileceği en pahalı yanlış anlamadır.
//
// ⚠️ SÜZGEÇLER SUNUCUYA GİDER (cari + para birimi), istemcide süzülmez. Sebep
// ÖZET KARTLARIDIR: kartlar backend'in `summary`sinden gelir ve satırlar
// istemcide süzülseydi "Net +12.500 TL" başlığı ile üç satırlık bir tablo aynı
// ekranda dururdu. Yaşlandırma raporunda istemci-taraflı arama meşrudur çünkü
// oradaki kartlar ADET sayar; burada kartlar PARA taşıyor.
//
// ⚠️ CARİ SEÇENEKLERİ İÇİN İKİNCİ SORGU (CashBookPage emsali). `cariId`
// gönderildiğinde backend satırları da o cariye daraltır → "hangi cariyi
// seçeyim" sorusunun cevabı ekrandan kaybolurdu. Katalog sorgusu bu yüzden
// süzgeçsiz koşar; anahtarı, cari seçilmeden ÖNCEKİ ana sorgunun anahtarıyla
// BİREBİR aynıdır — yani normal akışta react-query önbelleğinden gelir ve
// EK İSTEK ATILMAZ. Yalnız derin bağlantıyla (`?cariId=…`) girişte bir istek
// daha koşar.
//
// ⚠️ EKRAN HİÇBİR TUTARI TOPLAMAZ: string tutarlarla aritmetik kuruş kaydırır
// (`service.ts` başlığı). Alt toplam satırındaki TL farkı `summary.netTry`'den
// okunur; FX "Tutar" kolonunun toplamı ise BİLİNÇLİ boştur (farklı dövizlerin
// toplamı zaten anlamsız).
// =============================================================================

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Coins, Info, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MetricCard, ReportDateFilter, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtDate, fmtDateTime, fmtInt } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { FxDiffFilterBar } from "./FxDiffFilterBar";
import { ReportFilterNotes, ReportMultiSelect } from "../_components";
import { useAxisNotes, useReportAxes } from "../_hooks/useReportAxes";
import { AXIS_EMPTY_HINTS, AXIS_LABELS } from "../_hooks/reportAxisFilters";

const FX_AXES = ["cariId"] as const;
import { ReportErrorCard } from "./ReportErrorCard";
import { ReportNotesCard } from "./ReportNotesCard";
import { buildFxDiffExport } from "./fxDiffExport";
import { moneyStr, type CariKind, type Currency } from "./service";
import {
  FX_DIFF_NOTES,
  FX_TONE_CLASS,
  FX_TONE_LABEL,
  FX_TONE_METRIC,
  fxRate,
  fxTone,
  getFxDiffReport,
  invoiceTypeLabel,
} from "./fxDiffService";

export function FxDiffPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("finance/fx-diff");
  const [sp, setSp] = useSearchParams();

  // Filtre URL'de yaşar: paylaşılan link filtresiyle birlikte gider (rapor
  // sayfalarının ortak sözleşmesi — `useReportDateRange` de böyle çalışır).
  // Cari ekseni ortak katmanda (`?cariId=a,b`); para birimi ve tür bu rapora özgü.
  const axes = useReportAxes();
  const currency = (sp.get("currency") as Currency | null) ?? "";
  const kind = (sp.get("kind") as CariKind | null) ?? "";
  const patch = (p: { currency?: string; kind?: string }) => {
    const next = new URLSearchParams(sp);
    const set = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k));
    if (p.currency !== undefined) set("currency", p.currency);
    if (p.kind !== undefined) set("kind", p.kind);
    setSp(next, { replace: true });
  };

  const ready = Boolean(params.dateFrom && params.dateTo);

  const q = useQuery({
    queryKey: ["reports", "finance", "fx-diff", params, axes.sel.cariId, currency, kind],
    queryFn: () =>
      getFxDiffReport({
        ...params,
        cariId: axes.sel.cariId,
        currency: currency || undefined,
        kind: kind || undefined,
      }),
    enabled: ready,
    staleTime: 30_000,
  });

  const report = q.data?.data;
  const summary = report?.summary;
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;

  // ⚠️ SEÇENEK KAYNAĞI ARTIK SUNUCU (`meta.secenekler.cariId`, R5b-d): eskiden
  // seçenekler satırlardan türetiliyor ve süzgeçliyken liste daralmasın diye
  // İKİNCİ bir sorgu koşuluyordu. Sunucu listeyi süzgeçten bağımsız döndürdüğü
  // için o sorgu KALKTI — bir istek, tek kaynak.
  const { secenekler, notes: axisNotlari } = useAxisNotes(q.data, axes.sel, FX_AXES, {
    ek: [
      ...(currency ? [`SÜZGEÇ — Para birimi: ${currency}.`] : []),
      ...(kind ? [`SÜZGEÇ — Cari türü: ${kind === "CUSTOMER" ? "Müşteri" : "Fason"}.`] : []),
    ],
  });
  const scopeLines = axisNotlari;

  const spec = useMemo(
    () => () => (report ? buildFxDiffExport({ report, periodLabel, scopeLines }) : null),
    [report, periodLabel, scopeLines],
  );

  // Gösterim dönüşümü (toplama DEĞİL): tek değerin işaretine bakılır — kartı
  // sıfırken de yeşile boyamak "bu dönemde kambiyo kârı var" iddiasıdır.
  const netTone = fxTone(summary?.netTry);
  const hasGain = fxTone(summary?.gainTry) === "gain";
  const hasLoss = fxTone(summary?.lossTry) === "gain";
  const empty = summary?.count === 0;

  return (
    <ReportPageLayout
      reportKey="finance/fx-diff"
      title="Kur Farkı Raporu"
      description="Dövizli faturaları kapatan tahsilat/çeklerde gerçekleşen TL kur farkı — lehte ve aleyhte ayrı."
      actions={<ReportExportBar disabled={!report} buildSpec={spec} />}
      filters={
        <>
          <ReportDateFilter reportKey="finance/fx-diff" />
          <FxDiffFilterBar
            cariSelect={
              <ReportMultiSelect
                id="fx-cari"
                label={AXIS_LABELS.cariId}
                options={secenekler?.cariId}
                value={axes.sel.cariId}
                onChange={(v) => axes.set("cariId", v)}
                emptyHint={AXIS_EMPTY_HINTS.cariId}
              />
            }
            currency={currency}
            kind={kind}
            onChangeKind={(v) => patch({ kind: v })}
            onChangeCurrency={(v) => patch({ currency: v })}
            onClear={() => { patch({ currency: "", kind: "" }); axes.set("cariId", []); }}
          />
        </>
      }
    >
      {/* ⚠️ HATA DALI EN ÜSTTE: 403/500'de ekran "kur farkı doğuran kapama yok"
          DEMEZ. Bu olumlu bir iddiadır ve yanlıştır — fabrika kurulumunda en sık
          sebep `finance.enabled` kapalı olmasıdır ve o cümle yalnız hata
          gövdesinde yaşar (`ReportErrorCard` başlığı). */}
      <ReportFilterNotes notes={axisNotlari} />
      {q.isError ? <ReportErrorCard error={q.error} onRetry={() => void q.refetch()} /> : null}

      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Bu rapor <strong>türetilir, deftere yazmaz</strong> — kur farkı dekontu kesmek ayrı bir
          karardır. Rakamlar kapama satırlarından hesaplanır; kapama çözülürse satır kendiliğinden
          düşer.
        </span>
      </div>

      {/* Veri gelmemişken kart çizilmez: `?? 0` ile "Net 0,00 ₺" basmak,
          hiç ölçülmemiş bir dönemi "farksız" diye okutur (Aging emsali). */}
      {q.isError ? null : summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Lehte (kambiyo kârı)"
            value={moneyStr(summary.gainTry, "TRY")}
            hint="Pozitif farkların toplamı"
            icon={TrendingUp}
            tone={hasGain ? "ok" : "neutral"}
            isLoading={q.isLoading}
          />
          <MetricCard
            label="Aleyhte (kambiyo zararı)"
            value={moneyStr(summary.lossTry, "TRY")}
            hint="Negatif farkların büyüklüğü — pozitif sayı olarak"
            icon={TrendingDown}
            tone={hasLoss ? "bad" : "neutral"}
            isLoading={q.isLoading}
          />
          <MetricCard
            label="Net kur farkı"
            value={moneyStr(summary.netTry, "TRY")}
            hint="Lehte − aleyhte"
            icon={Scale}
            tone={FX_TONE_METRIC[netTone]}
            isLoading={q.isLoading}
          />
          <MetricCard
            label="Kapama sayısı"
            value={fmtInt(summary.count)}
            hint="Farkı sıfır çıkan kapamalar da sayılır"
            icon={Coins}
            isLoading={q.isLoading}
          />
        </div>
      ) : null}

      {/* PARA BİRİMİ KIRILIMI — çip (tablo değil) olarak çizilir: sayfadaki tek
          `<thead>` satır tablosuna aittir ve dışa aktarım bekçisi (§2) ekranın
          başlıklarını oradan okur. İkinci bir tablo başlığı o okumayı sessizce
          yanlış tabloya çevirirdi. */}
      {q.isError ? null : summary && summary.byCurrency.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {summary.byCurrency.map((c) => {
            const tone = fxTone(c.netTry);
            return (
              <Card key={c.currency} className="min-w-44 flex-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold tracking-tight">{c.currency}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {fmtInt(c.count)} kapama
                  </span>
                </div>
                <div className="mt-1.5 space-y-0.5 text-xs">
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Lehte</span>
                    <span className="tabular-nums text-success">{moneyStr(c.gainTry, "TRY")}</span>
                  </p>
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Aleyhte</span>
                    <span className="tabular-nums text-destructive">
                      {moneyStr(c.lossTry, "TRY")}
                    </span>
                  </p>
                  <p className="flex items-center justify-between gap-2 border-t pt-1 font-medium">
                    <span className="text-muted-foreground">Net</span>
                    <span className={cn("tabular-nums", FX_TONE_CLASS[tone])}>
                      {moneyStr(c.netTry, "TRY")}
                    </span>
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}

      {q.isError ? null : q.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : empty ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Bu dönemde kur farkı doğuran dövizli kapama yok. Dönem çıpası{" "}
          <strong>kapamanın tarihidir</strong> — faturanın değil.
          {/* Kapalı bir süzgeci sebep gibi göstermek kullanıcıyı olmayan bir
              düğmeyi aramaya gönderir — ipucu yalnız süzgeç AÇIKKEN basılır. */}
          {axes.any || currency || kind ? " Cari / tür / para birimi süzgecini gevşetip tekrar bakın." : ""}
        </div>
      ) : report ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Kur Farkı Satırları</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Her satır bir KAPAMADIR: aynı fatura birden fazla tahsilatla kapandıysa birden fazla
                satır üretir. Yeni kapama en üstte.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">{fmtInt(report.rows.length)} satır</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Kapama</th>
                  <th className="px-3 py-2 text-left">Cari</th>
                  <th className="px-3 py-2 text-left">Fatura No</th>
                  <th className="px-3 py-2 text-left">Tür</th>
                  <th className="px-3 py-2 text-left">Para</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Fatura Kuru</th>
                  <th className="px-3 py-2 text-left">Kaynak</th>
                  <th className="px-3 py-2 text-left">Kaynak No</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Kaynak Kuru</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Tutar</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Kur Farkı (TL)</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => {
                  const tone = fxTone(r.signedDiffTry);
                  return (
                    <tr
                      key={r.allocationId}
                      // Farkı sıfır olan satır SOLUK basılır ama GİZLENMEZ:
                      // "aynı kurla kapandı" meşru bir sonuçtur ve satırı
                      // saklamak "dövizli kapama olmadı" yalanını üretirdi.
                      className={cn("border-t", tone === "flat" && "text-muted-foreground")}
                    >
                      <td className="whitespace-nowrap px-3 py-2">{fmtDateTime(r.allocatedAt)}</td>
                      <td className="px-3 py-2">{r.cari.name}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{r.invoice.docNo}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {invoiceTypeLabel(r.invoice.type)}
                      </td>
                      <td className="px-3 py-2">{r.invoice.currency}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fxRate(r.invoice.exchangeRate)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {r.source.label}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{r.source.docNo}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fxRate(r.source.exchangeRate)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {moneyStr(r.amount, r.invoice.currency)}
                      </td>
                      {/* Renk TEK BAŞINA taşıyıcı değil: işaretin kendisi
                          ("−1.250,00 ₺") yönü metinle söyler, `title` da adıyla
                          yazar (`DUE_BUCKET_TONE` ile aynı erişilebilirlik kuralı). */}
                      <td
                        title={FX_TONE_LABEL[tone]}
                        className={cn(
                          "whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums",
                          FX_TONE_CLASS[tone],
                        )}
                      >
                        {moneyStr(r.signedDiffTry, "TRY")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 font-semibold">
                  <td className="px-3 py-2" colSpan={9}>
                    TOPLAM (net kur farkı)
                  </td>
                  {/* ⚠️ FX tutar toplamı BİLİNÇLİ BOŞ: backend vermiyor, istemci
                      string tutarları toplamıyor ve farklı dövizlerin toplamı
                      zaten anlamsız (`vatExport` ile aynı karar). */}
                  <td
                    className="px-3 py-2 text-right text-muted-foreground/50"
                    title="Farklı para birimleri toplanmaz"
                  >
                    —
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-right tabular-nums",
                      FX_TONE_CLASS[netTone],
                    )}
                  >
                    {moneyStr(summary?.netTry, "TRY")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      ) : null}

      <ReportNotesCard title="Bu rapor nasıl okunur" notes={FX_DIFF_NOTES} />
    </ReportPageLayout>
  );
}
