// Üretim özelliği (FabricProperty) içe-dışa aktarım adaptörü.
//
// ⚠️ KOD SUNUCU ÜRETİR (`nextPropertyCode`) → kod sütunu yalnız EŞLEŞME içindir.
// ⚠️ `stationIds` YENİ KAYITTA ZORUNLUDUR (servis 400 verir) ve bu bilinçlidir:
// hiçbir istasyona bağlı olmayan özellik SESSİZCE ÖLÜ doğar (2026-08-02 saha
// vakası: `ZIMPARALI` iki hafta boyunca 0 iş emrinde göründü). Şablonda da
// zorunlu tuttuk ki aynı ölü kayıt import'la yeniden üretilmesin.
// ⚠️ SEÇİM (CHOICE) tipli özellik DEĞER LİSTESİ ister; bayrak tipli taşıyamaz.
// İkisi de servisin guard'ıdır, buradan atlanmaz — şablon yalnız erken uyarır.

import prisma from "../../../lib/prisma";
import { fabricPropertyService } from "../../../routes/fabric-property.routes";
import { resolveReferenceList } from "../import-lookup";
import { splitList } from "../import-coerce";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Özellik Kodu",
    type: "text",
    maxLen: 32,
    createOnly: true,
    help: "BOŞ BIRAKIN — sistem üretir. Mevcut özelliği güncellemek için kodunu yazın.",
    example: "",
  },
  { key: "name", label: "Özellik Adı", type: "text", required: true, maxLen: 100, example: "ZIMPARALI" },
  {
    key: "valueType",
    label: "Tip",
    type: "enum",
    enumValues: [
      { value: "FLAG", label: "Bayrak" },
      { value: "CHOICE", label: "Seçim" },
    ],
    help: "Bayrak = var/yok. Seçim = birbirini dışlayan değerlerden biri (değer listesi zorunlu).",
    example: "Bayrak",
  },
  {
    key: "stationCodes",
    label: "İstasyonlar",
    type: "lookup",
    required: true,
    lookup: { entity: "station", by: "code", multiple: true },
    help: "İstasyon KODLARI, noktalı virgülle. YENİ kayıtta ZORUNLU — bağsız özellik hiçbir yerde görünmez. Yazılırsa liste değiştirilir (replace).",
    example: "",
  },
  {
    key: "valueCodes",
    label: "Değerler (Seçim tipi)",
    type: "text",
    maxLen: 1000,
    help: "Yalnız Seçim tipinde. Biçim: KOD=Ad;KOD=Ad (örn. 2KAT=2 Kat;TUP=Tüp). Kodlar ASCII olmalı.",
    example: "",
  },
  { key: "category", label: "Kategori", type: "text", maxLen: 100, help: "Panelde gruplama etiketi.", example: "" },
  { key: "description", label: "Açıklama", type: "text", maxLen: 1000, example: "" },
  { key: "color", label: "Renk (HEX)", type: "text", maxLen: 7, help: "#RRGGBB rozet rengi.", example: "" },
  { key: "sortOrder", label: "Sıra", type: "int", example: "0" },
  { key: "isActive", label: "Aktif", type: "bool", example: "Evet" },
];

export const fabricPropertyImportAdapter: ImportAdapter = {
  entity: "fabricProperty",
  label: "Üretim Özellikleri",
  tableName: "FABRIC_PROPERTY",
  writePermission: "property:write",
  readPermission: "property:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  notes: [
    "Özellik kodunu sistem üretir — YENİ özellik eklerken kod sütununu BOŞ bırakın.",
    "İstasyon listesi YENİ kayıtta zorunludur: hiçbir istasyona bağlı olmayan özellik iş emri ekranlarında GÖRÜNMEZ.",
    "Seçim tipli özellik en az bir değer ister; bayrak tipli değer listesi taşıyamaz.",
    "Değer listesi replace'tir — listede olmayan değer SİLİNMEZ, PASİFLEŞİR (geçmiş kayıtlar bozulmasın).",
  ],

  async findExisting(keys) {
    const rows = await prisma.fabricProperty.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      select: {
        id: true,
        code: true,
        name: true,
        valueType: true,
        category: true,
        description: true,
        color: true,
        sortOrder: true,
        isActive: true,
        stationCapabilities: { select: { station: { select: { code: true } } } },
        values: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
          select: { code: true, name: true },
        },
      },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      map.set(r.code.toLocaleUpperCase("tr-TR"), {
        ...r,
        stationCodes: r.stationCapabilities.map((c) => c.station.code),
        valueCodes: r.values.map((v) => `${v.code}=${v.name}`).join(";"),
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const code = row.values.code;
    if (typeof code === "string" && code.trim() && !row.existing) {
      row.result.errors.push({
        column: "code",
        message: `'${code.trim()}' kodlu özellik bulunamadı. Kodu sistem üretir — YENİ özellik için bu hücreyi BOŞ bırakın.`,
      });
    }

    const stations = row.values.stationCodes;
    if (stations === null) {
      row.result.errors.push({
        column: "stationCodes",
        message: "İstasyon listesi temizlenemez — bağsız özellik hiçbir ekranda görünmez.",
      });
    } else if (stations !== undefined) {
      const { ids, errors, warnings } = await resolveReferenceList("station", splitList(String(stations)), ctx);
      for (const m of errors) row.result.errors.push({ column: "stationCodes", message: m });
      for (const m of warnings) row.result.warnings.push({ column: "stationCodes", message: m });
      if (ids.length === 0) {
        row.result.errors.push({ column: "stationCodes", message: "En az bir istasyon gerekli." });
      }
      row.values.stationCodes__ids = ids;
    }

    // Değer listesi: "KOD=Ad;KOD=Ad"
    const rawValues = row.values.valueCodes;
    const effectiveType =
      (row.values.valueType as string | undefined) ??
      (row.existing?.valueType as string | undefined) ??
      "FLAG";
    if (rawValues !== undefined && rawValues !== null && String(rawValues).trim()) {
      const parsed: Array<{ code: string; name: string; sortOrder: number }> = [];
      let bad = false;
      splitList(String(rawValues)).forEach((pair, i) => {
        const [c, ...rest] = pair.split("=");
        const name = rest.join("=").trim();
        if (!c?.trim() || !name) {
          bad = true;
          return;
        }
        if (!/^[A-Za-z0-9_-]+$/.test(c.trim())) {
          row.result.errors.push({
            column: "valueCodes",
            message: `Değer kodu ASCII olmalı ('${c.trim()}' geçersiz — Türkçe karakter kullanmayın).`,
          });
          bad = true;
          return;
        }
        parsed.push({ code: c.trim().toLocaleUpperCase("en-US"), name, sortOrder: i });
      });
      if (bad) {
        row.result.errors.push({
          column: "valueCodes",
          message: "Değer listesi biçimi: KOD=Ad;KOD=Ad (örn. 2KAT=2 Kat;TUP=Tüp).",
        });
      }
      if (effectiveType === "FLAG") {
        row.result.errors.push({
          column: "valueCodes",
          message: "Bayrak tipli özellik değer listesi taşıyamaz — tipi 'Seçim' yapın.",
        });
      }
      row.values.valueCodes__parsed = parsed;
    } else if (effectiveType === "CHOICE" && !row.existing) {
      row.result.errors.push({
        column: "valueCodes",
        message: "Seçim tipli özellik en az bir değer ister (KOD=Ad).",
      });
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const res = await fabricPropertyService.create(toPayload(row), ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    await fabricPropertyService.update(id, toPayload(row), ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.fabricProperty.findMany({
      orderBy: { code: "asc" },
      select: {
        code: true,
        name: true,
        valueType: true,
        category: true,
        description: true,
        color: true,
        sortOrder: true,
        isActive: true,
        stationCapabilities: { select: { station: { select: { code: true } } } },
        values: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
          select: { code: true, name: true },
        },
      },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      valueType: r.valueType,
      stationCodes: r.stationCapabilities.map((c) => c.station.code).join(";"),
      valueCodes: r.values.map((v) => `${v.code}=${v.name}`).join(";"),
      category: r.category ?? "",
      description: r.description ?? "",
      color: r.color ?? "",
      sortOrder: String(r.sortOrder),
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};

function toPayload(row: PreparedRow): Record<string, unknown> {
  const v = row.values;
  const out: Record<string, unknown> = {};
  for (const key of ["name", "valueType", "category", "description", "color", "sortOrder", "isActive"]) {
    if (v[key] !== undefined) out[key] = v[key];
  }
  // ⚠️ `stationIds` yalnız GÖNDERİLDİĞİNDE yazılır: servis "verilmezse bağlara
  // DOKUNMA" sözleşmesini taşıyor (ad düzenlemesi bağı silmesin).
  if (v.stationCodes__ids !== undefined) out.stationIds = v.stationCodes__ids;
  if (v.valueCodes__parsed !== undefined) out.values = v.valueCodes__parsed;
  return out;
}
