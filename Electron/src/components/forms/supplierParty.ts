// =============================================================================
// TEDARİKÇİ TARAFI (C4) — SAF KATMAN
// =============================================================================
// Alış HER cariden yapılabilir (Logo/Mikro/SAP BP standardı) ama bu kurulumda
// cari kartları İKİ TABLODA yaşıyor: `Customer` (müşteri-tipli cari) ve
// `Subcontractor` (fason firma). Tam BP birleşmesi ayrı ve büyük bir iş; bu
// paket köprüyü kuruyor — `GoodsReceipt`/`PurchaseOrder` iki nullable FK taşır
// ve **tam biri** dolu olur (backend `supplier-party.helper` XOR'u).
//
// ⚠️⚠️ XOR TEK YERDE KURULUR (`supplierPartyPayload`). İki anahtarı birden
// göndermek backend'de 400'dür ve kullanıcı hiç kayıt yapamaz; daha kötüsü,
// "yalnız değişen bacağı yaz" gibi bir kısayol İKİ TEDARİKÇİLİ bir kayıt
// üretir (eski bacak temizlenmediği için) ve o kayıt panelde bir cariyi,
// faturada BAŞKA bir cariyi gösterir. Bu yüzden gövde kurma kararı bir
// bileşenin içinde değil burada, bekçili bir fonksiyonda yaşar.
//
// ⚠️ OKUMA TARAFINDA DA TEK KURAL: dolu olan bacak basılır ve öncelik
// `supplier` (müşteri-tipli cari) → `subcontractorSupplier`. Backend'in Excel
// çıkışı da aynı sırayı kullanıyor (`goods-receipt.service` supplierName);
// ikinci bir sıralama, aynı fişin iki yüzeyde iki farklı tedarikçi göstermesi
// demekti.
//
// ⚠️ ROZET YALNIZ FASON BACAĞINA BASILIR — süs değil, "sıfır görünür fark"
// kuralının uygulanışı: bugüne kadarki bütün kayıtlar müşteri-tipli caridir ve
// onların satırları BAYT BAYT aynı kalır. Yeni bacak ise ayırt edilmek
// zorundadır; aynı ada sahip bir cari kart ile fason firma listede birbirinin
// aynısı görünürdü.
//
// Bekçi: `supplierParty.test.ts`.
// =============================================================================

export type SupplierPartyKind = "CUSTOMER" | "SUBCONTRACTOR";

/** Seçimin kimliği — id TEK BAŞINA yetmez, hangi tabloya ait olduğu şarttır. */
export interface SupplierParty {
  kind: SupplierPartyKind;
  id: string;
}

/** İki bacağın da backend'de AYNI olan şekli (`{id, code, name}`). */
export interface SupplierRefLike {
  id: string;
  code?: string | null;
  name: string;
  /**
   * Yalnız SEÇENEK listesinde anlamlı (kayıt üstündeki `supplier` bacağı bunu
   * taşımaz). Pasif kayıt FİLTRE bağlamında listelenir ve etiketiyle işaretlenir.
   */
  isActive?: boolean;
}

/** Seçicide çizilen satır. */
export interface SupplierOption extends SupplierParty {
  code: string | null;
  name: string;
  /** `KOD — Ad` (kod yoksa yalnız ad) — arama sonucunda kimlik kod ile okunur. */
  label: string;
}

/** İki bacağı da taşıyan kayıt (fiş / sipariş / sipariş kalemi başlığı). */
export interface SupplierBearing {
  supplier?: SupplierRefLike | null;
  subcontractorSupplier?: SupplierRefLike | null;
}

/** İstek gövdesinin tedarikçi tarafı — TAM BİRİ dolu, diğeri `null`. */
export interface SupplierPartyPayload {
  supplierId: string | null;
  subcontractorId: string | null;
}

export const SUPPLIER_GROUP_LABEL: Record<SupplierPartyKind, string> = {
  CUSTOMER: "Cari kartlar",
  SUBCONTRACTOR: "Fason firmalar",
};

/**
 * Satır/kart üstünde basılan kısa etiket.
 *
 * ⚠️ `CUSTOMER` bilinçli olarak BOŞ: bugünkü tüm kayıtlar o bacakta ve onlara
 * yeni bir rozet basmak, hiçbir şey değişmemişken her satırı değiştirmek olurdu.
 */
export const SUPPLIER_KIND_TAG: Record<SupplierPartyKind, string> = {
  CUSTOMER: "",
  SUBCONTRACTOR: "Fason",
};

// -----------------------------------------------------------------------------
// KİMLİK
// -----------------------------------------------------------------------------

/**
 * Seçici satırının değeri — `Command` bir STRING taşır, nesne değil.
 *
 * ⚠️ Yalnız `id` taşınsaydı seçim geri okunurken hangi tabloya ait olduğu
 * kaybolurdu ve tek makul tahmin ("önce müşteri kartlarında ara") fason firmayı
 * sessizce müşteri-tipli cari olarak kaydederdi.
 */
export function supplierPartyKey(p: SupplierParty): string {
  return `${p.kind}:${p.id}`;
}

export function parseSupplierPartyKey(key: string): SupplierParty | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const kind = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (!id) return null;
  if (kind !== "CUSTOMER" && kind !== "SUBCONTRACTOR") return null;
  return { kind, id };
}

export function sameSupplierParty(
  a: SupplierParty | null | undefined,
  b: SupplierParty | null | undefined,
): boolean {
  if (!a || !b) return a == null && b == null;
  return a.kind === b.kind && a.id === b.id;
}

// -----------------------------------------------------------------------------
// GÖVDE (YAZMA)
// -----------------------------------------------------------------------------

/**
 * Seçim → istek gövdesi. **TEK XOR NOKTASI.**
 *
 * Seçim yoksa iki alan da `null` döner: mal kabulde tedarikçisiz fiş MEŞRUDUR
 * (mal önce girer, cari sonra belli olur) ve alış siparişinde backend zaten
 * "tam biri zorunlu" der — panel o reddi düğmeyi kapatarak önceden söyler.
 */
export function supplierPartyPayload(p: SupplierParty | null | undefined): SupplierPartyPayload {
  if (!p) return { supplierId: null, subcontractorId: null };
  return {
    supplierId: p.kind === "CUSTOMER" ? p.id : null,
    subcontractorId: p.kind === "SUBCONTRACTOR" ? p.id : null,
  };
}

/**
 * Liste/lookup sorgusunun tedarikçi daraltması.
 *
 * Gövdeyle AYNI XOR'u kullanır ama boş anahtar HİÇ GÖNDERİLMEZ (`undefined`):
 * `filter[supplierId]=` göndermek sorgu anahtarını da kirletir, üstelik boş
 * değer sunucunun iç `if`ine emanet edilmiş olurdu.
 */
export function supplierPartyQuery(p: SupplierParty | null | undefined): {
  supplierId?: string;
  subcontractorId?: string;
} {
  if (!p) return {};
  return p.kind === "CUSTOMER" ? { supplierId: p.id } : { subcontractorId: p.id };
}

// -----------------------------------------------------------------------------
// OKUMA
// -----------------------------------------------------------------------------

/** Kaydın tedarikçi tarafı — dolu bacak. İkisi de boşsa `null` (meşru). */
export function supplierPartyOf(rec: SupplierBearing | null | undefined): SupplierParty | null {
  if (!rec) return null;
  if (rec.supplier?.id) return { kind: "CUSTOMER", id: rec.supplier.id };
  if (rec.subcontractorSupplier?.id) return { kind: "SUBCONTRACTOR", id: rec.subcontractorSupplier.id };
  return null;
}

/** Kaydın tedarikçi kartı — kind ile birlikte (rozet buradan çizilir). */
export function supplierRefOf(
  rec: SupplierBearing | null | undefined,
): (SupplierRefLike & { kind: SupplierPartyKind }) | null {
  if (!rec) return null;
  if (rec.supplier?.id) return { ...rec.supplier, kind: "CUSTOMER" };
  if (rec.subcontractorSupplier?.id) return { ...rec.subcontractorSupplier, kind: "SUBCONTRACTOR" };
  return null;
}

/** Tek satırlık gösterim — tedarikçisiz kayıtta çağıranın verdiği yer tutucu. */
export function supplierDisplayName(
  rec: SupplierBearing | null | undefined,
  fallback = "—",
): string {
  return supplierRefOf(rec)?.name ?? fallback;
}

// -----------------------------------------------------------------------------
// SEÇENEK LİSTESİ
// -----------------------------------------------------------------------------

/**
 * Etiket "Ad — KOD" (kullanıcı testi C3, 2026-09-17): dar kutuda kod adı yiyordu ("MUS1609260002 — T…") ve
 * kullanıcı üstteki bölümdeki adla aynı kart olduğunu göremiyordu. Ad önce, kod sonra; kesme adın sonundan
 * değil satırın sonundan (kod kaybolur, ad kalır). Modal tablosunda Kod/Ünvan ayrı kolon — burası yalnız
 * tek satırlık yüzeyler (tetik kutusu, küçük liste, sipariş başlığı).
 */
export function supplierOptionLabel(row: SupplierRefLike): string {
  const base = row.code ? `${row.name} — ${row.code}` : row.name;
  // ⚠️ Pasif kayıt SESSİZCE normal görünmemeli: filtre bağlamında listeleniyor
  // (aşağıdaki `supplierListFilters` kararı) ve işaretsiz bırakılırsa kullanıcı
  // onu YAZMA bağlamında da seçilebilir sanır — oysa backend `resolveSupplierParty`
  // pasif kaydı 400'ler ve red, KAYDET'e kadar görünmez.
  return row.isActive === false ? `${base} (pasif)` : base;
}

export function toSupplierOptions(
  kind: SupplierPartyKind,
  rows: readonly SupplierRefLike[] | null | undefined,
): SupplierOption[] {
  return (rows ?? []).map((r) => ({
    kind,
    id: r.id,
    code: r.code ?? null,
    name: r.name,
    label: supplierOptionLabel(r),
  }));
}

// -----------------------------------------------------------------------------
// LİSTE KAPSAMI — YAZMA ile FİLTRE aynı süzgeci KULLANAMAZ
// -----------------------------------------------------------------------------

/**
 * Seçicinin liste sorgusundaki `filters` bloğu.
 *
 * ⚠️⚠️ AYNI BİLEŞEN İKİ BAĞLAMDA ÇALIŞIYOR ve doğru kapsam farklı:
 *
 *   • **YAZMA** (Mal Kabul formu · Alış Siparişi formu) → yalnız AKTİF kayıt.
 *     Pasif kaydı seçtirmek, backend'in `resolveSupplierParty` reddini KAYDET
 *     anına saklamak olurdu; kullanıcı bütün fişi doldurduktan sonra 400 yer.
 *
 *   • **FİLTRE** (Alış Siparişleri listesi) → PASİFLER DE. Sezon sonunda
 *     pasifleştirilen bir tedarikçinin GEÇMİŞ siparişleri duruyor ve
 *     aranabilmeli; kartı kapatmak geçmişini kilitlemek DEĞİLDİR. Bu karar bu
 *     depoda zaten yazılı ve aynısı: `Finance/Allocations/service.cariPickerService`
 *     mahsup ekranı için `isActive` süzgecini bilerek DÜŞÜRÜYOR ("pasifleştirilmiş
 *     bir carinin açık faturası ve serbest tahsilatı hâlâ olabilir").
 *
 * Süzgeç düşürüldüğünde pasif satır `supplierOptionLabel` ile "(pasif)" diye
 * işaretlenir — listelemek ile "normal göstermek" aynı şey değil.
 */
export function supplierListFilters(includeInactive: boolean): Record<string, string> {
  return includeInactive ? {} : { isActive: "true" };
}

// -----------------------------------------------------------------------------
// YÜKLEME DURUMU — "hata" ile "sonuç yok" AYRI CÜMLELER
// -----------------------------------------------------------------------------

export interface SupplierLoadState {
  customersError: boolean;
  subcontractorsError: boolean;
  loading: boolean;
}

export interface SupplierNotice {
  tone: "error" | "warn";
  message: string;
}

/**
 * Seçicinin altına basılan cümle. `null` = basma.
 *
 * ⚠️⚠️ ASIL SEBEP KISMİ HATA: iki kaynak ayrı ayrı sorgulanıyor. Fason listesi
 * düşer, cari listesi dolu dönerse kutu SONUÇ GÖSTERİR — kullanıcı aradığı
 * fason firmayı bulamaz, "kayıtlı değilmiş" der ve İKİNCİ BİR KART açar.
 * Sessiz yarım liste, boş listeden tehlikelidir: boş liste hiç değilse soru
 * sordurur.
 *
 * ⚠️ Yükleme sırasında cümle basılmaz — henüz cevap yokken "alınamadı" demek
 * yanlış olur; kutu kendi "Aranıyor…" hâlini gösterir.
 */
export function supplierLoadNotice(s: SupplierLoadState): SupplierNotice | null {
  if (s.loading) return null;
  if (s.customersError && s.subcontractorsError) {
    return {
      tone: "error",
      message:
        "Tedarikçi listesi alınamadı — bu “kayıt yok” DEMEK DEĞİLDİR. Bağlantı döndüğünde tekrar arayın; şimdi seçmezseniz kayıt tedarikçisiz kalır.",
    };
  }
  if (s.customersError) {
    return {
      tone: "warn",
      message:
        "Cari kartlar listelenemedi — yalnız fason firmalar görünüyor. Aradığınız tedarikçi “kayıtlı değil” diye yeni kart AÇMAYIN.",
    };
  }
  if (s.subcontractorsError) {
    return {
      tone: "warn",
      message:
        "Fason firmalar listelenemedi — yalnız cari kartlar görünüyor. Aradığınız firma “kayıtlı değil” diye yeni kart AÇMAYIN.",
    };
  }
  return null;
}
