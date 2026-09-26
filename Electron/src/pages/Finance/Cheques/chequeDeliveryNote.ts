// =============================================================================
// ÇEK / SENET TESLİM BORDROSU — istek gövdeleri + kapı yüklemi + token (saf katman)
// =============================================================================
// TEK BELGE (K1, 2026-09-26): bordronun resmî kaydı (`BRD…`) ile numarasız
// taslağı AYNI backend çözücüsünden gelir. Akış: seç → Önizle (`/draft`, yazmaz,
// okuma izni) → Kaydet (`finance:write`, BRD doğar ve donar) → resmî PDF/Excel.
// Kâğıdı bu dosya ÜRETMEZ; yalnız iki gövdeyi (`buildDraftBody` ·
// `buildDeliveryNoteBody`) ve deneme token'ının kuralını taşır.
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

import { isAmbiguousFailure } from "@/lib/fasonReceiveAttempt";
import { bordroBlockReason, type SelectableCheque } from "./chequeBordro";
import { dayStartIso } from "./dates";
import { targetBlockReason, targetBodyFields, type DeliveryTarget } from "./chequeNoteMovement";

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
  /** Mantıksal denemenin kimliği (uuid) — bkz. `tokenAfterFailure`. */
  clientToken?: string;
  /**
   * Hareket fişi (K3) teslim türü — YALNIZ bayrak açık ve aldığımız çeklerde verilir; yoksa
   * gövde bugünkü gibi (belge-only) kalır. Bkz. `chequeNoteMovement.ts`.
   */
  target?: DeliveryTarget;
}

/** `POST /api/finance/cheque-delivery-notes/draft` gövdesi — kaydın alanlarının aynısı. */
export interface DeliveryNoteDraftBody {
  chequeIds: string[];
  deliveryDate: string;
  /** Hareket fişi hedefi — yalnız biri, yalnız teslim türü seçildiyse. */
  bankAccountId?: string;
  cariId?: string;
  targetLabel?: string;
  notes?: string;
}

/** `POST /api/finance/cheque-delivery-notes` gövdesi (backend Zod `.strict()`). */
export interface DeliveryNoteBody extends DeliveryNoteDraftBody {
  confirmDuplicate?: boolean;
  clientToken?: string;
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
  return draft.target ? targetBlockReason(draft.target) : null;
}

/**
 * Taslak (önizleme) gövdesi — kayıt gövdesi bunun üstüne kurulur.
 *
 * ⚠️ FAIL-CLOSED: kabul edilemez taslakta `null` DÖNMEZ, FIRLATIR — `null`
 * çağıran tarafta sessizce "hiçbir şey yapmayan düğme"ye dönüşür. Çağıran ekran
 * zaten aynı yüklemi kullanıp düğmeyi kapatır ve sebebi yazar; burası son settir.
 *
 * ⚠️ BOŞ METİN ALANI HİÇ GÖNDERİLMEZ. Backend `.strict()` şemada bu alanlar
 * `nullable().optional()`; boş string göndermek reddedilmez ama kayda `""`
 * yazar ve kâğıtta "Teslim Edilen: " diye BAŞLIKSIZ bir satır doğururdu.
 */
export function buildDraftBody(draft: DeliveryNoteDraft): DeliveryNoteDraftBody {
  const blocked = bordroBlockReason(draft.rows);
  if (blocked) throw new Error(blocked);

  const deliveryDate = dayStartIso(draft.dateYmd);
  if (!deliveryDate) throw new Error(DELIVERY_DATE_ERROR);
  // Eksik teslim türü SESSİZCE belge-only gövdeye düşmesin — hareket bekleyen kullanıcı kâğıt alırdı.
  const targetBlocked = draft.target ? targetBlockReason(draft.target) : null;
  if (targetBlocked) throw new Error(targetBlocked);

  // ⚠️ TEKİLLEŞTİR: aynı çek iki kez giderse backend pivotun `@@unique`ine
  // çarpardı. Backend de dedup ediyor (iki katman), ama istemcinin gönderdiği
  // liste ile kâğıttaki adet aynı olmalı ki ekrandaki sayaç yalan söylemesin.
  const chequeIds = [...new Set(draft.rows.map((r) => r.id))];
  const targetLabel = draft.targetLabel.trim();
  const notes = draft.notes.trim();

  return {
    chequeIds,
    deliveryDate,
    ...(draft.target ? targetBodyFields(draft.target) : {}),
    ...(targetLabel ? { targetLabel } : {}),
    ...(notes ? { notes } : {}),
  };
}

/** Kayıt gövdesi — taslağın gövdesi + onay + deneme token'ı (taslak ne gösterdiyse kayıt onu yazar). */
export function buildDeliveryNoteBody(draft: DeliveryNoteDraft): DeliveryNoteBody {
  return {
    ...buildDraftBody(draft),
    // ⚠️ YALNIZ `true` iken gönderilir. Asıl tehlike bu alanı VARSAYILAN `true`
    // yapmaktır — o an uyarı hiç görünmez ve sessiz ikinci belge geri gelir.
    ...(draft.confirmDuplicate === true ? { confirmDuplicate: true } : {}),
    ...(draft.clientToken ? { clientToken: draft.clientToken } : {}),
  };
}

/**
 * Kayıt denemesi düştükten sonra hangi token'la devam edilir. Token yalnız sonucu
 * BELİRSİZ bırakan hatada (ağ · zaman aşımı · 5xx) yapışır — sunucu ilk denemeyi
 * yazmış olabilir ve aynı token ikinci BRD'yi önler. Kesin 4xx'te hiçbir şey
 * yazılmamıştır: yeni deneme yeni token alır.
 */
export function tokenAfterFailure(
  token: string,
  error: unknown,
  gen: () => string = () => crypto.randomUUID(),
): string {
  return isAmbiguousFailure(error) ? token : gen();
}
