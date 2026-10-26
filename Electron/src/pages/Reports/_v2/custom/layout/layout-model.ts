// =============================================================================
// Özel rapor DÜZENİ — tanım gövdesinin `bloklar` + `duzen` alanları üzerinde saf işlemler (R2-DUZEN)
// =============================================================================
// Düzen yalnız SUNUMDUR: sırala / genişlik / sayfa kesmesi yalnız `duzen`i yeniden kurar, `bloklar`a
// dokunmaz (sayı değişemez). Ekle/çıkar içeriği değiştirir; doğrulama sunucuda (`dogrula`/`onizle`).
// `duzen` 12 sütunluk ızgarada akış sırasıyla paketlenir: y satır, x sütun, h her zaman 1 (yükseklik içerikten).
// =============================================================================

export const GRID_COLUMNS = 12;
export const MAX_BLOCKS = 20;

export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sayfaKesmesi?: boolean;
}

export interface DefinitionQuery {
  kup: string;
  olculer: string[];
  boyutlar?: string[];
  suzgec?: unknown;
  zaman?: { param: string; kiyas?: string };
  tavan?: number | string;
}

/** Gövdedeki blok — bilinmeyen alanlar (kod modunda yazılmış) korunur. */
export interface DefinitionBlock {
  id: string;
  tur: string;
  baslik?: string;
  sorgu?: DefinitionQuery;
  sorgular?: DefinitionQuery[];
  [key: string]: unknown;
}

export interface DefinitionBody {
  surum: number;
  baslik: string;
  parametreler?: Array<Record<string, unknown>>;
  bloklar: DefinitionBlock[];
  duzen?: LayoutItem[];
  [key: string]: unknown;
}

export type BlockKind = "anaSayi" | "grafik" | "tablo" | "varyant" | "donem" | "anlati" | "analiz" | "metin";

export interface PaletteEntry {
  kind: BlockKind;
  label: string;
  description: string;
  /** Sunucu bu bloğu henüz hesaplamıyorsa palette devre dışı + gerekçe. */
  unavailable?: string;
  defaultWidth: number;
}

export const PALETTE: readonly PaletteEntry[] = [
  { kind: "anaSayi", label: "Ana sayı", description: "Tek büyük sayı ve önceki dönem kıyası", defaultWidth: 4 },
  { kind: "grafik", label: "Grafik", description: "Bir ölçünün kırılıma göre grafiği", defaultWidth: 12 },
  { kind: "tablo", label: "Tablo", description: "Ölçüler ve kırılımlar satır satır", defaultWidth: 12 },
  { kind: "varyant", label: "Kırılım kartları", description: "Bir ölçünün en büyük 6 değeri yan yana", defaultWidth: 12 },
  { kind: "donem", label: "Dönem kıyası", description: "Son birkaç gün, hafta ya da ay sütun sütun", defaultWidth: 12 },
  { kind: "metin", label: "Not", description: "Rapora açıklama ya da uyarı metni", defaultWidth: 12 },
  { kind: "anlati", label: "Ne görüyoruz?", description: "Rapordaki sayılardan günlük dil özeti", defaultWidth: 12 },
  { kind: "analiz", label: "Analiz", description: "Gruplar arasında fark var mı, iki ölçü birlikte mi değişiyor?", defaultWidth: 12 },
];

export const KIND_LABEL: Record<string, string> = Object.fromEntries(PALETTE.map((p) => [p.kind, p.label]));
KIND_LABEL.kpi = "Yan sayılar";

/** Anlatı bloğunun kuralları (sunucu `NARRATIVE_RULES`); cümleyi sunucu kurar, burada yalnız seçim. */
export const NARRATIVE_RULE_OPTIONS = [
  { deger: "anaSayiKiyas", etiket: "Ana sayı ve önceki dönem" },
  { deger: "enBuyukPay", etiket: "En büyük pay" },
  { deger: "korelasyon", etiket: "Analiz sonucu" },
  { deger: "orneklemUyarisi", etiket: "Az kayıt uyarısı" },
] as const;

export const WIDTH_OPTIONS = [
  { w: 12, label: "Tam" },
  { w: 8, label: "Üçte iki" },
  { w: 6, label: "Yarım" },
  { w: 4, label: "Üçte bir" },
] as const;

export const CHART_OPTIONS = [
  { deger: "cubuk", etiket: "Çubuk" },
  { deger: "cizgi", etiket: "Çizgi" },
  { deger: "yiginCubuk", etiket: "Yığın çubuk" },
  { deger: "pasta", etiket: "Pasta" },
  { deger: "isiHaritasi", etiket: "Isı haritası" },
  { deger: "sacilim", etiket: "Saçılım" },
  { deger: "kutu", etiket: "Kutu" },
  { deger: "kucukCoklu", etiket: "Küçük çoklu" },
] as const;

export const PERIOD_UNITS = [
  { deger: "gun", etiket: "Gün" },
  { deger: "hafta", etiket: "Hafta" },
  { deger: "ay", etiket: "Ay" },
] as const;

const clampWidth = (w: unknown): number => (typeof w === "number" && Number.isInteger(w) && w >= 1 && w <= GRID_COLUMNS ? w : GRID_COLUMNS);

/** Görünür sıra: düzendekiler (y, x) sırasıyla, düzende olmayanlar gövde sırasıyla sonda ve tam genişlikte. */
export function orderedLayout(body: DefinitionBody): Array<{ block: DefinitionBlock; item: LayoutItem }> {
  const byId = new Map(body.bloklar.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const placed = [...(body.duzen ?? [])]
    .filter((d) => byId.has(d.i))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .filter((d) => (seen.has(d.i) ? false : (seen.add(d.i), true)))
    .map((d) => ({ block: byId.get(d.i)!, item: { ...d, w: clampWidth(d.w) } }));
  const rest = body.bloklar.filter((b) => !seen.has(b.id)).map((b) => ({ block: b, item: { i: b.id, x: 0, y: 0, w: GRID_COLUMNS, h: 1 } }));
  return [...placed, ...rest];
}

/** Sıralı (kimlik, genişlik, sayfa kesmesi) listesini 12 sütuna akıtır; sayfa kesmesi yeni satır açar. */
export function packLayout(order: ReadonlyArray<Pick<LayoutItem, "i" | "w" | "sayfaKesmesi">>): LayoutItem[] {
  let x = 0;
  let y = 0;
  return order.map((o) => {
    const w = clampWidth(o.w);
    if (x > 0 && (x + w > GRID_COLUMNS || o.sayfaKesmesi)) {
      x = 0;
      y += 1;
    }
    const item: LayoutItem = { i: o.i, x, y, w, h: 1, ...(o.sayfaKesmesi ? { sayfaKesmesi: true } : {}) };
    x += w;
    if (x >= GRID_COLUMNS) {
      x = 0;
      y += 1;
    }
    return item;
  });
}

const withLayout = (body: DefinitionBody, order: ReadonlyArray<Pick<LayoutItem, "i" | "w" | "sayfaKesmesi">>): DefinitionBody => ({ ...body, duzen: packLayout(order) });

const currentOrder = (body: DefinitionBody) => orderedLayout(body).map(({ item }) => ({ i: item.i, w: item.w, sayfaKesmesi: item.sayfaKesmesi }));

/** Sürükle-bırak: `activeId` bloğunu `overId`nin yerine taşır. `bloklar` aynı kalır. */
export function moveBlock(body: DefinitionBody, activeId: string, overId: string): DefinitionBody {
  const order = currentOrder(body);
  const from = order.findIndex((o) => o.i === activeId);
  const to = order.findIndex((o) => o.i === overId);
  if (from < 0 || to < 0 || from === to) return body;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return withLayout(body, next);
}

/** Klavye/erişilebilir yedek: bir adım yukarı (-1) ya da aşağı (+1). */
export function shiftBlock(body: DefinitionBody, id: string, delta: -1 | 1): DefinitionBody {
  const order = currentOrder(body);
  const at = order.findIndex((o) => o.i === id);
  const target = order[at + delta];
  return at < 0 || !target ? body : moveBlock(body, id, target.i);
}

export function resizeBlock(body: DefinitionBody, id: string, w: number): DefinitionBody {
  return withLayout(body, currentOrder(body).map((o) => (o.i === id ? { ...o, w: clampWidth(w) } : o)));
}

export function setPageBreak(body: DefinitionBody, id: string, on: boolean): DefinitionBody {
  return withLayout(body, currentOrder(body).map((o) => (o.i === id ? { ...o, sayfaKesmesi: on } : o)));
}

/** Blok alanlarını günceller (başlık, ölçü, grafik türü…) — düzen değişmez. */
export function updateBlock(body: DefinitionBody, id: string, patch: Partial<DefinitionBlock>): DefinitionBody {
  return { ...body, bloklar: body.bloklar.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

/** Son blok çıkarılamaz (şema en az bir blok ister). */
export function removeBlock(body: DefinitionBody, id: string): DefinitionBody {
  if (body.bloklar.length <= 1 || !body.bloklar.some((b) => b.id === id)) return body;
  const rest = { ...body, bloklar: body.bloklar.filter((b) => b.id !== id) };
  return withLayout(rest, currentOrder(body).filter((o) => o.i !== id));
}

/** Gövdedeki ilk sorgu — yeni blok aynı konu (küp) ve dönemle doğar. */
export function baseQuery(body: DefinitionBody): DefinitionQuery | null {
  for (const b of body.bloklar) {
    if (b.sorgu) return b.sorgu;
    if (b.sorgular?.[0]) return b.sorgular[0];
  }
  return null;
}

function nextId(body: DefinitionBody, kind: BlockKind): string {
  const prefix = { anaSayi: "ana", grafik: "grafik", tablo: "tablo", varyant: "kirilim", donem: "donem", anlati: "anlati", analiz: "analiz", metin: "not" }[kind];
  const ids = new Set(body.bloklar.map((b) => b.id));
  for (let n = 1; ; n++) if (!ids.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/**
 * Paletten yeni blok: konu/dönem gövdenin ilk sorgusundan, kırılım `dimension`dan (yoksa ilk kategori boyutu).
 * Kurulamıyorsa (sorgusuz gövde, devre dışı tür, tavan) `null`.
 */
export function addBlock(body: DefinitionBody, kind: BlockKind, dimension: string | null): DefinitionBody | null {
  const entry = PALETTE.find((p) => p.kind === kind);
  if (!entry || entry.unavailable || body.bloklar.length >= MAX_BLOCKS) return null;
  const id = nextId(body, kind);
  let block: DefinitionBlock;
  if (kind === "metin") block = { id, tur: "metin", metin: "Açıklama yazın." };
  else if (kind === "anlati") block = { id, tur: "anlati", kurallar: NARRATIVE_RULE_OPTIONS.map((r) => r.deger), enFazla: 3 };
  else {
    const base = baseQuery(body);
    if (!base) return null;
    const measure = base.olculer[0]!;
    const q = (dims: string[], withCompare: boolean): DefinitionQuery => ({
      kup: base.kup,
      olculer: [measure],
      boyutlar: dims,
      ...(base.zaman ? { zaman: withCompare ? base.zaman : { param: base.zaman.param } } : {}),
    });
    const dims = dimension ? [dimension] : [];
    if (kind === "anaSayi") block = { id, tur: "anaSayi", sorgu: q([], true) };
    else if (kind === "grafik") block = { id, tur: "grafik", gorsel: "cubuk", sorgu: q(dims, false) };
    else if (kind === "tablo") block = { id, tur: "tablo", sorgu: q(dims, false) };
    else if (kind === "varyant") block = { id, tur: "varyant", ilkN: 6, sorgu: q(dims, true) };
    // R3-ANALIZ: konunun ölçüsü × ilk kırılım; maruziyeti kullanıcı seçer (sayımda zorunlu, kaydet bekler).
    else if (kind === "analiz") block = { id, tur: "analiz", yontem: "kiKare", kup: base.kup, x: dimension, y: measure, ...(base.zaman ? { zaman: { param: base.zaman.param } } : {}) };
    else block = { id, tur: "donem", birim: "ay", adet: 3, sorgu: q(dims, false) };
    if ((kind === "grafik" || kind === "varyant" || kind === "analiz") && dims.length === 0) return null;
  }
  const order = [...currentOrder(body), { i: id, w: entry.defaultWidth }];
  return withLayout({ ...body, bloklar: [...body.bloklar, block] }, order);
}

/** Kayda giden gövde: düzen her zaman tam ve paketli (eski kayıtta `duzen` boş olabilir). */
export function normalizedBody(body: DefinitionBody): DefinitionBody {
  return withLayout(body, currentOrder(body));
}
