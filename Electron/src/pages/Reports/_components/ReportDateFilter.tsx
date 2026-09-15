// =============================================================================
// RAPOR TARİH FİLTRESİ — katalogdaki `tarih` sözleşmesinden ÇİZER (K7 / R4)
// =============================================================================
// `pages/Reports/**` altında ham `<Input type="date">` çizen TEK dosya budur; bekçi
// (`ham-tarih-girdisi.test.ts`) bunu ölçer. Yaprak hangi girdiyi göstereceğini
// bilmez: anahtarını verir, sözleşme (aralık ISO · aralık fabrika günü · tek gün ·
// kesit · ileri pencere · yok) ve varsayılan gün sayısı katalogdan gelir, backend
// parametre adı `_lib/report-date`den. URL durumu `useReportDateRange` kalıbı.
//
// Alt bileşenler sözleşme başına AYRI: her hook yalnız kendi sözleşmesini kabul
// eder ve hook kuralları koşullu çağrıyı yasaklar — dallanma bileşen düzeyinde.
// =============================================================================
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REPORT_BY_KEY, type ReportKey } from "@/lib/report-catalog";
import { COMPARE_LABELS, useReportCompare, type CompareMode } from "../_hooks/useReportCompare";
import { useForwardWindow } from "../_hooks/useForwardWindow";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportDayState } from "../_hooks/useReportDay";
import { BACK_PRESETS, FORWARD_PRESETS, endOfDayIso, startOfDayIso, toYmd } from "../_lib/report-date";

const COMPARE_ORDER: CompareMode[] = ["none", "prev", "prevYear", "custom"];
const INPUT = "h-7 w-[130px] px-2 text-xs";
const BTN = "h-7 px-2 text-xs";

export interface DateWindowValue {
  from: string;
  to: string;
}

export interface ReportDateFilterProps {
  reportKey: ReportKey;
  /** Dönem karşılaştırma seçicisi AYNI satırda — yalnız `aralik-iso` ve karşılaştırmayı destekleyen raporlarda. */
  showCompare?: boolean;
  /** Sarmalayıcı satırı çizmez — özel filtre şeridine gömmek için. */
  bare?: boolean;
  /** `ileri-pencere`: backend'in "bugün"ü (ön ayarların çıpası). Veri gelmeden ön ayar çizilmez. */
  anchorToday?: string | null;
  /** `ileri-pencere`: URL boşken gösterilen backend penceresi (`window`). */
  windowFallback?: DateWindowValue | null;
  /** KONTROLLÜ kip (diyalog): URL yerine yerel değer; yalnız `aralik-iso`. */
  value?: DateWindowValue;
  onChange?: (next: DateWindowValue) => void;
}

function Wrap({ bare, children }: { bare?: boolean; children: React.ReactNode }) {
  if (bare) return <>{children}</>;
  return <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs">{children}</div>;
}

/** `aralik-iso` + `aralik-gun`: URL'deki ISO çift; iki tarih girdisi + geriye bakan ön ayarlar (+ karşılaştırma). */
function RangeFilter({ reportKey, showCompare, bare }: { reportKey: ReportKey; showCompare: boolean; bare?: boolean }) {
  const { dateFrom, dateTo, setRange, applyPreset } = useReportDateRange(reportKey);
  const compare = useReportCompare();
  const hasRange = Boolean(dateFrom || dateTo);
  return (
    <Wrap bare={bare}>
      <span className="mr-1 text-muted-foreground">Tarih</span>
      <Input
        type="date"
        value={toYmd(dateFrom)}
        onChange={(e) => setRange(e.target.value ? startOfDayIso(e.target.value) : "", dateTo)}
        className={INPUT}
      />
      <span className="text-muted-foreground">–</span>
      <Input
        type="date"
        value={toYmd(dateTo)}
        onChange={(e) => setRange(dateFrom, e.target.value ? endOfDayIso(e.target.value) : "")}
        className={INPUT}
      />
      {BACK_PRESETS.map((p) => (
        <Button key={p.days} type="button" size="sm" variant="outline" className={BTN} onClick={() => applyPreset(p.days)}>
          {p.label}
        </Button>
      ))}
      {hasRange ? (
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRange("", "")} title="Tarih filtresini kaldır">
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {showCompare ? (
        <>
          <span className="ml-3 mr-1 text-muted-foreground">Karşılaştır</span>
          <select
            value={compare.mode}
            onChange={(e) => compare.setMode(e.target.value as CompareMode)}
            className="h-7 rounded-md border bg-background px-2 text-xs"
          >
            {COMPARE_ORDER.map((m) => (
              <option key={m} value={m}>
                {COMPARE_LABELS[m]}
              </option>
            ))}
          </select>
          {compare.mode === "custom" ? (
            <>
              <Input
                type="date"
                value={toYmd(compare.compareFrom)}
                onChange={(e) => compare.setCustom(e.target.value ? startOfDayIso(e.target.value) : "", compare.compareTo)}
                className={INPUT}
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                value={toYmd(compare.compareTo)}
                onChange={(e) => compare.setCustom(compare.compareFrom, e.target.value ? endOfDayIso(e.target.value) : "")}
                className={INPUT}
              />
            </>
          ) : null}
        </>
      ) : null}
    </Wrap>
  );
}

/** `tek-gun` (fabrika günü) + `kesit` (günün sonu itibarıyla): tek girdi + "Bugün". Kesit ileriye bakamaz (`max`). */
function DayFilter({ reportKey, bare }: { reportKey: ReportKey; bare?: boolean }) {
  const { contract, ymd, todayYmd, setYmd, isToday } = useReportDayState(reportKey);
  const isSnapshot = contract === "kesit";
  return (
    <Wrap bare={bare}>
      <span className="mr-1 text-muted-foreground">{isSnapshot ? "Kesit" : "Fabrika günü"}</span>
      <Input
        type="date"
        value={ymd}
        max={isSnapshot ? todayYmd : undefined}
        onChange={(e) => setYmd(e.target.value || todayYmd)}
        className={INPUT}
        title={isSnapshot ? "Bu tarihin SONU itibarıyla" : "Fabrika günü (vardiya takvimi)"}
      />
      <Button type="button" size="sm" variant="outline" className={BTN} disabled={isToday} onClick={() => setYmd(todayYmd)}>
        Bugün
      </Button>
    </Wrap>
  );
}

/** `ileri-pencere`: URL `dueFrom/dueTo`; iki girdi + İLERİ bakan ön ayarlar (çıpa backend günü); "Son N gün" burada anlamsızdır. */
function ForwardFilter({ reportKey, bare, anchorToday, windowFallback }: { reportKey: ReportKey; bare?: boolean; anchorToday?: string | null; windowFallback?: DateWindowValue | null }) {
  const { from, to, hasWindow, setWindow, applyPreset } = useForwardWindow(reportKey);
  const fromValue = from || windowFallback?.from || "";
  const toValue = to || windowFallback?.to || "";
  return (
    <Wrap bare={bare}>
      <span className="mr-1 text-muted-foreground">Takvim penceresi</span>
      <Input type="date" value={fromValue} title="Pencere başlangıcı" onChange={(e) => setWindow(e.target.value, toValue)} className={INPUT} />
      <span className="text-muted-foreground">–</span>
      <Input type="date" value={toValue} title="Pencere bitişi" onChange={(e) => setWindow(fromValue, e.target.value)} className={INPUT} />
      {FORWARD_PRESETS.map((d) => (
        <Button key={d} type="button" size="sm" variant="outline" className={BTN} disabled={!anchorToday} onClick={() => applyPreset(anchorToday, d)}>
          +{d} gün
        </Button>
      ))}
      {hasWindow ? (
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setWindow("", "")} title="Varsayılan pencereye dön">
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </Wrap>
  );
}

/**
 * KONTROLLÜ aralık (diyalog): URL yok, değer dışarıdan. `max`/`min` çapraz bağlanır —
 * backend `from > to` isteğini 400 ile reddediyor; seçicide o kombinasyonu hiç sunmamak,
 * kullanıcıyı geri alması gereken bir hataya sokmamaktır (elle yazımı engellemez).
 */
function ControlledRange({ value, onChange, bare }: { value: DateWindowValue; onChange: (v: DateWindowValue) => void; bare?: boolean }) {
  return (
    <Wrap bare={bare}>
      <span className="mr-1 text-muted-foreground">Tarih</span>
      <Input type="date" value={value.from} max={value.to || undefined} title="Başlangıç" onChange={(e) => onChange({ from: e.target.value, to: value.to })} className={INPUT} />
      <span className="text-muted-foreground">–</span>
      <Input type="date" value={value.to} min={value.from || undefined} title="Bitiş" onChange={(e) => onChange({ from: value.from, to: e.target.value })} className={INPUT} />
    </Wrap>
  );
}

export function ReportDateFilter({ reportKey, showCompare = false, bare, anchorToday, windowFallback, value, onChange }: ReportDateFilterProps) {
  const entry = REPORT_BY_KEY.get(reportKey);
  if (!entry) throw new Error(`Rapor kataloğunda yok: ${reportKey}`);
  if (value && onChange) {
    if (entry.tarih !== "aralik-iso") throw new Error(`${reportKey}: kontrollü kip yalnız aralik-iso sözleşmesinde`);
    return <ControlledRange value={value} onChange={onChange} bare={bare} />;
  }
  switch (entry.tarih) {
    case "aralik-iso":
    case "aralik-gun":
      return <RangeFilter reportKey={reportKey} showCompare={showCompare} bare={bare} />;
    case "tek-gun":
    case "kesit":
      return <DayFilter reportKey={reportKey} bare={bare} />;
    case "ileri-pencere":
      return <ForwardFilter reportKey={reportKey} bare={bare} anchorToday={anchorToday} windowFallback={windowFallback} />;
    case "yok":
      return null;
  }
}
