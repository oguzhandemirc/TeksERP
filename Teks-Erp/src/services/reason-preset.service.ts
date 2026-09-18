// =============================================================================
// HAZIR SEBEP KATALOĞU — SERVİS (2026-08-19)
// =============================================================================
// Dört listeyi (fire · kayıt düzeltmesi · elle top ekleme · top iptali) fabrika
// kendi diliyle düzenleyebilsin diye satırlar DB'de yaşar; sistem varsayılanı
// `constants/reason-presets.ts`te kalır ve her boot'ta uzlaştırılır.
//
// ── SENKRON ÖNBELLEK, ve neden ─────────────────────────────────────────────
// Sapma doğrulaması (`validateVarianceReason`) transaction İÇİNDE ve SENKRON
// çağrılıyor (`roll-variance.helper`). Doğrulamayı async DB okumasına çevirmek,
// tx içine ekstra bir round-trip koymak demekti (perf kuralı 10: tx kısa kalır).
// Bu yüzden katalog modül-düzeyi bir önbellekte tutulur:
//   • boot'ta uzlaştırmadan SONRA doldurulur,
//   • her yazma işlemi kendi sürecinin önbelleğini ANINDA tazeler,
//   • TTL yalnız ikinci bir yazar (ör. ayrı bir script) ihtimaline karşı.
// Önbellek HİÇ doldurulmadıysa doğrulama kod kataloğuna düşer — yani "DB henüz
// okunmadı" durumu operatörü sebepsiz bırakmaz.
//
// ⚠️ TTL DOLMASI ÖNBELLEĞİ DÜŞÜRMEZ — bayat liste de döner ve arka planda bir
// tazeleme tetiklenir (`cachedRows` üstündeki 2026-08-26 notu). Eski davranış
// (bayat → `null` → kod kataloğu) fabrikanın PANELDEN EKLEDİĞİ her sebebi
// geçersiz kılıyordu; "taze ya da hiç" burada yanlış takastır.
//
// ⚠️ DOĞRULAMA GİZLİ SATIRI DA KABUL EDER. Liste ucu yalnız aktifleri döner ama
// tablette bayat liste taşıyan bir APK gizlenmiş kodu gönderebilir; onu 400'e
// düşürmek vardiya ortasında "Bitir"i kırardı (LEGACY_REASON_CODE ile aynı
// gerekçe). Gizleme bir GÖRÜNÜRLÜK kararıdır, geçerlilik kararı değil.
// =============================================================================

import { MachineStopLossClass, Prisma, ReasonPresetKind, RollVarianceKind } from "@prisma/client";
import { TAMBUR_UNDO_CANCEL_CODE, TAMBUR_UNDO_CANCEL_TEXT, QUICK_PICK_COUNT, QUICK_PICK_KINDS } from "../constants/reason-presets";

import prisma from "../lib/prisma";
import {
  REASON_PRESET_CATALOG,
  REASON_PRESET_KINDS,
  KIND_STORES_TEXT,
  slugifyReasonCode,
} from "../constants/reason-presets";
import { registerReasonCatalogSource } from "../constants/variance-reasons";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { foldNameForCompare } from "./helpers/name-normalize.helper";

export type ReasonPresetDto = {
  id: string;
  kind: ReasonPresetKind;
  code: string;
  label: string;
  fullText: string | null;
  requiresText: boolean;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  /** Eski adlar (salt-okunur; `update()` yazar) — çözücünün ikinci sözlüğü. */
  legacyTexts: string[];
  /** Yalnız `MACHINE_STOP`ta dolu (zorunlu, `MINOR` olamaz); diğer kind'lerde NULL. */
  stopLossClass: MachineStopLossClass | null;
};

/** Liste satırı: DTO + türetilmiş `quickPick` (E7) — kolon değil, sıralamadan (`markQuickPicks`). */
export type ReasonPresetListRow = ReasonPresetDto & { quickPick: boolean };

/**
 * `quickPick` işaretini türetir (saf): `QUICK_PICK_KINDS` içindeki her kind için AKTİF satırlardan `sortOrder`
 * (ardından `createdAt`, liste sırası) sırasına göre ilk `QUICK_PICK_COUNT` tanesi true; pasif satır hiç, öteki
 * kind'ler hiç. Satırlar zaten `kind, sortOrder, createdAt` sıralı gelir; yine de kind başına sayılır.
 */
export function markQuickPicks<T extends Pick<ReasonPresetDto, "kind" | "isActive">>(rows: readonly T[]): Array<T & { quickPick: boolean }> {
  const used = new Map<ReasonPresetKind, number>();
  return rows.map((r) => {
    if (!r.isActive || !QUICK_PICK_KINDS.includes(r.kind)) return { ...r, quickPick: false };
    const n = used.get(r.kind) ?? 0;
    used.set(r.kind, n + 1);
    return { ...r, quickPick: n < QUICK_PICK_COUNT };
  });
}

const SELECT = {
  id: true,
  kind: true,
  code: true,
  label: true,
  fullText: true,
  requiresText: true,
  sortOrder: true,
  isActive: true,
  isSystem: true,
  legacyTexts: true,
  stopLossClass: true,
} satisfies Prisma.ReasonPresetSelect;

/** Eski-ad listesinin üst sınırı — en eskisi düşer (sınırsız dizi = sınırsız satır). */
const LEGACY_TEXTS_MAX = 20;

/**
 * Etiket/metin değişiminde eski-ad listesini türetir: önceki değerler EKLENİR,
 * güncel label/fullText'e katlanmış-eşit olanlar ve tekrarlar TEMİZLENİR, en yeni
 * `LEGACY_TEXTS_MAX` kalır. Saf fonksiyon — bekçi doğrudan ölçer.
 */
export function nextLegacyTexts(
  current: { label: string; fullText: string | null; legacyTexts: string[] },
  next: { label: string; fullText: string | null },
): string[] {
  const currentFolds = new Set([foldNameForCompare(next.label), ...(next.fullText ? [foldNameForCompare(next.fullText)] : [])]);
  const candidates = [...current.legacyTexts, current.label, ...(current.fullText ? [current.fullText] : [])];
  const seen = new Set<string>();
  const out: string[] = [];
  // Sondan başa: en YENİ eski ad korunur, tekrar edenin eskisi düşer.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const t = candidates[i].trim();
    if (!t) continue;
    const f = foldNameForCompare(t);
    if (!f || currentFolds.has(f) || seen.has(f)) continue;
    seen.add(f);
    out.unshift(t);
  }
  return out.slice(-LEGACY_TEXTS_MAX);
}

// ── ÖNBELLEK ────────────────────────────────────────────────────────────────
/** Kind → TÜM satırlar (gizliler DAHİL — doğrulama onları da tanımalı). */
let cache: Map<ReasonPresetKind, ReasonPresetDto[]> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

/** Arka plan tazelemesi uçuşta mı (aynı anda iki okuma DB'yi iki kez yoklamasın). */
let backgroundRefresh: Promise<void> | null = null;
/** Tazeleme DÜŞTÜYSE bu ana kadar yeniden denenmez (DB kapalıyken her okuma yoklamasın). */
let refreshBlockedUntil = 0;
const REFRESH_RETRY_MS = 5_000;

function cacheIsFresh(): boolean {
  return cache !== null && Date.now() - cachedAt < CACHE_TTL_MS;
}

/** Önbelleği DB'den tazeler. Boot'ta ve her yazmadan sonra çağrılır. */
export async function refreshReasonPresetCache(): Promise<void> {
  const rows = await prisma.reasonPreset.findMany({
    select: SELECT,
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const next = new Map<ReasonPresetKind, ReasonPresetDto[]>();
  for (const kind of REASON_PRESET_KINDS) next.set(kind, []);
  for (const row of rows) next.get(row.kind)?.push(row);
  cache = next;
  cachedAt = Date.now();
  refreshBlockedUntil = 0;
}

/**
 * Bayatlamış önbelleği ARKA PLANDA tazeler — çağıranı BEKLETMEZ.
 *
 * ⚠️ `refreshReasonPresetCache`'i bu kapıdan geçirmiyoruz: yazma işlemleri
 * (`create`/`update`/…) kendi yazdıklarını GÖRMEK zorunda, uçuştaki eski bir
 * okumaya iliştirilemezler. Tekilleştirme yalnız arka plan tazelemesine ait.
 */
function scheduleBackgroundRefresh(): void {
  if (backgroundRefresh || Date.now() < refreshBlockedUntil) return;
  backgroundRefresh = refreshReasonPresetCache()
    .catch(() => {
      // DB okunamadı — ELDEKİ liste korunur (bu fonksiyonun tüm varlık sebebi).
      // Kısa bir bekleme koy ki DB kapalıyken her doğrulama yeni bir sorgu açmasın.
      refreshBlockedUntil = Date.now() + REFRESH_RETRY_MS;
    })
    .finally(() => {
      backgroundRefresh = null;
    });
}

/**
 * ⚠️ YALNIZ BEKÇİ İÇİN — önbelleği BAYATLATIR: satırlar yerinde DURUR, yalnız yaşı
 * geçer. `invalidateReasonPresetCache` ile KARIŞTIRMA — o satırları da düşürür ve
 * 2026-08-26 arızasının ölçülmesi gereken hâlini (liste ELDE ama BAYAT) hiç
 * kurmaz. Bekçi bu ikisini ayırmazsa düzeltmeyi değil başka bir şeyi ölçer.
 */
export function expireReasonPresetCacheForTest(): void {
  cachedAt = 0;
}

/** Test/araç kaçışı — önbelleği geçersiz kılar (bir sonraki okuma DB'ye gider). */
export function invalidateReasonPresetCache(): void {
  cache = null;
  cachedAt = 0;
  refreshBlockedUntil = 0;
}

/**
 * Senkron okuma — BAYAT LİSTE DE DÖNER, yaşı yüzünden `null`'a düşmez.
 * ⚠️ Burada DB okumaya KALKMA: fonksiyon tx içinden senkron çağrılıyor.
 *
 * ── NEDEN "BAYAT AMA VAR" > "TAZE YA DA HİÇ" (2026-08-26, saha arızası) ─────
 * Eskiden TTL dolunca burası `null` dönüyordu ve doğrulama KOD kataloğuna
 * düşüyordu. Kod kataloğunda yalnız SİSTEM satırları var — yani fabrikanın
 * PANELDEN EKLEDİĞİ her sebep, önbelleğin tazelendiği 60 saniyelik pencerenin
 * dışında GEÇERSİZ oluyordu. Sahadaki görünümü tam olarak şuydu: Tambur'da
 * "Kayıt düzeltmesi" hazır seçeneklerle çalışıyor, fabrikanın kendi eklediği
 * sebeple "tamamlanmadı — sunucu hatası" veriyordu. Önbelleği yalnız yazmalar
 * tazelediği için pencere pratikte hiç açılmıyordu.
 *
 * TTL'in işi TAZELİK'tir, GEÇERLİLİK değil: 60 sn önce okunmuş bir liste,
 * hiç okunmamış bir listeden her koşulda daha doğrudur. Bayatlık artık okumayı
 * düşürmez, arka planda bir tazeleme TETİKLER (`scheduleBackgroundRefresh`).
 */
function cachedRows(kind: ReasonPresetKind): ReasonPresetDto[] | null {
  if (!cacheIsFresh()) scheduleBackgroundRefresh();
  const rows = cache?.get(kind);
  // Boş dizi ile "hiç okunmadı" AYRI şeylerdir: uzlaştırma koşmuş ve fabrika
  // her satırı gizlemiş olabilir. Yine de boş katalog doğrulamayı kilitlerdi,
  // bu yüzden boş → kod kataloğuna düş.
  return rows && rows.length > 0 ? rows : null;
}

// ── SEBEP KODU ÇÖZÜCÜ — METİN SAKLAYAN İKİ KIND (2026-08-21) ────────────────
// ROLL_MANUAL_ENTRY / ROLL_CANCEL'da istemci bugün yalnız METİN gönderiyor
// (`fullText ?? label`); satır 2026-08-21'den beri KOD da taşıyor
// (`Roll.entryReasonCode` / `cancelReasonCode`, rapor anahtarı). Kodu SUNUCU çözer:
//   • açık `reasonCode` geldiyse katalogda doğrulanır (GİZLİ satır da kabul —
//     dosya başlığındaki gerekçe), bilinmiyorsa 400 `REASON_CODE_INVALID`;
//   • yoksa metin, kataloğun label VEYA fullText'iyle KATLANMIŞ eşlenir
//     (`foldNameForCompare`: "yanlış metraj girildi" ≡ "Yanlış metraj girildi");
//   • eşleşmezse NULL — serbest metne kod UYDURULMAZ.
// Bu sayede APK değişmeden ilk günden kod dolar; istemci ileride kodu açıkça
// gönderince de aynı kapıdan geçer (⚠️ çevrimdışı zemin kodları `BUILTIN_*`
// gerçek kod DEĞİL — istemci onları göndermemeli, sunucu türetir).
//
// ASYNC'tir ve tx DIŞINDA çağrılır: önbellek bayatsa DB'ye gider. Variance yolunun
// senkron kapısına (`validateVarianceReason`) DOKUNMAZ — o kendi semantiğiyle kalır.

/** Yalnız metin saklayan iki kind — diğerleri `validateVarianceReason`'dan geçer. */
/**
 * METİN SAKLAYAN kind'lar — `KIND_STORES_TEXT`ten TÜRETİLİR, elle yazılmaz.
 *
 * Eskiden burada elle bir union vardı (`"ROLL_MANUAL_ENTRY" | "ROLL_CANCEL"`) ve
 * o tablonun ikiziydi. İki liste sessizce ayrışabilirdi: yeni bir kind'ı
 * `KIND_STORES_TEXT`te true yapıp buraya eklemeyi unutan kişi, `resolveReasonCode`
 * çağrısında anlamsız bir tip hatası alır ve çözümü genelde "cast" olur —
 * o noktadan sonra kod sessizce yanlış kind'ı okur. Türetince ikizlik biter.
 */
export type TextReasonKind = {
  [K in ReasonPresetKind]: (typeof KIND_STORES_TEXT)[K] extends true ? K : never;
}[ReasonPresetKind];

type ReasonRow = { code: string; label: string; fullText: string | null; legacyTexts: string[] };

/** Kind'ın satırları: taze önbellek → DB tazeleme → (DB boşsa) kod kataloğu. */
async function rowsForTextKind(kind: TextReasonKind): Promise<ReasonRow[]> {
  if (!cacheIsFresh()) {
    try {
      await refreshReasonPresetCache();
    } catch {
      // DB yoklaması düştü — ELDEKİ (bayat) liste korunur. Hiç yoksa aşağıda kod
      // kataloğuna düşülür. Anlık bir DB tökezlemesi, fabrikanın eklediği sebebi
      // "geçersiz kod" (400) yapmamalı — senkron kapıyla aynı gerekçe.
    }
  }
  const rows = cache?.get(kind);
  if (rows && rows.length > 0) return rows;
  // Uzlaştırma henüz koşmamış (boş DB) → kod kataloğu; doğrulama operatörü kilitlemez.
  return REASON_PRESET_CATALOG[kind].map((s) => ({
    code: s.code,
    label: s.label,
    fullText: s.fullText ?? null,
    legacyTexts: [],
  }));
}

/**
 * Metin → kod. SIRA: ① güncel `fullText`/`label` katlanmış eşitlik → ② ESKİ ADLAR
 * (`legacyTexts` — etiket düzenlenmiş, bayat listeli tablet eski metni gönderiyor)
 * → ③ null. Gizli satır da eşleşir (kod geçerliliği görünürlükten bağımsız).
 * ⚠️ Eski adda BELİRSİZLİK (iki satır aynı eski adı taşıyor) → kod UYDURULMAZ, null.
 * Güncel ad her zaman eski addan ÖNCE gelir: B'nin bugünkü adı A'nın dünkü adıysa
 * operatörün gördüğü B'dir.
 */
export async function resolveReasonCodeFromText(
  kind: TextReasonKind,
  text: string | null | undefined,
): Promise<string | null> {
  const folded = text ? foldNameForCompare(text) : "";
  if (!folded) return null;
  const rows = await rowsForTextKind(kind);
  const hit = rows.find(
    (r) =>
      foldNameForCompare(r.fullText ?? r.label) === folded || foldNameForCompare(r.label) === folded,
  );
  if (hit) return hit.code;
  const legacyHits = rows.filter((r) => r.legacyTexts.some((t) => foldNameForCompare(t) === folded));
  return legacyHits.length === 1 ? legacyHits[0].code : null;
}

/** Açık kod: katalogda yoksa 400. Dönüşte satırın metni de var (metin boş gelirse dolsun). */
export async function assertKnownReasonCode(
  kind: TextReasonKind,
  code: string,
): Promise<{ code: string; text: string }> {
  const trimmed = code.trim();
  // SİSTEM KODLARI: hiçbir seçicide çıkmaz ama geçerlidir (`SHRINK_REASON_CODE`
  // emsali). Operatör bunları seçemez; sistem yazar.
  if (trimmed === TAMBUR_UNDO_CANCEL_CODE) {
    return { code: TAMBUR_UNDO_CANCEL_CODE, text: TAMBUR_UNDO_CANCEL_TEXT };
  }
  const rows = await rowsForTextKind(kind);
  const hit = rows.find((r) => r.code === trimmed);
  if (!hit) {
    throw AppError.badRequest(
      `Geçersiz sebep kodu: ${trimmed} (geçerli: ${rows.map((r) => r.code).join(", ")})`,
      { code: "REASON_CODE_INVALID" },
    );
  }
  return { code: hit.code, text: hit.fullText ?? hit.label };
}

/**
 * Birleşik çözüm: `{ reasonCode?, reasonText? }` → `{ code, text }`.
 * Kod varsa doğrulanır ve metin boşsa satırın metniyle doldurulur (görünen
 * kayıt NULL kalıp kod dolu olmasın); kod yoksa metinden türetilir.
 * ⚠️ `text` çağıranın metnidir, kesilmez — uzunluk kuralı yazma noktasının işi.
 */
export async function resolveReasonCode(
  kind: TextReasonKind,
  input: { reasonCode?: string | null; reasonText?: string | null },
): Promise<{ code: string | null; text: string | null }> {
  const text = input.reasonText?.trim() || null;
  const explicit = input.reasonCode?.trim() || null;
  if (explicit) {
    const known = await assertKnownReasonCode(kind, explicit);
    return { code: known.code, text: text ?? known.text };
  }
  return { code: await resolveReasonCodeFromText(kind, text), text };
}

// Doğrulama kapısını (constants/variance-reasons) DB'ye bağlar. Bağımlılık yönü
// korunur: sabitler servisi import ETMEZ, servis kendini KAYDETTİRİR.
/**
 * Sapma türü → hazır sebep listesi. OVERAGE'ın listesi YOKTUR (aşımı sistem
 * tespit eder, operatör beyan etmez) — `null` döner ve doğrulama sebep sormaz.
 */
function kindOfVariance(kind: RollVarianceKind): ReasonPresetKind | null {
  if (kind === RollVarianceKind.SCRAP) return ReasonPresetKind.ROLL_SCRAP;
  if (kind === RollVarianceKind.RECORD_CORRECTION) return ReasonPresetKind.ROLL_RECORD_CORRECTION;
  return null;
}

registerReasonCatalogSource({
  reasons(varianceKind) {
    const kind = kindOfVariance(varianceKind);
    if (!kind) return null;
    const rows = cachedRows(kind);
    if (!rows) return null;
    return rows
      .filter((r) => r.isActive)
      .map((r) => ({ code: r.code, label: r.label, requiresText: r.requiresText }));
  },
  find(varianceKind, code) {
    const kind = kindOfVariance(varianceKind);
    if (!kind) return null;
    const rows = cachedRows(kind);
    if (!rows) return null;
    // Gizli satır da bulunur — bkz. dosya başlığı.
    const hit = rows.find((r) => r.code === code);
    return hit
      ? { code: hit.code, label: hit.label, requiresText: hit.requiresText }
      : undefined;
  },
});

// ── OKUMA ───────────────────────────────────────────────────────────────────
export const ReasonPresetService = {
  /**
   * Listeleme. `includeInactive` yalnız DÜZENLEME yüzeyi içindir; operatör
   * ekranları aktifleri alır (gizlenen satır orada çizilmemeli).
   */
  async list(params: {
    kind?: ReasonPresetKind;
    includeInactive?: boolean;
  }): Promise<ReasonPresetListRow[]> {
    const rows = await prisma.reasonPreset.findMany({
      where: {
        ...(params.kind ? { kind: params.kind } : {}),
        ...(params.includeInactive ? {} : { isActive: true }),
      },
      select: SELECT,
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    // E7: hızlı sebep işareti türetilir (kolon yok) — pasif satırlar sayıma girmez, `includeInactive` sonucu değiştirmez.
    return markQuickPicks(rows);
  },

  async create(
    input: {
      kind: ReasonPresetKind;
      label: string;
      fullText?: string | null;
      requiresText?: boolean;
      stopLossClass?: MachineStopLossClass | null;
    },
    userId?: string,
  ): Promise<ReasonPresetDto> {
    const label = input.label.trim();
    if (!label) throw new AppError("Etiket boş olamaz", 400);
    const stopLossClass = resolveStopLossClass(input.kind, input.stopLossClass);

    const code = await nextFreeCode(input.kind, slugifyReasonCode(label));
    const sortOrder = await nextSortOrder(input.kind);
    const row = await prisma.reasonPreset.create({
      data: {
        kind: input.kind,
        code,
        label,
        // Metin saklayan listelerde sunucuya giden metin = etiketin kendisi
        // (operatör ayrıca uzun cümle yazmadıysa). Kod saklayan listelerde NULL.
        fullText: resolveFullText(input.kind, input.fullText, label),
        requiresText: input.requiresText ?? false,
        stopLossClass,
        sortOrder,
        isSystem: false,
        createdById: userId ?? null,
        updatedById: userId ?? null,
      },
      select: SELECT,
    });
    await refreshReasonPresetCache();
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "reason_presets",
      recordId: row.id,
      newData: { ...row },
    });
    return row;
  },

  /**
   * Düzenleme. ⚠️ `code` ve `kind` BURADA DEĞİŞMEZ — kod rapor anahtarıdır;
   * düzenlenebilir olsaydı "Top başı" adını düzelten operatör altı aylık fire
   * kırılımını ikiye bölerdi.
   */
  async update(
    id: string,
    input: {
      label?: string;
      fullText?: string | null;
      requiresText?: boolean;
      isActive?: boolean;
      stopLossClass?: MachineStopLossClass | null;
    },
    userId?: string,
  ): Promise<ReasonPresetDto> {
    const current = await prisma.reasonPreset.findUnique({ where: { id }, select: SELECT });
    if (!current) throw new AppError("Hazır sebep bulunamadı", 404);

    if (input.isActive === false) await assertNotLastActive(current.kind, id);
    // Sınıf katalogda düzeltilebilir; açılmış duruşlardaki kopya DONUK kalır (şema notu).
    const stopLossClass =
      input.stopLossClass !== undefined ? resolveStopLossClass(current.kind, input.stopLossClass) : undefined;

    const label = input.label?.trim();
    if (input.label !== undefined && !label) throw new AppError("Etiket boş olamaz", 400);

    // Etiket/metin değişiyorsa önceki değerler ESKİ ADLAR listesine düşer — bayat
    // listeli tablet eski metni göndermeye devam eder, kod düşmesin (şema notu).
    const nextLabel = label ?? current.label;
    const nextFullText =
      input.fullText !== undefined || label
        ? resolveFullText(current.kind, input.fullText, nextLabel)
        : current.fullText;
    const textChanged = nextLabel !== current.label || (nextFullText ?? null) !== (current.fullText ?? null);
    const legacyTexts = textChanged
      ? nextLegacyTexts(current, { label: nextLabel, fullText: nextFullText ?? null })
      : current.legacyTexts;

    const row = await prisma.reasonPreset.update({
      where: { id },
      data: {
        ...(label ? { label } : {}),
        ...(input.fullText !== undefined || label ? { fullText: nextFullText } : {}),
        ...(textChanged ? { legacyTexts } : {}),
        ...(input.requiresText !== undefined ? { requiresText: input.requiresText } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(stopLossClass !== undefined ? { stopLossClass } : {}),
        updatedById: userId ?? null,
      },
      select: SELECT,
    });
    await refreshReasonPresetCache();
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "reason_presets",
      recordId: id,
      oldData: { ...current },
      newData: { ...row },
    });
    return row;
  },

  /**
   * ÇOĞALTMA — mevcut satırdan yeni bir sebep türetir. Kopya SİSTEM DEĞİLDİR
   * (fabrikanın satırı olur) ve kaynağın hemen ALTINA yerleşir: operatör
   * çoğalttığı satırı listenin dibinde aramaz.
   */
  async duplicate(id: string, label: string | undefined, userId?: string): Promise<ReasonPresetDto> {
    const src = await prisma.reasonPreset.findUnique({ where: { id }, select: SELECT });
    if (!src) throw new AppError("Hazır sebep bulunamadı", 404);

    const newLabel = (label ?? `${src.label} (kopya)`).trim();
    if (!newLabel) throw new AppError("Etiket boş olamaz", 400);

    const code = await nextFreeCode(src.kind, slugifyReasonCode(newLabel));
    const row = await prisma.$transaction(async (tx) => {
      // Kaynaktan SONRAKİ satırları bir kaydır — sıra tam-sayı kalır.
      await tx.reasonPreset.updateMany({
        where: { kind: src.kind, sortOrder: { gt: src.sortOrder } },
        data: { sortOrder: { increment: 1 } },
      });
      return tx.reasonPreset.create({
        data: {
          kind: src.kind,
          code,
          label: newLabel,
          fullText: resolveFullText(src.kind, undefined, newLabel),
          requiresText: src.requiresText,
          // Sınıf kaynaktan kopyalanır — kopyalanmazsa MACHINE_STOP kopyası DB CHECK'e düşerdi.
          stopLossClass: src.stopLossClass,
          sortOrder: src.sortOrder + 1,
          isSystem: false,
          createdById: userId ?? null,
          updatedById: userId ?? null,
        },
        select: SELECT,
      });
    });
    await refreshReasonPresetCache();
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "reason_presets",
      recordId: row.id,
      newData: { ...row, duplicatedFrom: src.code },
    });
    return row;
  },

  /** Sıralama — istemci TÜM listenin id'lerini sırasıyla gönderir. */
  async reorder(kind: ReasonPresetKind, ids: string[], userId?: string): Promise<ReasonPresetDto[]> {
    const rows = await prisma.reasonPreset.findMany({ where: { kind }, select: { id: true } });
    const known = new Set(rows.map((r) => r.id));
    // Eksik/yabancı id → REDDET. Kısmi sıralama, gönderilmeyen satırları
    // sessizce listenin başına toplardı.
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new AppError("Sıralama listesi eksik veya yabancı kayıt içeriyor", 400);
    }
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.reasonPreset.update({
          where: { id },
          data: { sortOrder: i, updatedById: userId ?? null },
          select: { id: true },
        }),
      ),
    );
    await refreshReasonPresetCache();
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "reason_presets",
      recordId: kind,
      newData: { kind, order: ids },
    });
    return this.list({ kind, includeInactive: true });
  },
};

// ── Yardımcılar ─────────────────────────────────────────────────────────────

/**
 * Metin saklayan listelerde (`ROLL_MANUAL_ENTRY` / `ROLL_CANCEL`) sunucuya giden
 * tam metin; kod saklayanlarda NULL. Açıkça metin verilmediyse etiket kullanılır
 * — "kısa etiket + uzun metin" ayrımı yalnız iptal listesinde anlamlı ve orada
 * da isteğe bağlı.
 */
function resolveFullText(
  kind: ReasonPresetKind,
  given: string | null | undefined,
  label: string,
): string | null {
  if (!KIND_STORES_TEXT[kind]) return null;
  const text = given?.trim();
  return text || label;
}

/**
 * Kayıp sınıfı yalnız `MACHINE_STOP`un alanıdır: orada ZORUNLU ve `MINOR` olamaz
 * (MINOR süre sınıfıdır, sebep sınıfı değil); başka kind'de verilmesi REDDEDİLİR.
 * Birincil doğrulama burada (Türkçe mesaj), `reason_presets_machine_class_chk` ikinci hat.
 */
function resolveStopLossClass(
  kind: ReasonPresetKind,
  given: MachineStopLossClass | null | undefined,
): MachineStopLossClass | null {
  if (kind !== ReasonPresetKind.MACHINE_STOP) {
    if (given) {
      throw AppError.badRequest("Kayıp sınıfı yalnız tezgah duruşu sebeplerinde girilir", {
        code: "STOP_LOSS_CLASS_NOT_APPLICABLE",
        kind,
      });
    }
    return null;
  }
  if (!given) {
    throw AppError.badRequest("Tezgah duruşu sebebi için kayıp sınıfı zorunlu", {
      code: "STOP_LOSS_CLASS_REQUIRED",
    });
  }
  if (given === MachineStopLossClass.MINOR) {
    throw AppError.badRequest("Mikro (MINOR) bir süre sınıfıdır, sebebe verilemez", {
      code: "STOP_LOSS_CLASS_MINOR",
    });
  }
  return given;
}

/** `kind` içinde boş bir kod bulur (çakışırsa `_2`, `_3` … ekler). */
async function nextFreeCode(kind: ReasonPresetKind, base: string): Promise<string> {
  const existing = await prisma.reasonPreset.findMany({
    where: { kind, code: { startsWith: base } },
    select: { code: true },
  });
  const taken = new Set(existing.map((r) => r.code));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new AppError("Kod üretilemedi — aynı adda çok fazla sebep var", 400);
}

async function nextSortOrder(kind: ReasonPresetKind): Promise<number> {
  const last = await prisma.reasonPreset.findFirst({
    where: { kind },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}

/**
 * ⚠️ SON AKTİF SATIR GİZLENEMEZ. Fire/kayıt düzeltmesi kararında sebep ZORUNLU
 * — liste boşalırsa operatör "Kaydet"e hiç basamaz ve Tambur'da mal kilitlenir.
 * Diğer iki listede sebep opsiyonel ama boş liste yine anlamsız bir ekran verir.
 */
async function assertNotLastActive(kind: ReasonPresetKind, id: string): Promise<void> {
  const activeCount = await prisma.reasonPreset.count({
    where: { kind, isActive: true, id: { not: id } },
  });
  if (activeCount === 0) {
    throw new AppError(
      "Son aktif sebep gizlenemez — liste boş kalırsa operatör sebep seçemez",
      400,
    );
  }
}

/** Katalogda kaç sistem satırı var (bekçi/teşhis için). */
export function systemPresetCount(): number {
  return REASON_PRESET_KINDS.reduce((n, k) => n + REASON_PRESET_CATALOG[k].length, 0);
}
