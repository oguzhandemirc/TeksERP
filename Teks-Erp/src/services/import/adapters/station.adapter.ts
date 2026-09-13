// İstasyon içe-dışa aktarım adaptörü.
//
// ⚠️ KOD SUNUCU ÜRETİR (`autoCode: IST+GGAAYY+NNNN` — `station.routes.ts`).
// Dosyadaki kod yalnız EŞLEŞME içindir: dolu + eşleşen → güncelle, dolu +
// eşleşmeyen → HATA (sessizce başka bir kodla kayıt açmak round-trip'i bozar).
//
// ⚠️ Yetenek bayrakları (`appliesColor`/`appliesProperty`) istasyonun KENDİ
// alanıdır, kategoriden TÜRETİLMEZ (2026-08-10). `StationService` yalnız
// TOHUMLAR: fason kategorisi gönderildi ve bayrak gönderilmediyse kategoriden
// doldurulur; bayrak dosyada yazılıysa DOSYA KAZANIR. Bu yüzden iki bayrak
// bilerek ayrı sütun — yeni bir iç boyahane yeteneksiz doğmasın.

import prisma from "../../../lib/prisma";
import { stationService } from "../../../routes/station.routes";
import { resolveReference } from "../import-lookup";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "İstasyon Kodu",
    type: "text",
    maxLen: 32,
    createOnly: true,
    help: "BOŞ BIRAKIN — sistem üretir (IST…). Mevcut istasyonu güncellemek için o kaydın kodunu yazın.",
    example: "",
  },
  { key: "name", label: "İstasyon Adı", type: "text", required: true, maxLen: 100, example: "Kurşun + KK2" },
  {
    key: "type",
    label: "Tür",
    type: "enum",
    required: true,
    enumValues: [
      { value: "INTERNAL", label: "İç" },
      { value: "EXTERNAL", label: "Fason (Dış)" },
    ],
    help: "İç = fabrika içi; Fason (Dış) = dışarıda yapılan işlem.",
    example: "İç",
  },
  {
    key: "kind",
    label: "Rol",
    type: "enum",
    enumValues: [
      { value: "RAW_QC", label: "KK1 (Ham Giriş)" },
      { value: "PROCESS_QC", label: "Kurşun + KK2" },
      { value: "TAMBUR", label: "Tambur" },
      { value: "SUBCONTRACTOR", label: "Fason" },
      { value: "SHIPPING", label: "Sevkiyat / Tartı" },
      { value: "WEAVING", label: "Dokuma Tezgahı" },
      { value: "OTHER", label: "Diğer" },
    ],
    help: "İstasyonun domain rolü — mobil ekranların davranışı buna bağlıdır. Boş bırakılırsa Diğer.",
    example: "Diğer",
  },
  {
    key: "department",
    label: "Bölüm",
    type: "text",
    maxLen: 32,
    help: "Serbest metin (KALITE, TERBIYE, SEVKIYAT…). Boş bırakılabilir; temizlemek için NULL yazın.",
    example: "KALITE",
  },
  {
    key: "defaultCategoryCode",
    label: "Varsayılan Fason Kategorisi",
    type: "lookup",
    lookup: { entity: "subcontractorCategory", by: "code" },
    help: "Fason kategorisinin KODU — yalnız Fason (Dış) istasyonlarda anlamlıdır; iş emri planlamasında önerilir. Temizlemek için NULL yazın.",
    example: "",
  },
  {
    key: "allowAsWorkOrderStep",
    label: "İş Emri Adımı Olabilir",
    type: "bool",
    help: "Evet / Hayır. Hayır → KK1 gibi giriş noktaları; üretim akışına adım olarak girmez. Boş bırakılırsa Evet.",
    example: "Evet",
  },
  {
    key: "appliesColor",
    label: "Renk Uygular",
    type: "bool",
    help: "Evet / Hayır. Rota adımına renk hedefi yazılabilmesi bu bayrağa bağlıdır. Boş bırakılırsa Hayır.",
    example: "Hayır",
  },
  {
    key: "appliesProperty",
    label: "Özellik Uygular",
    type: "bool",
    help: "Evet / Hayır. Boş bırakılırsa Evet.",
    example: "Evet",
  },
  {
    key: "appliesQuality",
    label: "Kalite Kontrol Uygular",
    type: "bool",
    help: "Evet / Hayır. Kurşun + KK2 süreci bu istasyonda yürür mü. Boş bırakılırsa Hayır.",
    example: "Hayır",
  },
  {
    key: "isActive",
    label: "Aktif",
    type: "bool",
    help: "Evet / Hayır. Boş bırakılırsa yeni kayıt AKTİF doğar.",
    example: "Evet",
  },
];

export const stationImportAdapter: ImportAdapter = {
  entity: "station",
  label: "İstasyonlar",
  tableName: "STATION",
  writePermission: "station:write",
  readPermission: "station:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "station", field: "name", label: "istasyon", codeField: "code" },
  notes: [
    "İstasyon kodunu sistem üretir — YENİ istasyon eklerken kod sütununu BOŞ bırakın.",
    "Aynı ada sahip ikinci bir istasyon eklenemez (Türkçe harf duyarsız karşılaştırma).",
    "Fason kategorisi yazıp yetenek sütunlarını boş bırakırsanız yetenekler kategoriden doldurulur; sütunu doldurursanız DOSYADAKİ değer geçerlidir.",
    "Makineler ayrı bir şablonla aktarılır (Makineler).",
  ],

  async findExisting(keys) {
    const rows = await prisma.station.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      // Beyan edilen HER sütun seçilir — eksik alan UPDATE diff'inden düşerdi.
      select: {
        id: true, code: true, name: true, type: true, kind: true, department: true,
        allowAsWorkOrderStep: true, appliesColor: true, appliesProperty: true,
        appliesQuality: true, isActive: true,
        defaultCategory: { select: { code: true } },
      },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      map.set(importKey(r.code), {
        ...r,
        // Diff sütun ANAHTARIYLA yapılır — mevcut hâli de aynı anahtarla (kod) sun.
        defaultCategoryCode: r.defaultCategory?.code ?? null,
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const code = row.values.code;
    if (typeof code === "string" && code.trim() && !row.existing) {
      row.result.errors.push({
        column: "code",
        message: `'${code.trim()}' kodlu istasyon bulunamadı. İstasyon kodunu sistem üretir — YENİ kayıt için bu hücreyi BOŞ bırakın.`,
      });
    }
    // NOT NULL kolonlar "NULL" ile boşaltılamaz.
    for (const key of ["name", "type", "kind", "allowAsWorkOrderStep", "appliesColor", "appliesProperty", "appliesQuality", "isActive"] as const) {
      if (row.values[key] === null) {
        row.result.errors.push({ column: key, message: "Bu alan boşaltılamaz (NULL yazılamaz)." });
      }
    }
    // Referansı ŞİMDİ çöz: hata önizlemede görünsün, yazma anında değil.
    const rawCat = row.values.defaultCategoryCode;
    if (rawCat === null) {
      row.values.defaultCategoryCode__id = null; // "temizle"
    } else if (typeof rawCat === "string" && rawCat.trim()) {
      const out = await resolveReference("subcontractorCategory", rawCat, ctx);
      if (out.error) row.result.errors.push({ column: "defaultCategoryCode", ...out.error });
      if (out.warning) row.result.warnings.push({ column: "defaultCategoryCode", message: out.warning });
      if (out.hit) row.values.defaultCategoryCode__id = out.hit.id;
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const payload = toServicePayload(row);
    delete payload.code; // kod sunucu tarafında üretilir
    const res = await stationService.create(payload, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const payload = toServicePayload(row);
    delete payload.code; // kod değişmez
    await stationService.update(id, payload, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.station.findMany({
      orderBy: { code: "asc" },
      select: {
        code: true, name: true, type: true, kind: true, department: true,
        allowAsWorkOrderStep: true, appliesColor: true, appliesProperty: true,
        appliesQuality: true, isActive: true,
        defaultCategory: { select: { code: true } },
      },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      type: r.type,
      kind: r.kind,
      department: r.department ?? "",
      defaultCategoryCode: r.defaultCategory?.code ?? "",
      allowAsWorkOrderStep: r.allowAsWorkOrderStep ? "Evet" : "Hayır",
      appliesColor: r.appliesColor ? "Evet" : "Hayır",
      appliesProperty: r.appliesProperty ? "Evet" : "Hayır",
      appliesQuality: r.appliesQuality ? "Evet" : "Hayır",
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};

/** Satır değerlerini `StationService`'in beklediği gövdeye çevirir. */
function toServicePayload(row: PreparedRow): Record<string, unknown> {
  const v = row.values;
  const out: Record<string, unknown> = {};
  for (const key of [
    "code", "name", "type", "kind", "department",
    "allowAsWorkOrderStep", "appliesColor", "appliesProperty", "appliesQuality", "isActive",
  ]) {
    if (v[key] !== undefined) out[key] = v[key];
  }
  // Hücre hiç yoksa alana DOKUNULMAZ (D3) — yalnız çözülmüş id gönderilir.
  if (v.defaultCategoryCode__id !== undefined) out.defaultCategoryId = v.defaultCategoryCode__id;
  return out;
}
