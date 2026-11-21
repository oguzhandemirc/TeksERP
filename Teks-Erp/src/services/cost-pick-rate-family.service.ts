// =============================================================================
// DESEN AİLESİNE TOPLU ATKI ÜCRETİ (SY-C3)
// =============================================================================
// Aile = `WeaveDesign.familyLabel` (TERGAL-DÖNER, BALIK…); ailenin desen kartlarına bağlı KUMAŞLARIN
// ürün yapısındaki `loomPickRate/loomPickCurrency` toplu yazılır. Yıkıcı toplu işlem kuralı: önce
// önizleme (etkilenen HER kumaş, mevcut ücret + kaynağı), sonra yalnız SEÇİLEN kumaşlar. Aileden
// olmayan id fail-closed 400 (sessizce atlanmaz). Standart maliyet sürümleri DEĞİŞMEZ (donmuş);
// yeni ücret yalnız yeni hesaba girer (bayatlık rozeti). Tek tx; kalem başı audit tx DIŞINDA.
// =============================================================================
import { Currency, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { isUniqueViolation, parsePickRatePair } from "./helpers/cost-input.helper";

const MAX_ITEMS = 500;

const familyWhere = (familyLabel: string): Prisma.ItemWhereInput => ({ itemType: "FABRIC", weaveDesign: { familyLabel } });

function parseFamily(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw AppError.badRequest("Desen ailesi zorunludur.", { code: "COST_PICK_FAMILY_REQUIRED" });
  return raw.trim();
}

export interface PickFamilySummary { familyLabel: string; designCount: number; itemCount: number }

/** Aile listesi — etiketi olan desen kartları; kumaş sayısıyla. */
export async function listPickRateFamilies(): Promise<PickFamilySummary[]> {
  const designs = await prisma.weaveDesign.findMany({ where: { familyLabel: { not: null } }, select: { familyLabel: true, _count: { select: { fabricItems: { where: { itemType: "FABRIC" } } } } } });
  const map = new Map<string, PickFamilySummary>();
  for (const d of designs) {
    const label = d.familyLabel!.trim();
    if (!label) continue;
    const s = map.get(label) ?? { familyLabel: label, designCount: 0, itemCount: 0 };
    s.designCount += 1;
    s.itemCount += d._count.fabricItems;
    map.set(label, s);
  }
  return [...map.values()].sort((a, b) => a.familyLabel.localeCompare(b.familyLabel, "tr"));
}

export interface PickFamilyPreviewRow {
  itemId: string; code: string; name: string; isActive: boolean; designCode: string; designName: string;
  current: { rate: string | null; currency: Currency | null; source: "YAPI" | "PARAMETRE" | "YOK" };
}

/** Önizleme — hiçbir şey yazmaz; ailenin HER kumaşı mevcut ücret ve kaynağıyla. */
export async function previewPickRateFamily(familyRaw: unknown): Promise<{ familyLabel: string; rows: PickFamilyPreviewRow[]; parameterDefault: { rate: string; currency: Currency } | null }> {
  const familyLabel = parseFamily(familyRaw);
  const [items, params] = [
    await prisma.item.findMany({
      where: familyWhere(familyLabel),
      orderBy: [{ code: "asc" }, { id: "asc" }],
      select: { id: true, code: true, name: true, isActive: true, weaveDesign: { select: { code: true, name: true } }, costStructure: { select: { loomPickRate: true, loomPickCurrency: true } } },
    }),
    await prisma.costParameterSet.findFirst({ where: { status: "ACTIVE" }, select: { defaultLoomPickRate: true, defaultLoomPickCurrency: true } }),
  ];
  const parameterDefault = params?.defaultLoomPickRate && params.defaultLoomPickCurrency ? { rate: params.defaultLoomPickRate.toFixed(4), currency: params.defaultLoomPickCurrency } : null;
  const rows = items.map((i): PickFamilyPreviewRow => {
    const cs = i.costStructure;
    const current = cs?.loomPickRate && cs.loomPickCurrency
      ? { rate: cs.loomPickRate.toFixed(4), currency: cs.loomPickCurrency, source: "YAPI" as const }
      : parameterDefault
        ? { ...parameterDefault, source: "PARAMETRE" as const }
        : { rate: null, currency: null, source: "YOK" as const };
    return { itemId: i.id, code: i.code, name: i.name, isActive: i.isActive, designCode: i.weaveDesign?.code ?? "", designName: i.weaveDesign?.name ?? "", current };
  });
  return { familyLabel, rows, parameterDefault };
}

/** Uygula — yalnız seçilen kumaşlar; hepsi aileden olmalı (aksi 400, hiçbiri yazılmaz). */
export async function applyPickRateFamily(body: { familyLabel?: unknown; rate?: unknown; currency?: unknown; itemIds?: unknown }, userId?: string): Promise<{ updated: number }> {
  const familyLabel = parseFamily(body.familyLabel);
  const pair = parsePickRatePair(body.rate, body.currency);
  if (!pair || pair.rate === null || pair.currency === null) throw AppError.badRequest("Atkı ücreti ve dövizi zorunludur.", { code: "COST_PICK_RATE_PAIR" });
  const ids = Array.isArray(body.itemIds) ? [...new Set(body.itemIds.filter((x): x is string => typeof x === "string"))] : [];
  if (!ids.length) throw AppError.badRequest("En az bir kumaş seçilmeli.", { code: "COST_PICK_FAMILY_EMPTY" });
  if (ids.length > MAX_ITEMS) throw AppError.badRequest(`Tek seferde en çok ${MAX_ITEMS} kumaş güncellenir.`);
  const { rate, currency } = pair;

  let changes: Array<{ itemId: string; structureId: string; created: boolean; old: { rate: string | null; currency: Currency | null } }>;
  try {
    changes = await prisma.$transaction(async (tx) => {
      const found = await tx.item.findMany({ where: { AND: [{ id: { in: ids } }, familyWhere(familyLabel)] }, select: { id: true, costStructure: { select: { id: true, loomPickRate: true, loomPickCurrency: true } } } });
      if (found.length !== ids.length) {
        const ok = new Set(found.map((f) => f.id));
        throw AppError.badRequest("Seçilen kumaşlardan bazıları bu desen ailesinde değil — önizlemeyi yenileyin.", { code: "COST_PICK_FAMILY_MISMATCH", itemIds: ids.filter((id) => !ok.has(id)) });
      }
      const out: typeof changes = [];
      for (const it of [...found].sort((a, b) => a.id.localeCompare(b.id))) {
        const old = { rate: it.costStructure?.loomPickRate?.toFixed(4) ?? null, currency: it.costStructure?.loomPickCurrency ?? null };
        const up = await tx.costStructure.upsert({
          where: { itemId: it.id },
          create: { itemId: it.id, loomPickRate: rate, loomPickCurrency: currency, createdById: userId ?? null, updatedById: userId ?? null },
          update: { loomPickRate: rate, loomPickCurrency: currency, updatedById: userId ?? null },
          select: { id: true },
        });
        out.push({ itemId: it.id, structureId: up.id, created: !it.costStructure, old });
      }
      return out;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw AppError.conflict("Maliyet yapısı aynı anda başka bir işlemle yazıldı — tekrar deneyin.");
    throw e;
  }
  for (const c of changes) {
    void AuditService.log({
      userId, action: c.created ? "CREATE" : "UPDATE", tableName: "COST_STRUCTURE", recordId: c.structureId,
      oldData: c.created ? null : { loomPickRate: c.old.rate, loomPickCurrency: c.old.currency },
      newData: { itemId: c.itemId, loomPickRate: rate.toFixed(4), loomPickCurrency: currency, familyLabel },
    });
  }
  return { updated: changes.length };
}
