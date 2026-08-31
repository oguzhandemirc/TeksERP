// =============================================================================
// RESMÎ ÇEK / SENET TESLİM BORDROSU — istek gövdesi + kapı yüklemi (saf katman)
// =============================================================================
// NE ÜRETİR: `POST /api/finance/cheque-delivery-notes` gövdesi. Kâğıdı bu dosya
// ÜRETMEZ — belge backend'de `PrintedDocument` olarak DONAR ve ekrana mevcut
// `PrintedDocDialog` ile gelir (sürüm geçmişi, revizyon, PDF hepsi orada).
//
// ⚠️ `chequeBordro.ts` İLE İKİSİ AYRI İŞTİR, biri diğerinin yerine geçmez:
//   • `chequeBordro.ts`  → ANLIK çıktı. Hiçbir şey kaydetmez, belge numarası ve
//     sürümü yoktur, aynı seçimle iki kez basmak iki olay üretmez. Vardiya
//     ortasında hızlı kâğıt lazım olduğunda doğru araç odur.
//   • bu dosya           → RESMÎ kayıt. `BRD…` numarası alır, donar, iptal
//     edilebilir, sürüm geçmişi tutar. Karşı tarafa imzalatılan nüsha budur.
// İkisini tek düğmede birleştirmek, "hızlıca bakayım" diyen kullanıcıya her
// tıklamada iptal edilmesi gereken resmi bir kayıt açtırırdı; anlık çıktıyı
// kaldırmak ise resmi kaydı istemeyen kişiyi belge numarası üretmeye zorlardı.
// Bu yüzden EKRANDA İKİ DÜĞME durur ve metinleri farkı söyler.
//
// ⚠️ KAPI YÜKLEMİ KOPYALANMAZ, `bordroBlockReason` AYNEN ÇAĞRILIR. Backend
// aynı üç kuralı (tek yön · iptal edilmiş kayıt · boş seçim) fail-closed
// uyguluyor; ekranın ikinci bir yorumunu yazmak, bir gün birinin "geçer" deyip
// diğerinin reddettiği bir seçim demekti. Ekran katmanı yine bir NEZAKETTİR —
// asıl sed sunucudadır.
//
// ⚠️ TESLİM TARİHİ MUTLAK AN OLARAK GİDER (`dayStartIso`) ve boş/bozuk değerde
// gövde HİÇ ÜRETİLMEZ. Tarih yalnız kâğıdın üstündeki gün değil, belge
// numarasının GGAAYY çıpasıdır (`BRD` + gün + sıra) — sessizce "bugün"e
// düşmek yanlış numaralı bir resmi belge üretirdi.
// =============================================================================

import { bordroBlockReason, type SelectableCheque } from "./chequeBordro";
import { dayStartIso } from "./dates";

export const DELIVERY_DATE_ERROR =
  "Teslim tarihi gerekli — hem kâğıdın günü hem de belge numarasının çıpası odur.";

/** Ekranın topladığı ham taslak (kutulardaki metinler dahil, kırpılmamış). */
export interface DeliveryNoteDraft {
  /** SEÇİLİ satırlar — ekrandaki listeden gelir, yeni istek atılmaz. */
  rows: readonly SelectableCheque[];
  /** `<input type="date">` değeri (YYYY-MM-DD, yerel gün). */
  dateYmd: string;
  /** Teslim edilen yer / banka — SERBEST METİN, opsiyonel (H6 `place` ikizi). */
  targetLabel: string;
  /** Bordro notu — opsiyonel. */
  notes: string;
  /**
   * "Bu kıymetler zaten AKTİF bir bordroda" uyarısını kullanıcı GÖRDÜ ve
   * onayladı. Yalnız `true` iken gövdeye girer (bkz. `buildDeliveryNoteBody`).
   */
  confirmDuplicate?: boolean;
}

/** `POST /api/finance/cheque-delivery-notes` gövdesi (backend Zod `.strict()`). */
export interface DeliveryNoteBody {
  chequeIds: string[];
  deliveryDate: string;
  targetLabel?: string;
  notes?: string;
  confirmDuplicate?: boolean;
}

// -----------------------------------------------------------------------------
// "ZATEN AKTİF BİR BORDRODA" UYARISI (409) — ENGEL DEĞİL ONAYLATMA
// -----------------------------------------------------------------------------
// ⚠️ Backend bu durumu neden BLOKLAMIYOR: aynı fiziksel çek hayatı boyunca
// birden fazla kez teslim edilebilir (tahsile ver → karşılıksız dön → ciro et)
// ve her teslim kendi tutanağını hak eder. Kapatılan şey SESSİZLİKTİR:
// `clientToken` yok, yani zaman aşımından sonra ikinci basış SESSİZCE ikinci bir
// resmi belge doğururdu; düzeltmek isteyen kullanıcı da eski bordroyu ACTIVE
// bırakıp aynı çekler için karşı tarafa İKİ tutanak imzalatırdı.
//
// ⚠️ EKRANIN İŞİ: 409'u ham hata olarak yutmak DEĞİL, kullanıcıya HANGİ bordro
// ve HANGİ kıymetler olduğunu gösterip kararı ona bırakmak. `code` ile eşleşilir,
// mesaj metniyle DEĞİL — metin bir gün düzeltilirse eşleşme sessizce ölürdü.

/** Backend `AppError.details.code` değeri (`cheque-delivery-note.service` aynası). */
export const ALREADY_IN_ACTIVE_NOTE = "ALREADY_IN_ACTIVE_NOTE";

export interface DuplicateNoteWarning {
  /** Backend'in cümlesi — ekran kendi cümlesini uydurmaz (belge no'ları onda). */
  message: string;
  /** Çakışan AKTİF bordroların belge numaraları. */
  noteDocNos: string[];
  /** Zaten teslim edilmiş görünen kıymetlerin belge numaraları. */
  chequeDocNos: string[];
}

/**
 * Hata bir "zaten aktif bordroda" uyarısı mı? Değilse `null` (çağıran normal
 * hata yolunu izler — uyarı ile GERÇEK hata karıştırılmaz).
 *
 * ⚠️ AXIOS'A BAĞLANMAZ, gövde YAPISAL olarak okunur: bu bir saf katmandır ve
 * bekçisi sahte bir `AxiosError` kurmak zorunda kalmamalı. Eksik/bozuk gövdede
 * `null` döner — belirsiz bir cevabı "onayla ve devam et" diye sunmak, gerçek
 * bir sunucu hatasını onay diyaloğuna çevirirdi.
 */
export function duplicateNoteWarning(error: unknown): DuplicateNoteWarning | null {
  const body = (error as { response?: { data?: unknown } } | null | undefined)?.response?.data as
    | { message?: unknown; details?: { code?: unknown; noteDocNos?: unknown; chequeDocNos?: unknown } }
    | undefined;
  if (body?.details?.code !== ALREADY_IN_ACTIVE_NOTE) return null;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    message:
      typeof body.message === "string" && body.message.trim()
        ? body.message
        : "Seçimdeki kıymetlerden bazıları zaten aktif bir teslim bordrosunda.",
    noteDocNos: list(body.details?.noteDocNos),
    chequeDocNos: list(body.details?.chequeDocNos),
  };
}

/**
 * Bu taslaktan RESMÎ bordro kesilemiyorsa sebebi; kesilebiliyorsa `null`.
 *
 * ⚠️ Sebep DÖNDÜRÜLÜR, `false` değil (`chequeBordro` ile aynı sözleşme): kapalı
 * bir düğme tek başına "bozuk" okunur ve kullanıcı ne yapacağını bilemez.
 */
export function deliveryNoteBlockReason(draft: DeliveryNoteDraft): string | null {
  // SIRA: önce SEÇİMİN kendi tutarlılığı, sonra form alanları — backend de
  // aynı sırayı izliyor (`cheque-delivery-note.service` SIRA sözleşmesi).
  // Ters sırada, karışık yön seçen kullanıcı önce tarihi düzeltir, asıl
  // hatasını İKİ TUR SONRA öğrenirdi.
  const blocked = bordroBlockReason(draft.rows);
  if (blocked) return blocked;
  if (!dayStartIso(draft.dateYmd)) return DELIVERY_DATE_ERROR;
  return null;
}

/**
 * İstek gövdesi.
 *
 * ⚠️ FAIL-CLOSED: kabul edilemez taslakta `null` DÖNMEZ, FIRLATIR
 * (`buildChequeBordro` ile aynı gerekçe — `null` çağıran tarafta sessizce
 * "hiçbir şey yapmayan düğme"ye dönüşür). Çağıran ekran zaten aynı yüklemi
 * kullanıp düğmeyi kapatır ve sebebi yazar; burası son settir.
 *
 * ⚠️ BOŞ METİN ALANI HİÇ GÖNDERİLMEZ. Backend `.strict()` şemada bu alanlar
 * `nullable().optional()`; boş string göndermek reddedilmez ama kayda `""`
 * yazar ve kâğıtta "Teslim Edilen: " diye BAŞLIKSIZ bir satır doğururdu.
 */
export function buildDeliveryNoteBody(draft: DeliveryNoteDraft): DeliveryNoteBody {
  const blocked = bordroBlockReason(draft.rows);
  if (blocked) throw new Error(blocked);

  const deliveryDate = dayStartIso(draft.dateYmd);
  if (!deliveryDate) throw new Error(DELIVERY_DATE_ERROR);

  // ⚠️ TEKİLLEŞTİR: aynı çek iki kez giderse backend pivotun `@@unique`ine
  // çarpardı. Backend de dedup ediyor (iki katman), ama istemcinin gönderdiği
  // liste ile kâğıttaki adet aynı olmalı ki ekrandaki sayaç yalan söylemesin.
  const chequeIds = [...new Set(draft.rows.map((r) => r.id))];
  const targetLabel = draft.targetLabel.trim();
  const notes = draft.notes.trim();

  return {
    chequeIds,
    deliveryDate,
    ...(targetLabel ? { targetLabel } : {}),
    ...(notes ? { notes } : {}),
    // ⚠️ YALNIZ `true` iken gönderilir. `confirmDuplicate: false` göndermek
    // sözleşmeyi bozmaz ama gövdeyi her istekte "onay taşıyormuş" gibi gösterir;
    // asıl tehlike ise bu alanı VARSAYILAN `true` yapmaktır — o an uyarı hiç
    // görünmez ve tam da önlenmek istenen sessiz ikinci belge geri gelir.
    ...(draft.confirmDuplicate === true ? { confirmDuplicate: true } : {}),
  };
}
