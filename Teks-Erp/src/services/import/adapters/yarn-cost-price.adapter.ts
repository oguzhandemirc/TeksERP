// İplik maliyet fiyatı (YarnCostPrice) içe aktarım adaptörü — SY-H2.
//
// ③a DAMGALI SÜRÜM: anahtar iplik kodudur, "mevcut" = yürürlükteki sürüm. Farklı değer yeni sürüm
// yazar (eski damgalanır) — `changeYarnCostPrice` yolu; `expectedActiveId` önizleme ile yazım arasında
// başka bir fiyat girdiyse 409 verir (uygula önizlemeye güvenmez). Geri sarma sürümü SİLMEZ: damgalar
// ya da önceki değeri yeni sürüm olarak yazar (`revertVersion`).
import { Currency } from "@prisma/client";
import prisma from "../../../lib/prisma";
import { AppError } from "../../../utils/app-error";
import { ACTIVE_YARN_COST_PRICE } from "../../helpers/cost-price-validity.helper";
import { changeYarnCostPrice, revokeYarnCostPrice } from "../../yarn-cost-price.service";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";
import { resolveYarnCode } from "./weaving-import.shared";

const IMPORT_SOURCE_REF = "IMPORT";

const COLUMNS: ImportColumn[] = [
  {
    key: "yarnCode",
    label: "İplik Kodu",
    type: "lookup",
    required: true,
    lookup: { entity: "item", by: "code" },
    help: "İPLİK türündeki kalemin kodu. Önce iplik kalemlerini yükleyin.",
    example: "PES-75",
  },
  {
    key: "currency",
    label: "Para Birimi",
    type: "enum",
    required: true,
    enumValues: Object.values(Currency).map((value) => ({ value, label: value })),
    example: "USD",
  },
  { key: "pricePerKg", label: "Kg Fiyatı", type: "number", required: true, help: "Sıfırdan büyük; ondalık virgül ya da nokta.", example: "2,35" },
  { key: "note", label: "Not", type: "text", maxLen: 300, example: "" },
];

type Existing = { id: string; yarnItemId: string; currency: Currency; pricePerKg: number; note: string | null };

export const yarnCostPriceImportAdapter: ImportAdapter = {
  entity: "yarnCostPrice",
  label: "İplik Maliyet Fiyatları",
  tableName: "YARN_COST_PRICE",
  writePermission: "cost:write",
  readPermission: "cost:read",
  module: "maliyet",
  keyColumns: ["yarnCode"],
  columns: COLUMNS,
  notes: [
    "Her satır bir ipliğin YÜRÜRLÜKTEKİ kg fiyatıdır; farklı değer yeni fiyat sürümü yazar, eskisi geçmişte kalır.",
    "Aynı değer yeniden yüklenirse değişiklik yapılmaz.",
  ],

  async findExisting(keys) {
    const rows = await prisma.yarnCostPrice.findMany({
      where: { ...ACTIVE_YARN_COST_PRICE, yarnItem: { code: { in: keys, mode: "insensitive" } } },
      select: { id: true, yarnItemId: true, currency: true, pricePerKg: true, note: true, yarnItem: { select: { code: true } } },
    });
    return new Map(
      rows.map((r) => [
        importKey(r.yarnItem.code),
        { id: r.id, yarnItemId: r.yarnItemId, yarnCode: r.yarnItem.code, currency: r.currency, pricePerKg: Number(r.pricePerKg), note: r.note },
      ]),
    );
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const code = row.values.yarnCode;
    if (typeof code === "string") row.values.yarnCode__id = await resolveYarnCode(row, { column: "yarnCode", code }, ctx, { requireDenier: false });
    if (row.values.pricePerKg === null || row.values.pricePerKg === 0) {
      row.result.errors.push({ column: "pricePerKg", message: "Kg fiyatı sıfırdan büyük olmalı." });
    }
    if (row.values.currency === null) row.result.errors.push({ column: "currency", message: "Para birimi temizlenemez." });
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    return write(row, null, ctx.userId);
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    return write(row, row.existing as unknown as Existing, ctx.userId);
  },

  async exportRows() {
    const rows = await prisma.yarnCostPrice.findMany({
      where: ACTIVE_YARN_COST_PRICE,
      orderBy: [{ yarnItem: { code: "asc" } }, { id: "asc" }],
      select: { currency: true, pricePerKg: true, note: true, yarnItem: { select: { code: true } } },
    });
    return rows.map((r) => ({ yarnCode: r.yarnItem.code, currency: r.currency, pricePerKg: r.pricePerKg.toString(), note: r.note ?? "" }));
  },

  async revertVersion(line, userId) {
    try {
      if (line.action === "CREATE") {
        await revokeYarnCostPrice(line.recordId, userId);
        return null;
      }
      const row = await prisma.yarnCostPrice.findUnique({
        where: { id: line.recordId },
        select: { yarnItemId: true, currency: true, pricePerKg: true, note: true },
      });
      if (!row) return "Fiyat satırı bulunamadı";
      const cf = (line.changedFields as Record<string, { from: unknown }> | null) ?? {};
      await changeYarnCostPrice(
        {
          yarnItemId: row.yarnItemId,
          currency: (cf.currency?.from as Currency | undefined) ?? row.currency,
          pricePerKg: cf.pricePerKg ? String(cf.pricePerKg.from) : row.pricePerKg.toString(),
          note: cf.note ? cf.note.from : row.note,
          sourceRef: "IMPORT_REVERT",
          expectedActiveId: line.recordId,
        },
        userId,
      );
      return null;
    } catch (e) {
      // İş kuralı engeli bir DALDIR: sürüm sonradan değişti/kaldırıldı → atlanır, gerekçe deftere.
      if (e instanceof AppError && (e.statusCode === 409 || e.statusCode === 404 || e.statusCode === 400)) return e.message;
      throw e;
    }
  },
};

async function write(row: PreparedRow, existing: Existing | null, userId?: string): Promise<{ id: string }> {
  const v = row.values;
  const out = await changeYarnCostPrice(
    {
      yarnItemId: (v.yarnCode__id as string | undefined) ?? (existing?.yarnItemId as string),
      currency: (v.currency as Currency | undefined) ?? (existing?.currency as Currency),
      pricePerKg: v.pricePerKg !== undefined ? String(v.pricePerKg) : String(existing?.pricePerKg),
      note: v.note !== undefined ? v.note : (existing?.note ?? null),
      sourceRef: IMPORT_SOURCE_REF,
      expectedActiveId: existing?.id ?? null,
    },
    userId,
  );
  return { id: out.row.id };
}
