// =============================================================================
// GELEN BELGE — MÜŞTERİ (SAHİP) ÖNERİSİ: okunan metinde cari adı (Gülkesim OIE, sözleşme 4)
// =============================================================================
// Aynı boyahane farklı müşterilerin malını getirir (K10) → gönderene göre "hatırlama" yapılmaz; yalnız belgede
// YAZAN ad önerilir. İki kaynak, sırayla: (1) okunan sahip metni (`ownerText`) — eşleme servisinin AYNI sıralayıcısı,
// yalnız sözlük isabeti ya da ≥ 0,95 tek aday; (2) sayfaların tam OCR metni — katlanmış adın çekirdek kelime dizisi
// (şirket eki/gürültü kelimeleri atılmış) bir satırda TAM kelime dizisi olarak geçer; tek çekirdek kelimeli ad bu yolda aday
// DEĞİLDİR ("İSTANBUL TEKSTİL" adres satırında her belgede geçer). Gönderen/düzenleyen (bağlı gönderen, şablon göndereni,
// okunan gönderen alanı, antet satırındaki firma) ve kurulumun kendi firması (`company.name`) aday DEĞİLDİR (adları her
// belgede basılıdır; Takva antetli formda TAKVA önerilmişti). Zayıf ya da birden çok aday → null: istemci boş bırakır. Tam metin
// kaynaklı öneri `source: FULL_TEXT` taşır: istemci onu sahip alanına yazmaz, "bu müşteri mi?" diye sorar.
// Salt okunur; yazmaz, audit'e düşmez.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { FUZZY_NOISE_WORDS } from "../constants/duplicate-rules";
import { foldNameForCompare } from "./helpers/name-normalize.helper";
import { readCompanyName } from "./system-setting.service";
import { suggestCustomer, type Named } from "./gelen-belge-eslestirme.service";
import type { TrustMode } from "./gelen-belge-parti-metre.service";

export interface OwnerSuggestion {
  customerId: string;
  name: string;
  /** Eşleşmenin bulunduğu okunan metin (satır; en çok 160 karakter). */
  matchedText: string;
  /** OWNER_TEXT: okunan sahip alanından (güçlü) · FULL_TEXT: sayfanın tam metninden (istemci onaysız yazmaz). */
  source: "OWNER_TEXT" | "FULL_TEXT";
}

/** Sahip metni önerisinin "çok güçlü" eşiği (eşleme servisinin 0,90 öneri eşiğinden sıkı). */
export const OWNER_TEXT_STRONG = 0.95;
/** Tam metin taramasında çekirdek adın en kısa uzunluğu (tek kelimede daha uzun) — "ali" gibi kısa ad her yerde geçer. */
const CORE_MIN_CHARS = 4;
const CORE_SINGLE_WORD_MIN_CHARS = 5;
/** Tam metin taramasında adın en az çekirdek kelime sayısı — tek kelime (şehir, semt, soyad) her belgede geçebilir. */
const FULL_TEXT_MIN_CORE_WORDS = 2;

/** Saf: katlanmış metni kelime dizisine çevir (harf/rakam dışı ayraç). */
export function wordsOf(text: string): string[] {
  return foldNameForCompare(text).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Saf: adın çekirdek kelimeleri (gürültü/şirket eki atılmış); çok kısaysa boş — aranmaz. */
export function coreWords(name: string): string[] {
  const core = wordsOf(name).filter((w) => !FUZZY_NOISE_WORDS.has(w));
  const chars = core.join("").length;
  if (chars < CORE_MIN_CHARS || (core.length === 1 && chars < CORE_SINGLE_WORD_MIN_CHARS)) return [];
  return core;
}

const containsSeq = (hay: readonly string[], needle: readonly string[]): boolean => {
  if (needle.length === 0 || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

/**
 * Saf: tam metin satırlarında cari arama. Satır gürültü kelimelerinden arındırılır (ad çekirdeğiyle aynı kural).
 * Birden çok cari eşleşirse, çekirdeği başka bir eşleşenin çekirdeğinde geçenler düşer ("AHMET" ⊂ "AHMET YILMAZ");
 * yine de birden çok kalırsa belirsiz → null.
 */
export function findCustomerInText(lines: readonly string[], customers: readonly Named[], excludeIds: ReadonlySet<string>): OwnerSuggestion | null {
  const folded = lines.map((raw) => ({ raw: raw.trim(), words: wordsOf(raw).filter((w) => !FUZZY_NOISE_WORDS.has(w)) })).filter((l) => l.words.length > 0);
  if (folded.length === 0) return null;
  const hits: Array<{ c: Named; core: string[]; line: string }> = [];
  for (const c of customers) {
    if (excludeIds.has(c.id)) continue;
    const core = coreWords(c.name);
    if (core.length < FULL_TEXT_MIN_CORE_WORDS) continue;
    const line = folded.find((l) => containsSeq(l.words, core));
    if (line) hits.push({ c, core, line: line.raw });
  }
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.core.length > h.core.length && containsSeq(o.core, h.core)));
  if (kept.length !== 1) return null;
  const h = kept[0];
  return { customerId: h.c.id, name: h.c.name, matchedText: h.line.slice(0, 160), source: "FULL_TEXT" };
}

/**
 * Saf: adı verilen metinle çekirdek-örtüşen cariler — öneri adayı değil. `both`: çekirdek metnin içinde YA DA metin çekirdeğin
 * içinde (tek ad alanı: firma adı, gönderen alanı); değilse yalnız ilki (serbest satır: "PERDE" satırı her "… Perde" cariyi düşürmesin).
 */
export function namedIn(text: string, customers: readonly Named[], both = true): string[] {
  const own = wordsOf(text).filter((w) => !FUZZY_NOISE_WORDS.has(w));
  if (own.join("").length < CORE_MIN_CHARS) return [];
  return customers.filter((c) => {
    const core = coreWords(c.name);
    return core.length > 0 && (containsSeq(own, core) || (both && containsSeq(core, own)));
  }).map((c) => c.id);
}

/** Kurulumun kendi firması sayılan cariler (`company.name` ile çekirdek örtüşmesi). */
export const ownCompanyIds = (companyName: string, customers: readonly Named[]) => namedIn(companyName, customers);

/** Antet: sayfa metninin ilk iki dolu satırı — belgeyi düzenleyen firmanın adı. Muhatap satırı ("Sayın", "Alıcı") antet değildir. */
const LETTERHEAD_LINES = 2;
const ADDRESSEE_WORDS = new Set(["sayin", "alici", "musteri", "teslim", "adi", "unvani"]);

/** Saf: sayfa metinlerinden antet satırları (muhatap etiketli satır atlanır). */
export function letterheadLines(pages: readonly string[][]): string[] {
  return pages.flatMap((lines) => lines.map((l) => l.trim()).filter(Boolean).slice(0, LETTERHEAD_LINES)
    .filter((l) => !wordsOf(l).some((w) => ADDRESSEE_WORDS.has(w))));
}

/**
 * Saf: belgeyi GÖNDEREN/DÜZENLEYEN cariler — bağlı gönderen, şablonun göndereni, okunan gönderen alanı (`senderText`) ve
 * antet satırlarında adı geçen cari. Mal sahibi gönderen değildir (K10) → bunlar sahip önerisi olamaz.
 */
export function senderIds(head: { senderCustomerId: string | null; templateSenderId: string | null; senderText: string | null }, pages: readonly string[][], customers: readonly Named[]): string[] {
  return [head.senderCustomerId, head.templateSenderId, ...(head.senderText ? namedIn(head.senderText, customers) : []),
    ...letterheadLines(pages).flatMap((l) => namedIn(l, customers, false))].filter((x): x is string => !!x);
}

/** Notun okunmuş sayfalarının tam OCR metni, sayfa (tarama) başına satırlar (yalnız JSON alt yolu çekilir). */
async function readOcrPages(noteId: string): Promise<string[][]> {
  const rows = await prisma.$queryRaw<Array<{ text: string | null }>>(Prisma.sql`
    SELECT "ocrResult"->'ocr'->>'text' AS text FROM "document_scans"
    WHERE "noteId" = ${noteId}::uuid AND "status" = 'READ' AND "ocrResult" IS NOT NULL
    ORDER BY "pageNo" ASC, "regionNo" ASC NULLS FIRST, "createdAt" ASC`);
  return rows.flatMap((r) => (typeof r.text === "string" ? [r.text.split(/\r?\n/)] : []));
}

/** Okunan müşteri adı kayıtlı bir cariye çözülemedi: istemci "kayıtlı değil / bunu mu demek istediniz?" diye sorar. */
export interface OwnerUnmatched {
  /** Belgeden okunan müşteri adı (sahip alanı; müşteri adı tavanında kesilir). */
  text: string;
  /** Benzer aktif cariler (eşleme sıralayıcısı, ≥ `MATCH_LIST_THRESHOLD`), puana göre azalan; en çok `UNMATCHED_MAX`. */
  candidates: Array<{ customerId: string; name: string; score: number }>;
}

/** "Bunu mu demek istediniz?" listesinin tavanı (tablet modalı tek ekranda gösterir). */
export const UNMATCHED_MAX = 3;
/** Müşteri adı kolonunun tavanı (`Customer.name` VarChar(100)). */
const CUSTOMER_NAME_MAX = 100;
/** Katlanmış adın en kısa uzunluğu — 1-2 harfli okuma gürültüdür, kayıt teklif edilmez. */
const UNMATCHED_MIN_CHARS = 3;

export interface OwnerReading {
  suggestion: OwnerSuggestion | null;
  unmatched: OwnerUnmatched | null;
}

/**
 * Taslağın sahip önerisi. Yalnız sahibi seçilmemiş TASLAKTA hesaplanır (seçilmişse/onaylıysa null — öneri anlamsız,
 * detay yanıtı cari kataloğunu her açılışta taramasın).
 */
export async function suggestOwnerForNote(note: { id: string; status: string; ownerCustomerId: string | null }, trust: TrustMode = "NORMAL"): Promise<OwnerSuggestion | null> {
  return (await readOwnerForNote(note, trust)).suggestion;
}

/**
 * Öneri + çözülemeyen okuma TEK geçişte (katalog bir kez yüklenir). `unmatched` yalnız öneri yokken ve sahip metni
 * okunduysa dolar; BLIND'de ikisi de yok (sözlük tahmini forma dolmaz). Benzerlik eşleme servisinin sıralayıcısıdır.
 */
export async function readOwnerForNote(note: { id: string; status: string; ownerCustomerId: string | null }, trust: TrustMode = "NORMAL"): Promise<OwnerReading> {
  const none: OwnerReading = { suggestion: null, unmatched: null };
  // K30-B BLIND (SORMA + tanıtılmamış): sözlük tahmini forma dolmaz → öneri yok.
  if (note.status !== "DRAFT" || note.ownerCustomerId || trust === "BLIND") return none;
  const head = await prisma.customerDeliveryNote.findUnique({ where: { id: note.id }, select: { ownerText: true, senderText: true, senderCustomerId: true, template: { select: { senderCustomerId: true } } } });
  if (!head) return none;
  const customers: Named[] = await prisma.customer.findMany({ where: { isActive: true, mergedIntoId: null }, select: { id: true, code: true, name: true } });
  const pages = await readOcrPages(note.id);
  const sent = { senderCustomerId: head.senderCustomerId, templateSenderId: head.template?.senderCustomerId ?? null, senderText: head.senderText };
  const exclude = new Set([...senderIds(sent, pages, customers), ...ownCompanyIds(await readCompanyName(), customers)]);
  const ownerText = head.ownerText?.trim();
  const s = ownerText ? await suggestCustomer(ownerText, head.senderCustomerId, customers) : null;
  if (ownerText && s) {
    const hit = s.suggested;
    // TRUSTED: tanıtılan müşteri alanı eşleyicinin TEK müşterisine (`suggested`) çözüldüyse kesin; gönderen/kendi firma yine dışarıda.
    if (hit && !exclude.has(hit.id) && (trust === "TRUSTED" || s.source === "ALIAS" || hit.score >= OWNER_TEXT_STRONG)) {
      return { suggestion: { customerId: hit.id, name: hit.name, matchedText: ownerText.slice(0, 160), source: "OWNER_TEXT" }, unmatched: null };
    }
  }
  // TRUSTED'da tam metin taraması ("… mi? Seç") yapılmaz: çözülemeyen müşteri boş kalır, seçici açık.
  const suggestion = trust === "TRUSTED" ? null : findCustomerInText([...(ownerText ? [ownerText] : []), ...pages.flat()], customers, exclude);
  if (suggestion || !ownerText || !s || foldNameForCompare(ownerText).length < UNMATCHED_MIN_CHARS) return { suggestion, unmatched: null };
  return { suggestion: null, unmatched: unmatchedOf(ownerText, [...(s.suggested ? [s.suggested] : []), ...s.list]) };
}

/** Saf: çözülemeyen okumanın teklifi — adaylar tekilleşir, puana göre ilk `UNMATCHED_MAX`. */
export function unmatchedOf(text: string, ranked: ReadonlyArray<{ id: string; name: string; score: number }>): OwnerUnmatched {
  const seen = new Set<string>();
  const candidates = [...ranked].sort((a, b) => b.score - a.score)
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .slice(0, UNMATCHED_MAX)
    .map((c) => ({ customerId: c.id, name: c.name, score: c.score }));
  return { text: text.slice(0, CUSTOMER_NAME_MAX), candidates };
}
