// =============================================================================
// ÇEK / SENET VADE TAKVİMİ (H4)
// =============================================================================
// ⚠️ DÖNEM İLERİ BAKAR. Ortak `useReportDateRange` hook'u bilinçli olarak GERİYE
// bakar (son 30 gün) çünkü diğer raporların sorusu "geçen dönemde ne oldu"dur.
// Vade takviminin sorusu tam TERSİ: "önümüzdeki günlerde hangi para girecek,
// hangisi çıkacak". Bu yüzden sayfa kendi penceresini yönetir ve URL anahtarları
// da AYRIDIR (`dueFrom`/`dueTo`) — `dateFrom`/`dateTo` kullanılsaydı başka bir
// rapordan gelen GERİYE bakan aralık burada sessizce uygulanır ve ekran "vade
// yok" derdi.
//
// ⚠️ VARSAYILAN PENCERENİN TEK KAYNAĞI BACKEND'DİR. URL boşken sayfa hiçbir
// tarih göndermez; backend "bugün + 30 gün"ü uygular ve `window` ile geri
// söyler. Ekran o pencereyi gösterir. İstemcide ikinci bir "30" yazsaydık, biri
// değiştiğinde ekran ile veri sessizce ayrışırdı.
//
// ⚠️ İKİ ZAMAN ANLAYIŞI TEK EKRANDA (WIP karnesi emsali): **kovalar** portföyün
// TAMAMINI kapsar ve pencereden BAĞIMSIZDIR, **takvim** yalnız pencereyi. Bu
// ekranda yazılı olarak söylenir; söylenmezse tarih aralığını daraltan kullanıcı
// "vadesi geçmiş çekim kalmadı" diye okur.
//
// ⚠️ VADESİ GEÇMİŞLER AYRI BLOKTA ve EN ÜSTTE. Takvim satırlarının arasına
// karıştırılsaydı, "geçmiş" ile "gelecek" aynı sütunda toplanır ve nakit planı
// olmayan bir parayı planlanmış gösterirdi.
//
// ⚠️ HATA DALI EN ÜSTTE: istek düşerse ekran "vadesi yaklaşan çek yok" DEMEZ
// (bkz. `ReportErrorCard` başlığı). Para ekranında sessiz bir "yok", boş
// ekrandan tehlikelidir.
// =============================================================================

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ReportExportBar, ReportPageLayout } from "../_components";
import { fmtInt } from "../_components/formatters";
import { ReportErrorCard } from "./ReportErrorCard";
import { ReportNotesCard } from "./ReportNotesCard";
import { buildChequeDueExport } from "./chequeDueExport";
import { dayEndIso, dayStartIso, moneyStr } from "./service";
import {
  DUE_BUCKET_LABEL,
  DUE_BUCKET_TONE,
  DUE_KIND_LABEL,
  bucketRows,
  fmtDayKey,
  fmtMonthKey,
  fmtWeekRange,
  foldCalendar,
  getChequeDueSummary,
  shiftDayKey,
  type ChequeDueBucket,
  type ChequeDueCalendarRow,
  type ChequeDueSummary,
  type DuePeriodRow,
} from "./chequeDueService";

/** Kart olarak çizilen kovalar — SIRA anlamlı (geçmiş → uzak). */
const CARD_BUCKETS: ChequeDueBucket[] = ["OVERDUE", "SOON", "MONTH", "LATER"];

export function ChequeDuePage() {
  const [sp, setSp] = useSearchParams();
  const urlFrom = sp.get("dueFrom") ?? "";
  const urlTo = sp.get("dueTo") ?? "";
  const hasWindow = Boolean(urlFrom && urlTo);

  const q = useQuery({
    queryKey: ["reports", "finance", "cheque-due", urlFrom, urlTo],
    queryFn: () =>
      getChequeDueSummary(
        hasWindow ? { dateFrom: dayStartIso(urlFrom), dateTo: dayEndIso(urlTo) } : undefined,
      ),
    staleTime: 30_000,
  });

  const data = q.data;
  // Girdi değerleri: kullanıcı seçtiyse URL, seçmediyse backend'in uyguladığı
  // pencere. Boş bırakmak, ekrandaki takvimin hangi aralığı gösterdiğini
  // görünmez yapardı.
  const fromValue = urlFrom || data?.window.from || "";
  const toValue = urlTo || data?.window.to || "";

  const patch = (from: string, to: string) => {
    const next = new URLSearchParams(sp);
    if (from) next.set("dueFrom", from);
    else next.delete("dueFrom");
    if (to) next.set("dueTo", to);
    else next.delete("dueTo");
    setSp(next, { replace: true });
  };

  // Kısa yolların çıpası BACKEND'İN "bugün"üdür (fabrika takvim günü) —
  // istemcide `new Date()` ile gün kesmek, sunucunun kestiği günden kayabilir
  // ve "7 gün" penceresi kovalarla ayrışırdı. Veri gelmeden kısa yol çizilmez.
  const preset = (days: number) => {
    if (!data) return;
    patch(data.today, shiftDayKey(data.today, days));
  };

  const weeks = useMemo(() => foldCalendar(data?.weeks ?? []), [data]);
  const months = useMemo(() => foldCalendar(data?.months ?? []), [data]);
  const overdue = bucketRows(data, "OVERDUE");

  const spec = useMemo(() => () => (data ? buildChequeDueExport(data) : null), [data]);

  return (
    <ReportPageLayout
      title="Çek / Senet Vade Takvimi"
      description="Hangi hafta ne kadar tahsilat girecek, ne kadar ödeme çıkacak — eksen VADE tarihidir."
      actions={<ReportExportBar disabled={!data} buildSpec={spec} />}
      filters={
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Takvim penceresi</span>
          <Input
            type="date"
            className="w-36"
            title="Pencere başlangıcı"
            value={fromValue}
            onChange={(e) => patch(e.target.value, toValue)}
          />
          <Input
            type="date"
            className="w-36"
            title="Pencere bitişi"
            value={toValue}
            onChange={(e) => patch(fromValue, e.target.value)}
          />
          {/* İLERİ bakan kısa yollar — geriye bakan bir "son 30 gün" düğmesi
              bu ekranda anlamsız olurdu (dosya başlığı). */}
          {[7, 30, 90].map((d) => (
            <Button key={d} type="button" variant="outline" size="sm" disabled={!data} onClick={() => preset(d)}>
              +{d} gün
            </Button>
          ))}
          {hasWindow ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => patch("", "")}>
              Varsayılan pencere
            </Button>
          ) : null}
        </div>
      }
    >
      {q.isError ? <ReportErrorCard error={q.error} onRetry={() => void q.refetch()} /> : null}

      {q.isError ? null : (
        <>
          {/* VADESİ GEÇMİŞLER — ayrı blok, pencereden bağımsız. */}
          {overdue.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h3 className="text-sm font-semibold text-destructive">Vadesi geçmiş çek / senet</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Bu blok takvim penceresinden <strong>bağımsızdır</strong> — pencereyi daraltmak burayı
                değiştirmez. Vadesi geçmiş bir çek hâlâ portföydedir; tahsil edilmiş olsaydı buradan
                düşerdi.
              </p>
              <div className="mt-3 flex flex-wrap gap-4">
                {overdue.map((r) => (
                  <div key={`${r.kind}-${r.currency}`} className="min-w-40">
                    <p className="text-[11px] text-muted-foreground">{DUE_KIND_LABEL[r.kind]}</p>
                    <p className="text-lg font-semibold tabular-nums text-destructive">
                      {moneyStr(r.amount, r.currency)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{fmtInt(r.count)} adet</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* KOVALAR — portföyün tamamı. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {CARD_BUCKETS.map((bucket) => {
              const rows = bucketRows(data, bucket);
              return (
                <Card key={bucket} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-sm font-semibold", DUE_BUCKET_TONE[bucket])}>
                      {DUE_BUCKET_LABEL[bucket]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmtInt(rows.reduce((n, r) => n + r.count, 0))} adet
                    </span>
                  </div>
                  <div className="mt-2 flex flex-col gap-0.5">
                    {q.isLoading ? (
                      <span className="text-sm text-muted-foreground/40">…</span>
                    ) : rows.length === 0 ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      rows.map((r) => (
                        <span key={`${r.kind}-${r.currency}`} className="text-sm">
                          <span className="text-muted-foreground">{DUE_KIND_LABEL[r.kind]}: </span>
                          <span className="font-medium tabular-nums">{moneyStr(r.amount, r.currency)}</span>
                        </span>
                      ))
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {data ? (
            <p className="text-xs text-muted-foreground">
              Yukarıdaki kovalar <strong>portföyün tamamını</strong> kapsar. Aşağıdaki takvim yalnız{" "}
              <strong>
                {fmtDayKey(data.window.from)} – {fmtDayKey(data.window.to)}
              </strong>{" "}
              penceresini gösterir. “{DUE_BUCKET_LABEL.SOON}” eşiği {data.soonDays} gündür (bugün dahil).
            </p>
          ) : null}

          <PeriodTable
            title="Haftalık Vade Takvimi"
            hint="Haftalar pazartesi başlar. “Net” aynı para birimindeki giren − çıkan farkıdır."
            rows={weeks}
            source={data?.weeks ?? []}
            isLoading={q.isLoading}
            label={(r) => fmtWeekRange(r.start, r.end)}
          />
          <PeriodTable
            title="Aylık Vade Takvimi"
            hint="Pencere ay ortasında başlıyorsa o ayda yalnız pencereye düşen çekler sayılır."
            rows={months}
            source={data?.months ?? []}
            isLoading={q.isLoading}
            label={(r) => fmtMonthKey(r.key)}
          />

          <ReportNotesCard title="Bu takvim nasıl okunur" notes={data?.notes ?? []} />
        </>
      )}
    </ReportPageLayout>
  );
}

interface PeriodTableProps {
  title: string;
  hint: string;
  rows: DuePeriodRow[];
  /** Ham satırlar — yalnız "veri var mı" ayrımı için (boş ≠ yüklenmedi). */
  source: ChequeDueCalendarRow[];
  isLoading: boolean;
  label: (row: DuePeriodRow) => string;
}

function PeriodTable({ title, hint, rows, source, isLoading, label }: PeriodTableProps) {
  const currencies = new Set(rows.map((r) => r.currency));
  const single = currencies.size === 1 ? [...currencies][0] : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className="text-xs text-muted-foreground">{fmtInt(rows.length)} satır</span>
      </div>

      {isLoading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Yükleniyor…</p>
      ) : source.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Bu pencerede vadesi dolan çek/senet yok. Pencereyi genişletmeyi deneyin — vadesi geçmiş
          kayıtlar yukarıdaki ayrı blokta durur.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Dönem</th>
                <th className="px-3 py-2 text-left">Para</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Tahsil adet</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Tahsil edilecek</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Ödeme adet</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Ödenecek</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.key}-${r.currency}`} className="border-t">
                  <td className="px-3 py-2">{label(r)}</td>
                  <td className="px-3 py-2">{r.currency}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.receivedCount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyStr(r.receivedAmount, r.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.issuedCount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyStr(r.issuedAmount, r.currency)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-medium tabular-nums",
                      r.net < 0 && "text-destructive",
                    )}
                  >
                    {moneyStr(r.net, r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            {/* TOPLAM yalnız TEK para birimi varsa — karışık birimli toplam
                "önümüzdeki ay 1,2 milyon girecek" yalanı üretirdi. */}
            {single ? (
              <tfoot>
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="px-3 py-2">TOPLAM</td>
                  <td className="px-3 py-2">{single}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtInt(rows.reduce((n, r) => n + r.receivedCount, 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyStr(rows.reduce((n, r) => n + r.receivedAmount, 0), single)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtInt(rows.reduce((n, r) => n + r.issuedCount, 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyStr(rows.reduce((n, r) => n + r.issuedAmount, 0), single)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyStr(rows.reduce((n, r) => n + r.net, 0), single)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </Card>
  );
}

export type { ChequeDueSummary };
