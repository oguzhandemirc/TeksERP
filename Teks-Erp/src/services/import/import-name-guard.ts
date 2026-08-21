// =============================================================================
// AD MÜKERRER ÖN KONTROLÜ — önizleme ile uygulama AYNI ŞEYİ SÖYLESİN
// =============================================================================
// SORUN (2026-08-19, ilk sürümde bırakılmıştı): ad-mükerrer koruması
// SERVİSLERDE, yani YAZMA yolunda yaşıyor. Önizleme yazma yapmadığı için onu
// hiç çalıştırmıyordu ve şu davranış doğuyordu:
//
//   dosyada "MODA TEKSTIL" · sistemde "Moda Tekstil"
//   → önizleme: "Yeni" (her şey yeşil)
//   → uygula:   servis 409 → koşum "yarıda kesildi"
//
// Kullanıcıya "sorun yok" deyip sonra patlamak, tam olarak bu özelliğin
// önlemek için var olduğu şeydi. Üstelik en sık isabet edeceği yer en çok
// kullanılan ana veri: müşteri / renk / kumaş adları.
//
// ⚠️ NEDEN TEK BİR JENERİK SORGU DEĞİL: guard'ın SEMANTİĞİ modele göre
// değişiyor ve bunu varsaymak yanlış POZİTİF üretirdi (meşru bir içe aktarımı
// bloklamak, kaçırmaktan kötüdür):
//   • çoğu model → `foldNameForCompare` + DB `<field>Fold` gölge kolonu
//   • RENK       → `foldColorNameForCompare` (ayraç VE token sırasından
//     bağımsız); DB fold kolonuna BİLİNÇLİ bağlanmamış (color.service.ts notu)
//   • MAKİNE     → ad yalnız KENDİ istasyonu içinde tekil
//   • ŞUBE       → ad yalnız KENDİ müşterisi içinde tekil, JS taramalı
// Bu yüzden varyantı adaptör BEYAN eder; beyan etmeyen adaptörde kontrol
// KOŞMAZ (fail-open — bugünkü davranış, regresyon yok).

import prisma from "../../lib/prisma";
import { foldColorNameForCompare, foldNameForCompare } from "../helpers/name-normalize.helper";
import { modelHasMergeLineage } from "../base.service";
import type { NameGuardSpec, PreparedRow } from "./import.types";

type AnyDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
};

const delegate = (model: string): AnyDelegate =>
  (prisma as unknown as Record<string, AnyDelegate>)[model] as AnyDelegate;

const foldOf = (spec: NameGuardSpec, value: string): string =>
  spec.fold === "color" ? foldColorNameForCompare(value) : foldNameForCompare(value);

interface Candidate {
  row: PreparedRow;
  name: string;
  folded: string;
  scopeId: string | null;
}

/**
 * Ad çakışmalarını ÖNİZLEME sırasında bulur ve satıra hata yazar.
 * Sorgu satır başına değil, KAPSAM başına tek `findMany` (N+1 yok).
 */
export async function applyNameGuard(
  spec: NameGuardSpec,
  rows: PreparedRow[],
): Promise<void> {
  // Aday satırlar: yeni kayıtlar + adı GERÇEKTEN değişen güncellemeler.
  // Adı değişmeyen bir güncelleme kendi ikizine çarpardı (servis guard'ı da
  // tam olarak bu sebeple "ad değişmedikçe kontrol etme" diyor).
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (row.result.action === "ERROR") continue;
    const raw = row.values[spec.field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const folded = foldOf(spec, raw);
    if (row.existing) {
      const current = row.existing[spec.field];
      if (typeof current === "string" && foldOf(spec, current) === folded) continue;
    }
    const scopeId = spec.scope
      ? ((row.values[spec.scope.valueKey] as string | undefined) ??
        (row.existing?.[spec.scope.column] as string | undefined) ??
        null)
      : null;
    candidates.push({ row, name: raw.trim(), folded, scopeId });
  }
  if (candidates.length === 0) return;

  // --- mevcut kayıtları getir -----------------------------------------------
  const scopeIds = [...new Set(candidates.map((c) => c.scopeId).filter((s): s is string => Boolean(s)))];
  const where: Record<string, unknown> = {};
  if (spec.scope) {
    // Kapsamsız aday varsa (ör. istasyonu çözülememiş makine) onun kapsamı
    // belirsizdir — kontrol o satırda koşmaz, yazma anındaki guard yakalar.
    if (scopeIds.length === 0) return;
    where[spec.scope.column] = { in: scopeIds };
  }
  if (spec.useFoldColumn !== false) {
    where[`${spec.field}Fold`] = { in: [...new Set(candidates.map((c) => c.folded))] };
  }
  // BİRLEŞTİRİLMİŞ (tombstone) kayıt ADAY DEĞİL — servis guard'ı
  // (`BaseService.assertNameNotDuplicate`) ve DB seddi (`<tablo>_nameFold_key`,
  // `WHERE "mergedIntoId" IS NULL`, 2026-08-21) ikisi de tombstone'u dışarıda
  // bırakır; önizleme aynı şeyi söylemeli, yoksa "Mevcut" deyip yazmada geçen
  // satırı boş yere durdurur (önizleme ↔ uygulama ayrışması — dosya başlığı).
  if (modelHasMergeLineage(spec.model)) where.mergedIntoId = null;

  const select: Record<string, boolean> = { id: true, isActive: true, [spec.field]: true };
  if (spec.scope) select[spec.scope.column] = true;
  if (spec.codeField) select[spec.codeField] = true;

  const existing = (await delegate(spec.model).findMany({ where, select })) as Array<
    Record<string, unknown>
  >;
  if (existing.length === 0) return;

  // --- indeksle: (kapsam|katlanmış ad) → kayıt ------------------------------
  const key = (scopeId: string | null, folded: string): string => `${scopeId ?? ""}|${folded}`;
  const byKey = new Map<string, Record<string, unknown>>();
  for (const e of existing) {
    const eName = e[spec.field];
    if (typeof eName !== "string") continue;
    const eScope = spec.scope ? ((e[spec.scope.column] as string | undefined) ?? null) : null;
    const k = key(eScope, foldOf(spec, eName));
    // Aktif kayıt öncelikli: mesaj "zaten var" ile "PASİF, aktifleştirin"
    // arasında ayrışıyor ve operatöre yapılacak İŞİ söylemeli.
    const prev = byKey.get(k);
    if (!prev || (prev.isActive !== true && e.isActive === true)) byKey.set(k, e);
  }

  // --- satırlara yaz ---------------------------------------------------------
  for (const c of candidates) {
    const hit = byKey.get(key(c.scopeId, c.folded));
    if (!hit) continue;
    // Kendi kaydına çarpma (ad değiştiren güncelleme).
    if (c.row.result.targetId && hit.id === c.row.result.targetId) continue;

    const code = spec.codeField && typeof hit[spec.codeField] === "string" ? ` (kod: ${hit[spec.codeField] as string})` : "";
    c.row.result.errors.push({
      column: spec.field,
      message:
        hit.isActive === true
          ? `'${c.name}' adında bir ${spec.label} zaten var${code}. Aynı ${spec.label} ikinci kez eklenemez.`
          : `'${c.name}' adında PASİF bir ${spec.label} zaten var${code}. Yenisini eklemek yerine mevcut kaydı aktifleştirin.`,
    });
  }
}

/**
 * DOSYA İÇİ ad çakışması: iki satır AYNI adı taşıyorsa ikincisi yazılamaz.
 * Anahtar (kod) mükerrerliğinden ayrı bir sorundur — kodlar boş bırakıldığında
 * (sunucu üretiyor) tek yakalayıcı budur.
 */
export function checkDuplicateNamesInFile(spec: NameGuardSpec, rows: PreparedRow[]): void {
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (row.result.action === "ERROR") continue;
    const raw = row.values[spec.field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const scopeId = spec.scope ? ((row.values[spec.scope.valueKey] as string | undefined) ?? "") : "";
    const k = `${scopeId}|${foldOf(spec, raw)}`;
    const first = seen.get(k);
    if (first !== undefined) {
      row.result.errors.push({
        column: spec.field,
        message: `'${raw.trim()}' adı dosyada ${first}. satırda da var — aynı ${spec.label} iki kez eklenemez.`,
      });
    } else {
      seen.set(k, row.input.rowNo);
    }
  }
}
