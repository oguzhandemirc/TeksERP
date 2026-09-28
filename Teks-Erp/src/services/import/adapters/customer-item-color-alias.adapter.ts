// Kumaşa özel müşteri renk adı (müşteri × kumaş × renk) — üçüncü ad eşlemesi adaptörü.
// Tasarım: docs/design/MUSTERI-KUMAS-RENK-ADI.md §9 D5, §11 karar 6.
//
// Anahtar ÜÇLÜDÜR ve kardeşler gibi TEK sütunda taşınır: `CARİ|ÜRÜN|RENK` (ilk iki
// `|` böler) — motor satırı tek sütunla eşleştirir, anahtarı diğer hücrelerden
// türetemez. Ad/kod bilgi sütunları `readOnly`; yazılan TEK alan `alias`tır.
// Kumaş kapısı (`DEFINITION`) önizlemede de sorulur (yalnız yazılacak satırda):
// "Tükenene kadar"/Pasif kumaş yazma anında 409 verip koşumu yarıda DURDURMASIN.

import prisma from "../../../lib/prisma";
import { CustomerAliasService } from "../../customer-alias.service";
import { assertItemUsable } from "../../helpers/item-usage.helper";
import { AppError } from "../../../utils/app-error";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";
import {
  KEY_SEP,
  loadCustomers,
  parseAliasKey,
  targetIdField,
  validateAliasRow,
} from "./customer-alias.adapter";

const aliasService = new CustomerAliasService();

// Örnekte seri kodu YAZILMAZ: cari/renk kodu biçimi veridir, literal bayatlar (`test_bayat_kod_literali`).
const ORNEK = ["CARİ-KODU", "PATOS-01", "RENK-KODU"].join(KEY_SEP);

const COLUMNS: ImportColumn[] = [
  {
    key: "externalKey",
    label: "Anahtar (Cari Kodu|Kumaş Kodu|Renk Kodu)",
    type: "text",
    required: true,
    createOnly: true,
    // Defter kolonu (`ImportRunLine.keyValue`) 120; üç kod en çok 32'şer karakter.
    maxLen: 120,
    help:
      `Dikey çizgi ile ayırın: CARİ KODU|KUMAŞ KODU|RENK KODU (örn. ${ORNEK}). ` +
      "Kodlar sistemdeki kodlardır (dışa aktarımdan kopyalayın); bulunamazsa satır hata verir.",
    example: ORNEK,
  },
  { key: "customerName", label: "Cari Ünvanı (bilgi)", type: "text", readOnly: true, help: "Yalnız bilgi amaçlıdır — dışa aktarımda dolar, içe aktarımda yok sayılır.", example: "" },
  { key: "itemName", label: "Kumaş Adı — bizdeki (bilgi)", type: "text", readOnly: true, help: "Yalnız bilgi amaçlıdır; karşılaştırma için dışa aktarımda doldurulur.", example: "" },
  { key: "colorName", label: "Renk Adı — bizdeki (bilgi)", type: "text", readOnly: true, help: "Yalnız bilgi amaçlıdır; karşılaştırma için dışa aktarımda doldurulur.", example: "" },
  {
    key: "alias",
    label: "Renk Adı — müşterideki (bu kumaşta)",
    type: "text",
    required: true,
    maxLen: 200,
    help: "Müşterinin YALNIZ bu kumaştaki renge verdiği ad. BÜYÜK harfe çevrilerek saklanır. Boş bırakılırsa mevcut ada DOKUNULMAZ.",
    example: "",
  },
];

type Hit = { id: string; code: string; name: string };

async function byCode(model: "item" | "color", codes: string[]): Promise<Map<string, Hit>> {
  const where = { code: { in: [...new Set(codes)], mode: "insensitive" as const } };
  const select = { id: true, code: true, name: true } as const;
  const rows: Hit[] =
    model === "item" ? await prisma.item.findMany({ where, select }) : await prisma.color.findMany({ where, select });
  return new Map(rows.map((r) => [importKey(r.code), r]));
}

async function upsertRow(row: PreparedRow, ctx: ImportContext): Promise<{ id: string }> {
  const res = await aliasService.upsertItemColorAlias(
    {
      customerId: row.values.__customerId as string,
      itemId: row.values[targetIdField("item")] as string,
      colorId: row.values[targetIdField("color")] as string,
    },
    String(row.values.alias),
    ctx.userId,
  );
  return { id: res.data.id };
}

export const customerItemColorAliasImportAdapter: ImportAdapter = {
  entity: "customerItemColorAlias",
  label: "Müşteri Kumaşa Özel Renk Adları",
  tableName: "CUSTOMER_ITEM_COLOR_ALIAS",
  writePermission: "customer-alias:write",
  readPermission: "customer-alias:read",
  keyColumns: ["externalKey"],
  // Tablet 1.0.8 "kalıcı" düzeltmede çözülmüş (kumaşa özel olabilen) adı GENEL ada yazar
  // (MUSTERI-KUMAS-RENK-ADI §7): kumaşa özel ad girişi D4 bütün tabletlere ulaşınca açılır.
  releaseGate:
    "kumaşa özel renk adı girişi, tablet güncellemesi bütün tabletlere ulaştıktan sonra açılacak " +
    "(eski tablet bu adı müşterinin genel renk adına yazabilir).",
  columns: COLUMNS,
  notes: [
    "Bir satır = bir eşleme. Anahtar ÜÇ parçalıdır ve dikey çizgi ile ayrılır: CARİ|KUMAŞ|RENK.",
    "Bu ad YALNIZ o kumaştaki renge basılır; aynı rengin diğer kumaşları genel müşteri renk adını (Müşteri Renk Adları şablonu) kullanır.",
    "Müşteri, kumaş ve renk ANAHTARDAN okunur; '(bilgi)' yazan sütunları doldurmanız gerekmez.",
    "Boş bırakılan ad hücresi mevcut adı DEĞİŞTİRMEZ; ad BÜYÜK harfe çevrilerek saklanır.",
    "'Tükenene kadar' ya da Pasif kumaşa yeni ad eklenemez.",
    "Eşlemeyi kaldırmak bu şablonla YAPILMAZ (silme yok) — panelden kaldırın.",
  ],

  async findExisting(keys) {
    const map = new Map<string, Record<string, unknown>>();
    const parsed = keys
      .map((raw) => ({ raw, parts: parseAliasKey(raw, 3) }))
      .filter((p): p is { raw: string; parts: string[] } => p.parts !== null);
    if (parsed.length === 0) return map;

    const customerByCode = await loadCustomers(parsed.map((p) => p.parts[0]!));
    if (customerByCode.size === 0) return map;
    const itemByCode = await byCode("item", parsed.map((p) => p.parts[1]!));
    const colorByCode = await byCode("color", parsed.map((p) => p.parts[2]!));
    if (itemByCode.size === 0 || colorByCode.size === 0) return map;

    const rows = await prisma.customerItemColorAlias.findMany({
      where: {
        customerId: { in: [...customerByCode.values()].map((c) => c.id) },
        itemId: { in: [...itemByCode.values()].map((i) => i.id) },
        colorId: { in: [...colorByCode.values()].map((c) => c.id) },
      },
      select: { id: true, customerId: true, itemId: true, colorId: true, alias: true },
    });
    const byTriple = new Map(rows.map((r) => [`${r.customerId}:${r.itemId}:${r.colorId}`, r]));

    for (const { raw, parts } of parsed) {
      const customer = customerByCode.get(importKey(parts[0]!));
      const item = itemByCode.get(importKey(parts[1]!));
      const color = colorByCode.get(importKey(parts[2]!));
      if (!customer || !item || !color) continue;
      const hit = byTriple.get(`${customer.id}:${item.id}:${color.id}`);
      if (!hit) continue;
      map.set(importKey(raw), {
        id: hit.id,
        // `name` sütun DEĞİL — motorun satır etiketi olarak kullandığı alan.
        name: `${customer.name} · ${item.name} · ${color.name}`,
        externalKey: [customer.code, item.code, color.code].join(KEY_SEP),
        customerName: customer.name,
        itemName: item.name,
        colorName: color.name,
        alias: hit.alias,
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    await validateAliasRow(row, ctx, {
      targets: ["item", "color"],
      bucketKey: "customerItemColorAlias:target",
      format: "CARİ KODU|KUMAŞ KODU|RENK KODU",
      pivot: "customerItemColorAlias",
    });
    // Yalnız YAZILACAK satır sorulur: değişmeyen (SKIP) satır servise hiç ulaşmaz;
    // hata alırsa dışa aktar → geri yükle turu `abort` ile bütünüyle reddedilir.
    if (row.result.action !== "CREATE" && row.result.action !== "UPDATE") return;
    const itemId = row.values[targetIdField("item")];
    if (typeof itemId !== "string") return;
    try {
      await assertItemUsable(prisma, itemId, "DEFINITION");
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      row.result.errors.push({ column: "externalKey", message: e.message });
    }
  },

  createdClaim: (row) => ({
    customerId: row.values.__customerId,
    itemId: row.values[targetIdField("item")],
    colorId: row.values[targetIdField("color")],
    alias: row.values.alias,
  }),

  async createOne(row: PreparedRow, ctx: ImportContext) {
    return upsertRow(row, ctx);
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    return upsertRow(row, ctx);
  },

  async exportRows() {
    const rows = await prisma.customerItemColorAlias.findMany({
      orderBy: [{ customer: { code: "asc" } }, { item: { code: "asc" } }, { color: { code: "asc" } }],
      select: {
        alias: true,
        customer: { select: { code: true, name: true } },
        item: { select: { code: true, name: true } },
        color: { select: { code: true, name: true } },
      },
    });
    return rows.map((r) => ({
      externalKey: [r.customer.code, r.item.code, r.color.code].join(KEY_SEP),
      customerName: r.customer.name,
      itemName: r.item.name,
      colorName: r.color.name,
      alias: r.alias,
    }));
  },
};
