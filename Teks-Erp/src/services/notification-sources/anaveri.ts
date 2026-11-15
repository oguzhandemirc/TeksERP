// =============================================================================
// CARİ KART · ÜRÜN KARTI OLAYLARI — S4 (geniş katalog 2026-11-14)
// =============================================================================
// Tek yayma noktaları; çağıranlar kartı doğuran / durumunu geçiren tx'in İÇİNDEN çağırır. Yalnız çekirdek ana veri
// modellerini okur (finans modeli YOK — kart router'ı ön muhasebe rejim kapısına bağlanmasın). Toplu içe aktarma ve
// yönetim bulutu doğuşu bu türleri yaymaz (`notify:false`; bulut kendi türünü `cari.patron-carisi` yayar).
// =============================================================================
import type { Prisma } from "@prisma/client";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { auditFieldLabel } from "../../constants/audit-field-labels";
import { off, who, type Actor } from "./satis";

type Tx = EmitDb & Prisma.TransactionClient;
const subject = (type: string, id: string) => ({ type, id, key: id });
const txt = (s: string | null | undefined, max = 120): string => (s?.trim() ? s.trim().slice(0, max) : "—");

async function cardFacts(tx: Tx, customerId: string): Promise<{ cariId: string; cariAd: string; cariKodu: string } | null> {
  const c = await tx.customer.findUnique({ where: { id: customerId }, select: { name: true, code: true } });
  return c ? { cariId: customerId, cariAd: c.name, cariKodu: c.code } : null;
}

/** `cari.olusturuldu` — kart doğuş tx'i (`CustomerService.createCardInTx`; panel · hızlı kayıt · token boğazı). */
export async function emitCustomerCardCreatedTx(tx: Tx, customerId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await cardFacts(tx, customerId);
  if (!f) return;
  await emitNotification(tx, "cari.olusturuldu", subject("customer", customerId), f, { actorUserId: who(actor) });
}

/**
 * Metne girebilen müşteri kartı alanları — OPT-IN (iç kolon: id/künye/`nameFold`/`type` türevi/birleştirme/token yok).
 * Listede olmayan alanın değişimi bildirim doğurmaz.
 */
export const CUSTOMER_CHANGE_FIELDS: ReadonlySet<string> = new Set([
  "name", "code", "taxNumber", "exportCode", "address", "city", "district", "country", "defaultDestination",
  "contactName", "contactPhone", "email", "notes", "isCustomerRole", "isSupplierRole", "isSubcontractorRole", "isActive",
  "documentProfileId", "labelWidthSource", "tamburWeighRequired", "tamburSplitLengthM", "tamburLabelBatchEnabled",
  "labelShowGlobalTemplates",
]);

/** `cari.degisti` — kart güncellemesinin tx'i (`CustomerService.afterUpdateTx` ← `BaseService.updateCore`); yük alan ADLARI. */
export async function emitCustomerChangedTx(tx: Tx, customerId: string, changes: ReadonlyArray<{ field: string }>, actor: Actor): Promise<void> {
  const alanlar = [...new Set(changes.map((c) => c.field).filter((f) => CUSTOMER_CHANGE_FIELDS.has(f)))].map(auditFieldLabel);
  await emitCardChangedTx(tx, customerId, alanlar, actor);
}

/**
 * `cari.degisti` — finans/fason terimleri (S6b): `cariService.update` tx'i, kartın görünen alan ADLARIYLA (değer yok).
 * Terim etiketleri çağıranın (finans kapılı zincir) sözlüğünden gelir; bu dosya finans modelini okumaz.
 */
export async function emitCustomerTermsChangedTx(tx: Tx, customerId: string, termLabels: readonly string[], actor: Actor): Promise<void> {
  await emitCardChangedTx(tx, customerId, [...new Set(termLabels)], actor);
}

/** `cari.degisti`in TEK yayma noktası — kart alanı ve finans terimi yolu aynı satıra düşer. */
async function emitCardChangedTx(tx: Tx, customerId: string, alanlar: readonly string[], actor: Actor): Promise<void> {
  if (alanlar.length === 0) return;
  if (await off(tx)) return;
  const f = await cardFacts(tx, customerId);
  if (!f) return;
  await emitNotification(tx, "cari.degisti", subject("customer", customerId), { ...f, alanlar: txt(alanlar.join(", "), 200) }, { actorUserId: who(actor) });
}

/** `cari.pasife-alindi` — arşiv kapısının yazımı (`CustomerService` update/softDelete → `archiveMasterData`). */
export async function emitCustomerArchivedTx(tx: Tx, customerId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await cardFacts(tx, customerId);
  if (!f) return;
  await emitNotification(tx, "cari.pasife-alindi", subject("customer", customerId), f, { actorUserId: who(actor) });
}

async function itemFacts(tx: Tx, itemId: string): Promise<{ urunId: string; urunAd: string; urunKodu: string } | null> {
  const i = await tx.item.findUnique({ where: { id: itemId }, select: { name: true, code: true } });
  return i ? { urunId: itemId, urunAd: i.name, urunKodu: i.code } : null;
}

/** `anaveri.urun-olusturuldu` — yeni ürün kartının doğuş tx'i (`ItemService.create`; diriltme bir geçiştir, yaymaz). */
export async function emitItemCreatedTx(tx: Tx, itemId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await itemFacts(tx, itemId);
  if (!f) return;
  await emitNotification(tx, "anaveri.urun-olusturuldu", subject("item", itemId), f, { actorUserId: who(actor) });
}

/** `anaveri.urun-pasif` — yaşam döngüsünün tek yazarı, ARCHIVED claim'i (`transitionItemLifecycleTx`). */
export async function emitItemArchivedTx(tx: Tx, itemId: string, reason: string | null | undefined, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await itemFacts(tx, itemId);
  if (!f) return;
  await emitNotification(tx, "anaveri.urun-pasif", subject("item", itemId), { ...f, sebep: txt(reason) }, { actorUserId: who(actor) });
}

/** `anaveri.renk-olusturuldu` — renk doğuş tx'i (`ColorService.afterCreateTx` ← `BaseService.performInsert`). */
export async function emitColorCreatedTx(tx: Tx, colorId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const c = await tx.color.findUnique({ where: { id: colorId }, select: { name: true, code: true } });
  if (!c) return;
  await emitNotification(tx, "anaveri.renk-olusturuldu", subject("color", colorId), { renkId: colorId, renkAd: c.name, renkKodu: c.code }, { actorUserId: who(actor) });
}

/** Metne girebilen reçete alanları — OPT-IN (künye/`nameFold` yok). `properties` yalnız küme gerçekten değişince gelir. */
export const RECIPE_CHANGE_FIELDS: ReadonlySet<string> = new Set([
  "name", "code", "itemId", "colorId", "width", "foldType", "routeId", "variantCode", "finishingRateCode", "properties", "isActive",
]);
const RECIPE_LABELS: Readonly<Record<string, string>> = { properties: "Özellikler", variantCode: "Varyant kodu", finishingRateCode: "Terbiye fiyat kodu" };

/** `anaveri.recete-degisti` — reçete güncellemesinin tx'i (`ProductRecipeService.afterUpdateTx`); yük alan ADLARI. */
export async function emitRecipeChangedTx(tx: Tx, recipeId: string, changes: ReadonlyArray<{ field: string }>, actor: Actor): Promise<void> {
  const alanlar = [...new Set(changes.map((c) => c.field).filter((f) => RECIPE_CHANGE_FIELDS.has(f)))].map((f) => RECIPE_LABELS[f] ?? auditFieldLabel(f));
  if (alanlar.length === 0) return;
  if (await off(tx)) return;
  const r = await tx.productRecipe.findUnique({ where: { id: recipeId }, select: { name: true, code: true } });
  if (!r) return;
  await emitNotification(tx, "anaveri.recete-degisti", subject("product_recipe", recipeId), { receteId: recipeId, receteAd: r.name, receteKodu: r.code, alanlar: txt(alanlar.join(", "), 200) }, { actorUserId: who(actor) });
}
