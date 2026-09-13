// Hata tipi (hata kataloğu) içe-dışa aktarım adaptörü.
//
// ⚠️ KOD SUNUCU ÜRETİR (`autoCode: HATA+GGAAYY+NNNN` — `defect-type.routes.ts`).
// `BaseService.create` istemcinin gönderdiği kodu DÜŞÜRÜR; bu yüzden dosyadaki
// kod yalnız EŞLEŞME içindir: dolu + eşleşen → güncelle, dolu + eşleşmeyen →
// HATA. Sessizce yeni kod üretmek round-trip'i bozar (kullanıcı dosyadaki kodun
// yazıldığını sanır, oysa kayıt bambaşka bir kodla doğmuştur).

import prisma from "../../../lib/prisma";
import { defectTypeService } from "../../../routes/defect-type.routes";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { upperTr } from "../../../utils/tr-case";

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Hata Kodu",
    type: "text",
    maxLen: 32,
    createOnly: true,
    help: "BOŞ BIRAKIN — sistem üretir (HATA…). Mevcut hata tipini güncellemek için o kaydın kodunu yazın.",
    example: "",
  },
  { key: "name", label: "Hata Adı", type: "text", required: true, maxLen: 100, example: "DELİK" },
  {
    key: "description",
    label: "Açıklama",
    // DB'de sınırsız (text); tavan yalnız dosyadan gelen devasa hücreye karşı.
    type: "text",
    maxLen: 1000,
    example: "",
  },
  {
    key: "severity",
    label: "Önem Derecesi",
    type: "enum",
    enumValues: [
      { value: "MINOR", label: "Düşük" },
      { value: "MAJOR", label: "Orta" },
      { value: "CRITICAL", label: "Kritik" },
    ],
    help: "Düşük / Orta / Kritik. Boş bırakılabilir (yalnız ekran renklendirmesi için kullanılır). Temizlemek için NULL yazın.",
    example: "Orta",
  },
  {
    key: "isActive",
    label: "Aktif",
    type: "bool",
    help: "Evet / Hayır. Boş bırakılırsa yeni kayıt AKTİF doğar.",
    example: "Evet",
  },
];

export const defectTypeImportAdapter: ImportAdapter = {
  entity: "defectType",
  label: "Hata Tipleri",
  tableName: "DEFECT_TYPE",
  writePermission: "quality:write",
  readPermission: "quality:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "defectType", field: "name", label: "hata tipi", codeField: "code" },
  notes: [
    "Hata kodunu sistem üretir — YENİ hata tipi eklerken kod sütununu BOŞ bırakın.",
    "Aynı ada sahip ikinci bir hata tipi eklenemez (Türkçe harf duyarsız karşılaştırma).",
    "Aktif hata tipleri operatör ekranında (Kurşun+KK2 / Tambur) buton olarak çıkar.",
  ],

  async findExisting(keys) {
    const rows = await prisma.defectType.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      // Beyan edilen HER sütun seçilir — eksik alan "değişmedi" sanılıp
      // UPDATE diff'inden sessizce düşerdi.
      select: { id: true, code: true, name: true, description: true, severity: true, isActive: true },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) map.set(upperTr(r.code), r as Record<string, unknown>);
    return map;
  },

  validateRow(row: PreparedRow) {
    const code = row.values.code;
    if (typeof code === "string" && code.trim() && !row.existing) {
      row.result.errors.push({
        column: "code",
        message: `'${code.trim()}' kodlu hata tipi bulunamadı. Hata kodunu sistem üretir — YENİ kayıt için bu hücreyi BOŞ bırakın.`,
      });
    }
    // NOT NULL kolona "NULL" yazmak DB hatasına düşerdi — önizlemede söyle.
    for (const key of ["name", "isActive"] as const) {
      if (row.values[key] === null) {
        row.result.errors.push({ column: key, message: "Bu alan boşaltılamaz (NULL yazılamaz)." });
      }
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const { code: _ignored, ...data } = row.values;
    void _ignored; // kod sunucu tarafında üretilir
    const res = await defectTypeService.create(data, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const { code: _ignored, ...data } = row.values;
    void _ignored; // kod değişmez
    await defectTypeService.update(id, data, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.defectType.findMany({
      orderBy: { code: "asc" },
      select: { code: true, name: true, description: true, severity: true, isActive: true },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description ?? "",
      severity: r.severity ?? "",
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};
