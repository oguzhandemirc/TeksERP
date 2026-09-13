// Fason kategorisi (Boyahane, Zımpara, Baskı…) içe-dışa aktarım adaptörü.
//
// ⚠️ KOD İSTEMCİDEN GELİR ve ZORUNLUDUR — renk/müşteri adaptörlerinin tersine
// burada sunucu kod üretmez (`SubcontractorCategoryService.create` `data.code`'u
// aynen yazar). Kod aynı zamanda EŞLEŞME ANAHTARIDIR, bu yüzden `createOnly`:
// dosyada kodu değiştirmek "yeni kategori" demektir, kod düzeltmesi panelden
// yapılır.
//
// ⚠️ PASİF KAYIT DA EŞLEŞİR (`findExisting` `isActive` süzmez). Aksi hâlde satır
// CREATE'e düşer ve servis `decideCodeUniqueness` ile pasif kaydı DİRİLTİRDİ —
// yani önizlemede "yeni oluşturulacak" yazarken gerçekte mevcut kayıt üzerine
// yazılırdı. Önizleme ile sonucun ayrışması bu motorda en pahalı hatadır.
//
// ⚠️ `appliesColor` / `appliesProperty` ROTA DAVRANIŞINI değiştirir (fason kabul
// sonrası renk/özellik kopyalanması) — bu yüzden şablonda açıklamalı.

import prisma from "../../../lib/prisma";
import { SubcontractorCategoryService } from "../../subcontractor-management.service";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { upperTr } from "../../../utils/tr-case";

// Servisin paylaşılan tekili yok (controller kendi private örneğini kuruyor);
// servis durumsuz olduğu için burada kendi örneğimizi kuruyoruz.
const categoryService = new SubcontractorCategoryService();

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Kategori Kodu",
    type: "text",
    required: true,
    createOnly: true,
    maxLen: 32,
    help: "ZORUNLU — siz belirlersiniz (sistem üretmez). Mevcut kaydı güncellemek için aynı kodu yazın. Kod sonradan değiştirilemez.",
    example: "DYE_HOUSE",
  },
  { key: "name", label: "Kategori Adı", type: "text", required: true, maxLen: 100, example: "Boyahane" },
  { key: "description", label: "Açıklama", type: "text", maxLen: 1000, example: "" },
  {
    key: "appliesColor",
    label: "Renk Verir",
    type: "bool",
    help: "Evet ise bu kategorideki fason kabulünde topun rengi iş emrinin hedef renginden otomatik yazılır (Boyahane).",
    example: "Hayır",
  },
  {
    key: "appliesProperty",
    label: "Özellik Verir",
    type: "bool",
    help: "Evet ise fason kabulünde iş emrinin hedef özellikleri topa otomatik işlenir (Zımpara, Kurşun…).",
    example: "Hayır",
  },
  { key: "isActive", label: "Aktif", type: "bool", help: "Evet / Hayır.", example: "Evet" },
];

function boolVal(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function textVal(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return String(v);
}

export const subcontractorCategoryImportAdapter: ImportAdapter = {
  entity: "subcontractorCategory",
  label: "Fason Kategorileri",
  tableName: "SUBCONTRACTOR_CATEGORY",
  writePermission: "subcontractor:write",
  readPermission: "subcontractor:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "subcontractorCategory", field: "name", label: "fason kategorisi", codeField: "code" },
  notes: [
    "Kategori kodunu SİZ belirlersiniz ve zorunludur (renk/cari şablonlarının tersine sistem üretmez).",
    "Kod eşleşme anahtarıdır — sonradan değiştirilemez; yanlışsa panelden düzeltin.",
    "Aynı ada sahip ikinci kategori eklenemez (Türkçe harf ve aksan duyarsız karşılaştırma).",
    "'Renk Verir' / 'Özellik Verir' üretim davranışını değiştirir: fason kabulünde topun rengi/özellikleri otomatik yazılır.",
  ],

  async findExisting(keys) {
    // Pasifler dahil — gerekçe dosya başlığında.
    const rows = await prisma.subcontractorCategory.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      select: {
        id: true, code: true, name: true, description: true,
        appliesColor: true, appliesProperty: true, isActive: true,
      },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) map.set(upperTr(r.code), r as Record<string, unknown>);
    return map;
  },

  validateRow(row: PreparedRow) {
    const name = row.values.name;
    if (name === null) {
      row.result.errors.push({ column: "name", message: "Kategori adı temizlenemez (zorunlu alan)." });
    }
    const code = row.values.code;
    if (typeof code === "string" && /\s/.test(code)) {
      row.result.warnings.push({
        column: "code",
        message: "Kategori kodunda boşluk var — kodlar genelde boşluksuz yazılır (DYE_HOUSE gibi).",
      });
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const v = row.values;
    const description = textVal(v.description);
    const res = await categoryService.create(
      {
        code: String(v.code),
        name: String(v.name),
        // Servis imzası `description?: string` — "temizle" (null) yeni kayıtta
        // zaten boş demek, undefined'a indiriyoruz.
        ...(typeof description === "string" ? { description } : {}),
        ...(boolVal(v.appliesColor) !== undefined ? { appliesColor: boolVal(v.appliesColor) } : {}),
        ...(boolVal(v.appliesProperty) !== undefined ? { appliesProperty: boolVal(v.appliesProperty) } : {}),
      },
      ctx.userId,
    );
    const id = (res.data as { id: string }).id;
    // `create` imzası `isActive` ALMAZ (yeni kayıt aktif doğar). Pasif doğması
    // istenmişse ikinci adımda servisin kendi update'iyle kapatıyoruz — payload'a
    // gizlice fazladan alan iliştirip servisin spread'ine güvenmek yerine.
    if (boolVal(v.isActive) === false) {
      await categoryService.update(id, { isActive: false }, ctx.userId);
    }
    return { id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const v = row.values;
    const data: {
      name?: string;
      description?: string | null;
      isActive?: boolean;
      appliesColor?: boolean;
      appliesProperty?: boolean;
    } = {};
    if (typeof v.name === "string") data.name = v.name;
    const description = textVal(v.description);
    if (description !== undefined) data.description = description;
    if (boolVal(v.appliesColor) !== undefined) data.appliesColor = boolVal(v.appliesColor);
    if (boolVal(v.appliesProperty) !== undefined) data.appliesProperty = boolVal(v.appliesProperty);
    if (boolVal(v.isActive) !== undefined) data.isActive = boolVal(v.isActive);
    // `code` BİLEREK gönderilmiyor: anahtar sütunudur (createOnly).
    await categoryService.update(id, data, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.subcontractorCategory.findMany({
      orderBy: { code: "asc" },
      select: {
        code: true, name: true, description: true,
        appliesColor: true, appliesProperty: true, isActive: true,
      },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description ?? "",
      appliesColor: r.appliesColor ? "Evet" : "Hayır",
      appliesProperty: r.appliesProperty ? "Evet" : "Hayır",
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};
