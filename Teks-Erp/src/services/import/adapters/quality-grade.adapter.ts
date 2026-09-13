// Kalite derecesi (kalite kataloğu) içe-dışa aktarım adaptörü.
//
// ⚠️ KOD İSTEMCİDEN GELİR: `qualityGradeService` config'inde `autoCode` YOKTUR
// (`quality-grade.routes.ts`) — kod kullanıcının yazdığı iş anahtarıdır ("A1",
// "1.KALITE", "FIRE") ve etiket şablonlarındaki koşullu basım da bu KODU okur
// (`showIf`). Bu yüzden kod ZORUNLU; boş bırakılırsa satır hata verir.
// Kod, eşleşme anahtarı olduğu için mevcut kayıtta DEĞİŞTİRİLEMEZ (`createOnly`).
//
// ⚠️ `targetStatus` YENİ KAYITTA ZORUNLU (rotadaki `validateQgCreate` ile aynı
// kural). Sebebi yıkıcı: DB varsayılanı `SCRAP`'tir — göndermeyen bir satır,
// Tambur'da sağlam topu FİREYE yazan bir derece doğurur.
// ⚠️ Adaptör servisi DOĞRUDAN çağırır, yani rotadaki Zod süzgeci KOŞMAZ:
// izin verilen `RollStatus` alt kümesini burada `enumValues` taşır. Listeyi
// genişletirken rotadaki `qgTargetEnum`/`qgReturnEnum` ile BİRLİKTE güncelle —
// ayrışırsa import, panelden yazılamayan bir statüyü yazabilir hâle gelir.

import prisma from "../../../lib/prisma";
import { qualityGradeService } from "../../../routes/quality-grade.routes";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Kalite Kodu",
    type: "text",
    required: true,
    maxLen: 32,
    createOnly: true,
    help: "Kodu SİZ yazarsınız (örn. A1, 1.KALITE, FIRE) — sistem üretmez. Mevcut kaydı güncellemek için aynı kodu yazın; kod sonradan değiştirilemez.",
    example: "A1",
  },
  { key: "name", label: "Kalite Adı", type: "text", required: true, maxLen: 100, example: "A1 Kalite" },
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
    example: "#10b981",
  },
  {
    key: "sortOrder",
    label: "Sıra",
    type: "int",
    help: "Küçük sayı üstte görünür. Boş bırakılırsa 0.",
    example: "10",
  },
  {
    key: "targetStatus",
    label: "Tambur Hedef Statüsü",
    type: "enum",
    required: true,
    enumValues: [
      { value: "WAREHOUSE", label: "Bitmiş Depo" },
      { value: "A1_STOCK", label: "2. Kalite Deposu" },
      { value: "STOCK", label: "Ham Stok" },
      { value: "SCRAP", label: "Fire" },
    ],
    help: "ZORUNLU. Tambur'da bu kalite seçilince topun ineceği statü. Yanlış yazmak sağlam topu fireye yazar.",
    example: "Bitmiş Depo",
  },
  {
    // ROL — "hangi satırı YAZAYIM" sorusu; `targetStatus` ("hangi rafa iner")
    // ile KARIŞTIRILMAZ. Bu sütun ZORUNLUDUR ama katalog satırı başına değil
    // KATALOG başına: fabrikanın en az bir satırı FIRST rolünü taşımalıdır,
    // yoksa tambur/tablet kesimi fail-closed 400 verir. Panelde kalite kataloğu
    // SALT-OKUNUR olduğu için (QualityGradesPage) rolü atamanın saha yolu
    // BUDUR — sütun olmasaydı ikinci müşteri 400'den çıkamazdı.
    key: "role",
    label: "Üretim Rolü",
    type: "enum",
    enumValues: [
      { value: "FIRST", label: "1. Kalite" },
      { value: "SECOND", label: "2. Kalite" },
      { value: "SCRAP", label: "Fire" },
    ],
    help:
      "Operatör 'fire kes' dediğinde hangi kalitenin yazılacağını belirler. " +
      "Her rolden EN FAZLA BİR aktif kalite olabilir. Boş bırakılabilir " +
      "(rolsüz kademe); temizlemek için NULL yazın.",
    example: "1. Kalite",
  },
  {
    key: "returnTargetStatus",
    label: "İade Hedef Statüsü",
    type: "enum",
    enumValues: [
      { value: "WAREHOUSE", label: "Bitmiş Depo" },
      { value: "A1_STOCK", label: "2. Kalite Deposu" },
      { value: "SCRAP", label: "Fire" },
    ],
    help: "YALNIZ müşteri iadesi akışında okunur (Tambur'u etkilemez). Boş = Bitmiş Depo. Temizlemek için NULL yazın.",
    example: "",
  },
  {
    key: "isActive",
    label: "Aktif",
    type: "bool",
    help: "Evet / Hayır. Boş bırakılırsa yeni kayıt AKTİF doğar.",
    example: "Evet",
  },
];

export const qualityGradeImportAdapter: ImportAdapter = {
  entity: "qualityGrade",
  label: "Kalite Dereceleri",
  tableName: "QUALITY_GRADE",
  writePermission: "quality:write",
  readPermission: "quality:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "qualityGrade", field: "name", label: "kalite", codeField: "code" },
  notes: [
    "Kalite kodunu SİZ yazarsınız — sistem üretmez ve kod sonradan değiştirilemez.",
    "Tambur Hedef Statüsü yeni kayıtta zorunludur: boş bırakılan derece topu FİREYE yazar.",
    "İade Hedef Statüsü yalnız iade akışında okunur; Tambur kararını etkilemez.",
    "Üretim Rolü kataloğun en az bir satırında dolu olmalıdır: '1. Kalite' rolü atanmamışsa Tambur ve tablet kesimi hata verir.",
    "Aynı ada sahip ikinci bir kalite derecesi eklenemez (Türkçe harf duyarsız karşılaştırma).",
  ],

  async findExisting(keys) {
    const rows = await prisma.qualityGrade.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      // Beyan edilen HER sütun seçilir — eksik alan UPDATE diff'inden düşerdi.
      select: {
        id: true, code: true, name: true, description: true, color: true,
        sortOrder: true, role: true, targetStatus: true, returnTargetStatus: true, isActive: true,
      },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) map.set(importKey(r.code), r as Record<string, unknown>);
    return map;
  },

  validateRow(row: PreparedRow) {
    const color = row.values.color;
    if (typeof color === "string" && color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      row.result.errors.push({ column: "color", message: "Rozet rengi #RRGGBB biçiminde olmalı (örn. #10b981)." });
    }
    // NOT NULL kolonlar "NULL" ile boşaltılamaz. `targetStatus` burada özellikle
    // önemli: DB varsayılanı SCRAP olduğu için sessiz bir boşaltma FİRE demektir.
    for (const key of ["code", "name", "sortOrder", "targetStatus", "isActive"] as const) {
      if (row.values[key] === null) {
        row.result.errors.push({ column: key, message: "Bu alan boşaltılamaz (NULL yazılamaz)." });
      }
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    // Kod İSTEMCİDEN gider (autoCode yok) — düşürülmez.
    const res = await qualityGradeService.create({ ...row.values }, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const { code: _ignored, ...data } = row.values;
    void _ignored; // kod eşleşme anahtarıdır, güncellemede gönderilmez
    await qualityGradeService.update(id, data, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.qualityGrade.findMany({
      orderBy: { code: "asc" },
      select: {
        code: true, name: true, description: true, color: true,
        sortOrder: true, role: true, targetStatus: true, returnTargetStatus: true, isActive: true,
      },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description ?? "",
      color: r.color ?? "",
      sortOrder: String(r.sortOrder),
      role: r.role ?? "",
      targetStatus: r.targetStatus,
      returnTargetStatus: r.returnTargetStatus ?? "",
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};
