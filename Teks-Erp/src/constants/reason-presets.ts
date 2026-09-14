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
   * (ROLL_MANUAL_ENTRY / ROLL_CANCEL): oralarda satıra GÖRÜNEN metin yazılır
   * (`Roll.entryReason` / `Roll.cancelReason`) — 2026-08-21'den beri KOD da
   * (`entryReasonCode` / `cancelReasonCode`): sunucu gelen metni bu `fullText` ya
   * da `label` ile katlanmış eşleyip kodu kendisi türetir (`resolveReasonCode`).
   */
  readonly fullText?: string;
  readonly requiresText?: boolean;
  /**
   * DURUŞUN KAYIP SINIFI — yalnız `MACHINE_STOP` kind'ında dolar ve ZORUNLUDUR
   * (DB CHECK `reason_presets_machine_class_chk`). ⚠️ `MINOR` YAZILAMAZ: MINOR bir
   * SÜRE sınıfıdır, sebep sınıfı değil. Job bu alanı satıra yazmazsa INSERT 23514
   * ile düşer ⇒ CHECK + bu katalog + job AYNI commit'te değişir.
   */
  readonly stopLossClass?: "UNPLANNED" | "SETUP" | "PLANNED" | "NON_SCHEDULED";
};

/**
 * SÖZLEŞME FARKI, tek yerde yazılı: bu bayrak true ise listenin seçimi sunucuya
 * METİN olarak gider ve satıra görünen metin yazılır (`resolveFullText` bunu
 * okur); false ise yalnız KOD yazılır (`RollVariance.reasonCode`).
 * ⚠️ 2026-08-21'den beri true olan kind'larda satır KODU DA taşır
 * (`Roll.entryReasonCode` / `cancelReasonCode` — sunucu metinden türetir), yani
 * etiket/metin düzenlemesi geçmişi BÖLMEZ: eski kayıt eski metni, yeni kayıt
 * yenisini taşır, rapor anahtarı (kod) aynı kalır. Bayrağın "metin saklanır"
 * anlamı duruyor; "kod saklanmaz" anlamı DÜŞTÜ.
 */
export const KIND_STORES_TEXT = {
  ROLL_SCRAP: false,
  ROLL_RECORD_CORRECTION: false,
  ROLL_MANUAL_ENTRY: true,
  ROLL_CANCEL: true,
  // Yeniden üretimde ortada bir "satır" yok: sebep iş emrinin `parameters.rework`
  // alanına KOD + metin olarak yazılır (kod rapor anahtarı). Metin ayrıca 1. rota
  // adımının notuna geçip fason çekisine TALİMAT olarak basılır — ama bu, satıra
  // görünen metin yazmakla aynı şey değil; bayrak bu yüzden false.
  WORK_ORDER_REWORK: false,
  // Sipariş iptalinde satıra GÖRÜNEN metin yazılır (`Order.cancelReason`) —
  // top iptaliyle aynı sözleşme. Kod ayrıca `cancelReasonCode`'a düşer.
  ORDER_CANCEL: true,
  // Tezgah duruşunda satıra YALNIZ KOD yazılır (`MachineStopEvent.reasonCode`,
  // FK'sız — `Roll.cancelReasonCode` emsali); metin yoktur. Kayıp sınıfı
  // preset'ten KOPYALANIP DONAR (`lossClass`), katalog değişse geçmiş değişmez.
  MACHINE_STOP: false,
  // Levent dibi iadesinde satıra YALNIZ KOD yazılır (`YarnMovement.reasonCode`); metin yok.
  WARP_RETURN: false,
  // Faz 3: levent kalan düzeltmesi / hurda-artık dispozisyonu — satıra KOD (`WarpBeamEvent.reasonCode`), gerekçe `reason` kolonunda.
  WARP_BEAM_ADJUST: false,
  WARP_BEAM_SCRAP: false,
  // G1: fasondan iplik dönüşünde satıra YALNIZ KOD (`YarnMovement.reasonCode`, CHECK zorunlu); metin yok.
  YARN_SUBCONTRACT_RETURN: false,
  // `as const satisfies` — değerler LİTERAL kalsın (true/false), ama eksik kind
  // yine derlemede düşsün. `Record<..., boolean>` yazılsaydı literaller boolean'a
  // genişler ve `TextReasonKind` bu tablodan TÜRETİLEMEZDİ (aşağıdaki nota bak).
} as const satisfies Record<ReasonPresetKind, boolean>;

/** Panelde/tablette listenin başlığı. */
export const KIND_LABELS: Record<ReasonPresetKind, string> = {
  ROLL_SCRAP: "Fire sebepleri",
  ROLL_RECORD_CORRECTION: "Kayıt düzeltmesi sebepleri",
  ROLL_MANUAL_ENTRY: "Elle top ekleme sebepleri",
  ROLL_CANCEL: "Top iptal sebepleri",
  WORK_ORDER_REWORK: "Yeniden üretim sebepleri",
  ORDER_CANCEL: "Sipariş iptal sebepleri",
  MACHINE_STOP: "Tezgah duruş sebepleri",
  WARP_RETURN: "Levent dibi iade sebepleri",
  WARP_BEAM_ADJUST: "Levent kalan düzeltmesi sebepleri",
  WARP_BEAM_SCRAP: "Levent hurda / artık dispozisyonu",
  YARN_SUBCONTRACT_RETURN: "Fasondan iplik dönüş sebepleri",
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
/**
 * SİSTEM SEBEBİ — seçilebilir bir sebep DEĞİLDİR (`SHRINK_REASON_CODE` emsali).
 *
 * Tambur geri alması bir kesim parçasını iptal ederken metrajı KAYNAK TOPA İADE
 * EDER. O parça bundan sonra "iptal edilmiş ama metrajı üstünde duran" bir kayıt
 * olur ve Envanter→Arşiv'den "İptali Geri Al" ile diriltilirse AYNI metraj iki
 * yerde birden görünür (BULGU-T1-011; saha kopyasında 50 top / 1.834,8 m
 * diriltilmeye hazır bekliyordu).
 *
 * Kodu `CANCEL_REASONS`'a EKLEMEDİK — o liste operatörün iptal ekranında
 * gördüğü listedir ve oraya "Tambur geri alması" koymak, operatörün elle
 * yaptığı bir iptali sistem iptali gibi işaretlemesinin yolunu açardı.
 * Seçicilerde ÇIKMAZ, doğrulama KABUL eder.
 *
 * ⚠️ İZ SATIRIN KENDİSİNDE durmak ZORUNDA: tek alternatif audit'ti ve audit 6
 * ayda arşivleniyor — ona dayanan bir kural zamanla SESSİZCE açılırdı
 * (`entryReason`/`labelPrintedAt` dersinin aynısı).
 */
export const TAMBUR_UNDO_CANCEL_CODE = "TAMBUR_GERI_ALMA";
export const TAMBUR_UNDO_CANCEL_TEXT = "Tambur geri alması — metraj kaynak topa iade edildi";

/**
 * FASON KABUL İPTALİ — cascade ile düşen doğan top (2026-09-13).
 *
 * ⚠️ Bu yol bugüne kadar topu SEBEPSİZ iptal ediyordu (`data` yalnız `status` +
 * `currentStepId`), oysa iptal sebebi katalogludur. İki ayrı iş yapıyor:
 *   1) izi satırın kendisinde bırakır (audit 6 ayda arşivlenir — üstteki ders),
 *   2) restore guard'ın YENİ DALINI besler.
 *
 * ⚠️ AMA ENGELİ GETİREN ŞEY BU KOD DEĞİL, GUARD'IN DALIDIR. Sebep kodu yazmak
 * tek başına hiçbir engel getirmez — `isUndoSourcedByAudit` ilk satırı
 * `if (cancelReasonCode) return false;` olduğu için kod DOLU olduğu an audit
 * dalı da kapanır (ölçüldü 2026-09-13). İkisini karıştırmak kusuru "kapatılmış
 * sanmaya" yol açar.
 */
export const FASON_RECEIPT_CANCEL_CODE = "FASON_KABUL_IPTAL";
export const FASON_RECEIPT_CANCEL_TEXT =
  "Fason kabulü iptal edildi — kumaş fasona geri döndü";

export const CANCEL_REASONS: readonly ReasonPresetSeed[] = [
  { code: "MUKERRER", label: "Mükerrer", fullText: "Mükerrer giriş — aynı top iki kez kaydedildi" },
  { code: "YANLIS_METRAJ", label: "Yanlış metraj", fullText: "Yanlış metraj girildi" },
  { code: "YANLIS_URUN_RENK", label: "Yanlış ürün/renk", fullText: "Yanlış ürün / renk seçildi" },
  { code: "TOP_YOK", label: "Top yok", fullText: "Top fiziksel olarak yok (hatalı kayıt)" },
  { code: "DENEME", label: "Deneme", fullText: "Deneme / eğitim kaydı" },
] as const;

/**
 * YENİDEN ÜRETİM — depodaki BİTMİŞ topu tekrar üretime/boyahaneye alma sebebi.
 *
 * Sebep İSTEĞE BAĞLIDIR (2026-08-25 kullanıcı kararı): operatör hiçbirini
 * seçmeden de iş emrini başlatabilir. Seçerse metin fason çekisine talimat
 * olarak basılır ("ton tutmadı — yeniden boya"), kod ise iş emrinin
 * `parameters.rework`una yazılır ve ileride "neden N top tekrar boyandı"
 * raporunun anahtarı olur.
 *
 * `label` chip üstünde yazan kısa metindir; `fullText` YOK — çekiye basılacak
 * cümle chip'in kendisidir, ikinci bir uzun metin operatöre iki farklı şey
 * okutmaktan başka işe yaramazdı (iptal listesindeki label/fullText ayrımının
 * gerekçesi orada geçerli: orada metin ALTI AY SONRA raporda okunuyor).
 */
export const REWORK_REASONS: readonly ReasonPresetSeed[] = [
  { code: "TON_TUTMADI", label: "Ton tutmadı" },
  { code: "LEKE", label: "Leke / kir" },
  { code: "MUSTERI_IADESI", label: "Müşteri iadesi" },
  { code: "RENK_DEGISIKLIGI", label: "Renk değişikliği" },
  { code: "KALITE_DUSUK", label: "Kalite düşük" },
  // Serbest metin kutusunun kataloğa bakan yüzü: operatör yazmaya başlayınca
  // istemci bu kodu kendiliğinden seçer (Fire ekranıyla aynı desen).
  { code: "DIGER", label: "Diğer", requiresText: true },
] as const;

/**
 * SİPARİŞ İPTALİ — "müşteri neden vazgeçti".
 *
 * Ayrım bilinçli: ilk dört satır MÜŞTERİ kararıdır (ticari sinyal — satışın
 * bakması gereken şey), son ikisi BİZİM kayıt/tedarik sorunumuzdur. Rapor bu
 * ikisini karıştırırsa "iptal oranımız yüksek" cümlesi hangi tarafın sorunu
 * olduğunu söylemez. Kodlar rapor anahtarıdır ve ASLA değişmez; fabrika
 * etiketleri panelden kendi diliyle düzenleyebilir.
 */
export const ORDER_CANCEL_REASONS: readonly ReasonPresetSeed[] = [
  { code: "MUSTERI_VAZGECTI", label: "Müşteri vazgeçti", fullText: "Müşteri siparişten vazgeçti" },
  { code: "FIYAT", label: "Fiyat anlaşmazlığı", fullText: "Fiyatta anlaşılamadı" },
  { code: "TERMIN", label: "Termin uzun", fullText: "Verilen termin müşteriye uzun geldi" },
  { code: "MUSTERI_DEGISIKLIK", label: "Müşteri değişiklik istedi", fullText: "Müşteri sipariş içeriğini değiştirmek istedi — yeni siparişle devam edildi" },
  { code: "HATALI_KAYIT", label: "Hatalı kayıt", fullText: "Sipariş yanlış girildi (mükerrer / hatalı kayıt)" },
  { code: "TEMIN_EDILEMEDI", label: "Temin edilemedi", fullText: "Kumaş / hammadde temin edilemedi" },
  // Serbest metin kutusunun kataloğa bakan yüzü — Fire ekranıyla aynı desen.
  { code: "DIGER", label: "Diğer", requiresText: true },
] as const;

/**
 * TEZGAH DURUŞU — 23 sistem sebebi, dört kayıp sınıfında (dokuma P2b-2, tasarım §2.7).
 *
 * ⚠️ KODLAR ASLA DEĞİŞMEZ (rapor anahtarı); Türkçe etiketler panelden düzenlenir.
 * ⚠️ `stopLossClass` HER satırda ZORUNLU ve `MINOR` YOK — MINOR bir SEBEP sınıfı
 *    değil bir SÜRE sınıfıdır (mikro-duruş eşiğinin altı) ve tek helper'da türer;
 *    45 dakikalık bir çözgü kopuşunu MINOR saymak kullanılabilirliği hiç
 *    düşürmezdi (tasarım denetimi B2). DB CHECK ikisini de tutar.
 * ⚠️ Kopuş sebepleri (`*_KOPUSU`, `IPLIK_BITTI`) UNPLANNED: makine kendi kendine
 *    durdu. `LEVENT_BAGLAMA`/`TAHAR`/`TARAK_DEGISIMI` ile `DESEN_DEGISIMI` AYRI
 *    kodlar — saha kaynağının ana bulgusu: bir levent → çok desen; levent değişimi
 *    pahalı, atkı/desen değişimi ucuz; kurulum defteri ikisini AYIRMAK zorunda.
 * ⚠️ `TESPIT_EDILEMEDI` bir KARARDIR, "sınıflandırılmamış" değil: sınıflandırılmamış
 *    duruş `reasonCode = NULL`dır ve kuyrukta bekler; bu kod kuyruğu temizlemez,
 *    "bakıldı, sebep bulunamadı" der.
 * ⚠️ Bu satırlar TEZGAH MODÜLÜ KAPALI kurulumda da DB'ye düşer (job bayrağa
 *    bakmaz — izin kataloğu denklemi). Görünürlük kapısı PANELDEDİR: `KIND_TABS`
 *    sekmesi yalnız `tezgahEnabled` açıkken çizilir.
 */
export const MACHINE_STOP_REASONS: readonly ReasonPresetSeed[] = [
  // ── Kopuşlar ve malzeme (UNPLANNED) — makine kendi kendine durdu
  { code: "COZGU_KOPUSU", label: "Çözgü kopuşu", stopLossClass: "UNPLANNED" },
  { code: "ATKI_KOPUSU", label: "Atkı kopuşu", stopLossClass: "UNPLANNED" },
  { code: "KENAR_KOPUSU", label: "Kenar kopuşu", stopLossClass: "UNPLANNED" },
  { code: "IPLIK_BITTI", label: "İplik bitti", stopLossClass: "UNPLANNED" },
  // ── Arıza ve dış etken (UNPLANNED)
  { code: "MEKANIK_ARIZA", label: "Mekanik arıza", stopLossClass: "UNPLANNED" },
  { code: "ELEKTRIK_ARIZA", label: "Elektrik arızası", stopLossClass: "UNPLANNED" },
  { code: "ELEKTRIK_KESINTISI", label: "Elektrik kesintisi", stopLossClass: "UNPLANNED" },
  { code: "HAVA_BASINCI", label: "Hava basıncı düştü", stopLossClass: "UNPLANNED" },
  { code: "JAKAR_ARIZA", label: "Jakar arızası", stopLossClass: "UNPLANNED" },
  { code: "OPERATOR_YOK", label: "Operatör yok", stopLossClass: "UNPLANNED" },
  { code: "KUMAS_TAMIR", label: "Kumaş tamiri", stopLossClass: "UNPLANNED" },
  { code: "TESPIT_EDILEMEDI", label: "Sebep tespit edilemedi", stopLossClass: "UNPLANNED" },
  // ── Kurulum (SETUP) — levent değişimi ile desen değişimi AYRI kodlar
  { code: "LEVENT_BAGLAMA", label: "Levent bağlama", stopLossClass: "SETUP" },
  { code: "TAHAR", label: "Tahar", stopLossClass: "SETUP" },
  { code: "TARAK_DEGISIMI", label: "Tarak değişimi", stopLossClass: "SETUP" },
  { code: "DESEN_DEGISIMI", label: "Desen değişimi", stopLossClass: "SETUP" },
  { code: "TOP_ALMA", label: "Top alma", stopLossClass: "SETUP" },
  // ── Planlı (PLANNED)
  { code: "PLANLI_BAKIM", label: "Planlı bakım", stopLossClass: "PLANNED" },
  { code: "TEMIZLIK", label: "Temizlik", stopLossClass: "PLANNED" },
  { code: "MOLA", label: "Mola", stopLossClass: "PLANNED" },
  { code: "VARDIYA_DEVRI", label: "Vardiya devri", stopLossClass: "PLANNED" },
  // ── Çalışma dışı (NON_SCHEDULED) — POT'tan düşülür
  { code: "SIPARIS_YOK", label: "Sipariş yok", stopLossClass: "NON_SCHEDULED" },
  { code: "TEZGAH_KAPALI", label: "Tezgah kapalı", stopLossClass: "NON_SCHEDULED" },
] as const;

/**
 * LEVENT DİBİ İADESİ — sarım bitince bobinde kalan iplik NEREYE GİTTİ (devere 1b, §3.7/§9.7b).
 * Aksiyon anında seçilir; aynı fabrika bir gün depoya iade eder, ertesi gün atkıya aktarır.
 * `WARP_RETURN` satırında kod ZORUNLUDUR (CHECK `yarn_movements_warp_return_reason_ck`, c2).
 */
export const WARP_RETURN_REASONS: readonly ReasonPresetSeed[] = [
  { code: "DEPOYA_IADE", label: "Depoya iade (bobin tartılıp geri kondu)" },
  { code: "ATKILIK_AKTARIM", label: "Atkılığa aktarım (dip atkı olarak kullanılacak)" },
  { code: "TELEF", label: "Telef (dip kullanılamaz, fire)" },
] as const;

/** Faz 3 — kalan metre düzeltmesi: ölçüm yolu değişti / sayaç yanlış / çap ölçümü / tartı. */
export const WARP_BEAM_ADJUST_REASONS: readonly ReasonPresetSeed[] = [
  { code: "SAYAC_DUZELTME", label: "Tezgah sayacı yanlıştı (yeniden okundu)" },
  { code: "OLCUM_FARKI", label: "Ölçüm farkı (çap / tartı ile yeniden hesap)" },
  { code: "KAYIT_HATASI", label: "Kayıt hatası (tüketim yanlış girildi)" },
] as const;

/** Faz 3 — levent dibi / hurda dispozisyonu (#15). Telef satışı kod olarak YOK — kapsam dışı. */
export const WARP_BEAM_SCRAP_REASONS: readonly ReasonPresetSeed[] = [
  { code: "DIP_TELEF", label: "Levent dibi telef (kullanılamaz artık)" },
  { code: "DIP_ATKILIK", label: "Levent dibi atkılığa aktarıldı" },
  { code: "KOPUK_COZGU", label: "Kopuk / bozuk çözgü (dokunamaz)" },
  { code: "YANLIS_SARIM", label: "Yanlış sarım (kart uyuşmuyor)" },
] as const;

/** G1 — fasondan iplik dönüşü: neden geri geldi (kalan · kalite · sevk iptali). Kod değişmez, son aktif gizlenemez. */
export const YARN_SUBCONTRACT_RETURN_REASONS: readonly ReasonPresetSeed[] = [
  { code: "KALAN_IPLIK", label: "Kalan iplik (iş bitti, artan döndü)" },
  { code: "KALITE", label: "Kalite (iplik kullanılamadı / uygun değil)" },
  { code: "IPTAL", label: "İş iptal edildi (iplik kullanılmadan döndü)" },
] as const;

/** Kind → sistem satırları. Sıra ANLAMLIDIR (dizideki sıra `sortOrder` olur). */
export const REASON_PRESET_CATALOG: Record<ReasonPresetKind, readonly ReasonPresetSeed[]> = {
  ROLL_SCRAP: SCRAP_REASONS,
  ROLL_RECORD_CORRECTION: RECORD_CORRECTION_REASONS,
  ROLL_MANUAL_ENTRY: MANUAL_ENTRY_REASONS,
  ROLL_CANCEL: CANCEL_REASONS,
  WORK_ORDER_REWORK: REWORK_REASONS,
  ORDER_CANCEL: ORDER_CANCEL_REASONS,
  MACHINE_STOP: MACHINE_STOP_REASONS,
  WARP_RETURN: WARP_RETURN_REASONS,
  WARP_BEAM_ADJUST: WARP_BEAM_ADJUST_REASONS,
  WARP_BEAM_SCRAP: WARP_BEAM_SCRAP_REASONS,
  YARN_SUBCONTRACT_RETURN: YARN_SUBCONTRACT_RETURN_REASONS,
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
