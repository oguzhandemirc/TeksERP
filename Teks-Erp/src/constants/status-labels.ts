// =============================================================================
// BACKEND DURUM ETİKETLERİ (TÜRKÇE) — hata mesajları + DONMUŞ belgeler
// =============================================================================
// NEDEN VAR: bu projede kullanıcıya giden her metin Türkçedir, ama backend'in
// hata mesajları ve belge alanları uzun süre ham enum basıyordu ("Statüsü
// değişti (AT_SUBCONTRACTOR)"). Panel sözlüğü (`Electron/src/types/enums.ts`
// → `rollStatusLabels`) 2026-07'den beri var; backend'de karşılığı YOKTU.
//
// ⚠️ EN AĞIR YÜZEY DONMUŞ BELGEDİR: stok sayım tutanağındaki `outOfScopeReason`
// kolona YAZILIR ve tutanak dondurulur — yani ham enum kâğıda basıldığı anda
// GERİYE DÖNÜK DÜZELTİLEMEZ. Bu sözlüğün ilk müşterisi odur.
//
// ⚠️ METİNLER PANEL SÖZLÜĞÜYLE BİREBİR AYNI OLMAK ZORUNDA
// (`Electron/src/types/enums.ts: rollStatusLabels`). Ayrışırlarsa aynı top,
// aynı ekranda "Fasonda" iken hata mesajında başka bir adla anılır ve
// kullanıcı iki farklı şeyden bahsedildiğini sanır. Electron backend'i import
// EDEMEZ (ayrı proje) → kopya bilinçlidir ve bekçi (`test_status_labels.ts`)
// ikisinin metin metin eşitliğini MEKANİK doğrular.
//
// ⚠️ `Record<Enum, string>` TİPİ LOAD-BEARING: enum'a yeni bir üye eklendiği an
// derleme kırılır. `Partial`/`[k: string]` yazımı, yeni statüyü sessizce
// `undefined` bastırırdı ("Statüsü değişti (undefined)").
// =============================================================================
import { RollStatus, PurchaseOrderStatus } from "@prisma/client";

/** Topun durumu — panel `rollStatusLabels` ile BİREBİR aynı metinler. */
export const ROLL_STATUS_TR: Record<RollStatus, string> = {
  STOCK: "Stokta",
  IN_PRODUCTION: "Üretimde",
  SCRAP: "Fire",
  CANCELLED: "İptal Edildi",
  AT_SUBCONTRACTOR: "Fasonda",
  A1_STOCK: "A1 (2. Kalite)",
  RETURNED_FROM_SUBCONTRACTOR: "Fasondan Döndü",
  WAREHOUSE: "Depoda",
  SHIPPED: "Sevk Edildi",
  TAMBUR_CONSUMED: "Tamburda Bölündü",
  SUBCONTRACTOR_CONSUMED: "Fasonda Tüketildi",
  AT_KARTELA: "Kartelada",
  KARTELA_CONSUMED: "Kartela'da Tüketildi",
};

/**
 * Alış siparişi durumu — panel `PO_STATUS_LABEL` ile BİREBİR aynı metinler
 * (`Electron/src/pages/Operations/PurchaseOrders/labels.ts`).
 *
 * ⚠️ Etiketler enum ADIYLA değil satın almacının SORUSUYLA yazılır: "PARTIAL"
 * değil "Kısmen geldi". Varsayılan okuyucu vardiya ortasındaki depo/satın alma
 * personelidir.
 */
export const PURCHASE_ORDER_STATUS_TR: Record<PurchaseOrderStatus, string> = {
  OPEN: "Bekliyor",
  PARTIAL: "Kısmen geldi",
  CLOSED: "Tamamlandı",
  CANCELLED: "İptal",
};
