// =============================================================================
// TeksERP - Customer Name Cascade Helper
// =============================================================================
// Etiket / kartela basımında "müşterinin gördüğü ad" cascade'i.
// Tek yerde tutulur ki swatch, label endpoint'leri aynı mantıkla çalışsın.
//
// Sıra:
//   OrderLine.customerItemName  (1-shot override)  →  source: "OVERRIDE"
//     ↓ yoksa
//   CustomerItemAlias.alias     (master, live)     →  source: "MASTER"
//     ↓ yoksa
//   Item.name                   (default)          →  source: "DEFAULT"
//
// Aynı sıra color için; renkte MASTER kademesi iki katlıdır: kumaşa özel
// (`CustomerItemColorAlias`) → genel (`CustomerColorAlias`), bkz. aşağıda
// `loadCustomerColorIndex`.
// =============================================================================

import { Prisma } from "@prisma/client";
import { normalizeDisplayName } from "./name-normalize.helper";

export type NameSource = "OVERRIDE" | "MASTER" | "DEFAULT";

export interface ResolvedName {
  name: string;
  source: NameSource;
}

/**
 * Tek değer için cascade — override > master > fallback.
 */
export function resolveName(
  override: string | null | undefined,
  master: string | null | undefined,
  fallback: string,
): ResolvedName {
  if (override && override.trim().length > 0) {
    return { name: override, source: "OVERRIDE" };
  }
  if (master && master.trim().length > 0) {
    return { name: master, source: "MASTER" };
  }
  return { name: fallback, source: "DEFAULT" };
}

/**
 * Boş string / sadece whitespace → null (override silindi sayılır).
 * OrderLine.customerItemName / customerColorName yazılırken normalize.
 *
 * 2026-08-19 (kullanıcı kararı): BÜYÜK harfe de çevrilir. Eskiden yalnız trim
 * ediliyordu ve bu, aynı listede iki ayrı rejim üretiyordu: `item.name` BÜYÜK
 * saklanırken müşterinin kendi kumaş adı girildiği gibi kalıyordu. Sevk
 * irsaliyesinde ve etikette yan yana basıldıkları için görsel olarak da
 * tutarsızdı. (Arama tarafı zaten katlanmış gölge kolondan çözülüyor — bu
 * değişiklik GÖRÜNÜM tutarlılığı içindir, arama için gerekli değildi.)
 */
export function normalizeOverride(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = normalizeDisplayName(v);
  return t.length === 0 ? null : t;
}

// =============================================================================
// RENK ADI ANA VERİ KADEMESİ — TEK ÇÖZÜCÜ (docs/design/MUSTERI-KUMAS-RENK-ADI.md §5)
// =============================================================================
// Müşterinin renk adı iki tablodan gelebilir: kumaşa özel (`CustomerItemColorAlias`,
// müşteri × kumaş × renk) ve genel (`CustomerColorAlias`, müşteri × renk). Özelden
// genele çözülür (Oracle Customer Items / BC Item References kalıbı). Bu iki tabloyu
// ad için okuyan TEK yer burasıdır; `test_musteri_adi_tek_cozucu` başka okuyucuyu
// kırmızıya düşürür — etiketle irsaliyenin farklı ad basmasının tek panzehiri.
// =============================================================================

/** Ana veri kademesinin hangi tablodan geldiği. `NameSource` DEĞİŞMEZ. */
export type ColorNameScope = "ITEM" | "CUSTOMER";

export interface ColorMaster {
  alias: string;
  scope: ColorNameScope;
}

export interface CustomerColorIndex {
  /** Ana veri kademesi: kumaşa özel → genel; ikisi de yoksa null. */
  master(customerId: string, itemId: string, colorId: string | null): ColorMaster | null;
}

type ColorIndexDb = {
  customerColorAlias: Prisma.TransactionClient["customerColorAlias"];
  customerItemColorAlias: Prisma.TransactionClient["customerItemColorAlias"];
};

const uniq = (xs: Array<string | null | undefined>): string[] => [...new Set(xs.filter((x): x is string => !!x))];

/**
 * Çok müşterili, N+1'siz: iki findMany (customerId IN · itemId IN · colorId IN).
 * Seri çeker — tx içinde de güvenli (tx + Promise.all yasak).
 */
export async function loadCustomerColorIndex(
  db: ColorIndexDb,
  keys: { customerIds: Array<string | null | undefined>; itemIds: Array<string | null | undefined>; colorIds: Array<string | null | undefined> },
): Promise<CustomerColorIndex> {
  const customerIds = uniq(keys.customerIds);
  const itemIds = uniq(keys.itemIds);
  const colorIds = uniq(keys.colorIds);
  const general = new Map<string, string>();
  const byItem = new Map<string, string>();
  if (customerIds.length > 0 && colorIds.length > 0) {
    const rows = await db.customerColorAlias.findMany({
      where: { customerId: { in: customerIds }, colorId: { in: colorIds } },
      select: { customerId: true, colorId: true, alias: true },
    });
    // `alias` null = yalnız atama (assigned), özel ad yok → bizim adımız geçerli.
    for (const r of rows) if (r.alias) general.set(`${r.customerId}|${r.colorId}`, r.alias);
    if (itemIds.length > 0) {
      const own = await db.customerItemColorAlias.findMany({
        where: { customerId: { in: customerIds }, itemId: { in: itemIds }, colorId: { in: colorIds } },
        select: { customerId: true, itemId: true, colorId: true, alias: true },
      });
      for (const r of own) byItem.set(`${r.customerId}|${r.itemId}|${r.colorId}`, r.alias);
    }
  }
  return {
    master(customerId, itemId, colorId) {
      if (!colorId) return null;
      const own = byItem.get(`${customerId}|${itemId}|${colorId}`);
      if (own) return { alias: own, scope: "ITEM" };
      const gen = general.get(`${customerId}|${colorId}`);
      return gen ? { alias: gen, scope: "CUSTOMER" } : null;
    },
  };
}

/**
 * İrsaliye kademe sırası (sevkiyat kapsamında satır kümesi olan yüzeyler), saf:
 *   1 satır adı, aynı kumaş+renk → 2 kumaşa özel → 3 satır adı, aynı renk başka kumaş
 *   → 4 genel → null (çağıran bizim adımıza düşer).
 * 3. kademe (geniş) 2'nin ALTINDA: kumaşa özel ad girildiyse başka kumaşın satır adı
 * onu ezmez; girilmediyse zincir bugünküyle aynı çıktıyı verir.
 */
export function pickShipmentColorName(a: {
  pairOverride: string | null;
  wideOverride: string | null;
  master: ColorMaster | null;
}): { ad: string | null; scope: ColorNameScope | null } {
  if (a.pairOverride) return { ad: a.pairOverride, scope: null };
  if (a.master?.scope === "ITEM") return { ad: a.master.alias, scope: "ITEM" };
  if (a.wideOverride) return { ad: a.wideOverride, scope: null };
  if (a.master) return { ad: a.master.alias, scope: "CUSTOMER" };
  return { ad: null, scope: null };
}

/** `colorNameScope` yalnız ana veri kademesi KAZANDIĞINDA dolar (§12.4). */
export function colorScopeOf(resolved: ResolvedName | null, master: ColorMaster | null): ColorNameScope | null {
  return resolved?.source === "MASTER" && master ? master.scope : null;
}

// =============================================================================
// Toplu master alias çekme — kumaş adı haritası + renk indeksi, sorgu sayısı sabit.
// =============================================================================

export interface BatchAliasResult {
  itemAliasByItemId: Map<string, string>;
  colors: CustomerColorIndex;
}

type AliasDb = ColorIndexDb & { customerItemAlias: Prisma.TransactionClient["customerItemAlias"] };

/** Tek müşteri için kumaş adı haritası + renk indeksi (snapshot builder'lar). */
export async function batchLoadAliases(
  client: AliasDb,
  customerId: string,
  itemIds: string[],
  colorIds: Array<string | null>,
): Promise<BatchAliasResult> {
  const multi = await batchLoadAliasesMulti(client, [customerId], itemIds, colorIds);
  const itemAliasByItemId = new Map<string, string>();
  for (const [k, v] of multi.itemAlias) itemAliasByItemId.set(k.slice(customerId.length + 1), v);
  return { itemAliasByItemId, colors: multi.colors };
}

/**
 * ÇOK MÜŞTERİLİ toplu alias — kaç müşteri olursa olsun sabit gidiş-dönüş
 * (müşteri başına döngü tx + Promise.all yasağı yüzünden seri koşardı).
 * Kumaş adı anahtarı `${customerId}:${itemId}`.
 */
export async function batchLoadAliasesMulti(
  client: AliasDb,
  customerIds: string[],
  itemIds: string[],
  colorIds: Array<string | null>,
): Promise<{ itemAlias: Map<string, string>; colors: CustomerColorIndex }> {
  const musteriler = uniq(customerIds);
  const urunler = uniq(itemIds);
  const itemAlias = new Map<string, string>();
  if (musteriler.length > 0 && urunler.length > 0) {
    const rows = await client.customerItemAlias.findMany({
      where: { customerId: { in: musteriler }, itemId: { in: urunler } },
      select: { customerId: true, itemId: true, alias: true },
    });
    for (const r of rows) itemAlias.set(`${r.customerId}:${r.itemId}`, r.alias);
  }
  const colors = await loadCustomerColorIndex(client, { customerIds: musteriler, itemIds: urunler, colorIds });
  return { itemAlias, colors };
}
