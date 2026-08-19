// =============================================================================
// HAZIR SEBEP KATALOGLARI — SİSTEM SATIRLARI (TEK KAYNAK, 2026-08-19)
// =============================================================================
// Dört listenin fabrika-varsayılanı burada yaşar; DB'ye boot uzlaştırmasıyla
// gelir (`jobs/reason-preset-catalog.job.ts`). İzin kataloğuyla BİREBİR aynı
// denklem: **kodu deploy etmek = katalogu getirmek**; taze kurulumda seed'e,
// mevcut fabrikada elle INSERT'e ihtiyaç yok.
//
// ── NEDEN HEM KOD HEM DB ────────────────────────────────────────────────────
// Fabrika listeyi kendi diliyle düzenleyebilsin diye satırlar DB'de yaşar; ama
// DB boş/erişilemez olduğunda operatör SEBEPSİZ kalmamalı (fire kararı sebep
// olmadan kaydedilemiyor). Bu dosya o zeminidir: uzlaştırma koşmadıysa da
// doğrulama bu listeyi tanır, mobil istemci de bunu gömülü taşır.
//
// ⚠️ Buradan bir satır SİLMEK onu DB'den kaldırmaz (uzlaştırma yalnız EKLER) —
// izin kataloğuyla aynı kural. Gerçekten kaldırmak = panelden GİZLEMEK.
//
// ⚠️ `code` rapor anahtarıdır ve ASLA değişmez. Etiketi düzeltmek serbesttir;
// kodu düzeltmek geçmiş kayıtları öksüz bırakır.
// =============================================================================

import { ReasonPresetKind } from "@prisma/client";

import { SCRAP_REASONS, RECORD_CORRECTION_REASONS } from "./variance-reasons";

/** Tek bir hazır sebep satırının katalog hâli. */
export type ReasonPresetSeed = {
  readonly code: string;
  readonly label: string;
  /**
   * Sunucuya GİDEN tam metin. Yalnız METİN SAKLAYAN kind'larda dolar
   * (ROLL_MANUAL_ENTRY / ROLL_CANCEL): oralarda satıra kod değil metin yazılır
   * (`Roll.entryReason` / `Roll.cancelReason` serbest metin kolonlarıdır).
   */
  readonly fullText?: string;
  readonly requiresText?: boolean;
};

/**
 * ⚠️ SÖZLEŞME FARKI, tek yerde yazılı: bu bayrak true ise listenin seçimi
 * sunucuya METİN olarak gider ve rapor gruplaması METNE dayanır → etiketi
 * düzenlemek GEÇMİŞ kayıtları eski metinle bırakır (iki satır olur). false ise
 * satıra KOD yazılır ve etiket düzenlemesi tamamen güvenlidir.
 */
export const KIND_STORES_TEXT: Record<ReasonPresetKind, boolean> = {
  ROLL_SCRAP: false,
  ROLL_RECORD_CORRECTION: false,
  ROLL_MANUAL_ENTRY: true,
  ROLL_CANCEL: true,
};

/** Panelde/tablette listenin başlığı. */
export const KIND_LABELS: Record<ReasonPresetKind, string> = {
  ROLL_SCRAP: "Fire sebepleri",
  ROLL_RECORD_CORRECTION: "Kayıt düzeltmesi sebepleri",
  ROLL_MANUAL_ENTRY: "Elle top ekleme sebepleri",
  ROLL_CANCEL: "Top iptal sebepleri",
};

/**
 * ELLE TOP EKLEME — mobil `manualReasons.ts`'in sunucu ikizi.
 * `fullText` = bugüne kadar `Roll.entryReason`'a yazılan metnin BİREBİR aynısı;
 * değiştirilirse geçmişle gruplama kopar (bu yüzden kodda sabit duruyor,
 * fabrika düzenlemesi DB satırında yaşar).
 */
export const MANUAL_ENTRY_REASONS: readonly ReasonPresetSeed[] = [
  { code: "DEPO_BARKODSUZ", label: "Depoda barkodsuz kalmış top", fullText: "Depoda barkodsuz kalmış top" },
  { code: "ETIKET_KOPMUS", label: "Etiketi kopmuş / okunmuyor", fullText: "Etiketi kopmuş / okunmuyor" },
  { code: "GECMIS_VARDIYA", label: "Sistem kaydı yapılmamış (geçmiş vardiya)", fullText: "Sistem kaydı yapılmamış (geçmiş vardiya)" },
  { code: "FASON_DONUS_KAYITSIZ", label: "Fason dönüşü kayda girmemiş", fullText: "Fason dönüşü kayda girmemiş" },
  { code: "SAYIM_FARKI", label: "Sayım farkı — fiziksel mal var", fullText: "Sayım farkı — fiziksel mal var" },
] as const;

/**
 * TOP İPTALİ — mobil `cancelReasons.ts`'in sunucu ikizi.
 * `label` chip üstünde yazan KISA metin, `fullText` `Roll.cancelReason`'a
 * yazılan tam cümle. İkisi bilerek ayrı: tablette okuyanla altı ay sonra
 * raporda okuyan aynı kişi değil.
 */
export const CANCEL_REASONS: readonly ReasonPresetSeed[] = [
  { code: "MUKERRER", label: "Mükerrer", fullText: "Mükerrer giriş — aynı top iki kez kaydedildi" },
  { code: "YANLIS_METRAJ", label: "Yanlış metraj", fullText: "Yanlış metraj girildi" },
  { code: "YANLIS_URUN_RENK", label: "Yanlış ürün/renk", fullText: "Yanlış ürün / renk seçildi" },
  { code: "TOP_YOK", label: "Top yok", fullText: "Top fiziksel olarak yok (hatalı kayıt)" },
  { code: "DENEME", label: "Deneme", fullText: "Deneme / eğitim kaydı" },
] as const;

/** Kind → sistem satırları. Sıra ANLAMLIDIR (dizideki sıra `sortOrder` olur). */
export const REASON_PRESET_CATALOG: Record<ReasonPresetKind, readonly ReasonPresetSeed[]> = {
  ROLL_SCRAP: SCRAP_REASONS,
  ROLL_RECORD_CORRECTION: RECORD_CORRECTION_REASONS,
  ROLL_MANUAL_ENTRY: MANUAL_ENTRY_REASONS,
  ROLL_CANCEL: CANCEL_REASONS,
};

export const REASON_PRESET_KINDS = Object.keys(REASON_PRESET_CATALOG) as ReasonPresetKind[];

/** Etiket → kod. Türkçe harfler ASCII'ye iner (kod ASCII kalır — `TUP` dersi). */
export function slugifyReasonCode(label: string): string {
  const map: Record<string, string> = {
    ç: "C", Ç: "C", ğ: "G", Ğ: "G", ı: "I", İ: "I",
    ö: "O", Ö: "O", ş: "S", Ş: "S", ü: "U", Ü: "U",
  };
  const ascii = label.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => map[c] ?? c);
  const code = ascii
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  // Tamamen sembolden oluşan etiket (ör. "???") boş kod üretirdi — kod satırın
  // KİMLİĞİ olduğu için boş bırakılamaz, çağıran benzersizleştirir.
  return code || "SEBEP";
}
