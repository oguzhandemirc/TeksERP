// Kutuya özgü gösterim ayarı (`prefs.dashboard.boxOptions`) — saf şema. Ayar yalnız gösterimi süzer (veri isteği
// değişmez). Gizlenen tür "gizli" listesinde tutulur: sunucuya yeni tür eklenince varsayılan olarak görünür.
// Okurken bilinmeyen kutu/anahtar/değer sessizce düşer; varsayılana eşit kutu kayda yazılmaz.
import type { AgendaBox } from "./box-types";
import type { HareketTuru } from "./types";

export const AGENDA_KINDS = ["alis", "isEmri", "dokuma", "sevk", "tarihsiz"] as const;
export type AgendaKind = (typeof AGENDA_KINDS)[number];

/** Son hareketlerde tür grubu — doğrudan sevk "Sevk" grubundadır. */
export const MOVEMENT_GROUPS = ["siparis", "sevk", "fasonGiden", "fasonDonen", "malKabul", "gelenBelge"] as const;
export type MovementGroup = (typeof MOVEMENT_GROUPS)[number];
export const MOVEMENT_GROUP_OF: Record<HareketTuru, MovementGroup> = {
  SIPARIS: "siparis", SEVK: "sevk", DOGRUDAN_SEVK: "sevk", FASON_GIDEN: "fasonGiden",
  FASON_DONEN: "fasonDonen", MAL_KABUL: "malKabul", GELEN_BELGE: "gelenBelge",
};

export interface AgendaOptions { hidden: AgendaKind[]; calendar: boolean; weekStart: "mon" | "sun" }
export interface MovementOptions { hidden: MovementGroup[]; rows: 5 | 8 }
export interface TrendOptions { hidden: Array<"uretim" | "sevk">; chart: "area" | "line" | "bar" }
export interface DistributionOptions { chart: "donut" | "bars"; slices: 3 | 5 | 8 }
export interface TopOptions { tab: "uretilen" | "sevk"; rows: 3 | 5 }

export interface BoxOptions {
  ajanda: AgendaOptions;
  sonHareketler: MovementOptions;
  egilim: TrendOptions;
  dagilim: DistributionOptions;
  enCok: TopOptions;
}
export type BoxOptionKey = keyof BoxOptions;

/** Varsayılan = ayardan önceki görünüm (sunucu en çok 8 hareket, 6 dilim, 5 kumaş veriyor). */
export const DEFAULT_BOX_OPTIONS: BoxOptions = {
  ajanda: { hidden: [], calendar: true, weekStart: "mon" },
  sonHareketler: { hidden: [], rows: 8 },
  egilim: { hidden: [], chart: "area" },
  dagilim: { chart: "donut", slices: 8 },
  enCok: { tab: "uretilen", rows: 5 },
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const subset = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? allowed.filter((a) => v.includes(a)) : [];

const CLEANERS: { [K in BoxOptionKey]: (r: Rec) => BoxOptions[K] } = {
  ajanda: (r) => ({
    hidden: subset(r.hidden, AGENDA_KINDS),
    calendar: typeof r.calendar === "boolean" ? r.calendar : true,
    weekStart: pick(r.weekStart, ["mon", "sun"] as const, "mon"),
  }),
  sonHareketler: (r) => ({ hidden: subset(r.hidden, MOVEMENT_GROUPS), rows: pick(r.rows, [5, 8] as const, 8) }),
  egilim: (r) => ({ hidden: subset(r.hidden, ["uretim", "sevk"] as const), chart: pick(r.chart, ["area", "line", "bar"] as const, "area") }),
  dagilim: (r) => ({ chart: pick(r.chart, ["donut", "bars"] as const, "donut"), slices: pick(r.slices, [3, 5, 8] as const, 8) }),
  enCok: (r) => ({ tab: pick(r.tab, ["uretilen", "sevk"] as const, "uretilen"), rows: pick(r.rows, [3, 5] as const, 5) }),
};

export const hasBoxOptions = (key: string): key is BoxOptionKey => key in CLEANERS;

/** Kayıtlı ham ayar → her kutu için geçerli ayar (eksik/bozuk alan varsayılana döner). */
export function cleanBoxOptions(raw: unknown): BoxOptions {
  const src = isRec(raw) ? raw : {};
  const out = {} as Rec;
  for (const k of Object.keys(CLEANERS) as BoxOptionKey[]) out[k] = CLEANERS[k](isRec(src[k]) ? (src[k] as Rec) : {});
  return out as unknown as BoxOptions;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Bir kutunun ayarını değiştirir; dönen değer kayda yazılacak blob (hepsi varsayılansa `undefined`). */
export function nextBoxOptions<K extends BoxOptionKey>(raw: unknown, key: K, value: BoxOptions[K]): Rec | undefined {
  const cur = cleanBoxOptions(raw);
  const merged: Rec = { ...cur, [key]: CLEANERS[key](value as unknown as Rec) };
  const out: Rec = {};
  for (const k of Object.keys(CLEANERS) as BoxOptionKey[]) if (!same(merged[k], DEFAULT_BOX_OPTIONS[k])) out[k] = merged[k];
  return Object.keys(out).length ? out : undefined;
}

/** Listede aç/kapa (gizli listesi). */
export function toggleHidden<T extends string>(hidden: readonly T[], kind: T, visible: boolean): T[] {
  return visible ? hidden.filter((h) => h !== kind) : hidden.includes(kind) ? [...hidden] : [...hidden, kind];
}

/** Ajandada sunucunun verdiği (null olmayan) türler. */
export function agendaKinds(d: AgendaBox): AgendaKind[] {
  const out: AgendaKind[] = [];
  if (d.isler.alisTeslim) out.push("alis");
  if (d.isler.isEmriBaslangic) out.push("isEmri");
  if (d.isler.dokumaBaslangic) out.push("dokuma");
  if (d.isler.sevkiyat) out.push("sevk");
  if (d.planliSevkiyat) out.push("tarihsiz");
  return out;
}
