// Top kartı "Ölçümler" — metre okumaları (kurşun giriş/çıkış · Tambur kesim) + sapma satırları (D4-B4, DALGA4 §3.8).
// "Ölçüm" (kaynak) kolonu OPT-IN: varsayılan gizli, tercih `prefs.tableVisibility` (useDataTable emsali).
// Düzelt düğmesi yalnız aktif Tambur kesim okumasında ve `kursun:meter-approve` izniyle (izinsizde istek hiç atılmaz).
import { useState } from "react";
import { Ruler } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionGate } from "@/components/PermissionGate";
import { formatFactory } from "@/lib/factory-time";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";
import { MeterCorrectionDialog } from "./MeterCorrectionDialog";
import {
  METER_PHASE_LABEL,
  MEASURE_SOURCE_COLUMN,
  ROLL_MEASUREMENTS_TABLE_KEY,
  VARIANCE_KIND_LABEL,
  isCorrectableReading,
  readingStatusLabel,
  isMeasureColumnVisible,
  measureSourceClass,
  measureSourceLabel,
  type RollMeasurements,
  type RollMeterReadingView,
  type RollVarianceView,
} from "./measure-source";

interface Props {
  measurements: RollMeasurements;
  onChanged: () => void;
}

const fmt = (v: number) => `${v.toLocaleString("tr-TR", { maximumFractionDigits: 3 })} m`;

function SourceChip({ source }: { source: string | null }) {
  return (
    <span data-testid="measure-source" className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] ${measureSourceClass(source)}`}>
      {measureSourceLabel(source)}
    </span>
  );
}

/** Kolon tercihi: kabuk içinde kullanıcı tercihine yazılır; sağlayıcısız (izole) kullanımda bileşen durumu. */
function useMeasureColumn(): [boolean, (v: boolean) => void] {
  const prefs = useOptionalPreferences();
  const [local, setLocal] = useState(false);
  if (!prefs) return [local, setLocal];
  const visible = isMeasureColumnVisible(prefs.prefs.tableVisibility);
  const set = (v: boolean) => {
    const all = prefs.prefs.tableVisibility ?? {};
    prefs.setPreference({ tableVisibility: { ...all, [ROLL_MEASUREMENTS_TABLE_KEY]: { ...(all[ROLL_MEASUREMENTS_TABLE_KEY] ?? {}), [MEASURE_SOURCE_COLUMN]: v } } });
  };
  return [visible, set];
}

interface ReadingsProps {
  readings: RollMeterReadingView[];
  showSource: boolean;
  onCorrect: (r: RollMeterReadingView) => void;
}

function ReadingsTable({ readings, showSource, onCorrect }: ReadingsProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 pr-2 text-left font-medium">Zaman</th>
            <th className="py-1 pr-2 text-left font-medium">Okuma</th>
            <th className="py-1 pr-2 text-right font-medium">Metre</th>
            {showSource && <th className="py-1 pr-2 text-left font-medium">Ölçüm</th>}
            <th className="py-1 pr-2 text-left font-medium">Durum</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {readings.map((r) => (
            <tr key={r.id} data-testid="reading-row" className={`border-t align-top ${r.revokedAt ? "text-muted-foreground" : ""}`}>
              <td className="whitespace-nowrap py-1 pr-2">{formatFactory(r.createdAt, "dd.MM.yyyy HH:mm")}</td>
              <td className="py-1 pr-2">
                {METER_PHASE_LABEL[r.phase] ?? r.phase}
                {r.machineName ? <span className="block text-[11px] text-muted-foreground">{r.machineName}</span> : null}
              </td>
              <td className={`whitespace-nowrap py-1 pr-2 text-right tabular-nums ${r.revokedAt ? "line-through" : ""}`}>{fmt(r.meters)}</td>
              {showSource && (
                <td className="py-1 pr-2">
                  <SourceChip source={r.source} />
                </td>
              )}
              <td className="whitespace-nowrap py-1 pr-2" title={r.revokeReason ?? undefined}>
                {readingStatusLabel(r)}
              </td>
              <td className="py-1 text-right">
                {isCorrectableReading(r) && (
                  <PermissionGate permission="kursun:meter-approve">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onCorrect(r)}>
                      Düzelt
                    </Button>
                  </PermissionGate>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VariancesTable({ variances, showSource }: { variances: RollVarianceView[]; showSource: boolean }) {
  return (
    <div className="overflow-x-auto">
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">Sapmalar</div>
      <table className="text-xs">
        <tbody>
          {variances.map((v) => (
            <tr key={v.id} data-testid="variance-row" className={`border-t ${v.reversedAt ? "text-muted-foreground line-through" : ""}`}>
              <td className="whitespace-nowrap py-1 pr-4">{formatFactory(v.createdAt, "dd.MM.yyyy HH:mm")}</td>
              <td className="py-1 pr-4">{VARIANCE_KIND_LABEL[v.kind] ?? v.kind}</td>
              <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">{fmt(v.qty)}</td>
              {showSource && (
                <td className="py-1 pr-2">
                  <SourceChip source={v.measureSource} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RollMeasurementsCard({ measurements, onChanged }: Props) {
  const [showSource, setShowSource] = useMeasureColumn();
  const [target, setTarget] = useState<RollMeterReadingView | null>(null);
  const { readings, variances } = measurements;
  if (readings.length === 0 && variances.length === 0) return null;

  return (
    <Card data-testid="roll-measurements">
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Ruler className="h-3.5 w-3.5" /> Ölçümler
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={showSource} onCheckedChange={(v) => setShowSource(v === true)} aria-label="Ölçüm kolonunu göster" />
            Ölçüm kolonu
          </label>
        </div>
        {readings.length > 0 && <ReadingsTable readings={readings} showSource={showSource} onCorrect={setTarget} />}
        {variances.length > 0 && <VariancesTable variances={variances} showSource={showSource} />}
      </CardContent>
      {target && <MeterCorrectionDialog reading={target} onClose={() => setTarget(null)} onChanged={onChanged} />}
    </Card>
  );
}
