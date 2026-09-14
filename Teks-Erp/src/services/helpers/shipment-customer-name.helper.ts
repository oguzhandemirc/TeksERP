// =============================================================================
// SEVK BELGESİNDE "MÜŞTERİDEKİ AD" — çözüm zinciri (2026-09-04)
// =============================================================================
// Fabrika talebi: "sevkiyat belgelerinde ürünün MÜŞTERİDEKİ adı da yazsın; bir
// seferliğine bile değiştiyse O ismi kullanırız."
//
// Zincir `label.service` / `customer-name.helper`in BİREBİR aynısıdır (ikinci
// bir semantik açmak, etiketle irsaliyenin farklı ad basması demekti):
//
//   OrderLine.customerItemName   (bir-seferlik override)  -> OVERRIDE
//     yoksa
//   CustomerItemAlias.alias      (müşteri x ürün master)  -> MASTER
//     yoksa
//   null  -> çağıran bizim adımıza düşer
//
// ⚠️ TOP → SİPARİŞ SATIRI bağı YOKTUR. Çuval tahsisi (`SackAllocation`) çuval
// başınadır ve çuval KARIŞIK içerikli olabilir; yani "bu topun order line'ı"
// diye bir kayıt yok. Bu yüzden override kümesi SEVKİYAT KAPSAMINDA toplanır
// ve (itemId, colorId) ile eşlenir. Aday satırlar iki kaynaktan gelir:
//   (a) bu sevkiyatın çuvallarına yazılmış tahsisler — sevkin GERÇEKTEN
//       beslediği satırlar (yalnız DISPATCH'ten sonra vardır),
//   (b) sevkiyata bağlı siparişlerin satırları — PLANNED taslak önizlemede tek
//       kaynak budur; olmasaydı önizleme ile donmuş belge ayrışırdı.
// (a) ÖNCELİKLİDİR; iki kaynak da aynı çifte override veriyorsa tahsis kazanır.
//
// ⚠️ DETERMİNİZM load-bearing: aynı (itemId,colorId) çifti için birden çok
// satırda override olabilir. Sıra sabitlenmezse aynı sevkiyat iki baskıda
// FARKLI ad basar (ve `reissue` sahte bir "içerik değişti" üretir). Sıra:
// tahsisli-önce -> createdAt asc -> id asc; İLK dolu override kazanır.
//
// ⚠️ İKİNCİ KADEME (`byItem`) BİLİNÇLİ GENİŞ: kullanıcının kuralı "bir
// seferliğine bile değiştiyse o ismi kullanırız". Renk eşleşmeyen ama aynı
// ürünün satırında girilmiş bir ad, hiç ad basmamaktan iyidir. Dar kademe
// (itemId+colorId) her zaman ÖNCE denenir.
// =============================================================================

import { Prisma } from "@prisma/client";
import { ACTIVE_SACK_ALLOCATION } from "./sack-allocation.helper";
import { batchLoadAliases } from "./customer-name.helper";

/** Bir sevkiyat için çözülmüş müşteri-adı sözlüğü. */
export interface ShipmentCustomerNames {
  /** (itemId, colorId) -> müşterideki ürün adı (override ya da master). */
  itemName(itemId: string, colorId: string | null): string | null;
  /** colorId -> müşterideki renk adı (override ya da master). */
  colorName(colorId: string | null): string | null;
}

const NO_COLOR = " ";
const ckey = (itemId: string, colorId: string | null): string => `${itemId}|${colorId ?? NO_COLOR}`;

/** `collectShipmentDocContent`in ihtiyaç duyduğu okuma yüzeyi (tx ile de çalışır). */
type AliasDb = {
  sackAllocation: Prisma.TransactionClient["sackAllocation"];
  orderLine: Prisma.TransactionClient["orderLine"];
  customerItemAlias: Prisma.TransactionClient["customerItemAlias"];
  customerColorAlias: Prisma.TransactionClient["customerColorAlias"];
};

interface CandidateLine {
  itemId: string;
  colorId: string | null;
  customerItemName: string | null;
  customerColorName: string | null;
  createdAt: Date;
  id: string;
  /** Tahsisli satır (a) mı, yalnız sipariş bağından gelen (b) mi. */
  allocated: boolean;
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

/**
 * Sevkiyat kapsamındaki override + master alias'ları tek seferde yükler.
 *
 * `itemIds`/`colorIds` belgeye GERÇEKTEN giren topların kimlikleridir
 * (brütleştirme sonrası) — master alias sorgusu onlarla daraltılır. Override
 * kümesi sevkiyattan türer ve o kümeye bağlı değildir (sipariş satırında ad var
 * ama o üründen top gitmemiş olabilir; zararsız).
 */
export async function loadShipmentCustomerNames(
  db: AliasDb,
  input: {
    customerId: string;
    sackIds: string[];
    orderIds: string[];
    itemIds: string[];
    colorIds: string[];
  },
): Promise<ShipmentCustomerNames> {
  const lineSelect = {
    id: true,
    itemId: true,
    colorId: true,
    customerItemName: true,
    customerColorName: true,
    createdAt: true,
  } as const;

  const candidates: CandidateLine[] = [];

  // (a) Bu sevkiyatın çuvallarına yazılmış tahsisler — sevk ANINDA yazılır.
  if (input.sackIds.length) {
    const rows = await db.sackAllocation.findMany({
      where: { sackId: { in: input.sackIds }, ...ACTIVE_SACK_ALLOCATION },
      select: { orderLine: { select: lineSelect } },
    });
    for (const r of rows) candidates.push({ ...r.orderLine, allocated: true });
  }

  // (b) Sevkiyata bağlı siparişlerin satırları — PLANNED önizlemenin tek kaynağı.
  if (input.orderIds.length) {
    const rows = await db.orderLine.findMany({
      where: { orderId: { in: input.orderIds } },
      select: lineSelect,
    });
    for (const r of rows) candidates.push({ ...r, allocated: false });
  }

  // Determinizm: tahsisli önce -> createdAt asc -> id asc.
  candidates.sort((a, b) => {
    if (a.allocated !== b.allocated) return a.allocated ? -1 : 1;
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const itemByPair = new Map<string, string>();
  const itemByItem = new Map<string, string>();
  const colorByColor = new Map<string, string>();
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id)) continue; // aynı satır iki kaynaktan gelebilir
    seen.add(c.id);
    const item = clean(c.customerItemName);
    if (item) {
      const k = ckey(c.itemId, c.colorId);
      if (!itemByPair.has(k)) itemByPair.set(k, item);
      if (!itemByItem.has(c.itemId)) itemByItem.set(c.itemId, item);
    }
    const color = clean(c.customerColorName);
    if (color && c.colorId && !colorByColor.has(c.colorId)) colorByColor.set(c.colorId, color);
  }

  // Master alias (canlı) — override yoksa ikinci kademe.
  const master = await batchLoadAliases(db, input.customerId, input.itemIds, input.colorIds);

  return {
    itemName(itemId, colorId) {
      return (
        itemByPair.get(ckey(itemId, colorId)) ??
        itemByItem.get(itemId) ??
        master.itemAliasByItemId.get(itemId) ??
        null
      );
    },
    colorName(colorId) {
      if (!colorId) return null;
      return colorByColor.get(colorId) ?? master.colorAliasByColorId.get(colorId) ?? null;
    },
  };
}
