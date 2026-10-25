import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ParamPickerDialog } from "../ParamPickerDialog";
import { customReportApi, type CatalogCube } from "./custom-api";
import { allowedDimensions, COMPARE_OPTIONS, DATE_PRESET_OPTIONS, VIEW_OPTIONS, type BuilderState } from "./builder-model";

interface Props {
  step: number;
  state: BuilderState;
  cubes: readonly CatalogCube[];
  onChange: (next: BuilderState) => void;
}

type Picker = "cube" | "measures" | "dimensions" | "filterDim" | "filterValues" | "period" | "compare" | "view" | null;

function Choice({ label, value, onPick, hint }: { label: string; value: string; onPick: () => void; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Button type="button" variant="outline" className="h-auto min-h-9 justify-start whitespace-normal text-left" onClick={onPick}>
        {value}
      </Button>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const nameOf = (list: ReadonlyArray<{ kimlik: string; ad: string }>, ids: readonly string[]) =>
  ids.map((id) => list.find((x) => x.kimlik === id)?.ad ?? id).join(", ");

/** Oluşturucunun bir adımı — her seçim doğrudan MODAL açar (combobox yok). */
export function BuilderStepPanel({ step, state, cubes, onChange }: Props) {
  const [picker, setPicker] = useState<Picker>(null);
  const [filterDim, setFilterDim] = useState<string | null>(null);
  const [values, setValues] = useState<Array<{ deger: string; etiket: string }>>([]);
  const cube = cubes.find((c) => c.kimlik === state.cube);
  const dims = allowedDimensions(cube, state.measures);
  const close = () => setPicker(null);
  const openValues = async (dim: string) => {
    setFilterDim(dim);
    setValues(cube && state.measures[0] ? await customReportApi.dimensionValues(cube.kimlik, state.measures[0], dim).catch(() => []) : []);
    setPicker("filterValues");
  };
  const currentFilter = state.filters.find((f) => f.boyut === filterDim);

  return (
    <div className="flex flex-col gap-4">
      {step === 0 ? (
        <Choice label="Hangi konuda?" value={cube?.ad ?? "Küp seçin…"} onPick={() => setPicker("cube")} hint="Küp, raporun hangi veriden okuyacağıdır (sevkiyat, üretim, finans…)." />
      ) : null}
      {step === 1 ? (
        <Choice label="Neyi ölçelim?" value={state.measures.length ? nameOf(cube?.olculer ?? [], state.measures) : "Ölçü seçin…"} onPick={() => setPicker("measures")} hint="İlk ölçü raporun ana sayısıdır." />
      ) : null}
      {step === 2 ? (
        <Choice label="Neye göre kıralım? (isteğe bağlı, en çok 3)" value={state.dimensions.length ? nameOf(dims, state.dimensions) : "Kırılım yok — yalnız ana sayı"} onPick={() => setPicker("dimensions")} />
      ) : null}
      {step === 3 ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Süzgeçler (isteğe bağlı)</span>
          {state.filters.map((f) => (
            <div key={f.boyut} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium">{dims.find((d) => d.kimlik === f.boyut)?.ad ?? f.boyut}:</span>
              <button type="button" className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline" onClick={() => void openValues(f.boyut)}>
                {f.degerler.map((v) => v.etiket).join(", ") || "Tümü"}
              </button>
              <Button type="button" size="icon" variant="ghost" aria-label="Süzgeci kaldır" onClick={() => onChange({ ...state, filters: state.filters.filter((x) => x !== f) })}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setPicker("filterDim")} disabled={state.filters.length >= 10}>
            <Plus className="h-4 w-4" /> Süzgeç ekle
          </Button>
        </div>
      ) : null}
      {step === 4 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Choice label="Dönem" value={DATE_PRESET_OPTIONS.find((o) => o.deger === state.period)!.etiket} onPick={() => setPicker("period")} />
          <Choice label="Kıyas" value={COMPARE_OPTIONS.find((o) => o.deger === state.compare)!.etiket} onPick={() => setPicker("compare")} />
          <Choice label="Görünüm" value={VIEW_OPTIONS.find((o) => o.deger === state.view)!.etiket} onPick={() => setPicker("view")} hint={state.dimensions.length ? undefined : "Kırılım yoksa yalnız ana sayı çizilir."} />
        </div>
      ) : null}

      <ParamPickerDialog open={picker === "cube"} title="Küp seçin" multiple={false} allowAll={false} options={cubes.map((c) => ({ deger: c.kimlik, etiket: c.ad }))} selected={state.cube ? [state.cube] : []}
        onApply={([v]) => v !== state.cube && onChange({ ...state, cube: v ?? null, measures: [], dimensions: [], filters: [] })} onClose={close} />
      <ParamPickerDialog open={picker === "measures"} title="Ölçü seçin" multiple allowAll={false} options={(cube?.olculer ?? []).map((m) => ({ deger: m.kimlik, etiket: m.ad }))} selected={state.measures}
        onApply={(v) => onChange({ ...state, measures: v.slice(0, 8), dimensions: state.dimensions.filter((d) => allowedDimensions(cube, v).some((x) => x.kimlik === d)) })} onClose={close} />
      <ParamPickerDialog open={picker === "dimensions"} title="Kırılım seçin" multiple options={dims.map((d) => ({ deger: d.kimlik, etiket: d.ad }))} selected={state.dimensions}
        onApply={(v) => onChange({ ...state, dimensions: v.slice(0, 3) })} onClose={close} />
      <ParamPickerDialog open={picker === "filterDim"} title="Neye göre süzelim?" multiple={false} allowAll={false} options={dims.filter((d) => d.tur === "kategori" && !state.filters.some((f) => f.boyut === d.kimlik)).map((d) => ({ deger: d.kimlik, etiket: d.ad }))} selected={[]}
        onApply={([v]) => v && void openValues(v)} onClose={() => (picker === "filterDim" ? close() : undefined)} />
      <ParamPickerDialog open={picker === "filterValues"} title={`${dims.find((d) => d.kimlik === filterDim)?.ad ?? ""} — değer seçin`} multiple options={values} selected={currentFilter?.degerler.map((v) => v.deger) ?? []}
        onApply={(v) => filterDim && onChange({ ...state, filters: [...state.filters.filter((f) => f.boyut !== filterDim), { boyut: filterDim, degerler: values.filter((x) => v.includes(x.deger)) }].filter((f) => f.degerler.length > 0) })} onClose={close} />
      <ParamPickerDialog open={picker === "period"} title="Dönem" multiple={false} allowAll={false} options={DATE_PRESET_OPTIONS} selected={[state.period]} onApply={([v]) => v && onChange({ ...state, period: v as BuilderState["period"] })} onClose={close} />
      <ParamPickerDialog open={picker === "compare"} title="Kıyas" multiple={false} allowAll={false} options={COMPARE_OPTIONS} selected={[state.compare]} onApply={([v]) => v && onChange({ ...state, compare: v as BuilderState["compare"] })} onClose={close} />
      <ParamPickerDialog open={picker === "view"} title="Görünüm" multiple={false} allowAll={false} options={VIEW_OPTIONS} selected={[state.view]} onApply={([v]) => v && onChange({ ...state, view: v as BuilderState["view"] })} onClose={close} />
    </div>
  );
}
