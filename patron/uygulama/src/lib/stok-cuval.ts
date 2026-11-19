// Stok kalem/top (`stok-kalem`), çuval deposu (`cuval-deposu`) ve sevkiyat dökümü (`sevkiyat-icerigi`) — SAF görünüm
// okuyucuları. Bütün sayılar fabrikanın (toplam, çuval başına top/metre, BRÜT sevk); burada yalnız metin kurulur.
import { formatDate } from "./format";
import { UNIT } from "./labels/uretim";
import { arr, num, obj, qty, str } from "../ui/pano/read";

export const STOK_BOLUMLERI = [
  { key: "bitmis", label: "Bitmiş" },
  { key: "ham", label: "Ham" },
] as const;
export type StokBolum = (typeof STOK_BOLUMLERI)[number]["key"];

export const isStokBolum = (v: unknown): v is StokBolum => v === "ham" || v === "bitmis";

const m = (v: unknown): string => `${qty(v)} ${UNIT.metre}`;
const t = (v: unknown): string => `${qty(v)} ${UNIT.top}`;
const gun = (v: unknown): string | null => (num(v) === null ? null : `${qty(v)} ${UNIT.gun}`);
const join = (parts: readonly (string | null | undefined)[]): string => parts.filter((p): p is string => !!p).join(" · ");

export interface Row {
  readonly key: string;
  readonly title: string;
  readonly value: string;
  readonly lines: readonly string[];
}

/** Bitmiş kalemin adı: kumaş + en + renk + kat (ham kalemde yalnız kumaş). */
function kalemTitle(k: Record<string, unknown>): string {
  const en = num(k.en);
  return join([str(k.urun) ?? "—", en === null ? null : `${qty(en)} cm`, str(k.renk), str(k.kat)]);
}

export interface StockKalemView {
  readonly totalText: string;
  readonly rows: readonly Row[];
  readonly kirpildi: boolean;
  readonly emanetText: string | null;
}

/** `stok-kalem` bölümü → kalem satırları (sıra fabrikanın). Veri yoksa `null` (eski fabrika). */
export function stockKalemView(veri: unknown, bolum: StokBolum): StockKalemView | null {
  const d = obj(veri);
  if (d.ham === undefined || d.bitmis === undefined) return null;
  const s = obj(d[bolum]);
  const e = d.emanet === undefined ? null : obj(d.emanet);
  return {
    totalText: `${m(s.toplamMetre)} · ${t(s.toplamTop)}`,
    rows: arr(s.kalemler).map((k) => ({
      key: String(k.anahtar),
      title: kalemTitle(k),
      value: m(k.metre),
      lines: [join([t(k.top), gun(k.enEskiGun) ? `en eski ${gun(k.enEskiGun)}` : null])],
    })),
    kirpildi: s.toplarKirpildi === true,
    emanetText: e ? `Müşteri malı (emanet) ayrı: ${m(bolum === "ham" ? e.hamMetre : e.bitmisMetre)} · ${t(bolum === "ham" ? e.hamTop : e.bitmisTop)}` : null,
  };
}

export interface KalemRollsView {
  readonly title: string;
  readonly summary: string;
  readonly rows: readonly Row[];
  /** Fabrika top dizisini kırptı ve bu kalemin topları eksik olabilir. */
  readonly eksik: boolean;
}

/** Kalemin raf topları (en yaşlı önce, fabrika sırası). Kalem bulunmazsa `null`. */
export function kalemRollsView(veri: unknown, bolum: StokBolum, anahtar: string): KalemRollsView | null {
  const s = obj(obj(veri)[bolum]);
  const k = arr(s.kalemler).find((x) => String(x.anahtar) === anahtar);
  if (!k) return null;
  const rows = arr(s.toplar).filter((r) => String(r.kalem) === anahtar).map((r) => ({
    key: String(r.id),
    title: str(r.topNo) ?? "Barkodsuz top",
    value: m(r.metre),
    lines: [join([str(r.depo), str(r.parti) ? `parti ${str(r.parti)}` : null, num(r.kg) === null ? null : `${qty(r.kg)} kg`, gun(r.gun) ? `${gun(r.gun)}dür rafta` : null]) || "—"],
  }));
  return { title: kalemTitle(k), summary: `${m(k.metre)} · ${t(k.top)}`, rows, eksik: s.toplarKirpildi === true && rows.length < (num(k.top) ?? 0) };
}

export const UNIT_KIND_LABEL: Readonly<Record<string, string>> = { SACK: "Çuval", CART: "Araba", BULK: "Dökme" };

function unitTitle(c: Record<string, unknown>): string {
  const kind = str(c.tur) ?? "SACK";
  if (kind === "SACK") return str(c.cuvalNo) ?? "—";
  return join([UNIT_KIND_LABEL[kind] ?? kind, str(c.etiket) ?? str(c.cuvalNo)]);
}

export interface SackDepotView {
  readonly summary: string;
  readonly detail: string;
  readonly customers: readonly Row[];
  readonly sacks: readonly (Row & { readonly assigned: boolean })[];
  readonly kirpildi: boolean;
}

/** `cuval-deposu` → özet + cari kovaları + birimler. Veri yoksa `null`. */
export function sackDepotView(veri: unknown, cariKartId?: string | null): SackDepotView | null {
  const d = obj(veri);
  if (d.ozet === undefined) return null;
  const o = obj(d.ozet);
  const all = arr(d.cuvallar);
  const sacks = cariKartId === undefined ? all : all.filter((c) => (c.cariKartId ?? null) === cariKartId);
  return {
    summary: `${qty(o.cuval)} çuval · ${t(o.top)} · ${m(o.metre)}`,
    detail: join([num(o.kg) === null ? null : `${qty(o.kg)} kg (${qty(o.tartiliCuval)}/${qty(o.cuval)} tartılı)`, num(o.sevkeAtanan) ? `${qty(o.sevkeAtanan)} çuval sevkiyata atandı` : null]) || "Tartılı çuval yok",
    customers: arr(d.cariler).map((c) => ({
      key: String(c.cariKartId ?? "none"),
      title: str(c.ad) ?? "—",
      value: `${qty(c.cuval)} çuval`,
      lines: [join([t(c.top), m(c.metre)])],
    })),
    sacks: sacks.map((c) => ({
      key: String(c.id),
      title: unitTitle(c),
      value: m(c.metre),
      lines: [join([str(c.cari) ?? "Müşterisiz", t(c.top), num(c.kg) === null ? null : `${qty(c.kg)} kg`, c.durum === "SEVKE_ATANDI" ? `sevkiyat ${str(c.sevkiyatNo) ?? ""}`.trim() : formatDate(c.olusturulma)])],
      assigned: c.durum === "SEVKE_ATANDI",
    })),
    kirpildi: d.kirpildi === true,
  };
}

export interface SackDetailView {
  readonly title: string;
  readonly summary: string;
  readonly info: string;
  readonly rolls: readonly Row[];
}

const rollLine = (r: Record<string, unknown>): string => {
  const en = num(r.en);
  return join([str(r.urun), str(r.renk), en === null ? null : `${qty(en)} cm`, str(r.kat), str(r.kalite) ? `kalite ${str(r.kalite)}` : null]) || "—";
};

/** Tek birim + topları; bulunmazsa `null` (sevk edildi ya da kırpıldı). */
export function sackDetailView(veri: unknown, id: string): SackDetailView | null {
  const c = arr(obj(veri).cuvallar).find((x) => String(x.id) === id);
  if (!c) return null;
  return {
    title: unitTitle(c),
    summary: `${t(c.top)} · ${m(c.metre)}${num(c.kg) === null ? "" : ` · ${qty(c.kg)} kg`}`,
    info: join([str(c.cari) ?? "Müşterisiz", str(c.sube), c.durum === "SEVKE_ATANDI" ? `sevkiyata atandı ${str(c.sevkiyatNo) ?? ""}`.trim() : "depoda", formatDate(c.olusturulma)]),
    rolls: arr(c.toplar).map((r) => ({ key: String(r.id), title: str(r.topNo) ?? "Barkodsuz top", value: m(r.metre), lines: [rollLine(r)] })),
  };
}

export interface ShipmentContentView {
  readonly summary: string;
  readonly detail: string | null;
  readonly sacks: readonly { readonly key: string; readonly title: string; readonly value: string; readonly line: string; readonly rolls: readonly (Row & { readonly iade: boolean; readonly yok: boolean })[] }[];
  readonly loose: readonly (Row & { readonly iade: boolean; readonly yok: boolean })[];
}

const contentRoll = (r: Record<string, unknown>) => ({
  key: String(r.id),
  title: str(r.topNo) ?? "Barkodsuz top",
  value: m(r.metre),
  lines: [join([rollLine(r), r.iade === true ? `iade ${formatDate(r.iadeTarihi)}` : null, r.yok === true ? "çuvalda değil" : null])],
  iade: r.iade === true,
  yok: r.yok === true,
});

/** `sevkiyat-icerigi` kaydı → özet + çuvallar (BRÜT; iade satırı rozetli). Alan yoksa `null`. */
export function shipmentContentView(kayit: unknown): ShipmentContentView | null {
  const k = obj(kayit);
  if (k.ozet === undefined) return null;
  const o = obj(k.ozet);
  return {
    summary: `${qty(o.cuval)} çuval · ${t(o.top)} · ${m(o.metre)}`,
    detail: join([num(o.kg) ? `${qty(o.kg)} kg (${qty(o.tartiliCuval)}/${qty(o.cuval)} tartılı)` : null, num(o.iadeTop) ? `${t(o.iadeTop)} iade (${m(o.iadeMetre)}) dahil — brüt` : null]) || null,
    sacks: arr(k.cuvallar).map((c) => ({
      key: String(c.id),
      title: join([unitTitle(c), str(c.sira) ? `#${str(c.sira)}` : null]),
      value: m(c.metre),
      line: join([t(c.top), num(c.kg) === null ? null : `${qty(c.kg)} kg`, num(c.iadeTop) ? `${qty(c.iadeTop)} iade` : null]),
      rolls: arr(c.toplar).map(contentRoll),
    })),
    loose: arr(k.cuvalsizToplar).map(contentRoll),
  };
}
