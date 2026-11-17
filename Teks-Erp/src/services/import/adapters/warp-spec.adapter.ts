// Çözgü kartı (WarpSpec) içe aktarım adaptörü — SY-H2 (Seyitoğlu desen kartları); fason devere D3: GRUPLU.
//
// Aynı kodlu satırlar TEK kart, her satır bir çözgü ipliği (kart sırası = dosya sırası; A = ilk satır); iplik
// listesi REPLACE (③b). Tek satırlı kart bugünkü biçimle aynıdır (tel = toplam tel). Kod KULLANICIDAN gelir
// (desen kodu saha dilidir, autoCode yok). İplik referansı fail-closed: bulunamayan/iplik olmayan/denyesiz kod
// satır hatasıdır. Yazım servisin kendi yolundan (`yarns` gövdesi; kolonlar satırlardan türer).
import prisma from "../../../lib/prisma";
import { warpSpecService } from "../../../routes/warp-spec.routes";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";
import { resolveYarnCode, setCanonical } from "./weaving-import.shared";
import { normalizeDisplayName } from "../../helpers/name-normalize.helper";
import { WARP_SPEC_MAX_YARNS } from "../../helpers/warp-spec-yarn-write.helper";

const PCT_HELP = "0 ile 100 arası (100 hariç). Boş = bilinmiyor.";

const COLUMNS: ImportColumn[] = [
  { key: "code", label: "Çözgü Kartı Kodu", type: "text", required: true, maxLen: 32, help: "Aynı kodlu satırlar TEK kart; her satır bir çözgü ipliği.", example: "UA6007-Ç" },
  { key: "name", label: "Çözgü Kartı Adı", type: "text", required: true, maxLen: 100, example: "3000 ZEMİN ÇÖZGÜ" },
  { key: "selvedgeEnds", label: "Kenar Teli", type: "int", example: "" },
  { key: "reedNo", label: "Tarak No", type: "number", example: "" },
  { key: "endsPerDent", label: "Dişe Tel", type: "int", example: "" },
  { key: "reedWidthCm", label: "Tarak Eni (cm)", type: "number", example: "" },
  { key: "takeUpPct", label: "Take-up (%)", type: "number", help: PCT_HELP, example: "8" },
  { key: "wastePct", label: "Çözgü Firesi (%)", type: "number", help: PCT_HELP, example: "" },
  { key: "sequenceNote", label: "Dizilim", type: "text", maxLen: 160, help: "Devereciye talimat, ör. \"1 A 1 B\" (A = ilk satırın ipliği). Hesaba girmez.", example: "1 A 1 B" },
  { key: "notes", label: "Not", type: "text", maxLen: 500, example: "" },
  { key: "isActive", label: "Aktif", type: "bool", example: "Evet" },
  {
    key: "yarnCode",
    label: "Çözgü İpliği Kodu",
    type: "lookup",
    child: true,
    lookup: { entity: "item", by: "code" },
    help: "Bu satırın ipliği — İPLİK türünde ve denyesi dolu olmalı; yeni kartta zorunlu. Önce iplik kalemlerini yükleyin.",
    example: "PES-75",
  },
  { key: "endsCount", label: "Tel Adedi", type: "int", child: true, help: "Bu ipliğin teli (kenar dahil). Tek iplikli kartta toplam tel. Yeni kartta zorunlu.", example: "5250" },
];

const HEADER_NUM_KEYS = ["selvedgeEnds", "reedNo", "endsPerDent", "reedWidthCm", "takeUpPct", "wastePct"] as const;
const HEADER_KEYS = ["code", "name", ...HEADER_NUM_KEYS, "sequenceNote", "notes", "isActive"] as const;

const SELECT = {
  id: true,
  code: true,
  name: true,
  selvedgeEnds: true,
  reedNo: true,
  endsPerDent: true,
  reedWidthCm: true,
  takeUpPct: true,
  wastePct: true,
  sequenceNote: true,
  notes: true,
  isActive: true,
  // Satırsız (göç öncesi) kart: kolonlardan tek çocuk — `warpSpecYarnLines` kuralının ikizi.
  endsCount: true,
  yarnItem: { select: { code: true } },
  yarns: { select: { endsCount: true, yarnItem: { select: { code: true } } }, orderBy: { sortOrder: "asc" as const } },
} as const;

type Child = { yarnCode: string | null; endsCount: number | null };
type Row = Record<string, unknown> & {
  endsCount: number;
  yarnItem: { code: string };
  yarns: Array<{ endsCount: number; yarnItem: { code: string } }>;
};

function childrenOf(r: Row): Child[] {
  if (r.yarns.length > 0) return r.yarns.map((y) => ({ yarnCode: y.yarnItem.code, endsCount: y.endsCount }));
  return [{ yarnCode: r.yarnItem.code, endsCount: r.endsCount }];
}

function flatten(r: Row): Record<string, unknown> {
  const { yarns: _y, yarnItem: _i, endsCount: _e, ...rest } = r;
  const out: Record<string, unknown> = { ...rest, __children: childrenOf(r) };
  for (const k of HEADER_NUM_KEYS) out[k] = rest[k] === null || rest[k] === undefined ? null : Number(rest[k]);
  return out;
}

const sameChildren = (a: Child[], b: Child[]): boolean =>
  a.length === b.length && a.every((x, i) => importKey(String(x.yarnCode ?? "")) === importKey(String(b[i]!.yarnCode ?? "")) && x.endsCount === b[i]!.endsCount);

/**
 * İplik sütunları boş satır: güncellemede "iplik listesine dokunma" (yalnız kart bilgisi), yeni kartta hata.
 * Güncellemede boş kalan iplik kodu/tel aynı sıradaki mevcut satırdan gelir (boş = dokunma kuralı; tek iplikli
 * eski dosya "yalnız tel" yazarak güncellenebilsin).
 */
function fillChildrenFromExisting(row: PreparedRow): boolean {
  const children = row.children ?? [];
  const blank = (c: { values: Record<string, unknown> }) => c.values.yarnCode === undefined && c.values.endsCount === undefined;
  if (children.every(blank)) {
    if (!row.existing) row.result.errors.push({ column: "yarnCode", message: "Çözgü İpliği Kodu ve Tel Adedi zorunlu (yeni kayıt)." });
    return false;
  }
  const prev = (row.existing?.__children as Child[] | undefined) ?? [];
  children.forEach((c, i) => {
    if (c.values.yarnCode === undefined && prev[i]?.yarnCode) c.values.yarnCode = prev[i]!.yarnCode;
    if (c.values.endsCount === undefined && prev[i]?.endsCount != null) c.values.endsCount = prev[i]!.endsCount;
    if (c.values.yarnCode === undefined) row.result.errors.push({ column: "yarnCode", message: `${c.rowNo}. satır: çözgü ipliği kodu boş.` });
  });
  return true;
}

async function validateChildren(row: PreparedRow, ctx: ImportContext): Promise<void> {
  const touch = fillChildrenFromExisting(row);
  row.values.yarns__touch = touch;
  if (!touch) return;
  const children = row.children ?? [];
  if (children.length > WARP_SPEC_MAX_YARNS) row.result.errors.push({ column: "yarnCode", message: `Bir çözgü kartında en çok ${WARP_SPEC_MAX_YARNS} iplik satırı olabilir.` });
  const ids: Array<string | null> = [];
  for (const c of children) {
    const code = c.values.yarnCode;
    ids.push(typeof code === "string" ? await resolveYarnCode(row, { column: "yarnCode", code }, ctx) : null);
    const ends = c.values.endsCount;
    if (typeof ends !== "number" || ends <= 0) row.result.errors.push({ column: "endsCount", message: `${c.rowNo}. satır: tel adedi sıfırdan büyük olmalı.` });
  }
  const codes = children.map((c) => importKey(String(c.values.yarnCode ?? "")));
  if (new Set(codes).size !== codes.length) row.result.errors.push({ column: "yarnCode", message: "Aynı iplik kartta iki satır olamaz — telleri tek satırda toplayın." });
  row.values.yarns__ids = ids;
}

/** Çocuk diff'i yeniden kurulur — yazım biçimi (kod harf farkı) değişiklik sayılmaz. */
function rebuildChildDiff(row: PreparedRow): void {
  if (!row.existing || !row.result.changes) return;
  if (row.values.yarns__touch !== true) {
    delete row.result.changes.__children;
    if (row.result.action === "UPDATE" && Object.keys(row.result.changes).length === 0) row.result.action = "SKIP";
    return;
  }
  const next = (row.children ?? []).map((c): Child => ({ yarnCode: (c.values.yarnCode as string) ?? null, endsCount: (c.values.endsCount as number) ?? null }));
  const prev = (row.existing.__children as Child[]) ?? [];
  if (sameChildren(prev, next)) delete row.result.changes.__children;
  else row.result.changes.__children = { from: prev, to: next };
  const n = Object.keys(row.result.changes).length;
  if (row.result.action === "UPDATE" && n === 0) row.result.action = "SKIP";
  if (row.result.action === "SKIP" && n > 0) row.result.action = "UPDATE";
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
  grouped: true,
  nameGuard: { model: "warpSpec", field: "name", label: "çözgü kartı", codeField: "code" },
  notes: [
    "Aynı kodlu satırlar TEK çözgü kartıdır; iplik listesi dosyadaki sırayla DEĞİŞTİRİLİR (replace). Kart bilgileri ilk satırdan okunur.",
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
    await validateChildren(row, ctx);
    for (const k of ["takeUpPct", "wastePct"] as const) {
      const v = row.values[k];
      if (typeof v === "number" && v >= 100) row.result.errors.push({ column: k, message: "Yüzde 100'den küçük olmalı." });
    }
    rebuildChildDiff(row);
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const res = await warpSpecService.create({ ...headerBody(row), yarns: yarnsBody(row) }, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const body = headerBody(row);
    delete body.code;
    if (row.values.yarns__touch === true && (row.result.changes?.__children !== undefined || row.result.rowNo === 0)) body.yarns = yarnsBody(row);
    if (Object.keys(body).length > 0) await warpSpecService.update(id, body, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.warpSpec.findMany({ orderBy: { code: "asc" }, select: SELECT });
    const out: Array<Record<string, string>> = [];
    for (const r of rows) {
      const f = flatten(r as unknown as Row);
      const head: Record<string, string> = {};
      for (const c of COLUMNS) {
        if (c.child) continue;
        const v = f[c.key];
        head[c.key] = c.type === "bool" ? (v ? "Evet" : "Hayır") : v === null || v === undefined ? "" : String(v);
      }
      for (const ch of f.__children as Child[]) out.push({ ...head, yarnCode: ch.yarnCode ?? "", endsCount: ch.endsCount === null ? "" : String(ch.endsCount) });
    }
    return out;
  },
};

function headerBody(row: PreparedRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of HEADER_KEYS) if (row.values[k] !== undefined) out[k] = row.values[k];
  return out;
}

function yarnsBody(row: PreparedRow): Array<{ yarnItemId: string; endsCount: number }> {
  const ids = (row.values.yarns__ids as Array<string | null>) ?? [];
  return (row.children ?? []).map((c, i) => ({ yarnItemId: ids[i] as string, endsCount: c.values.endsCount as number }));
}
