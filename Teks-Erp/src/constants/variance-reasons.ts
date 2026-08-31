// =============================================================================
// ÜRETİM SAPMASI — SEBEP KATALOĞU (2026-08-09)
// =============================================================================
// `RollVariance.reasonCode`'un TEK KAYNAĞI. Sapmanın türü (`RollVarianceKind`)
// "bu metraj fiziksel olarak var mıydı" sorusunu yanıtlar; sebep kodu "neden"
// sorusunu yanıtlar ve veriyi SAYILABİLİR yapar.
//
// NEDEN HAZIR SEÇENEK, neden serbest metin DEĞİL: emsal `mobil/src/constants/
// manualReasons.ts` (elle top ekleme). Eldivenli operatör vardiya ortasında
// tablet klavyesiyle metin yazmak istemiyor; pratikte "aaa" / "." gibi
// doldurmalar üretiyor ve o, boş bırakmaktan DAHA KÖTÜDÜR — denetimde cevap
// varmış gibi görünür, hiçbir şey söylemez. Serbest yazım kaldırılmadı,
// "Diğer"in altına alındı.
//
// ⚠️ SÜRTÜNME ÖLÇÜTÜ: sahada sürekli "Diğer" seçiliyorsa katalog YANLIŞTIR;
// gerçek serbest metinlere bakıp seçenekleri güncelle, listeyi BÜYÜTME.
//
// ⚠️ MOBİL AYNASI: `mobil/src/constants/varianceReasons.ts` bağımsız bir
// projedir ve bu dosyayı import EDEMEZ (izin katalogu / `permissions.ts` ile
// aynı durum). Kod eklerken orayı da güncelle — bekçi
// `scripts/test_roll_variance.ts` iki listenin BİREBİR aynı olduğunu mekanik
// doğrular, yani ayrışma derleme değil TEST hatası olarak düşer.
// =============================================================================

import { RollVarianceKind } from "@prisma/client";

import { AppError } from "../utils/app-error";

/** Sapmayı doğuran YOL. Sebep "neden", kaynak "nerede" sorusunu yanıtlar. */
export const VARIANCE_SOURCES = {
  /** Tambur açık kumaş finalize'ı — kalan metraj kararı. */
  TAMBUR_FINALIZE: "TAMBUR_FINALIZE",
  /** Tambur "Top Kesme" (depo topu) kapanışı — kalan metraj kararı. */
  TAMBUR_WAREHOUSE_FINALIZE: "TAMBUR_WAREHOUSE_FINALIZE",
  /** Kesimlerin toplamı kayıtlı metrajı aştı (artı yön; sistem tespit eder). */
  TAMBUR_OVERCUT: "TAMBUR_OVERCUT",
  /** Finalize'dan SONRA tek parçanın iptali — metraj arşivdeki kaynağa dönemez. */
  TAMBUR_UNDO_SINGLE: "TAMBUR_UNDO_SINGLE",
  /**
   * TEKİL CANLANDIRMADA (İş Emrine Geri Al, 2026-08-12) geri konan metraj
   * kayıtlı giriş metrajını aştı — TAMBUR_UNDO_FULL aşımının tekil ikizi.
   */
  TAMBUR_UNDO_RESTORE: "TAMBUR_UNDO_RESTORE",
  /**
   * Tümden geri almada geri konan metraj kayıtlı giriş metrajını AŞTI.
   * Aşımlı kesimde olur (operatör 500 m kayıtlı topu 545 m ölçtü) ve
   * `initialQty` yukarı çekilir — `currentQty > initialQty` gibi imkânsız bir
   * satır bırakmak yerine sapma kayda geçirilir.
   */
  TAMBUR_UNDO_FULL: "TAMBUR_UNDO_FULL",
  /**
   * Fasonda kalan metraj "gelmeyecek" kararıyla kapatıldı (kısmi teslimat
   * sonrası kalan ya da hiç dönmeyen top). Sebep listesi FİRE kataloğudur
   * (ReasonPresetKind.ROLL_SCRAP — fabrika panelden düzenler).
   */
  SUBCONTRACTOR_REMAINDER: "SUBCONTRACTOR_REMAINDER",
  /**
   * FASON KABULÜNDE GİDEN ↔ DÖNEN METRAJ FARKI (2026-08-21) — boyahane çekmesi.
   *
   * Kabulde iki bağımsız sayı vardır: fasonun hesabından DÜŞÜLEN metraj
   * (`SubcontractorReceiptItem.receivedQty` toplamı) ve fiziksel olarak GELEN
   * metraj (doğan açık-kumaş parçalarının toplamı). Boyahanede kumaş çeker —
   * 250 m giden mal 220 m döner ve bu 30 m HİÇBİR YERE yazılmıyordu: makbuz
   * kalemi "kalanın tamamı kabul edildi" diyor, doğan toplar 220 m taşıyor,
   * aradaki fark yalnız iki tabloyu yan yana koyan birinin görebileceği bir
   * çıkarma işlemi olarak kalıyordu. Fason karnesi de bu yüzden her firmaya
   * **%0 fire** basıyordu (kanıt: `subcontract-scorecard` `returnedQty`
   * defterden okur, defter TAM kabulde kalanın kendisidir → fark hep sıfır).
   *
   * Satırı SİSTEM yazar, operatör beyan etmez: sebep kodu sabittir
   * (`SHRINK_REASON_CODE`), eksi yön SCRAP (mal vardı, metre gitti), artı yön
   * OVERAGE (fazla dönen). `sourceRefId` = makbuz id'si — makbuz iptal edilince
   * TAM O satırlar terslenir.
   */
  SUBCONTRACTOR_RETURN: "SUBCONTRACTOR_RETURN",
  /** Depoda SAYIM metraj düzeltmesi (G4, 2026-08-14) — `inventory.service.adjustRollQty`. */
  WAREHOUSE_QTY_ADJUST: "WAREHOUSE_QTY_ADJUST",
  /**
   * TAM STOK SAYIMI fark fişi (J2 #19, 2026-08-15) — `stock-count.service.complete`.
   *
   * ⚠️ `WAREHOUSE_QTY_ADJUST` ile KARIŞTIRMA, ikisi ayrı soruyu yanıtlar:
   * o TEKİL bir topun metrajını düzeltir (mal var, sayı yanlış), bu bir
   * SAYIM BELGESİNE bağlı olarak topun tamamını kayıttan düşer (mal yok).
   * Tek kovaya atmak, "sayımda kaç top kayboldu" sorusunu cevapsız bırakırdı.
   */
  STOCK_COUNT: "STOCK_COUNT",
} as const;

export type VarianceSource = (typeof VARIANCE_SOURCES)[keyof typeof VARIANCE_SOURCES];

export interface VarianceReason {
  code: string;
  label: string;
  /** true → operatörden serbest metin de istenir (`reasonText` zorunlu olur). */
  requiresText?: boolean;
}

/**
 * FİRE sebepleri — mal VARDI, kullanılamaz.
 *
 * Sektörel karşılık: SAP hurda sebep kodu (Ausschussgrund) — hurda hareketinde
 * ZORUNLUDUR, çünkü "fireniz neden %8" sorusunun cevabı sebep kırılımıdır.
 */
export const SCRAP_REASONS: readonly VarianceReason[] = [
  // ⚠️ SIRA ANLAMLIDIR: en sık seçilen sebep BAŞTA durur (eldivenli operatör
  // listenin ilk satırına bakar). "Top başı" tambur kesiminde en yaygın fire
  // sebebidir — 2026-08-19 saha talebi.
  { code: "TOP_BASI", label: "Top başı" },
  { code: "DOKUMA_HATASI", label: "Dokuma hatası" },
  { code: "BOYA_HATASI", label: "Boya / renk hatası" },
  { code: "LEKE", label: "Leke / kirlenme" },
  { code: "YIRTIK", label: "Yırtık / delik" },
  { code: "EN_HATASI", label: "En hatası" },
  { code: "MAKINE_HASARI", label: "Makine kaynaklı hasar" },
  { code: "DIGER", label: "Diğer", requiresText: true },
] as const;

/**
 * KAYIT DÜZELTMESİ sebepleri — mal HİÇ YOKTU, kayıt yanlıştı.
 *
 * ⚠️ Bu liste FİRE ile karıştırılmamalı. Buradaki her satır "sistemdeki sayı
 * yanlıştı" der; fire ise "mal vardı, çöpe gitti" der. Aynı kovaya atmak fire
 * oranını sistematik olarak şişirir (bkz. `RollVarianceKind` şema notu).
 */
export const RECORD_CORRECTION_REASONS: readonly VarianceReason[] = [
  { code: "OLCUM_HATASI", label: "Ölçüm hatası (metre yanlış okundu)" },
  { code: "GIRIS_FAZLA", label: "Girişte fazla metraj yazılmış" },
  { code: "MUKERRER_KAYIT", label: "Mükerrer kayıt" },
  { code: "YANLIS_TOP", label: "Yanlış top okutulmuş" },
  { code: "DIGER", label: "Diğer", requiresText: true },
] as const;

/** Serbest metnin alt sınırı — `manualReasons.MANUAL_MIN_REASON` ile aynı. */
export const VARIANCE_MIN_REASON_TEXT = 3;

/**
 * ESKİ İSTEMCİ İŞARETİ — seçilebilir bir sebep DEĞİLDİR.
 *
 * Sahadaki APK'lar sebep alanını bilmiyor. Sebebi katı biçimde zorunlu kılmak,
 * backend deploy edildiği anda eski tabletlerde "Bitir"i 400'e düşürürdü — yani
 * operatör vardiya ortasında işini KAPATAMAZDI. Bu, kaydı sebepsiz bırakmaktan
 * kat kat kötüdür.
 *
 * Bu yüzden sebep gönderilmemişse satır bu kodla yazılır: veri KAYBOLMAZ, ve
 * "belirtilmedi" raporda GÖRÜNÜR bir kova olur — sessiz NULL'dan farkı budur.
 * `reasonsForKind` onu DÖNDÜRMEZ, yani hiçbir seçicide çıkmaz.
 *
 * ⚠️ Sahadaki tüm tabletler yeni APK'ya geçtikten sonra bu kodun oranı düşmeli.
 * Düşmüyorsa yeni istemci sebebi göndermiyordur — katalog değil KABLOLAMA hatası.
 */
export const LEGACY_REASON_CODE = "BELIRTILMEDI";

/**
 * SİSTEM SEBEBİ — seçilebilir bir sebep DEĞİLDİR (`LEGACY_REASON_CODE` emsali).
 *
 * Fason kabulünde giden ↔ dönen metraj farkını SİSTEM tespit eder; operatör
 * "neden" sorusuna cevap vermez, çünkü cevap zaten bellidir: kumaş boyada
 * çekti. Kodu `SCRAP_REASONS`'a EKLEMEDİK — o liste operatörün Tambur fire
 * ekranında gördüğü listedir ve oraya "Fason çekmesi" koymak, tamburda kesilen
 * bir topun firesini yanlış kovaya yazmanın yolunu açardı. `reasonsForKind`
 * bu kodu DÖNDÜRMEZ (hiçbir seçicide çıkmaz), `validateVarianceReason` KABUL
 * eder — LEGACY ile birebir aynı desen.
 */
export const SHRINK_REASON_CODE = "FASON_CEKME";

/**
 * SİSTEM KODU — tam stok sayımında bulunamayan top (J2 #19, 2026-08-15).
 * Seçilebilir bir sebep DEĞİLDİR ve `reasonsForKind` onu DÖNDÜRMEZ.
 *
 * ⚠️ NEDEN `RECORD_CORRECTION_REASONS` DİZİSİNE EKLENMEDİ (bilinçli):
 *   ① O dizi bir OPERATÖR SEÇİCİSİDİR (Tambur kalan-metraj kararı, mobil).
 *      Oraya "Sayım farkı" koymak, sayımla hiç ilgisi olmayan bir ekranda
 *      seçilebilir bir yanlış kova doğururdu — kataloğun kendi kuralı
 *      ("listeyi BÜYÜTME, sürtünme ölçütüne bak") tam da bunu yasaklar.
 *   ② Burada sebebi OPERATÖR SEÇMEZ, SİSTEM BİLİR: satır "bulunamadı" diye
 *      işaretlendiği için kayıt düşülüyor. Sorulacak bir soru yok.
 *   ③ Mobil ayna (`mobil/src/constants/varianceReasons.ts`) bu yolla
 *      DEĞİŞMEZ — sayım bir panel/depo işidir, tablet ekranı yoktur.
 *      `test_roll_variance`'ın birebirlik kontrolü de olduğu gibi kalır.
 * Emsal: `LEGACY_REASON_CODE` (kabul edilir, hiçbir seçicide görünmez).
 *
 * Raporda AYRI BİR KOVADIR: "sayımda kaç metre kayboldu" sorusunun cevabı
 * `reasonCode = 'SAYIM_FARKI'` satırlarının toplamıdır.
 */
export const STOCK_COUNT_REASON_CODE = "SAYIM_FARKI";

// ─────────────────────────────────────────────────────────────────────────────
// DİNAMİK KATALOG BAĞI (2026-08-19) — fabrika sebepleri panelden düzenleyebilir.
//
// Satırların canlı hâli DB'dedir (`ReasonPreset`), ama doğrulama transaction
// İÇİNDE ve SENKRON koşuyor. Bu yüzden servis kendi önbelleğini buraya KAYDETTİRİR;
// sabitler servisi import etmez (bağımlılık yönü korunur: services → constants).
//
// ⚠️ Kaynak `null` dönerse bu dosyadaki KOD kataloğu geçerlidir. "DB henüz
// okunmadı" ile "liste gerçekten boş" aynı davranışa düşer ve bu bilinçlidir:
// sebep zorunlu bir alandır, boş katalog operatörü kilitlerdi.
// ─────────────────────────────────────────────────────────────────────────────
export interface ReasonCatalogSource {
  /** Aktif satırlar (seçicide gösterilecek liste). Bilinmiyorsa `null`. */
  reasons(kind: RollVarianceKind): VarianceReason[] | null;
  /**
   * Tek kod araması — GİZLENMİŞ satırı da bulur (bayat liste taşıyan APK
   * vardiya ortasında 400 almasın). `null` = kaynak hazır değil,
   * `undefined` = kaynak hazır ama böyle bir kod YOK (fail-closed).
   */
  find(kind: RollVarianceKind, code: string): VarianceReason | null | undefined;
}

let catalogSource: ReasonCatalogSource | null = null;

export function registerReasonCatalogSource(source: ReasonCatalogSource): void {
  catalogSource = source;
}

/** Yalnız testler için — kayıtlı kaynağı düşürür. */
export function clearReasonCatalogSource(): void {
  catalogSource = null;
}

/** Kod kataloğu (DB'siz zemin). */
function builtinReasonsForKind(kind: RollVarianceKind): readonly VarianceReason[] {
  if (kind === RollVarianceKind.SCRAP) return SCRAP_REASONS;
  if (kind === RollVarianceKind.RECORD_CORRECTION) return RECORD_CORRECTION_REASONS;
  return [];
}

/** Türe göre geçerli sebep listesi. OVERAGE sebep İSTEMEZ (sistem tespit eder). */
export function reasonsForKind(kind: RollVarianceKind): readonly VarianceReason[] {
  const dynamic = catalogSource?.reasons(kind);
  if (dynamic && dynamic.length > 0) return dynamic;
  return builtinReasonsForKind(kind);
}

/** Doğrulamanın kullandığı tek arama noktası (gizli satırları da tanır). */
function findReason(kind: RollVarianceKind, code: string): VarianceReason | undefined {
  const dynamic = catalogSource?.find(kind, code);
  if (dynamic) return dynamic;
  // `undefined` (kaynak hazır, kod yok) durumunda da kod kataloğuna bakılır:
  // sistem satırları DB'den gizlenmiş olabilir ve o kodu taşıyan eski bir
  // istemci hâlâ sahada olabilir.
  return builtinReasonsForKind(kind).find((r) => r.code === code);
}

export interface VarianceReasonInput {
  reasonCode?: string | null;
  reasonText?: string | null;
}

/**
 * Sebep doğrulaması — TEK KAPI. Servis katmanı bunu çağırır, kendi `if`ini yazmaz.
 *
 * Sözleşme:
 *   • OVERAGE  → sebep İSTENMEZ (verilirse de kabul edilir; sistem tespitidir).
 *   • diğerleri → `reasonCode` ZORUNLU ve katalogda OLMALI.
 *   • `requiresText` işaretli kod ("Diğer") → `reasonText` en az 3 karakter.
 *
 * ⚠️ Bilinmeyen kodu SESSİZCE kabul etmek en kötü davranıştır: rapor kırılımında
 * "DIGER" kovasına düşmeyen, hiçbir yerde tanımlı olmayan bir etiket doğar ve
 * kimse fark etmez. Fail-closed.
 */
export function validateVarianceReason(
  kind: RollVarianceKind,
  input: VarianceReasonInput,
): { reasonCode: string | null; reasonText: string | null } {
  const code = input.reasonCode?.trim() || null;
  const text = input.reasonText?.trim() || null;

  if (kind === RollVarianceKind.OVERAGE) {
    return { reasonCode: code, reasonText: text };
  }

  // Sebepsiz çağrı = SEBEBİ BİLMEYEN eski istemci. Reddetmek yerine görünür bir
  // kovaya yazılır (bkz. LEGACY_REASON_CODE notu). Reddetmek, deploy penceresinde
  // sahadaki her tablette "Bitir"i kırardı.
  if (!code) return { reasonCode: LEGACY_REASON_CODE, reasonText: text };
  if (code === LEGACY_REASON_CODE) return { reasonCode: code, reasonText: text };
  // Sistem sebebi — katalogda ARANMAZ (bilerek listede değil, bkz. üstteki not).
  if (code === SHRINK_REASON_CODE) return { reasonCode: code, reasonText: text };
  // Sistem kodu — seçicide yok, katalogda yok, ama GEÇERLİ (bkz. sabit notu).
  if (code === STOCK_COUNT_REASON_CODE) return { reasonCode: code, reasonText: text };

  const hit = findReason(kind, code);
  if (!hit) {
    const catalog = reasonsForKind(kind);
    // ⚠️ 400, düz `Error` DEĞİL (2026-08-26). Düz Error error.middleware'de 500'e
    // düşüyordu ve operatörün gördüğü tek şey "tamamlanmadı — sunucu hatası"
    // oluyordu: sebebi söylemeyen bir mesaj, üstelik mobil kuyruk 5xx'i geçici
    // sanıp üç kez daha deniyordu. Geçersiz sebep kodu bir İSTEMCİ hatasıdır.
    // (Tek çağrı noktası bunu zaten elle sarıyordu — subcontractor.service
    // "kalan kapama"; kural artık kapının kendisinde.)
    throw AppError.badRequest(
      `Geçersiz sebep kodu: ${code} (geçerli: ${catalog.map((r) => r.code).join(", ")})`,
      { code: "REASON_CODE_INVALID" },
    );
  }
  if (hit.requiresText && (!text || text.length < VARIANCE_MIN_REASON_TEXT)) {
    throw AppError.badRequest(
      `"${hit.label}" seçildiğinde açıklama yazılmalı (en az ${VARIANCE_MIN_REASON_TEXT} karakter)`,
      { code: "REASON_TEXT_REQUIRED" },
    );
  }
  return { reasonCode: code, reasonText: text };
}

/**
 * Eski `remainingAction` sözleşmesini sapma türüne çevirir.
 *
 * ⚠️ `discard` → RECORD_CORRECTION eşlemesi bu işin ÇEKİRDEĞİ: eski arayüz onu
 * "At (kayıp)" diye gösteriyordu ve "kayıp" kelimesi fire çağrıştırıyordu.
 * Veri modeli zaten doğruydu (`scrap` gerçek FIRE topu doğuruyor, `discard`
 * doğurmuyor) — yanlış olan ADIYDI ve raporu yanıltacak olan da oydu.
 *
 * `keep_*` sapma DEĞİLDİR: kalan metraj gerçek bir top olarak stoğa girer.
 */
export function varianceKindForRemainingAction(
  action: "keep_1kalite" | "keep_a1" | "scrap" | "discard",
): RollVarianceKind | null {
  if (action === "scrap") return RollVarianceKind.SCRAP;
  if (action === "discard") return RollVarianceKind.RECORD_CORRECTION;
  return null;
}
