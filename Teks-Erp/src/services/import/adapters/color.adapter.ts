// Renk içe/dışa aktarım adaptörü.
//
// ⚠️ KOD SUNUCU ÜRETİR (`autoCode: RNK+GGAAYY+NNNN`). Dosyadaki kod yalnız
// EŞLEŞME içindir: dolu + eşleşen → güncelle; dolu + eşleşmeyen → HATA.
// Sessizce yeni kod üretmek round-trip'i bozar (kullanıcı dosyadaki kodu
// "yazıldı" sanır, oysa kayıt bambaşka bir kodla doğmuştur).

import prisma from "../../../lib/prisma";
import { colorService } from "../../../routes/color.routes";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Renk Kodu",
    type: "text",
    maxLen: 32,
    createOnly: true,
    help: "BOŞ BIRAKIN — sistem üretir (RNK…). Mevcut bir rengi güncellemek için o rengin kodunu yazın.",
    example: "",
  },
  { key: "name", label: "Renk Adı", type: "text", required: true, maxLen: 100, example: "LACİVERT" },
  {
    key: "hex",
    label: "Renk Kodu (HEX)",
    type: "text",
    maxLen: 7,
    help: "#RRGGBB biçiminde. Boş bırakılabilir.",
    example: "#1B2A5B",
  },
  {
    key: "isActive",
    label: "Aktif",
    type: "bool",
    help: "Evet / Hayır. Boş bırakılırsa yeni kayıt AKTİF doğar.",
    example: "Evet",
  },
];

export const colorImportAdapter: ImportAdapter = {
  entity: "color",
  label: "Renkler",
  tableName: "COLOR",
  // ⚠️ İZİN, VARLIĞIN GERÇEK CRUD İZNİDİR — "hangi menüde duruyor" DEĞİL.
  // (2026-08-19 düzeltmesi: burada `quality:*` yazıyordu, oysa `POST /api/colors`
  // `property:write` istiyor. Sonuç: `data:import` + `quality:write` taşıyan biri
  // panelden tek renk açamazken TOPLU renk yükleyebiliyordu — yanlış izinle
  // açılmış bir yazma kapısı. Bekçi: `scripts/test_import_permissions.ts`.)
  writePermission: "property:write",
  readPermission: "property:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "color", field: "name", label: "renk", codeField: "code", fold: "color", useFoldColumn: false },
  notes: [
    "Renk kodunu sistem üretir — YENİ renk eklerken kod sütununu BOŞ bırakın.",
    "Aynı ada sahip ikinci bir renk eklenemez (Türkçe harf duyarsız karşılaştırma).",
  ],

  async findExisting(keys) {
    const rows = await prisma.color.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      select: { id: true, code: true, name: true, hex: true, isActive: true },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) map.set(importKey(r.code ?? ""), r as Record<string, unknown>);
    return map;
  },

  validateRow(row: PreparedRow) {
    const code = row.values.code;
    if (typeof code === "string" && code.trim() && !row.existing) {
      row.result.errors.push({
        column: "code",
        message: `'${code.trim()}' kodlu renk bulunamadı. Renk kodunu sistem üretir — YENİ renk için bu hücreyi BOŞ bırakın.`,
      });
    }
    const hex = row.values.hex;
    if (typeof hex === "string" && hex && !/^#[0-9a-fA-F]{6}$/.test(hex)) {
      row.result.errors.push({ column: "hex", message: "HEX kodu #RRGGBB biçiminde olmalı (örn. #1B2A5B)." });
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const { code: _ignored, ...data } = row.values;
    void _ignored; // kod sunucu tarafında üretilir
    const res = await colorService.create(data, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const { code: _ignored, ...data } = row.values;
    void _ignored; // kod değişmez
    await colorService.update(id, data, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.color.findMany({
      orderBy: { code: "asc" },
      select: { code: true, name: true, hex: true, isActive: true },
    });
    return rows.map((r) => ({
      code: r.code ?? "",
      name: r.name ?? "",
      hex: r.hex ?? "",
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};
