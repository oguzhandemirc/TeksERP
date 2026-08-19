// İade nedeni (iade kataloğu) içe-dışa aktarım adaptörü.
//
// ⚠️ KOD SUNUCU ÜRETİR (`autoCode: IADE+GGAAYY+NNNN` — `return-reason.routes.ts`).
// Dosyadaki kod yalnız EŞLEŞME içindir: dolu + eşleşen → güncelle, dolu +
// eşleşmeyen → HATA (sessizce başka bir kodla kayıt açmak round-trip'i bozar).

import prisma from "../../../lib/prisma";
import { returnReasonService } from "../../../routes/return-reason.routes";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Neden Kodu",
    type: "text",
    maxLen: 32,
    createOnly: true,
    help: "BOŞ BIRAKIN — sistem üretir (IADE…). Mevcut nedeni güncellemek için o kaydın kodunu yazın.",
    example: "",
  },
  { key: "name", label: "Neden Adı", type: "text", required: true, maxLen: 100, example: "HASARLI ÜRÜN" },
  {
    key: "description",
    label: "Açıklama",
    // DB'de sınırsız (text); tavan yalnız dosyadan gelen devasa hücreye karşı.
    type: "text",
    maxLen: 1000,
    example: "",
  },
  {
    key: "color",
    label: "Rozet Rengi (HEX)",
    type: "text",
    maxLen: 7,
    help: "#RRGGBB biçiminde — yalnız ekran rozeti için. Boş bırakılabilir; temizlemek için NULL yazın.",
    example: "#ef4444",
  },
  {
    key: "sortOrder",
    label: "Sıra",
    type: "int",
    help: "Küçük sayı üstte görünür. Boş bırakılırsa 0.",
    example: "10",
  },
  {
    key: "isActive",
    label: "Aktif",
    type: "bool",
    help: "Evet / Hayır. Boş bırakılırsa yeni kayıt AKTİF doğar.",
    example: "Evet",
  },
];

export const returnReasonImportAdapter: ImportAdapter = {
  entity: "returnReason",
  label: "İade Nedenleri",
  tableName: "RETURN_REASON",
  writePermission: "return:write",
  readPermission: "return:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "returnReason", field: "name", label: "iade sebebi", codeField: "code" },
  notes: [
    "Neden kodunu sistem üretir — YENİ neden eklerken kod sütununu BOŞ bırakın.",
    "Aynı ada sahip ikinci bir iade nedeni eklenemez (Türkçe harf duyarsız karşılaştırma).",
    "Pasife alınan neden yeni iadelerde seçilemez; geçmiş iade kayıtları etkilenmez.",
  ],

  async findExisting(keys) {
    const rows = await prisma.returnReason.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      // Beyan edilen HER sütun seçilir — eksik alan UPDATE diff'inden düşerdi.
      select: { id: true, code: true, name: true, description: true, color: true, sortOrder: true, isActive: true },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) map.set(r.code.toLocaleUpperCase("tr-TR"), r as Record<string, unknown>);
    return map;
  },

  validateRow(row: PreparedRow) {
    const code = row.values.code;
    if (typeof code === "string" && code.trim() && !row.existing) {
      row.result.errors.push({
        column: "code",
        message: `'${code.trim()}' kodlu iade nedeni bulunamadı. Neden kodunu sistem üretir — YENİ kayıt için bu hücreyi BOŞ bırakın.`,
      });
    }
    const color = row.values.color;
    if (typeof color === "string" && color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      row.result.errors.push({ column: "color", message: "Rozet rengi #RRGGBB biçiminde olmalı (örn. #ef4444)." });
    }
    // NOT NULL kolonlar "NULL" ile boşaltılamaz — önizlemede söyle.
    for (const key of ["name", "sortOrder", "isActive"] as const) {
      if (row.values[key] === null) {
        row.result.errors.push({ column: key, message: "Bu alan boşaltılamaz (NULL yazılamaz)." });
      }
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const { code: _ignored, ...data } = row.values;
    void _ignored; // kod sunucu tarafında üretilir
    const res = await returnReasonService.create(data, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const { code: _ignored, ...data } = row.values;
    void _ignored; // kod değişmez
    await returnReasonService.update(id, data, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.returnReason.findMany({
      orderBy: { code: "asc" },
      select: { code: true, name: true, description: true, color: true, sortOrder: true, isActive: true },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description ?? "",
      color: r.color ?? "",
      sortOrder: String(r.sortOrder),
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};
