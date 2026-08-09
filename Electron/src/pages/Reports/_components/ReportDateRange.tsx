import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { COMPARE_LABELS, useReportCompare, type CompareMode } from "../_hooks/useReportCompare";

const COMPARE_ORDER: CompareMode[] = ["none", "prev", "prevYear", "custom"];

const PRESETS = [
  { days: 7, label: "Son 7g" },
  { days: 30, label: "Son 30g" },
  { days: 90, label: "Son 90g" },
] as const;

function toYmd(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function startOfDayIso(ymd: string): string {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}
function endOfDayIso(ymd: string): string {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

/**
 * URL-driven tarih aralığı filtresi. Rapor sayfa header'ı altında durur.
 *
 * `showCompare` ile dönem karşılaştırma seçicisi AYNI satırda çıkar — ayrı bir
 * satıra koymak "tarih" ile "karşılaştırma tarihi"ni iki ayrı filtre gibi
 * gösterirdi; oysa ikincisi birincinin türevi.
 */
export function ReportDateRange({
  defaultDays = 30,
  showCompare = false,
}: {
  defaultDays?: number;
  showCompare?: boolean;
}) {
  const { dateFrom, dateTo, setRange, applyPreset } = useReportDateRange(defaultDays);
  const compare = useReportCompare();
  const hasRange = Boolean(dateFrom || dateTo);

  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs">
      <span className="mr-1 text-muted-foreground">Tarih</span>
      <Input
        type="date"
        value={toYmd(dateFrom)}
        onChange={(e) =>
          setRange(e.target.value ? startOfDayIso(e.target.value) : "", dateTo)
        }
        className="h-7 w-[130px] px-2 text-xs"
      />
      <span className="text-muted-foreground">–</span>
      <Input
        type="date"
        value={toYmd(dateTo)}
        onChange={(e) =>
          setRange(dateFrom, e.target.value ? endOfDayIso(e.target.value) : "")
        }
        className="h-7 w-[130px] px-2 text-xs"
      />
      {PRESETS.map((p) => (
        <Button
          key={p.days}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => applyPreset(p.days)}
        >
          {p.label}
        </Button>
      ))}
      {hasRange ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setRange("", "")}
          title="Tarih filtresini kaldır"
        >
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
                onChange={(e) =>
                  compare.setCustom(e.target.value ? startOfDayIso(e.target.value) : "", compare.compareTo)
                }
                className="h-7 w-[130px] px-2 text-xs"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                value={toYmd(compare.compareTo)}
                onChange={(e) =>
                  compare.setCustom(compare.compareFrom, e.target.value ? endOfDayIso(e.target.value) : "")
                }
                className="h-7 w-[130px] px-2 text-xs"
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
