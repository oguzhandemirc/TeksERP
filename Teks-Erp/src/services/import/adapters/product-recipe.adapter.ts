// İş emri şablonu (ProductRecipe) içe-dışa aktarım adaptörü.
//
// ⚠️ KOD SUNUCU ÜRETİR (`autoCode: REC`) → kod sütunu yalnız EŞLEŞME içindir.
// ⚠️ `properties` M:N REPLACE semantiğiyle yazılır (servisin kendi davranışı):
// dosyada ne yazıyorsa o kalır, eksikler silinir. Boş bırakmak "dokunma"dır;
// temizlemek için NULL yazılır.

import prisma from "../../../lib/prisma";
import { productRecipeService } from "../../../routes/product-recipe.routes";
import { resolveReference, resolveReferenceList } from "../import-lookup";
import { splitList } from "../import-coerce";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Şablon Kodu",
    type: "text",
    maxLen: 32,
    createOnly: true,
    help: "BOŞ BIRAKIN — sistem üretir (REC…). Mevcut şablonu güncellemek için kodunu yazın.",
    example: "",
  },
  { key: "name", label: "Şablon Adı", type: "text", required: true, maxLen: 100, example: "PATOS LACİVERT 180" },
  {
    key: "itemCode",
    label: "Kumaş Kodu",
    type: "lookup",
    required: true,
    lookup: { entity: "item", by: "code" },
    help: "Kumaş kodu (ya da tam adı).",
    example: "PATOS-01",
  },
  {
    key: "colorCode",
    label: "Renk Kodu",
    type: "lookup",
    lookup: { entity: "color", by: "code" },
    help: "Boş = renksiz (ham) şablon.",
    example: "",
  },
  { key: "width", label: "En (cm)", type: "number", help: "Ondalık ayracı virgül ya da nokta.", example: "180" },
  {
    key: "foldType",
    label: "Kat",
    type: "text",
    maxLen: 32,
    help: "Kat kataloğundaki KOD (ASCII, örn. TUP). Katalog dışı değer reddedilir.",
    example: "",
  },
  {
    key: "routeCode",
    label: "Rota Kodu",
    type: "lookup",
    lookup: { entity: "route", by: "code" },
    help: "Boş = rota bağlı değil.",
    example: "",
  },
  {
    key: "propertyCodes",
    label: "Özellikler",
    type: "lookup",
    lookup: { entity: "fabricProperty", by: "code", multiple: true },
    help: "Özellik KODLARI, noktalı virgülle. Yazılırsa liste DEĞİŞTİRİLİR (replace).",
    example: "",
  },
  { key: "isActive", label: "Aktif", type: "bool", example: "Evet" },
];

export const productRecipeImportAdapter: ImportAdapter = {
  entity: "productRecipe",
  label: "İş Emri Şablonları",
  tableName: "PRODUCT_RECIPE",
  // ⚠️ İZİN, VARLIĞIN GERÇEK CRUD İZNİDİR (bkz. color.adapter.ts notu).
  // `POST /api/product-recipes` → `station:write`; burada `item:*` yazıyordu.
  writePermission: "station:write",
  readPermission: "station:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "productRecipe", field: "name", label: "iş emri şablonu", codeField: "code" },
  notes: [
    "Şablon kodunu sistem üretir — YENİ şablon eklerken kod sütununu BOŞ bırakın.",
    "Özellik listesi DEĞİŞTİRME (replace) mantığıyla yazılır: dosyadaki liste neyse o kalır.",
  ],

  async findExisting(keys) {
    const rows = await prisma.productRecipe.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      select: {
        id: true,
        code: true,
        name: true,
        width: true,
        foldType: true,
        isActive: true,
        item: { select: { code: true } },
        color: { select: { code: true } },
        route: { select: { code: true } },
        properties: { select: { property: { select: { code: true } } } },
      },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      map.set(r.code.toLocaleUpperCase("tr-TR"), {
        ...r,
        // Diff karşılaştırması SÜTUN anahtarlarıyla yapılır — mevcut hâli de
        // aynı anahtarlarla sun, yoksa her satır "değişti" görünür.
        itemCode: r.item?.code ?? null,
        colorCode: r.color?.code ?? null,
        routeCode: r.route?.code ?? null,
        propertyCodes: r.properties.map((p) => p.property.code),
        width: r.width === null ? null : Number(r.width),
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    for (const [key, entity] of [
      ["itemCode", "item"],
      ["colorCode", "color"],
      ["routeCode", "route"],
    ] as const) {
      const raw = row.values[key];
      if (raw === undefined) continue;
      if (raw === null) {
        row.values[`${key}__id`] = null;
        continue;
      }
      const out = await resolveReference(entity, String(raw), ctx);
      if (out.error) row.result.errors.push({ column: key, ...out.error });
      if (out.warning) row.result.warnings.push({ column: key, message: out.warning });
      row.values[`${key}__id`] = out.hit?.id ?? null;
    }

    const props = row.values.propertyCodes;
    if (props !== undefined) {
      if (props === null) {
        row.values.propertyCodes__ids = [];
      } else {
        const { ids, errors, warnings } = await resolveReferenceList(
          "fabricProperty",
          splitList(String(props)),
          ctx,
        );
        for (const m of errors) row.result.errors.push({ column: "propertyCodes", ...m });
        for (const m of warnings) row.result.warnings.push({ column: "propertyCodes", message: m });
        row.values.propertyCodes__ids = ids;
      }
    }

    const code = row.values.code;
    if (typeof code === "string" && code.trim() && !row.existing) {
      row.result.errors.push({
        column: "code",
        message: `'${code.trim()}' kodlu şablon bulunamadı. Kodu sistem üretir — YENİ şablon için bu hücreyi BOŞ bırakın.`,
      });
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const res = await productRecipeService.create(toPayload(row, false), ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    await productRecipeService.update(id, toPayload(row, true), ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.productRecipe.findMany({
      orderBy: { code: "asc" },
      select: {
        code: true,
        name: true,
        width: true,
        foldType: true,
        isActive: true,
        item: { select: { code: true } },
        color: { select: { code: true } },
        route: { select: { code: true } },
        properties: { select: { property: { select: { code: true } } } },
      },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      itemCode: r.item?.code ?? "",
      colorCode: r.color?.code ?? "",
      width: r.width === null ? "" : String(Number(r.width)),
      foldType: r.foldType ?? "",
      routeCode: r.route?.code ?? "",
      propertyCodes: r.properties.map((p) => p.property.code).join(";"),
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};

function toPayload(row: PreparedRow, isUpdate: boolean): Record<string, unknown> {
  const v = row.values;
  const out: Record<string, unknown> = {};
  for (const key of ["name", "width", "foldType", "isActive"]) {
    if (v[key] !== undefined) out[key] = v[key];
  }
  if (!isUpdate && v.code !== undefined) {
    // autoCode: servis zaten düşürür; göndermiyoruz ki niyet açık olsun.
  }
  if (v.itemCode__id !== undefined) out.itemId = v.itemCode__id;
  if (v.colorCode__id !== undefined) out.colorId = v.colorCode__id;
  if (v.routeCode__id !== undefined) out.routeId = v.routeCode__id;
  if (v.propertyCodes__ids !== undefined) {
    out.properties = (v.propertyCodes__ids as string[]).map((propertyId) => ({ propertyId }));
  }
  return out;
}
