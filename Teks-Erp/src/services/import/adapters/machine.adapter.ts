// Makine içe-dışa aktarım adaptörü.
//
// ⚠️ KOD SUNUCU ÜRETİR (`autoCode: MAK+GGAAYY+NNNN` — `station.routes.ts`).
// Dosyadaki kod yalnız EŞLEŞME içindir: dolu + eşleşen → güncelle, dolu +
// eşleşmeyen → HATA (sessizce başka bir kodla kayıt açmak round-trip'i bozar).
//
// ⚠️ MAKİNE ADI YALNIZ AYNI İSTASYON İÇİNDE TEKİLDİR
// (`machineService.duplicateNameScopeField = "stationId"`): "Makine 1" farklı
// istasyonlarda tekrar edebilir, aynı istasyonda edemez. Bu yüzden istasyon
// sütunu yeni kayıtta ZORUNLU — ad tek başına kaydı tanımlamaz.

import prisma from "../../../lib/prisma";
import { machineService } from "../../../routes/station.routes";
import { resolveReference } from "../import-lookup";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Makine Kodu",
    type: "text",
    maxLen: 32,
    createOnly: true,
    help: "BOŞ BIRAKIN — sistem üretir (MAK…). Mevcut makineyi güncellemek için o kaydın kodunu yazın.",
    example: "",
  },
  { key: "name", label: "Makine Adı", type: "text", required: true, maxLen: 100, example: "Kurşun 1" },
  {
    key: "stationCode",
    label: "İstasyon",
    type: "lookup",
    required: true,
    lookup: { entity: "station", by: "code" },
    help: "Makinenin bağlı olduğu istasyonun KODU (IST…). Yeni makinede ZORUNLUDUR. Ad da yazılabilir ama kod daha güvenlidir.",
    example: "IST1908260001",
  },
  {
    key: "isActive",
    label: "Aktif",
    type: "bool",
    help: "Evet / Hayır. Boş bırakılırsa yeni kayıt AKTİF doğar.",
    example: "Evet",
  },
];

export const machineImportAdapter: ImportAdapter = {
  entity: "machine",
  label: "Makineler",
  tableName: "MACHINE",
  writePermission: "station:write",
  readPermission: "station:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "machine", field: "name", label: "makine", codeField: "code", scope: { valueKey: "stationCode__id", column: "stationId" } },
  notes: [
    "Makine kodunu sistem üretir — YENİ makine eklerken kod sütununu BOŞ bırakın.",
    "Makine adı YALNIZ aynı istasyon içinde tekildir: 'Makine 1' iki farklı istasyonda olabilir, aynı istasyonda olamaz.",
    "İstasyon sütunu yeni makinede zorunludur; istasyonun ÖNCE tanımlı (ve aktif) olması gerekir.",
    "Makineyi başka bir istasyona taşımak için İstasyon sütununa yeni istasyonun kodunu yazın.",
  ],

  async findExisting(keys) {
    const rows = await prisma.machine.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      // Beyan edilen HER sütun seçilir — eksik alan UPDATE diff'inden düşerdi.
      select: {
        id: true, code: true, name: true, isActive: true,
        station: { select: { code: true } },
      },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      map.set(r.code.toLocaleUpperCase("tr-TR"), {
        ...r,
        // Diff sütun ANAHTARIYLA yapılır — mevcut istasyonu da kod olarak sun.
        stationCode: r.station?.code ?? null,
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const code = row.values.code;
    if (typeof code === "string" && code.trim() && !row.existing) {
      row.result.errors.push({
        column: "code",
        message: `'${code.trim()}' kodlu makine bulunamadı. Makine kodunu sistem üretir — YENİ kayıt için bu hücreyi BOŞ bırakın.`,
      });
    }
    // NOT NULL kolonlar "NULL" ile boşaltılamaz — makine istasyonsuz kalamaz.
    for (const key of ["name", "stationCode", "isActive"] as const) {
      if (row.values[key] === null) {
        row.result.errors.push({ column: key, message: "Bu alan boşaltılamaz (NULL yazılamaz)." });
      }
    }
    // Referansı ŞİMDİ çöz: hata önizlemede görünsün, yazma anında değil.
    const rawStation = row.values.stationCode;
    if (typeof rawStation === "string" && rawStation.trim()) {
      const out = await resolveReference("station", rawStation, ctx);
      if (out.error) row.result.errors.push({ column: "stationCode", ...out.error });
      if (out.warning) row.result.warnings.push({ column: "stationCode", message: out.warning });
      if (out.hit) row.values.stationCode__id = out.hit.id;
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const payload = toServicePayload(row);
    delete payload.code; // kod sunucu tarafında üretilir
    const res = await machineService.create(payload, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const payload = toServicePayload(row);
    delete payload.code; // kod değişmez
    await machineService.update(id, payload, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.machine.findMany({
      orderBy: { code: "asc" },
      select: { code: true, name: true, isActive: true, station: { select: { code: true } } },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      stationCode: r.station?.code ?? "",
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};

/** Satır değerlerini `machineService`'in beklediği gövdeye çevirir. */
function toServicePayload(row: PreparedRow): Record<string, unknown> {
  const v = row.values;
  const out: Record<string, unknown> = {};
  for (const key of ["code", "name", "isActive"]) {
    if (v[key] !== undefined) out[key] = v[key];
  }
  // Hücre hiç yoksa istasyona DOKUNULMAZ (D3) — makine yerinde kalır.
  if (v.stationCode__id !== undefined) out.stationId = v.stationCode__id;
  return out;
}
