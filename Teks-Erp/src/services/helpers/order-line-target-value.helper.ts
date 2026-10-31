// =============================================================================
// SİPARİŞ SATIRI HEDEF DEĞERİ — `OrderLineTargetValue` gövde kapısı (SY-K1k, tasarım §7.4)
// =============================================================================
// "Kuşak: ZEBRA" satırın PLAN alanıdır (③b saf yapılandırma pivotu; satır düzenlemesinde replace).
// Doğrulayıcı iş emri hedefiyle AYNIDIR (`assertTargetValueItems`): çeşit özelliği + o özelliğin aktif değeri.
// Çeşidin BAYRAK ikizi satırın `requiredPropertyIds`ine kendiliğinden eklenir (400 değil) — sonra mevcut
// özellik kapıları (izinli liste, aktiflik, hedeflenebilirlik) onu da sınar. Gövdede yoksa satıra dokunulmaz.
// =============================================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { assertTargetValueItems, type TargetValueItem } from "./workorder-target-value.helper";

type Reader = Prisma.TransactionClient | PrismaClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TARGETS_PER_LINE = 20;

/** `undefined` = gövdede yok (mevcut küme korunur); dizi = satırın YENİ kümesi (boş dizi = temizle). */
export function readLineTargetValues(raw: unknown, label: string): TargetValueItem[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_TARGETS_PER_LINE) {
    throw AppError.badRequest(`${label}: hedef değerler dizi olmalı (en çok ${MAX_TARGETS_PER_LINE}).`, { code: "TARGET_VALUE_INVALID" });
  }
  return raw.map((e: unknown) => {
    const r = (e ?? {}) as Record<string, unknown>;
    if (typeof r.propertyId !== "string" || !UUID_RE.test(r.propertyId) || typeof r.valueId !== "string" || !UUID_RE.test(r.valueId)) {
      throw AppError.badRequest(`${label}: hedef değerde özellik ve değer zorunlu.`, { code: "TARGET_VALUE_INVALID" });
    }
    return { propertyId: r.propertyId, valueId: r.valueId };
  });
}

/**
 * Satır gövdelerini HAZIRLAR (yerinde): `targetValues` okunup doğrulanır ve normalize edilir; çeşitlerin BAYRAK
 * ikizleri `requiredPropertyIds`e birleşir. Mevcut özellik doğrulamasından ÖNCE çağrılır. Hedefsiz gövdede sorgu yok.
 * Gövdede `targetValues` yoksa (eski istemci) MEVCUT satırın hedefleri korunur → onların ikizleri de korunmalı (§7.4).
 */
export async function prepareLineTargetValues(
  db: Reader,
  lines: unknown,
  current: ReadonlyArray<{ id: string; targetValues: ReadonlyArray<TargetValueItem> }> = [],
): Promise<void> {
  if (!Array.isArray(lines)) return;
  const currentById = new Map(current.map((l) => [l.id, l.targetValues]));
  for (const [i, raw] of lines.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const line = raw as Record<string, unknown>;
    const items = readLineTargetValues(line.targetValues, `${i + 1}. kalem`);
    if (items === undefined) {
      const kept = typeof line.id === "string" ? currentById.get(line.id) : undefined;
      if (kept && kept.length > 0) await mergeFlagTwins(db, line, kept);
      continue;
    }
    line.targetValues = items;
    if (items.length === 0) continue;
    // Yalnız YENİ çift sınanır (varyant kapısındaki isNew emsali): sonradan pasife alınan mevcut hedef ilgisiz düzenlemeyi kesmez.
    const keptKeys = new Set((typeof line.id === "string" ? (currentById.get(line.id) ?? []) : []).map((t) => `${t.propertyId}|${t.valueId}`));
    const fresh = items.filter((t) => !keptKeys.has(`${t.propertyId}|${t.valueId}`));
    if (fresh.length > 0) await assertTargetValueItems(db, fresh);
    await mergeFlagTwins(db, line, items);
  }
}

async function mergeFlagTwins(db: Reader, line: Record<string, unknown>, items: ReadonlyArray<TargetValueItem>): Promise<void> {
  const props = await db.fabricProperty.findMany({
    where: { id: { in: items.map((t) => t.propertyId) } },
    select: { variantOfPropertyId: true },
  });
  const current = Array.isArray(line.requiredPropertyIds)
    ? (line.requiredPropertyIds as unknown[]).filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  const flags = props.map((p) => p.variantOfPropertyId).filter((p): p is string => !!p);
  line.requiredPropertyIds = [...new Set([...current, ...flags])];
}

/** Hazırlanmış gövdenin hedef kümesi (`prepareLineTargetValues` sonrası). */
export function preparedTargetValues(line: Record<string, unknown>): TargetValueItem[] | undefined {
  return Array.isArray(line.targetValues) ? (line.targetValues as TargetValueItem[]) : undefined;
}

/** Yeni satırın iç içe yaratımı; hedef yoksa boş nesne (bugünkü gövde bayt-aynı). */
export function lineTargetValuesNestedCreate(items: TargetValueItem[] | undefined) {
  return items && items.length > 0 ? { targetValues: { create: items.map((t) => ({ propertyId: t.propertyId, valueId: t.valueId })) } } : {};
}

/** Küme farkı var mı (sıra bağımsız) — replace yalnız fark varsa yazar. */
export function targetSetChanged(current: ReadonlyArray<TargetValueItem>, next: ReadonlyArray<TargetValueItem>): boolean {
  const key = (t: TargetValueItem) => `${t.propertyId}|${t.valueId}`;
  const a = new Set(current.map(key));
  const b = new Set(next.map(key));
  return a.size !== b.size || [...a].some((k) => !b.has(k));
}

/** Okuma yüzeyi: satırın hedef değerleri (özellik + değer adı). */
export const LINE_TARGET_VALUES_SELECT = {
  select: {
    propertyId: true,
    valueId: true,
    property: { select: { id: true, code: true, name: true } },
    value: { select: { id: true, code: true, name: true } },
  },
} as const;
