// =============================================================================
// CARİ EKSTRE (rapor yüzeyi) — devir + hareketler + yürüyen bakiye
// =============================================================================
// ⚠️ PARA BİRİMİ ZORUNLU ve “hepsi” seçeneği BİLİNÇLİ OLARAK YOK: iki para
// birimini tek yürüyen bakiyede toplamak matematiksel olarak anlamsızdır.
// Varsayılan, tıklanan yaşlandırma bloğunun para birimidir — kullanıcının
// bakmak istediği neredeyse her zaman odur.
//
// ⚠️ “Dönem devri” satırı OPSİYONEL DEĞİL: dönem başından önceki tüm
// hareketlerin toplamıdır ve olmadan ekstrenin en çok bakılan sayısı (kapanış
// bakiyesi) YANLIŞ çıkar.
//
// ⚠️ NEDEN `Finance/StatementDialog` KULLANILMIYOR: o diyalog
// `/api/finance/cari/:id/statement`'i çağırır ve kapısı `finance:read`'tir.
// Yalnız `report:finance` taşıyan yönetim kullanıcısı orada 403 alır — ekran
// açılır, tablo boş kalır ve sebebi hiçbir yerde yazmaz. Rapor yüzeyi kendi
// ucunu (`/api/reports/finance/statement`) çağırır.
// =============================================================================

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReportExportBar } from "../_components";
import { fmtDate } from "../_components/formatters";
import { formatDayKey } from "../../Finance/PeriodClose/service";
import { ReportErrorCard } from "./ReportErrorCard";
import { buildStatementExport } from "./statementExport";
import {
  CARI_TXN_SOURCE_LABEL,
  dayEndIso,
  dayStartIso,
  getStatementReport,
  isZeroAmount,
  moneyStr,
  toYmd,
  type Currency,
} from "./service";

const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

export interface StatementTarget {
  cariId: string;
  name: string;
  currency: Currency;
  /**
   * Cari kodu — YALNIZ dışa aktarılan dosyanın kapağında kullanılır (ekran
   * başlığı adı basıyor). OPSİYONEL: bugün çağıran (`AgingReportPage`) geçmiyor,
   * geçmediğinde dosyada da basılmaz — uydurulmaz. Yaşlandırma satırı kodu zaten
   * taşıyor; tek satırlık dikiş için `statementExport.ts` sonundaki nota bak.
   */
  code?: string | null;
}

interface Props {
  target: StatementTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CariStatementDialog({ target, open, onOpenChange }: Props) {
  const defaults = useMemo(() => {
    const today = new Date();
    const back = new Date();
    back.setMonth(back.getMonth() - 3);
    return { from: toYmd(back), to: toYmd(today) };
  }, []);

  const [currency, setCurrency] = useState<Currency>(target?.currency ?? "TRY");
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);

  // ⚠️ Hedef değiştiğinde para birimi yeni carinin bloğuna çekilir. Diyalog
  // çağıran tarafta KOŞULLU mount edilir (`{target ? <Dialog .../> : null}`),
  // yani her açılış taze bileşendir — bu satır yalnız o sözleşme bozulursa
  // devreye girer ve o zaman bile yanlış para birimi göstermez.
  const activeCurrency = target ? currency : "TRY";

  const q = useQuery({
    queryKey: ["reports", "finance", "statement", target?.cariId, activeCurrency, from, to],
    queryFn: () =>
      getStatementReport({
        cariId: target!.cariId,
        currency: activeCurrency,
        dateFrom: dayStartIso(from),
        dateTo: dayEndIso(to),
      }),
    enabled: open && Boolean(target) && Boolean(from) && Boolean(to),
    staleTime: 30_000,
  });

  const data = q.data?.data;

  // Dışa aktarım spec'i TIKLANDIĞINDA kurulur (bkz. `ReportExportBar` gerekçesi).
  // ⚠️ Veri EKRANDAKİ sorgudan okunur — yeni istek atılmaz: dosyanın rakamı
  // ekrandaki rakamdan farklı çıkamaz, çünkü ikisi aynı yanıttan gelir.
  const spec = useMemo(
    () => () =>
      target && data
        ? buildStatementExport({
            cariName: target.name,
            cariCode: target.code ?? null,
            currency: activeCurrency,
            fromYmd: from,
            toYmd: to,
            opening: data.opening,
            closing: data.closing,
            totalDebit: data.totalDebit,
            totalCredit: data.totalCredit,
            carriedFrom: data.carriedFrom ?? null,
            rows: data.rows,
          })
        : null,
    [target, data, activeCurrency, from, to],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{target ? `${target.name} — Cari Ekstre` : "Cari Ekstre"}</DialogTitle>
          <DialogDescription>
            Dönem devri, hareketler ve yürüyen bakiye. Bakiye <strong>pozitifse cari size borçludur</strong>,
            negatifse siz ona borçlusunuz.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Para birimi</Label>
            <select
              className="mt-1 h-9 rounded-md border bg-background px-2 text-sm"
              value={activeCurrency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {/* ⚠️ `max`/`min` çapraz bağlanır: backend `from > to` isteğini 400 ile
              reddediyor ("Başlangıç tarihi bitiş tarihinden büyük olamaz").
              Tarayıcı seçicisinde bu kombinasyonu hiç sunmamak, kullanıcıyı
              geri alması gereken bir hataya sokmamaktır. Elle yazımı
              engellemez — o yüzden hata dalı ayrıca duruyor, bu onun YERİNE
              geçmez. */}
          <div>
            <Label className="text-xs">Başlangıç</Label>
            <Input
              type="date"
              className="mt-1"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Bitiş</Label>
            <Input
              type="date"
              className="mt-1"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          {/* ⚠️ `disabled={!data}` — veri yokken (yükleniyor / hata / boş yanıt)
              düğmeler iş yapmaz. Boş bir Excel indirmek hiç indirmemekten
              KÖTÜDÜR: kullanıcı onu "bu carinin hareketi yok" diye okur. */}
          <div className="ml-auto">
            <ReportExportBar disabled={!data} buildSpec={spec} />
          </div>
        </div>

        {/* ⚠️ Sebep SOMUT yazılır. Eski "Kayıt getirilemedi, aralığı daraltın"
            metni TEK bir tahmindi ve çoğu durumda YANLIŞTI: backend burada üç
            ayrı somut cümle döndürebiliyor — "Başlangıç tarihi bitiş tarihinden
            büyük olamaz", "Tarih aralığı en fazla 366 gün olabilir" ve
            "Ön muhasebe modülü bu kurulumda kapalı". Üçünü tek tahminle
            değiştirmek, kullanıcıyı düzeltemeyeceği bir işe yönlendirirdi. */}
        {q.isError ? (
          <ReportErrorCard error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</p>
        ) : !data ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Ekstre henüz yüklenmedi.
          </div>
        ) : (
          <div className="max-h-[52vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-left">Belge</th>
                  <th className="px-3 py-2 text-left">Kaynak</th>
                  <th className="px-3 py-2 text-left">Açıklama</th>
                  <th className="px-3 py-2 text-right">Borç</th>
                  <th className="px-3 py-2 text-right">Alacak</th>
                  <th className="px-3 py-2 text-right">Bakiye</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t bg-muted/30 font-medium">
                  <td className="px-3 py-2" colSpan={6}>
                    Dönem devri ({fmtDate(from)} öncesi)
                    {/* Kaynak notu (K5): devir mühürlü kapanıştan kuruluyorsa
                        söylenir. Alan yoksa (mühürsüz cari / eski backend) not
                        basılmaz — bugünkü görünüm birebir. Gün anahtarı UTC
                        parçalarından basılır (`formatDayKey`), yerel saatle
                        değil: `@db.Date` UTC gece yarısıdır. */}
                    {data.carriedFrom ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        · {formatDayKey(data.carriedFrom.periodEnd)} kapanışından devir
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyStr(data.opening, activeCurrency)}
                  </td>
                </tr>
                {data.rows.length === 0 ? (
                  <tr className="border-t">
                    <td className="px-3 py-6 text-center text-muted-foreground" colSpan={7}>
                      Bu dönemde hareket yok — bakiye devirden geliyor.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.txnDate)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.docNo ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {CARI_TXN_SOURCE_LABEL[r.sourceType] ?? r.sourceType}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.description ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {isZeroAmount(r.debit) ? "" : moneyStr(r.debit, activeCurrency)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {isZeroAmount(r.credit) ? "" : moneyStr(r.credit, activeCurrency)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {moneyStr(r.running, activeCurrency)}
                      </td>
                    </tr>
                  ))
                )}
                <tr className="border-t-2 bg-muted/50 font-semibold">
                  <td className="px-3 py-2" colSpan={4}>
                    Dönem toplamı
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyStr(data.totalDebit, activeCurrency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyStr(data.totalCredit, activeCurrency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyStr(data.closing, activeCurrency)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
