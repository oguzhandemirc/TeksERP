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
// Önbellek boşsa doğrulama kod kataloğuna düşer — yani "DB henüz okunmadı"
// durumu operatörü sebepsiz bırakmaz.
//
// ⚠️ DOĞRULAMA GİZLİ SATIRI DA KABUL EDER. Liste ucu yalnız aktifleri döner ama
// tablette bayat liste taşıyan bir APK gizlenmiş kodu gönderebilir; onu 400'e
// düşürmek vardiya ortasında "Bitir"i kırardı (LEGACY_REASON_CODE ile aynı
// gerekçe). Gizleme bir GÖRÜNÜRLÜK kararıdır, geçerlilik kararı değil.
// =============================================================================

import { Prisma, ReasonPresetKind, RollVarianceKind } from "@prisma/client";

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
};

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
} satisfies Prisma.ReasonPresetSelect;

// ── ÖNBELLEK ────────────────────────────────────────────────────────────────
/** Kind → TÜM satırlar (gizliler DAHİL — doğrulama onları da tanımalı). */
let cache: Map<ReasonPresetKind, ReasonPresetDto[]> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

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
}

/** Test/araç kaçışı — önbelleği geçersiz kılar (bir sonraki okuma DB'ye gider). */
export function invalidateReasonPresetCache(): void {
  cache = null;
  cachedAt = 0;
}

/**
 * Senkron okuma. Önbellek yoksa/bayatsa `null` döner — çağıran kod kataloğuna
 * düşer. ⚠️ Burada DB okumaya KALKMA: fonksiyon tx içinden senkron çağrılıyor.
 */
function cachedRows(kind: ReasonPresetKind): ReasonPresetDto[] | null {
  if (!cacheIsFresh()) return null;
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
export type TextReasonKind = Extract<ReasonPresetKind, "ROLL_MANUAL_ENTRY" | "ROLL_CANCEL">;

type ReasonRow = { code: string; label: string; fullText: string | null };

/** Kind'ın satırları: taze önbellek → DB tazeleme → (DB boşsa) kod kataloğu. */
async function rowsForTextKind(kind: TextReasonKind): Promise<ReasonRow[]> {
  if (!cacheIsFresh()) await refreshReasonPresetCache();
  const rows = cache?.get(kind);
  if (rows && rows.length > 0) return rows;
  // Uzlaştırma henüz koşmamış (boş DB) → kod kataloğu; doğrulama operatörü kilitlemez.
  return REASON_PRESET_CATALOG[kind].map((s) => ({
    code: s.code,
    label: s.label,
    fullText: s.fullText ?? null,
  }));
}

/**
 * Metin → kod. Satırın `fullText` VEYA `label`'ı ile katlanmış eşitlik; yoksa null.
 * Gizli satır da eşleşir (kod geçerliliği görünürlükten bağımsız).
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
  return hit ? hit.code : null;
}

/** Açık kod: katalogda yoksa 400. Dönüşte satırın metni de var (metin boş gelirse dolsun). */
export async function assertKnownReasonCode(
  kind: TextReasonKind,
  code: string,
): Promise<{ code: string; text: string }> {
  const trimmed = code.trim();
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
  }): Promise<ReasonPresetDto[]> {
    return prisma.reasonPreset.findMany({
      where: {
        ...(params.kind ? { kind: params.kind } : {}),
        ...(params.includeInactive ? {} : { isActive: true }),
      },
      select: SELECT,
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
  },

  async create(
    input: { kind: ReasonPresetKind; label: string; fullText?: string | null; requiresText?: boolean },
    userId?: string,
  ): Promise<ReasonPresetDto> {
    const label = input.label.trim();
    if (!label) throw new AppError("Etiket boş olamaz", 400);

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
    input: { label?: string; fullText?: string | null; requiresText?: boolean; isActive?: boolean },
    userId?: string,
  ): Promise<ReasonPresetDto> {
    const current = await prisma.reasonPreset.findUnique({ where: { id }, select: SELECT });
    if (!current) throw new AppError("Hazır sebep bulunamadı", 404);

    if (input.isActive === false) await assertNotLastActive(current.kind, id);

    const label = input.label?.trim();
    if (input.label !== undefined && !label) throw new AppError("Etiket boş olamaz", 400);

    const row = await prisma.reasonPreset.update({
      where: { id },
      data: {
        ...(label ? { label } : {}),
        ...(input.fullText !== undefined || label
          ? { fullText: resolveFullText(current.kind, input.fullText, label ?? current.label) }
          : {}),
        ...(input.requiresText !== undefined ? { requiresText: input.requiresText } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
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
