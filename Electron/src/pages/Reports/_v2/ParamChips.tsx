import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportCatalogEntry, ReportKey } from "@/lib/report-catalog";
import { ReportDateFilter } from "../_components/ReportDateFilter";
import { parseCsv, toCsv } from "../_hooks/reportAxisFilters";
import type { ParametreBeyani, ParametreSecenegi } from "./sunum";
import { ALL_LABEL, ParamPickerDialog } from "./ParamPickerDialog";
import { COMPARE_PARAM } from "./request-params";
import { emptyLabelOf, VARIANT_PARAM } from "./variant-model";

interface ChipSpec {
  key: string;
  label: string;
  options: readonly ParametreSecenegi[];
  multiple: boolean;
  allowAll: boolean;
  /** Seçili değerler (URL); boş = Tümü. */
  selected: string[];
  /** Seçim yokluğunun metni ("Tümü" yerine — varyant "Tek", dönem kıyası "Kapalı"). */
  emptyLabel?: string;
}

/** Seçili değerlerin çip metni: "Tümü" · tek etiket · "3 seçili". */
export function chipValueText(spec: Pick<ChipSpec, "options" | "selected" | "emptyLabel">): string {
  if (spec.selected.length === 0) return spec.emptyLabel ?? ALL_LABEL;
  if (spec.selected.length === 1) return spec.options.find((o) => o.deger === spec.selected[0])?.etiket ?? spec.selected[0]!;
  return `${spec.selected.length} seçili`;
}

/** URL'de seçim yoksa sunucunun UYGULADIĞI değer (`deger`) gösterilir; `null` = Tümü. */
function appliedOf(p: ParametreBeyani, search: URLSearchParams): string[] {
  const fromUrl = parseCsv(search.get(p.ad));
  if (fromUrl.length > 0) return fromUrl;
  if (Array.isArray(p.deger)) return p.deger;
  return typeof p.deger === "string" ? [p.deger] : [];
}

/**
 * Sunucunun beyan ettiği seçim parametreleri → çip. Kıyas da bir beyandır (K-KIYAS): varsayılanı
 * istemci YAZMAZ, beyan yoksa çip yoktur; "Tümü" seçeneği taşımaz ve en başta durur.
 * Tarih çipi `ReportDateFilter`ındır; serbest metin/sayı R1'de.
 */
export function chipSpecsOf(params: readonly ParametreBeyani[], search: URLSearchParams): ChipSpec[] {
  const specs = params
    .filter((p) => (p.tur === "secim" || p.tur === "cokluSecim") && (p.secenekler?.length ?? 0) > 0)
    .map((p) => ({
      key: p.ad,
      label: p.etiket,
      options: p.secenekler ?? [],
      multiple: p.tur === "cokluSecim",
      allowAll: p.ad !== COMPARE_PARAM,
      selected: appliedOf(p, search),
      emptyLabel: emptyLabelOf(p.ad),
    }));
  return [...specs.filter((c) => c.key === COMPARE_PARAM), ...specs.filter((c) => c.key !== COMPARE_PARAM)];
}

interface Props {
  entry: ReportCatalogEntry;
  params: readonly ParametreBeyani[];
  /** Sunum kişi adı taşıyor (K-KISI) — kırılım çipinde işaret; bu görünüm patron bulutuna gitmez. */
  personNamed?: boolean;
}

/** Parametre çipleri: tarih (katalog sözleşmesi) · sunucunun beyan ettiği kıyas ve seçimler. Çip → MODAL. */
export function ParamChips({ entry, params, personNamed = false }: Props) {
  const [search, setSearch] = useSearchParams();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const chips = chipSpecsOf(params, search);
  const apply = (key: string, values: string[]) => {
    const next = new URLSearchParams(search);
    const v = toCsv(values);
    if (v === null) next.delete(key);
    else next.set(key, v);
    setSearch(next, { replace: true });
  };
  const open = chips.find((c) => c.key === openKey) ?? null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
      <ReportDateFilter reportKey={entry.key as ReportKey} bare />
      {chips.map((c) => (
        <Button key={c.key} type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setOpenKey(c.key)}>
          <span className="text-muted-foreground">{c.label}:</span>
          <span className="max-w-[180px] truncate font-medium">{chipValueText(c)}</span>
          {personNamed && c.key === VARIANT_PARAM ? (
            <UserRound className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-label="Kişi adı içerir" data-testid="person-named-chip" />
          ) : null}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      ))}
      {open ? (
        <ParamPickerDialog
          open
          title={open.label}
          options={open.options}
          multiple={open.multiple}
          allowAll={open.allowAll}
          allLabel={open.emptyLabel}
          selected={open.selected}
          onApply={(values) => apply(open.key, values)}
          onClose={() => setOpenKey(null)}
        />
      ) : null}
    </div>
  );
}
