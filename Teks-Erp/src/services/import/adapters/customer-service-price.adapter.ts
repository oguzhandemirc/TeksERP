// Müşteri hizmet fiyat listesi içe aktarım adaptörü — toplu açılış aktarımı.
//
// ③a DAMGALI SÜRÜM (ItemPrice, SALE, müşteri istisnası): yazım TEK KAYNAKTAN `itemPriceService.upsert`
// (farklı fiyat eski sürümü damgalar + yeni sürüm; aynı fiyat SKIP). Kalem SERVİS türünde olmalı. Geri
// sarma satır SİLMEZ: yaratılan sürüm damgalanır, güncellenen sürümde önceki fiyat yeni sürüm olarak yazılır.
import { Currency, ItemType, ItemUnit, PriceKind } from "@prisma/client";
import prisma from "../../../lib/prisma";
import { itemPriceService } from "../../item-price.service";
import { resolveReference } from "../import-lookup";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { CURRENCY_VALUES, claimInFile, joinKey, revertBranchMessage } from "./opening-import.shared";

const UNIT_LABEL: Record<ItemUnit, string> = { MT: "Metre", KG: "Kg", ADET: "Adet" };

const COLUMNS: ImportColumn[] = [
  { key: "customerCode", label: "Müşteri Kodu", type: "text", required: true, maxLen: 100, help: "Müşteri KODU; bulunamazsa tam ad (uyarılı).", example: "M001" },
  { key: "itemCode", label: "Hizmet Kodu", type: "text", required: true, maxLen: 100, help: "SERVİS türündeki kalemin kodu.", example: "HZM-KURSUN" },
  {
    key: "unit",
    label: "Birim",
    type: "enum",
    enumValues: Object.values(ItemUnit).map((value) => ({ value, label: UNIT_LABEL[value] })),
    help: "Bilgi/denetim: doluysa hizmet kartının birimiyle aynı olmalı (fiyat kart birimi başınadır).",
    example: "Metre",
  },
  { key: "price", label: "Birim Fiyat", type: "number", required: true, help: "Sıfır geçerlidir (ücretsiz hizmet).", example: "3,75" },
  { key: "currency", label: "Para Birimi", type: "enum", required: true, enumValues: CURRENCY_VALUES, example: "USD" },
];

interface Resolved {
  customerId: string;
  itemId: string;
}
const resolved = new WeakMap<PreparedRow, Resolved>();

export const customerServicePriceImportAdapter: ImportAdapter = {
  entity: "customerServicePrice",
  label: "Hizmet Fiyat Listesi",
  tableName: "ITEM_PRICE",
  writePermission: "price:write",
  readPermission: "item:read",
  module: "ticaret",
  keyColumns: ["customerCode"],
  columns: COLUMNS,
  rowKey: (v) => joinKey(v, ["customerCode", "itemCode", "currency"]),
  auditOmit: ["price"],
  notes: [
    "Her satır bir müşterinin bir hizmet kalemi için YÜRÜRLÜKTEKİ satış fiyatıdır (müşteri istisnası).",
    "Farklı fiyat yeni sürüm yazar (eskisi geçmişte kalır); aynı fiyat değişiklik yapmaz.",
  ],

  async findExisting() {
    // Kod ya da ad ile çözülen kimlik `validateRow`da eşleşir; anahtar metni kimlik değildir.
    return new Map();
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const v = row.values;
    if (typeof v.customerCode !== "string" || typeof v.itemCode !== "string" || typeof v.currency !== "string") return;
    const cust = await resolveReference("customer", v.customerCode, ctx);
    const item = await resolveReference("item", v.itemCode, ctx);
    for (const [col, out] of [["customerCode", cust], ["itemCode", item]] as const) {
      if (out.error) row.result.errors.push({ column: col, message: out.error.message, fix: out.error.fix });
      if (out.warning) row.result.warnings.push({ column: col, message: out.warning });
    }
    if (!cust.hit || !item.hit) return;
    const card = await prisma.item.findUnique({ where: { id: item.hit.id }, select: { itemType: true, unit: true } });
    if (card?.itemType !== ItemType.SERVICE) row.result.errors.push({ column: "itemCode", message: "Kalem SERVİS türünde değil — hizmet fiyat listesi yalnız hizmet kalemlerini alır." });
    if (v.unit && card && v.unit !== card.unit) row.result.errors.push({ column: "unit", message: `Hizmetin birimi ${UNIT_LABEL[card.unit]} — dosyadaki birim farklı.` });
    const ids = { customerId: cust.hit.id, itemId: item.hit.id };
    resolved.set(row, ids);
    row.result.label = `${cust.hit.name ?? v.customerCode} · ${item.hit.name ?? v.itemCode}`;
    claimInFile(ctx, row, { key: `${ids.customerId}|${ids.itemId}|${v.currency}`, column: "itemCode", message: "Aynı müşteri + hizmet + para birimi dosyada iki kez var" });

    const current = await itemPriceService.findActiveSale({ ...ids, currency: v.currency as Currency });
    if (!current) return;
    row.existing = { id: current.id, price: Number(current.price) };
    row.result.targetId = current.id;
    const same = typeof v.price === "number" && current.price.equals(v.price);
    row.result.changes = same ? {} : { price: { from: Number(current.price), to: v.price } };
    row.result.action = same ? "SKIP" : "UPDATE";
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    return write(row, ctx.userId);
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    return write(row, ctx.userId);
  },

  async exportRows() {
    const rows = await itemPriceService.listActiveCustomerServicePrices();
    return rows.map((r) => ({
      customerCode: r.customer?.code ?? "",
      itemCode: r.item.code,
      unit: UNIT_LABEL[r.item.unit],
      price: r.price.toString(),
      currency: r.currency,
    }));
  },

  async revertVersion(line, userId) {
    try {
      if (line.action === "CREATE") {
        await itemPriceService.remove(line.recordId, userId);
        return null;
      }
      const row = await itemPriceService.findActiveKey(line.recordId);
      if (!row) return "Fiyat içe aktarımdan sonra değişti ya da kaldırıldı — geri alınmaz";
      const from = (line.changedFields as Record<string, { from: unknown }> | null)?.price?.from;
      if (from === undefined || from === null) return "Önceki fiyat defterde yok";
      await itemPriceService.upsert({ itemId: row.itemId, customerId: row.customerId, kind: PriceKind.SALE, currency: row.currency, price: String(from) }, userId);
      return null;
    } catch (e) {
      const msg = revertBranchMessage(e);
      if (msg) return msg;
      throw e;
    }
  },
};

async function write(row: PreparedRow, userId?: string): Promise<{ id: string }> {
  const ids = resolved.get(row);
  if (!ids) throw new Error("Müşteri/hizmet çözümü önizlemede yapılmadı.");
  const out = await itemPriceService.upsert(
    { ...ids, kind: PriceKind.SALE, currency: row.values.currency as Currency, price: String(row.values.price) },
    userId,
  );
  return { id: out.data!.id };
}
