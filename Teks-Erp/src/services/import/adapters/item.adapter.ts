// Kumaş (Item / stok kartı) içe-dışa aktarım adaptörü.
//
// ⚠️ KOD HİBRİT: boş bırakılırsa sunucu `STK-NNNNNN` üretir, doluysa AYNEN
// kabul edilir (mevcut `ItemService.create` davranışı — advisory kilit + kod
// tekilliği orada; buradan atlanmaz).
// ⚠️ `itemType` ve `code` GÜNCELLENEMEZ (`ItemService.update` reddeder) — bu
// yüzden `createOnly`. Sessizce yok saymak yerine satır HATA verir.
// ⚠️ `pendingReview` bilinçli olarak SÜTUN DEĞİL: mass-assignment guard'ı
// (`ItemService.create` alanları tek tek sayar) import'la delinmemeli.

import prisma from "../../../lib/prisma";
import { itemService } from "../../../routes/item.routes";
import { resolveReferenceList } from "../import-lookup";
import { splitList } from "../import-coerce";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Kumaş Kodu",
    type: "text",
    maxLen: 32,
    createOnly: true,
    help: "Boş bırakılırsa sistem üretir (STK-…). Mevcut kaydı güncellemek için kodunu yazın. 'STK-' ile başlayan kod elle yazılamaz.",
    example: "PATOS-01",
  },
  { key: "name", label: "Kumaş Adı", type: "text", required: true, maxLen: 100, example: "PATOS" },
  {
    key: "itemType",
    label: "Tür",
    type: "enum",
    required: true,
    createOnly: true,
    enumValues: [
      { value: "FABRIC", label: "Kumaş" },
      { value: "YARN", label: "İplik" },
      { value: "CONSUMABLE", label: "Sarf" },
    ],
    help: "Mevcut kayıtta DEĞİŞTİRİLEMEZ.",
    example: "Kumaş",
  },
  {
    key: "unit",
    label: "Birim",
    type: "enum",
    enumValues: [
      { value: "MT", label: "Metre" },
      { value: "KG", label: "Kilogram" },
      { value: "ADET", label: "Adet" },
    ],
    help: "Boş bırakılırsa Metre.",
    example: "Metre",
  },
  {
    key: "allowedColorCodes",
    label: "İzinli Renkler",
    type: "lookup",
    lookup: { entity: "color", by: "code", multiple: true },
    help: "Renk KODLARI, noktalı virgülle: RNK1908260001;RNK1908260002. Boş = tüm aktif renkler serbest. Temizlemek için NULL yazın.",
    example: "",
  },
  {
    key: "allowedPropertyCodes",
    label: "İzinli Özellikler",
    type: "lookup",
    lookup: { entity: "fabricProperty", by: "code", multiple: true },
    help: "Özellik KODLARI, noktalı virgülle. Boş = tüm aktif özellikler serbest.",
    example: "",
  },
  {
    key: "linearDensityDen",
    label: "Denye",
    type: "number",
    help: "Yalnız İPLİK kalemlerinde anlamlıdır ve çözgü kartı açmanın ön koşuludur (kg = tel × denye × metre ÷ 9.000.000). Ondalık ayracı virgül ya da nokta.",
    example: "150",
  },
  { key: "isActive", label: "Aktif", type: "bool", help: "Evet / Hayır.", example: "Evet" },
];

export const itemImportAdapter: ImportAdapter = {
  entity: "item",
  label: "Ürünler",
  tableName: "ITEM",
  writePermission: "item:write",
  readPermission: "item:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "item", field: "name", label: "kumaş", codeField: "code" },
  notes: [
    "Kod boş bırakılırsa sistem STK- ile başlayan bir kod üretir.",
    "Tür (Kumaş/İplik/Sarf) sonradan değiştirilemez — yanlışsa yeni kart açın.",
    "İzinli renk/özellik listesi DEĞİŞTİRME (replace) mantığıyla yazılır: dosyada ne yazıyorsa o kalır.",
  ],

  async findExisting(keys) {
    const rows = await prisma.item.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      select: {
        id: true,
        code: true,
        name: true,
        itemType: true,
        unit: true,
        linearDensityDen: true,
        isActive: true,
        allowedColors: { select: { color: { select: { code: true } } } },
        allowedProperties: { select: { property: { select: { code: true } } } },
      },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      map.set(importKey(r.code), {
        ...r,
        // Decimal NESNESİ sayı sütunuyla karşılaştırılamaz: "değişti mi"
        // sorusu dokunulmamış her satırda YANLIŞ 'evet' derdi.
        linearDensityDen: r.linearDensityDen === null ? null : Number(r.linearDensityDen),
        // Diff karşılaştırması sütun anahtarlarıyla yapılır — mevcut hâli de
        // aynı anahtarla (kod listesi) sun ki "değişti mi" doğru cevaplansın.
        allowedColorCodes: r.allowedColors.map((a) => a.color.code),
        allowedPropertyCodes: r.allowedProperties.map((a) => a.property.code),
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const code = row.values.code;
    if (typeof code === "string" && /^stk-/i.test(code.trim())) {
      row.result.errors.push({
        column: "code",
        message: "Kumaş kodu STK- ile başlayamaz — bu önek otomatik stok kodlarına ayrılmıştır (boş bırakın, sistem üretsin).",
      });
    }
    // Referansları ŞİMDİ çöz: hatalar önizlemede görünsün, uygulama anında değil.
    for (const [key, entity] of [
      ["allowedColorCodes", "color"],
      ["allowedPropertyCodes", "fabricProperty"],
    ] as const) {
      const raw = row.values[key];
      if (raw === undefined) continue;
      if (raw === null) {
        row.values[`${key}__ids`] = [];
        continue;
      }
      const { ids, errors, warnings } = await resolveReferenceList(entity, splitList(String(raw)), ctx);
      for (const m of errors) row.result.errors.push({ column: key, ...m });
      for (const m of warnings) row.result.warnings.push({ column: key, message: m });
      row.values[`${key}__ids`] = ids;
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const payload = toServicePayload(row);
    const res = await itemService.create(payload, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const payload = toServicePayload(row);
    // `code`/`itemType` update'te YASAK (servis 400 verir) — zaten createOnly
    // guard'ı satırı önizlemede durdurur; burada da göndermiyoruz.
    delete payload.code;
    delete payload.itemType;
    await itemService.update(id, payload, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.item.findMany({
      orderBy: { code: "asc" },
      select: {
        code: true,
        name: true,
        itemType: true,
        unit: true,
        linearDensityDen: true,
        isActive: true,
        allowedColors: { select: { color: { select: { code: true } } } },
        allowedProperties: { select: { property: { select: { code: true } } } },
      },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      itemType: r.itemType,
      unit: r.unit,
      linearDensityDen: r.linearDensityDen === null ? "" : String(Number(r.linearDensityDen)),
      allowedColorCodes: r.allowedColors.map((a) => a.color.code).join(";"),
      allowedPropertyCodes: r.allowedProperties.map((a) => a.property.code).join(";"),
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};

/** Satır değerlerini `ItemService`'in beklediği gövdeye çevirir. */
function toServicePayload(row: PreparedRow): Record<string, unknown> {
  const v = row.values;
  const out: Record<string, unknown> = {};
  for (const key of ["code", "name", "itemType", "unit", "linearDensityDen", "isActive"]) {
    if (v[key] !== undefined) out[key] = v[key];
  }
  if (v.allowedColorCodes__ids !== undefined) out.allowedColorIds = v.allowedColorCodes__ids;
  if (v.allowedPropertyCodes__ids !== undefined) out.allowedPropertyIds = v.allowedPropertyCodes__ids;
  return out;
}
