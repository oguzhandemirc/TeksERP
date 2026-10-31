// Atkı kartı (WeftSpec) içe aktarım adaptörü — SY-H2. GRUPLU: aynı kodlu satırlar tek kart, her
// satır bir atkı ipliği (kart sırası = dosya sırası; A = ilk satır). İplik listesi REPLACE (③b).
// Sıra kodu (`A4 B1 A4 C1`) doluysa adetler ONDAN türer — servisin kuralı; önizleme de aynı türetimi
// yapar ki adet sütunu boş dosya her yüklemede "değişti" görünmesin.
import prisma from "../../../lib/prisma";
import { createWeftSpec, updateWeftSpec } from "../../weft-spec.service";
import { parseWeftSequence } from "../../helpers/weft-sequence.helper";
import { AppError } from "../../../utils/app-error";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";
import { resolveYarnCode, setCanonical } from "./weaving-import.shared";

const COLUMNS: ImportColumn[] = [
  { key: "code", label: "Atkı Kartı Kodu", type: "text", required: true, maxLen: 32, help: "Aynı kodlu satırlar TEK kart; her satır bir atkı ipliği.", example: "W6037" },
  { key: "name", label: "Atkı Kartı Adı", type: "text", required: true, maxLen: 100, example: "3000 ATKI" },
  { key: "picksPerCm", label: "Atkı Sıklığı (atkı/cm)", type: "number", example: "12" },
  { key: "sequenceCode", label: "Atkı Sıra Kodu", type: "text", maxLen: 120, help: "Harf = satır sırası (A ilk satır), sayı = ardışık atkı. Doluysa adet sütunu boş bırakılabilir.", example: "A20 B3" },
  { key: "sequenceNote", label: "Sıra Notu", type: "text", maxLen: 300, example: "" },
  { key: "weftProgramNo", label: "Atkı Program No", type: "text", maxLen: 16, example: "6037" },
  { key: "notes", label: "Not", type: "text", maxLen: 500, example: "" },
  {
    key: "yarnCode",
    label: "Atkı İpliği Kodu",
    type: "lookup",
    required: true,
    child: true,
    lookup: { entity: "item", by: "code" },
    help: "Bu satırın ipliği — İPLİK türünde, denyesi dolu. Önce iplik kalemlerini yükleyin.",
    example: "PES-150",
  },
  { key: "picksInRepeat", label: "Rapordaki Atkı Adedi", type: "int", child: true, help: "Sıra kodu boşsa zorunlu.", example: "20" },
];

const SELECT = {
  id: true,
  code: true,
  name: true,
  picksPerCm: true,
  sequenceCode: true,
  sequenceNote: true,
  weftProgramNo: true,
  notes: true,
  isActive: true,
  yarns: { select: { picksInRepeat: true, yarnItem: { select: { code: true } } }, orderBy: { sortOrder: "asc" as const } },
} as const;

type Child = { yarnCode: string | null; picksInRepeat: number | null };

function flatten(r: Record<string, unknown> & { yarns: Array<{ picksInRepeat: number; yarnItem: { code: string } }> }): Record<string, unknown> {
  const { yarns, ...rest } = r;
  return {
    ...rest,
    picksPerCm: rest.picksPerCm === null ? null : Number(rest.picksPerCm),
    __children: yarns.map((y): Child => ({ yarnCode: y.yarnItem.code, picksInRepeat: y.picksInRepeat })),
  };
}

const sameChildren = (a: Child[], b: Child[]): boolean =>
  a.length === b.length &&
  a.every((x, i) => importKey(String(x.yarnCode ?? "")) === importKey(String(b[i]!.yarnCode ?? "")) && x.picksInRepeat === b[i]!.picksInRepeat);

export const weftSpecImportAdapter: ImportAdapter = {
  entity: "weftSpec",
  label: "Atkı Kartları",
  tableName: "WEFT_SPEC",
  writePermission: "warpspec:write",
  readPermission: "warpspec:read",
  module: "dokuma",
  keyColumns: ["code"],
  columns: COLUMNS,
  grouped: true,
  revertCoupledFields: ["sequenceCode"],
  nameGuard: { model: "weftSpec", field: "name", label: "atkı kartı", codeField: "code" },
  notes: [
    "Aynı kodlu satırlar TEK atkı kartıdır; iplik listesi dosyadaki sırayla DEĞİŞTİRİLİR (replace).",
    "Sıra: önce iplik kalemleri, sonra atkı kartı.",
  ],

  async findExisting(keys) {
    const rows = await prisma.weftSpec.findMany({ where: { code: { in: keys, mode: "insensitive" } }, select: SELECT });
    return new Map(rows.map((r) => [importKey(r.code), flatten(r)]));
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const children = row.children ?? [];
    const ids: Array<string | null> = [];
    for (const c of children) {
      const code = c.values.yarnCode;
      ids.push(typeof code === "string" ? await resolveYarnCode(row, { column: "yarnCode", code }, ctx) : null);
    }
    row.values.yarns__ids = ids;

    const seqRaw = row.values.sequenceCode !== undefined ? row.values.sequenceCode : (row.existing?.sequenceCode ?? null);
    const seq = typeof seqRaw === "string" && seqRaw.trim() ? seqRaw : null;
    if (seq !== null && children.length > 0) {
      try {
        const parsed = parseWeftSequence(seq, children.length);
        if (typeof row.values.sequenceCode === "string") setCanonical(row, "sequenceCode", parsed.normalized);
        children.forEach((c, i) => {
          const derived = parsed.picksBySortOrder[i]!;
          const given = c.values.picksInRepeat;
          if (given !== undefined && given !== null && given !== derived) {
            row.result.errors.push({ column: "picksInRepeat", message: `${c.rowNo}. satır: adet (${String(given)}) sıra kodundan türeyenle (${derived}) çelişiyor.` });
          }
          c.values.picksInRepeat = derived;
        });
      } catch (e) {
        row.result.errors.push({ column: "sequenceCode", message: e instanceof AppError ? e.message : "Atkı sıra kodu okunamadı." });
      }
    } else {
      for (const c of children) {
        if (c.values.picksInRepeat === undefined || c.values.picksInRepeat === null || c.values.picksInRepeat === 0) {
          row.result.errors.push({ column: "picksInRepeat", message: `${c.rowNo}. satır: sıra kodu yokken rapordaki atkı adedi zorunlu (> 0).` });
        }
      }
    }

    // Türetimden sonra çocuk diff'i yeniden kurulur — yazım biçimi/boş adet değişiklik sayılmaz.
    if (row.existing && row.result.changes) {
      const next = children.map((c): Child => ({ yarnCode: (c.values.yarnCode as string) ?? null, picksInRepeat: (c.values.picksInRepeat as number) ?? null }));
      const prev = (row.existing.__children as Child[]) ?? [];
      if (sameChildren(prev, next)) delete row.result.changes.__children;
      else row.result.changes.__children = { from: prev, to: next };
      const n = Object.keys(row.result.changes).length;
      if (row.result.action === "UPDATE" && n === 0) row.result.action = "SKIP";
      if (row.result.action === "SKIP" && n > 0) row.result.action = "UPDATE";
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const created = await createWeftSpec({ ...headerBody(row), yarns: yarnsBody(row) }, ctx.userId);
    return { id: created.id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const body: Record<string, unknown> = headerBody(row);
    delete body.code;
    if (row.result.changes?.__children !== undefined || row.result.rowNo === 0) body.yarns = yarnsBody(row);
    if (Object.keys(body).length > 0) await updateWeftSpec(id, body, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.weftSpec.findMany({ orderBy: { code: "asc" }, select: SELECT });
    const out: Array<Record<string, string>> = [];
    for (const r of rows) {
      const head = {
        code: r.code,
        name: r.name,
        picksPerCm: r.picksPerCm === null ? "" : String(Number(r.picksPerCm)),
        sequenceCode: r.sequenceCode ?? "",
        sequenceNote: r.sequenceNote ?? "",
        weftProgramNo: r.weftProgramNo ?? "",
        notes: r.notes ?? "",
      };
      for (const y of r.yarns) out.push({ ...head, yarnCode: y.yarnItem.code, picksInRepeat: String(y.picksInRepeat) });
      if (r.yarns.length === 0) out.push({ ...head, yarnCode: "", picksInRepeat: "" });
    }
    return out;
  },
};

function headerBody(row: PreparedRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["code", "name", "picksPerCm", "sequenceCode", "sequenceNote", "weftProgramNo", "notes"]) {
    if (row.values[k] !== undefined) out[k] = row.values[k];
  }
  return out;
}

function yarnsBody(row: PreparedRow): Array<{ yarnItemId: string; picksInRepeat: number | null }> {
  const ids = (row.values.yarns__ids as Array<string | null>) ?? [];
  return (row.children ?? []).map((c, i) => ({
    yarnItemId: ids[i] as string,
    picksInRepeat: (c.values.picksInRepeat as number | undefined) ?? null,
  }));
}
