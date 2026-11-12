import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, SlidersHorizontal, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ReportCatalogEntry, ReportKey } from "@/lib/report-catalog";
import { ReportDateFilter } from "../_components/ReportDateFilter";
import { parseCsv, toCsv } from "../_hooks/reportAxisFilters";
import type { ParametreBeyani, ParametreSecenegi } from "./sunum";
import { ALL_LABEL, ParamPickerDialog } from "./ParamPickerDialog";
import { COMPARE_PARAM, VIEW_PARAM } from "./request-params";
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
 * istemci YAZMAZ, beyan yoksa çip yoktur; "Tümü" seçeneği taşımaz ve en başta durur. Tablo görünümü de
 * "Tümü" taşımaz (sunucu hep bir tablo uygular).
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
      allowAll: p.ad !== COMPARE_PARAM && p.ad !== VIEW_PARAM,
      selected: appliedOf(p, search),
      emptyLabel: emptyLabelOf(p.ad),
    }));
  return [...specs.filter((c) => c.key === COMPARE_PARAM), ...specs.filter((c) => c.key !== COMPARE_PARAM)];
}

/** Bantta satır içinde kalan çip sayısı; fazlası "Süzgeçler (n)" paneline katlanır. */
export const INLINE_CHIP_LIMIT = 2;

/** Bant genişliğine göre satır içi çip sayısı: dar bantta (1280 ekranda ~1040 px) bant iki satıra kırılmasın. */
export function inlineLimitFor(width: number): number {
  if (width >= 1180) return INLINE_CHIP_LIMIT;
  return width >= 760 ? 1 : 0;
}

// React 19 ref temizliği: gözlemci bant sökülünce kapanır.
function useBandWidth(): [(el: HTMLDivElement | null) => (() => void) | undefined, number] {
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e?.contentRect.width ?? Number.POSITIVE_INFINITY));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Satır içi / katlanan çipler: kıyas ve SEÇİMİ OLAN çipler önce satırda kalır (sıra korunur). */
export function splitChips<T extends { key: string; selected: string[] }>(chips: readonly T[], limit = INLINE_CHIP_LIMIT): { inline: T[]; folded: T[] } {
  if (chips.length <= limit) return { inline: [...chips], folded: [] };
  const priority = (c: T) => c.key === COMPARE_PARAM || c.selected.length > 0;
  const keep = new Set(chips.filter(priority).slice(0, limit).map((c) => c.key));
  for (const c of chips) if (keep.size < limit) keep.add(c.key);
  return { inline: chips.filter((c) => keep.has(c.key)), folded: chips.filter((c) => !keep.has(c.key)) };
}

interface Props {
  entry: ReportCatalogEntry;
  params: readonly ParametreBeyani[];
  /** Sunum kişi adı taşıyor (K-KISI) — kırılım çipinde işaret; bu görünüm patron bulutuna gitmez. */
  personNamed?: boolean;
}

/**
 * Parametre çipleri: tarih (katalog sözleşmesi) · sunucunun beyan ettiği kıyas ve seçimler. Çip → MODAL.
 * Tek, ince, yapışkan bant; çok çipte fazlası "Süzgeçler (n)" paneline katlanır.
 */
export function ParamChips({ entry, params, personNamed = false }: Props) {
  const [search, setSearch] = useSearchParams();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [foldOpen, setFoldOpen] = useState(false);
  const [bandRef, bandWidth] = useBandWidth();
  const chips = chipSpecsOf(params, search);
  const { inline, folded } = splitChips(chips, inlineLimitFor(bandWidth));
  const foldedActive = folded.filter((c) => c.selected.length > 0).length;
  const apply = (key: string, values: string[]) => {
    const next = new URLSearchParams(search);
    const v = toCsv(values);
    if (v === null) next.delete(key);
    else next.set(key, v);
    setSearch(next, { replace: true });
  };
  const chipButton = (c: ChipSpec, wide = false) => (
    <Button
      key={c.key}
      type="button"
      variant="outline"
      size="sm"
      className={cn("h-7 gap-1 bg-card px-2 text-xs", wide && "w-full justify-between", c.selected.length > 0 && c.key !== COMPARE_PARAM && "border-primary/50 bg-primary/5")}
      onClick={() => {
        setFoldOpen(false);
        setOpenKey(c.key);
      }}
    >
      <span className="text-muted-foreground">{c.label}:</span>
      <span className="max-w-[180px] truncate font-medium">{chipValueText(c)}</span>
      {personNamed && c.key === VARIANT_PARAM ? (
        <UserRound className="h-3.5 w-3.5 text-warning" aria-label="Kişi adı içerir" data-testid="person-named-chip" />
      ) : null}
      <ChevronDown className="h-3.5 w-3.5 opacity-60" />
    </Button>
  );
  const open = chips.find((c) => c.key === openKey) ?? null;
  return (
    <div
      ref={bandRef}
      className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-y border-chrome-border bg-band/95 px-4 py-1.5 text-xs backdrop-blur supports-[backdrop-filter]:bg-band/85"
      data-testid="report-filter-band"
    >
      <ReportDateFilter reportKey={entry.key as ReportKey} bare />
      {inline.map((c) => chipButton(c))}
      {folded.length > 0 ? (
        <Popover open={foldOpen} onOpenChange={setFoldOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className={cn("h-7 gap-1.5 bg-card px-2 text-xs", foldedActive > 0 && "border-primary/50 text-primary")}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Süzgeçler ({folded.length})
              {foldedActive > 0 ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{foldedActive}</span> : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex w-72 flex-col gap-1.5 p-2" data-testid="folded-filters">
            {folded.map((c) => chipButton(c, true))}
          </PopoverContent>
        </Popover>
      ) : null}
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
