// =============================================================================
// RAPOR TARİH FİLTRESİ — katalogdaki `tarih` sözleşmesinden ÇİZER (K7 / R4)
// =============================================================================
// `pages/Reports/**` altında tarih girdisi çizen TEK dosya budur (artık `DatePickerInput`/`DateRangeInput`,
// yerleşik `type="date"` yok — panel geneli takvim taraması 2026-09-17); bekçi (`ham-tarih-girdisi.test.ts`)
// ham girdiyi başka dosyada yasaklar, `date-input-kaynak` cırcırı bütün paneli sayar. Yaprak hangi girdiyi göstereceğini
// bilmez: anahtarını verir, sözleşme (aralık ISO · aralık fabrika günü · tek gün ·
// kesit · ileri pencere · yok) ve varsayılan gün sayısı katalogdan gelir, backend
// parametre adı `_lib/report-date`den. URL durumu `useReportDateRange` kalıbı.
//
// Alt bileşenler sözleşme başına AYRI: her hook yalnız kendi sözleşmesini kabul
// eder ve hook kuralları koşullu çağrıyı yasaklar — dallanma bileşen düzeyinde.
// =============================================================================
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { REPORT_BY_KEY, type ReportKey } from "@/lib/report-catalog";
import { COMPARE_LABELS, useReportCompare, type CompareMode } from "../_hooks/useReportCompare";
import { useForwardWindow } from "../_hooks/useForwardWindow";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportDayState } from "../_hooks/useReportDay";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { DayPresetChip } from "@/components/data-table/filter-row/DayPresetChip";
import { BACK_PRESETS, FORWARD_PRESETS, backWindowIso, endOfDayIso, startOfDayIso, toYmd } from "../_lib/report-date";

const RANGE = "aralik";
const COMPARE_ORDER: CompareMode[] = ["none", "prev", "prevYear", "custom"];
const INPUT = "h-7 w-[180px] px-2 text-xs";
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
  const { dateFrom, dateTo, setRange, applyPreset, defaultDays } = useReportDateRange(reportKey);
  const compare = useReportCompare();
  const days = [...new Set([...BACK_PRESETS.map((x) => x.days as number), defaultDays])].sort((x, y) => x - y);
  const presets = days.map((d) => ({ value: String(d), label: `Son ${d} gün` }));
  // URL penceresi bir ön ayarla birebir örtüşüyorsa o seçili; değilse elle aralık.
  const hit = days.find((d) => { const w = backWindowIso(d); return w.dateFrom === dateFrom && w.dateTo === dateTo; });
  const current = hit !== undefined ? String(hit) : RANGE;
  return (
    <Wrap bare={bare}>
      {/* O12: ön ayar düğme grubu yerine tek açılır "Tarih: Son 30 gün ▾" (aralık seçimi açılırın içinde). */}
      <DayPresetChip
        id="rapor-tarih"
        label="Tarih"
        presets={presets}
        value={current}
        rangeValue={RANGE}
        resetValue={String(defaultDays)}
        from={toYmd(dateFrom)}
        to={toYmd(dateTo)}
        onPreset={(v) => applyPreset(Number(v))}
        onRange={(r) => setRange(r.from ? startOfDayIso(r.from) : "", r.to ? endOfDayIso(r.to) : "")}
      />
      {showCompare ? (
        <>
          <SelectChip id="rapor-karsilastir" label="Karşılaştır" value={compare.mode} resetValue="none"
            options={COMPARE_ORDER.map((m) => ({ value: m, label: COMPARE_LABELS[m] }))} onChange={(v) => compare.setMode(v ?? "none")} />
          {compare.mode === "custom" ? (
            <>
              <DateRangeInput
                from={toYmd(compare.compareFrom)}
                to={toYmd(compare.compareTo)}
                onFrom={(v) => compare.setCustom(v ? startOfDayIso(v) : "", compare.compareTo)}
                onTo={(v) => compare.setCustom(compare.compareFrom, v ? endOfDayIso(v) : "")}
                inputClassName={INPUT}
                fromLabel="Karşılaştırma başlangıcı"
                toLabel="Karşılaştırma bitişi"
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
      <DatePickerInput
        value={ymd}
        max={isSnapshot ? todayYmd : undefined}
        onChange={(v) => setYmd(v || todayYmd)}
        className={INPUT}
        aria-label={isSnapshot ? "Kesit tarihi" : "Fabrika günü"}
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
      <DateRangeInput from={fromValue} to={toValue} onFrom={(v) => setWindow(v, toValue)} onTo={(v) => setWindow(fromValue, v)} inputClassName={INPUT} fromLabel="Pencere başlangıcı" toLabel="Pencere bitişi" />
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
      <DateRangeInput from={value.from} to={value.to} onFrom={(v) => onChange({ from: v, to: value.to })} onTo={(v) => onChange({ from: value.from, to: v })} inputClassName={INPUT} fromLabel="Başlangıç" toLabel="Bitiş" />
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
