// =============================================================================
// e-İrsaliye (UBL-TR 1.2 DespatchAdvice) SABİTLERİ — tek kaynak.
// Kılavuz/şema güncellenince yalnız bu dosya değişir (plan §6 R2: "sürüm işi").
//
// ⚠ DOĞRULANACAK (plan §7 V1 — GİB "e-İrsaliye UBL-TR Kılavuzu" + mali müşavir;
//   CANLI KULLANIMDAN ÖNCE kullanıcıda). Bu turda kılavuz ve XSD DOĞRUDAN okunmadı:
//   1. CUSTOMIZATION_ID tam değeri ("TR1.2.1" mi "TR1.2" mi).
//   2. ETTN (`cbc:UUID`) büyük/küçük harf beklentisi — yazıcı verileni aynen basar.
//   3. `cac:Signature` yer tutucusunun imzasız belgede zorunluluğu ve biçimi
//      (schemeID "VKN_TCKN", URI "#Signature_<no>").
//   4. `ext:UBLExtensions` BASILMAZ (boş ExtensionContent UBL 2.1 XSD'de geçersiz;
//      imzayı entegratör ekler) — entegratör boş kabuk bekliyor mu.
//   5. Kimlik şema adları: VKN, TCKN, MERSISNO, TICARETSICILNO, PLAKA, DORSEPLAKA.
//   6. Taşıma kuralı: (plaka + şoför) YA DA taşıyıcı (unvan + VKN) yeter mi.
//   7. Satırda `cac:OrderLineReference/cbc:LineID` (UBL 2.1'de zorunlu) satır
//      sırasıyla dolduruluyor — sipariş satırı karşılığı beklenip beklenmediği.
//   8. Sipariş no'ları `cac:OrderReference` yerine `cbc:Note`ta (snapshot'ta sipariş
//      tarihi yok); ürün kodu, GTİP, değer/fiyat, XSLT görünümü basılmıyor.
//   9. `cac:Delivery/cac:DeliveryAddress` alıcı adresiyle dolduruluyor.
//  10. "ikisi" ad rejiminde müşteri adı `cbc:Name`, bizim ad `cbc:Description`.
//  11. Öğe sıraları (`despatch-advice.order.ts`) UBL 2.1 şemasından ezberle yazıldı.
//  12. Metin uzunluk sınırları GİB sınırı değil, bizim savunma sınırımızdır.
// =============================================================================

export const UBL_VERSION_ID = "2.1";
/** ⚠ doğrulanacak (madde 1). */
export const CUSTOMIZATION_ID = "TR1.2.1";
export const PROFILE_ID = "TEMELIRSALIYE";
export const DESPATCH_ADVICE_TYPE_CODE = "SEVK";
export const COPY_INDICATOR = "false";

/** UN/ECE Rec. 20 birim kodları — satır miktarı defterin birimini izler (metre). */
export const UNIT_CODES = {
  meter: "MTR",
  kilogram: "KGM",
  piece: "C62",
} as const;
export const ALLOWED_UNIT_CODES: ReadonlySet<string> = new Set(Object.values(UNIT_CODES));

/** OASIS UBL 2.1 ad alanları. */
export const UBL_NAMESPACES = {
  root: "urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
} as const;

/** Kimlik şema adları (⚠ madde 5). */
export const SCHEME_IDS = {
  vkn: "VKN",
  tckn: "TCKN",
  signer: "VKN_TCKN",
  mersis: "MERSISNO",
  tradeRegistry: "TICARETSICILNO",
  plate: "PLAKA",
  trailerPlate: "DORSEPLAKA",
} as const;

/** GİB belge numarası: 3 karakter seri + 4 hane yıl + 9 hane sıra (E1 CHECK seddiyle aynı). */
export const DOCUMENT_NO_RE = /^[A-Z0-9]{3}20[0-9]{2}[0-9]{9}$/;
/** ETTN: RFC 4122 biçimi (harf büyüklüğü ⚠ madde 2). */
export const ETTN_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** Plaka — gevşek: boşluksuz büyük harf/rakam (normalleştirme kaynak eşlemesinde). */
export const PLATE_RE = /^[A-Z0-9]{4,12}$/;

/** Bizim savunma sınırlarımız (⚠ madde 12) — karakter sayısı. */
export const TEXT_LIMITS = {
  name: 300,
  addressPart: 300,
  note: 500,
  shortCode: 64,
} as const;

/** Yurt içi alıcının ülkesi — v1 yalnız DOMESTIC sevkiyat üretir. */
export const DOMESTIC_COUNTRY_NAME = "Türkiye";
