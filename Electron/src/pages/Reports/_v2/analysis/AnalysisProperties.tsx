import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ParamPickerDialog } from "../ParamPickerDialog";
import type { CatalogCube } from "../custom/custom-api";
import type { DefinitionBlock } from "../custom/layout/layout-model";
import { ANALYSIS_METHOD_OPTIONS, analysisBlockIssue, analysisCube, type AnalysisMethod } from "./analysis-model";

interface Props {
  block: DefinitionBlock;
  cubes: readonly CatalogCube[] | undefined;
  onChange: (patch: Partial<DefinitionBlock>) => void;
}

type Slot = "x" | "y" | "maruziyet";

function Row({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5 text-left text-sm hover:bg-muted/60">
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block truncate">{value}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">{label}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Analiz bölümünün ayarları (R3-ANALIZ): yöntem, iki alan, maruziyet. Seçiciler doğrudan modal.
 * Sayım ölçüsünde maruziyet zorunlu — kaydet devre dışı kalır; asıl doğrulama sunucunun `dogrula`sı.
 */
export function AnalysisProperties({ block, cubes, onChange }: Props) {
  const [slot, setSlot] = useState<Slot | null>(null);
  const method = (block.yontem as AnalysisMethod | undefined) ?? "kiKare";
  const cube = analysisCube(block, cubes);
  const nameOf = (id: unknown) =>
    cube?.olculer.find((m) => m.kimlik === id)?.ad ?? cube?.boyutlar.find((d) => d.kimlik === id)?.ad ?? (cubes ?? []).flatMap((c) => c.olculer).find((m) => m.kimlik === id)?.ad ?? (id ? String(id) : "Seçilmedi");
  const measures = (cube?.olculer ?? []).map((m) => ({ deger: m.kimlik, etiket: m.ad }));
  const dims = (cube?.boyutlar ?? []).filter((d) => d.tur === "kategori").map((d) => ({ deger: d.kimlik, etiket: d.ad }));
  // Maruziyet başka küpten gelebilir (hata sayısı ÷ biten metre); sayım olmayan ölçüler.
  const exposures = (cubes ?? []).flatMap((c) => c.olculer.filter((m) => m.birim !== "adet").map((m) => ({ deger: m.kimlik, etiket: `${m.ad} (${c.ad})` })));
  const uniqueExposures = [...new Map(exposures.map((o) => [o.deger, o])).values()];
  const options: Record<Slot, Array<{ deger: string; etiket: string }>> = {
    x: method === "kiKare" ? dims : measures,
    y: method === "kiKare" ? [...measures, ...dims] : measures,
    maruziyet: uniqueExposures,
  };
  const titles: Record<Slot, string> = {
    x: method === "kiKare" ? "Hangi gruplar kıyaslansın?" : "Birinci ölçü",
    y: method === "kiKare" ? "Neyi kıyaslayalım?" : "İkinci ölçü",
    maruziyet: "Neye göre oranlansın?",
  };
  const issue = analysisBlockIssue(block, cubes);
  return (
    <section aria-label="Analiz ayarları" className="flex flex-col gap-3">
      <Field label="Ne soruyoruz?">
        <div className="flex flex-col gap-1.5">
          {ANALYSIS_METHOD_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={method === o.value}
              onClick={() => onChange({ yontem: o.value, x: undefined, y: undefined, maruziyet: undefined })}
              className={cn("rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors", method === o.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
            >
              <span className="block font-medium">{o.label}</span>
              <span className={cn("block", method === o.value ? "text-primary-foreground/80" : "text-muted-foreground")}>{o.hint}</span>
            </button>
          ))}
        </div>
      </Field>
      <Row label={titles.x} value={nameOf(block.x)} onOpen={() => setSlot("x")} />
      <Row label={titles.y} value={nameOf(block.y)} onOpen={() => setSlot("y")} />
      <Row label={titles.maruziyet} value={block.maruziyet ? nameOf(block.maruziyet) : "Oranlama yok"} onOpen={() => setSlot("maruziyet")} />
      {issue ? (
        <p role="alert" data-testid="analysis-issue" className="rounded-md border border-amber-300/70 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
          {issue}
        </p>
      ) : null}
      <ParamPickerDialog
        open={slot !== null}
        title={slot ? titles[slot] : ""}
        options={slot ? options[slot] : []}
        multiple={false}
        allowAll={slot === "maruziyet"}
        allLabel="Oranlama yok"
        selected={slot && typeof block[slot] === "string" ? [block[slot] as string] : []}
        onApply={(values) => {
          if (slot) onChange({ [slot]: values[0] });
          setSlot(null);
        }}
        onClose={() => setSlot(null)}
      />
    </section>
  );
}
