// =============================================================================
// YÜK BİRİMİ (çuvalsız sevk, 2026-11-06) — sevkiyat çuvala DEĞİL yük birimine bağlanır:
// SACK (çuval) · CART (top taşıma arabası, elle girilen no) · BULK (kamyon kasasına
// dökme). Model adı `Sack` kalır; SACK-dışı birim yalnız sevkiyatın İÇİNDE doğar,
// havuza hiç düşmez (DB trigger `sacks_load_unit_not_in_pool`), iptalde ÇÖZÜLÜR:
// topları rafa döner, birim sevkiyatında `dissolvedAt` damgasıyla kalır.
// Burada yalnız SAF doğrulama; tek yaratıcı `openLoadUnitTx` ve tek çözücü
// `dissolveLoadUnitsTx` audit'i basan `shipping.service.ts` içinde.
// =============================================================================
import { LoadUnitKind, type Prisma } from "@prisma/client";

import { AppError } from "../../utils/app-error";

/** DB `unitLabel` kolonu (VarChar 32) ile aynı tavan. */
export const LOAD_UNIT_LABEL_MAX = 32;

export type LoadUnitInput = { kind: "BULK" | "CART"; label?: string | null; rollIds: string[] };
export type LoadUnitPlan = { kind: LoadUnitKind; label: string | null; rollIds: string[] };

/** Araba no serbest metin: kenar boşluğu + çift boşluk atılır (tablet `normalizeCartLabel` ikizi). */
export function normalizeLoadUnitLabel(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * İstemcinin bildirdiği yük birimlerini doğrular; top kümesini TAM bölmeleri şart
 * (eksik/fazla/çift top 400). Karışık tür (dökme + araba) bu sürümde yok (D2 ertelendi).
 */
export function planLoadUnits(units: LoadUnitInput[], rollIds: string[]): LoadUnitPlan[] {
  if (units.length === 0) throw AppError.badRequest("Yük birimi listesi boş", { code: "LOAD_UNITS_INVALID" });
  const kinds = new Set(units.map((u) => u.kind));
  if (kinds.size > 1) {
    throw AppError.badRequest("Aynı sevkiyatta dökme ve araba birlikte kullanılamaz", { code: "LOAD_UNITS_INVALID" });
  }
  if (kinds.has("BULK") && units.length > 1) {
    throw AppError.badRequest("Dökme yük sevkiyat başına tek birimdir", { code: "LOAD_UNITS_INVALID" });
  }
  const want = new Set(rollIds);
  const seen = new Set<string>();
  const labels = new Set<string>();
  const plans: LoadUnitPlan[] = [];
  for (const u of units) {
    const ids = [...new Set(u.rollIds)];
    if (ids.length === 0) throw AppError.badRequest("Boş yük birimi gönderilemez", { code: "LOAD_UNITS_INVALID" });
    for (const id of ids) {
      if (!want.has(id)) throw AppError.badRequest("Yük biriminde seçilmemiş top var", { code: "LOAD_UNITS_INVALID" });
      if (seen.has(id)) throw AppError.badRequest("Bir top iki yük biriminde olamaz", { code: "LOAD_UNITS_INVALID" });
      seen.add(id);
    }
    let label: string | null = null;
    if (u.kind === "CART") {
      label = normalizeLoadUnitLabel(u.label);
      if (!label) throw AppError.badRequest("Araba no boş olamaz", { code: "LOAD_UNITS_INVALID" });
      if (label.length > LOAD_UNIT_LABEL_MAX) {
        throw AppError.badRequest(`Araba no en fazla ${LOAD_UNIT_LABEL_MAX} karakter olabilir`, { code: "LOAD_UNITS_INVALID" });
      }
      if (labels.has(label)) throw AppError.badRequest(`Araba no tekrar ediyor: ${label}`, { code: "LOAD_UNITS_INVALID" });
      labels.add(label);
    }
    plans.push({ kind: u.kind === "CART" ? LoadUnitKind.CART : LoadUnitKind.BULK, label, rollIds: ids });
  }
  if (seen.size !== want.size) {
    throw AppError.badRequest("Seçilen her top bir yük birimine atanmalı", { code: "LOAD_UNITS_INVALID" });
  }
  return plans;
}

/**
 * Sevkiyatın CANLI yük birimleri: boşalınca çözülen dökme/araba (`dissolvedAt` dolu, topsuz) sevkiyatta
 * iz olarak kalır ama sayılmaz, listelenmez, belgeye girmez — çuvalın sevkiyattan çıkmasının karşılığı.
 */
export const LIVE_LOAD_UNIT_WHERE = { dissolvedAt: null } satisfies Prisma.SackWhereInput;

const KIND_WORD: Record<LoadUnitKind, string> = { SACK: "çuval", BULK: "dökme yük", CART: "araba" };

/**
 * Aynı sevkiyatta tek yük türü (karışık sevk ertelendi, kullanıcı kararı 2026-11-06 md. 6): canlı birimlerin
 * türü gelenle aynı olmalı; boş sevkiyat her türü alır. Çağıran sevkiyatı kilitlemiş olmalı.
 * `allowSackWithBulk` YALNIZ el terminali yolunun (`shipping/handheld-load.ts`) seçeneğidir: çuval + tek dökme
 * birlikte durabilir (SPEC v2 md. 5); araba hiçbir karışıma girmez, dökme tekilliğini unique index korur.
 */
export function assertLoadKindCompatible(
  existing: readonly LoadUnitKind[],
  incoming: LoadUnitKind,
  opts: { allowSackWithBulk?: boolean } = {},
): void {
  const mixable = (k: LoadUnitKind) => k === LoadUnitKind.SACK || k === LoadUnitKind.BULK;
  const other = existing.find((k) => k !== incoming && !(opts.allowSackWithBulk === true && mixable(k) && mixable(incoming)));
  if (!other) return;
  throw AppError.conflict(
    `Bu sevkiyatta ${KIND_WORD[other]} var; aynı sevkiyata ${KIND_WORD[incoming]} eklenemez (karışık yük bu sürümde yok). Ayrı sevkiyat kurun.`,
    { code: "LOAD_UNIT_KIND_MIXED", existing: other, incoming },
  );
}

/**
 * Karışık yükün (çuval + dökme; yalnız el terminali yolu) belge özeti: "2 çuval (8 top) + 3 top dökme".
 * Tek türlü yükte `null` → snapshot'a anahtar HİÇ yazılmaz (bugünkü irsaliyeler bayt-eşit kalır).
 */
export function loadSummaryText(units: { unitKind: LoadUnitKind; rollCount: number }[]): string | null {
  const sacks = units.filter((u) => u.unitKind === LoadUnitKind.SACK);
  const bulkRolls = units.filter((u) => u.unitKind === LoadUnitKind.BULK).reduce((n, u) => n + u.rollCount, 0);
  if (sacks.length === 0 || bulkRolls === 0) return null;
  const sackRolls = sacks.reduce((n, u) => n + u.rollCount, 0);
  return `${sacks.length} çuval (${sackRolls} top) + ${bulkRolls} top dökme`;
}
