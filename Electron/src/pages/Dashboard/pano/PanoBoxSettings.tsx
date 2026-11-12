// Kutu ayar paneli içeriği — yalnız sunucunun verdiği (izinli/açık) bölümler seçenek olur; null bölüm hiç çıkmaz.
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { TERIM } from "@/lib/terim";
import type { PanoBoxData } from "./box-types";
import {
  agendaKinds, MOVEMENT_GROUP_OF, MOVEMENT_GROUPS, toggleHidden,
  type AgendaKind, type BoxOptionKey, type BoxOptions, type MovementGroup,
} from "./box-options";
import { egilimSerileri } from "./PanoGrafikKutulari";
import type { SetBoxOption } from "./usePanoBoxOptions";

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-xs font-semibold text-muted-foreground">{label}</legend>
      {children}
    </fieldset>
  );
}

function Seg<T extends string | number>({ label, value, choices, onChange }: { label: string; value: T; choices: ReadonlyArray<readonly [T, string]>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
      {choices.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn("rounded-md px-2.5 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === v ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", disabled && "opacity-60")}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

/** Görünür türlerin listesi; son açık tür kapatılamaz (kutu boşalmasın). */
function KindList<T extends string>({ kinds, hidden, labels, onChange }: { kinds: readonly T[]; hidden: readonly T[]; labels: Record<T, string>; onChange: (hidden: T[]) => void }) {
  const visible = kinds.filter((k) => !hidden.includes(k));
  return (
    <>
      {kinds.map((k) => {
        const on = !hidden.includes(k);
        return <Check key={k} label={labels[k]} checked={on} disabled={on && visible.length === 1} onChange={(v) => onChange(toggleHidden(hidden, k, v))} />;
      })}
    </>
  );
}

const AGENDA_LABEL: Record<AgendaKind, string> = {
  alis: "Alış teslimleri",
  isEmri: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} başlangıçları`,
  dokuma: "Dokuma başlangıçları",
  sevk: "Planlı sevkiyatlar",
  tarihsiz: "Tarihsiz sevkiyat listesi",
};

const MOVEMENT_LABEL: Record<MovementGroup, string> = {
  siparis: "Sipariş", sevk: "Sevk", fasonGiden: "Fasona giden", fasonDonen: "Fason dönüşü", malKabul: "Mal kabul", gelenBelge: "Gelen belge",
};

type Renderer<K extends BoxOptionKey> = (d: PanoBoxData[K], o: BoxOptions[K], set: (v: BoxOptions[K]) => void) => ReactNode;

const SETTINGS: { [K in BoxOptionKey]: Renderer<K> } = {
  ajanda: (d, o, set) => {
    const kinds = agendaKinds(d);
    return (
      <>
        {kinds.length > 0 && <Group label="Görünsün"><KindList kinds={kinds} hidden={o.hidden} labels={AGENDA_LABEL} onChange={(hidden) => set({ ...o, hidden })} /></Group>}
        <Group label="Takvim">
          <Check label="Takvimi göster" checked={o.calendar} onChange={(calendar) => set({ ...o, calendar })} />
          {o.calendar && <Seg label="Haftanın ilk günü" value={o.weekStart} choices={[["mon", "Pzt"], ["sun", "Paz"]]} onChange={(weekStart) => set({ ...o, weekStart })} />}
        </Group>
      </>
    );
  },
  sonHareketler: (d, o, set) => {
    const groups = MOVEMENT_GROUPS.filter((g) => d.turler.some((t) => MOVEMENT_GROUP_OF[t] === g));
    return (
      <>
        {groups.length > 1 && <Group label="Türler"><KindList kinds={groups} hidden={o.hidden} labels={MOVEMENT_LABEL} onChange={(hidden) => set({ ...o, hidden })} /></Group>}
        <Group label="Satır"><Seg label="Satır sayısı" value={o.rows} choices={[[5, "5"], [8, "8"]]} onChange={(rows) => set({ ...o, rows })} /></Group>
      </>
    );
  },
  egilim: (d, o, set) => {
    const series = egilimSerileri(d).map((s) => s.key as "uretim" | "sevk");
    return (
      <>
        {series.length > 1 && <Group label="Seriler"><KindList kinds={series} hidden={o.hidden} labels={{ uretim: "Üretim", sevk: "Sevk" }} onChange={(hidden) => set({ ...o, hidden })} /></Group>}
        <Group label="Grafik"><Seg label="Grafik türü" value={o.chart} choices={[["area", "Alan"], ["line", "Çizgi"], ["bar", "Sütun"]]} onChange={(chart) => set({ ...o, chart })} /></Group>
      </>
    );
  },
  dagilim: (_d, o, set) => (
    <>
      <Group label="Grafik"><Seg label="Grafik türü" value={o.chart} choices={[["donut", "Halka"], ["bars", "Çubuk"]]} onChange={(chart) => set({ ...o, chart })} /></Group>
      <Group label="Dilim"><Seg label="Dilim sayısı" value={o.slices} choices={[[3, "3"], [5, "5"], [8, "8"]]} onChange={(slices) => set({ ...o, slices })} /></Group>
    </>
  ),
  enCok: (d, o, set) => (
    <>
      {d.uretilen && d.sevkEdilen && (
        <Group label="Açılış sekmesi"><Seg label="Varsayılan sekme" value={o.tab} choices={[["uretilen", "Üretilen"], ["sevk", "Sevk edilen"]]} onChange={(tab) => set({ ...o, tab })} /></Group>
      )}
      <Group label="Satır"><Seg label="Satır sayısı" value={o.rows} choices={[[3, "3"], [5, "5"]]} onChange={(rows) => set({ ...o, rows })} /></Group>
    </>
  ),
};

/** Kutunun ayar içeriği; ayarı olmayan ya da verisi gelmemiş kutuda `null` (⋯ menüsünde "Ayarlar" çıkmaz). */
export function boxSettings(key: string, data: unknown, options: BoxOptions, setOption: SetBoxOption): ReactNode {
  if (!(key in SETTINGS) || data === null || data === undefined) return null;
  const k = key as BoxOptionKey;
  const r = SETTINGS[k] as Renderer<BoxOptionKey>;
  return <div className="space-y-3">{r(data as PanoBoxData[BoxOptionKey], options[k], (v) => setOption(k, v))}</div>;
}
