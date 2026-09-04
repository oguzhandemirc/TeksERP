// =============================================================================
// ÇUVAL İZİ (ETİKET) — ORTAK YÜKLEMLER (2026-09-04)
// =============================================================================
// İz, çuvala bırakılan bir işarettir (macOS Finder etiketi emsali): nesnenin
// KENDİSİNİ değiştirmez. `Sack.notes` ile aynı sınıf — annotation.
// =============================================================================

import { Prisma } from "@prisma/client";

/**
 * "ETKİN İZ" YÜKLEMİ — TEK KAYNAK.
 *
 * Sevkte iz SOFT temizlenir (`clearedAt` + `clearedShipmentId` damgası,
 * `performDispatchTx`), storno onu geri alır. Yani tablo hem etkin hem
 * temizlenmiş satır taşır ve **her okuma yüzeyi** (liste rozeti · `tagId`
 * filtresi · `hasTag` yüklemi · çuval detayı · belge) bu yüklemden geçmek
 * ZORUNDA.
 *
 * ⚠️ NEDEN TEK KAYNAK: rozet ile filtre ayrı yazılırsa liste "🏷 Kontrol Et"
 * rozeti basar ama aynı etiketin filtresi o satırı DÖNDÜRMEZ (ya da tersi) —
 * bu depoda adı konmuş "türetilmiş alan / ayrışan yüzey" sınıfı
 * (`hasNote`/`notePreview` ↔ `PRESENT_ROLL_WHERE` aynı dersi).
 */
export const ACTIVE_TAG_WHERE = { clearedAt: null } satisfies Prisma.SackTagAssignmentWhereInput;

/**
 * Etiket rozeti — liste/detay/belge yüzeylerinin ORTAK select'i. Etkin izleri
 * katalog sırasıyla getirir.
 *
 * ⚠️ `tag.isActive` SÜZÜLMEZ: katalogdan çıkarılmış (pasif) bir etiketin ESKİ
 * ataması görünmeye devam eder — gizleme bir GÖRÜNÜRLÜK kararıdır (yeni atamaya
 * kapalı), geçmişi silme kararı değil. Süzseydik operatörün rafta duran fiziksel
 * işaretiyle ekran çelişirdi.
 */
export const ACTIVE_TAG_SELECT = {
  where: ACTIVE_TAG_WHERE,
  select: {
    createdAt: true,
    createdById: true,
    tag: { select: { id: true, code: true, name: true, hex: true, isActive: true } },
  },
  orderBy: [{ tag: { sortOrder: "asc" } }, { tag: { name: "asc" } }],
} satisfies Prisma.Sack$tagsArgs;

/** Liste/detay satırında dönen rozet şekli. */
export interface SackTagBadge {
  id: string;
  code: string;
  name: string;
  hex: string;
  /** false → katalogdan çıkarılmış; rozet soluk çizilir, yeni atamaya kapalı. */
  isActive: boolean;
}

/** `ACTIVE_TAG_SELECT` çıktısını rozet dizisine indirger (tek dönüşüm noktası). */
export function toTagBadges(
  rows: { tag: { id: string; code: string; name: string; hex: string; isActive: boolean } }[] | undefined,
): SackTagBadge[] {
  return (rows ?? []).map((r) => r.tag);
}

/**
 * Etiket KODU addan türetilir ve sonradan DEĞİŞMEZ (`slugifyReasonCode` emsali:
 * kod rapor anahtarıdır, ad sunumdur). Türkçe harfler ASCII'ye katlanır — kod
 * ASCII kalmalı (2026-08-10 `TUP`/`TÜP` dersi).
 */
export function slugifySackTagCode(name: string): string {
  const map: Record<string, string> = {
    ç: "C", Ç: "C", ğ: "G", Ğ: "G", ı: "I", İ: "I",
    ö: "O", Ö: "O", ş: "S", Ş: "S", ü: "U", Ü: "U",
  };
  const ascii = name.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => map[c] ?? c);
  const code = ascii
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  // Tamamen sembolden oluşan ad ("???") boş kod üretirdi — kod satırın KİMLİĞİ,
  // boş bırakılamaz; çağıran benzersizleştirir.
  return code || "ETIKET";
}

/** `#RRGGBB` doğrulaması — katalog rengi bir UI sabitidir, serbest metin değil. */
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
