// Çözgü kartı (WarpSpec) içe aktarım adaptörü — SY-H2 (Seyitoğlu desen kartları).
//
// Kod KULLANICIDAN gelir (desen kodu saha dilidir, autoCode yok). İplik referansı fail-closed:
// bulunamayan/iplik olmayan/denyesiz kod satır hatasıdır — sıra dışı yükleme (iplik kalemleri
// önce) sessiz yaratma değil hata üretir. Yazım servisin kendi yolundan (guard'lar korunur).
import prisma from "../../../lib/prisma";
import { warpSpecService } from "../../../routes/warp-spec.routes";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";
import { resolveYarnCode, setCanonical } from "./weaving-import.shared";
import { normalizeDisplayName } from "../../helpers/name-normalize.helper";

const PCT_HELP = "0 ile 100 arası (100 hariç). Boş = bilinmiyor.";

const COLUMNS: ImportColumn[] = [
  { key: "code", label: "Çözgü Kartı Kodu", type: "text", required: true, maxLen: 32, example: "UA6007-Ç" },
  { key: "name", label: "Çözgü Kartı Adı", type: "text", required: true, maxLen: 100, example: "3000 ZEMİN ÇÖZGÜ" },
  {
    key: "yarnCode",
    label: "Çözgü İpliği Kodu",
    type: "lookup",
    required: true,
    lookup: { entity: "item", by: "code" },
    help: "İplik kalem kodu — İPLİK türünde ve denyesi dolu olmalı. Önce iplik kalemlerini yükleyin.",
    example: "PES-75",
  },
  { key: "endsCount", label: "Toplam Tel", type: "int", required: true, help: "Kenar teli dahil.", example: "5250" },
  { key: "selvedgeEnds", label: "Kenar Teli", type: "int", example: "" },
  { key: "reedNo", label: "Tarak No", type: "number", example: "" },
  { key: "endsPerDent", label: "Dişe Tel", type: "int", example: "" },
  { key: "reedWidthCm", label: "Tarak Eni (cm)", type: "number", example: "" },
  { key: "takeUpPct", label: "Take-up (%)", type: "number", help: PCT_HELP, example: "8" },
  { key: "wastePct", label: "Çözgü Firesi (%)", type: "number", help: PCT_HELP, example: "" },
  { key: "notes", label: "Not", type: "text", maxLen: 500, example: "" },
  { key: "isActive", label: "Aktif", type: "bool", example: "Evet" },
];

const NUM_KEYS = ["endsCount", "selvedgeEnds", "reedNo", "endsPerDent", "reedWidthCm", "takeUpPct", "wastePct"] as const;

const SELECT = {
  id: true,
  code: true,
  name: true,
  endsCount: true,
  selvedgeEnds: true,
  reedNo: true,
  endsPerDent: true,
  reedWidthCm: true,
  takeUpPct: true,
  wastePct: true,
  notes: true,
  isActive: true,
  yarnItem: { select: { code: true } },
} as const;

type Row = Record<string, unknown> & { yarnItem: { code: string } | null };

function flatten(r: Row): Record<string, unknown> {
  const out: Record<string, unknown> = { ...r, yarnCode: r.yarnItem?.code ?? null };
  for (const k of NUM_KEYS) out[k] = r[k] === null || r[k] === undefined ? null : Number(r[k]);
  delete out.yarnItem;
  return out;
}

export const warpSpecImportAdapter: ImportAdapter = {
  entity: "warpSpec",
  label: "Çözgü Kartları",
  tableName: "WARP_SPEC",
  writePermission: "warpspec:write",
  readPermission: "warpspec:read",
  module: "devere",
  keyColumns: ["code"],
  columns: COLUMNS,
  nameGuard: { model: "warpSpec", field: "name", label: "çözgü kartı", codeField: "code" },
  notes: [
    "Sıra: önce iplik kalemleri, sonra çözgü/atkı kartları, desen, ürün ve varyant.",
    "Kodu siz yazarsınız (desen kodu). Aynı kod yeniden yüklenirse kart güncellenir.",
  ],

  async findExisting(keys) {
    const rows = await prisma.warpSpec.findMany({ where: { code: { in: keys, mode: "insensitive" } }, select: SELECT });
    return new Map(rows.map((r) => [importKey(r.code), flatten(r as unknown as Row)]));
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    // Servis (BaseService) adı yazımda normalize eder; diff de aynı biçimle kurulmalı.
    if (typeof row.values.name === "string") setCanonical(row, "name", normalizeDisplayName(row.values.name));
    const raw = row.values.yarnCode;
    if (raw === null) row.result.errors.push({ column: "yarnCode", message: "Çözgü ipliği temizlenemez (zorunlu)." });
    else if (raw !== undefined) row.values.yarnCode__id = await resolveYarnCode(row, { column: "yarnCode", code: String(raw) }, ctx);
    for (const k of ["takeUpPct", "wastePct"] as const) {
      const v = row.values[k];
      if (typeof v === "number" && v >= 100) row.result.errors.push({ column: k, message: "Yüzde 100'den küçük olmalı." });
    }
    if (row.values.endsCount === 0) row.result.errors.push({ column: "endsCount", message: "Tel adedi sıfırdan büyük olmalı." });
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const res = await warpSpecService.create(toPayload(row), ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    await warpSpecService.update(id, toPayload(row), ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.warpSpec.findMany({ orderBy: { code: "asc" }, select: SELECT });
    return rows.map((r) => {
      const f = flatten(r as unknown as Row);
      const out: Record<string, string> = {};
      for (const c of COLUMNS) {
        const v = f[c.key];
        out[c.key] = c.type === "bool" ? (v ? "Evet" : "Hayır") : v === null || v === undefined ? "" : String(v);
      }
      return out;
    });
  },
};

function toPayload(row: PreparedRow): Record<string, unknown> {
  const v = row.values;
  const out: Record<string, unknown> = {};
  for (const k of ["code", "name", ...NUM_KEYS, "notes", "isActive"]) if (v[k] !== undefined) out[k] = v[k];
  if (row.result.action === "UPDATE") delete out.code;
  if (v.yarnCode__id !== undefined) out.yarnItemId = v.yarnCode__id;
  return out;
}
