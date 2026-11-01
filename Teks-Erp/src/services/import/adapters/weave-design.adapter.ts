// Desen kartı (WeaveDesign) içe aktarım adaptörü — SY-H2.
//
// Kod KULLANICIDAN (desen no). Armür ızgarası tek hücrede: atkı satırları `;` ile, her satır çerçeve
// başına 0/1 (`1010;0101`). Izgara görselden okunamadıysa hücre boş kalır (uyarı değil, "dokunma").
// Yazım `weave-design.service` yolundan; pasife alma/aktifleştirme de servisin claim'li yolları.
import { WeaveDesignKind } from "@prisma/client";
import prisma from "../../../lib/prisma";
import {
  activateWeaveDesign,
  createWeaveDesign,
  deactivateWeaveDesign,
  parseLiftPlan,
  updateWeaveDesign,
} from "../../weave-design.service";
import type { ImportAdapter, ImportColumn, PreparedRow } from "../import.types";
import { importKey } from "../import-key";
import { AppError } from "../../../utils/app-error";
import { cellText, encodeLiftPlan, parseLiftPlanCell, setCanonical } from "./weaving-import.shared";

const KIND_LABELS: Record<WeaveDesignKind, string> = {
  PLAIN: "Düz",
  DOBBY: "Armür",
  JACQUARD: "Jakar",
  LENO: "Döner",
};

const COLUMNS: ImportColumn[] = [
  { key: "code", label: "Desen Kodu", type: "text", required: true, maxLen: 32, example: "D2017" },
  { key: "name", label: "Desen Adı", type: "text", required: true, maxLen: 100, example: "D2017 DÖNER" },
  {
    key: "kind",
    label: "Örgü Türü",
    type: "enum",
    required: true,
    enumValues: Object.values(WeaveDesignKind).map((value) => ({ value, label: KIND_LABELS[value] })),
    example: "Döner",
  },
  { key: "familyLabel", label: "Aile", type: "text", maxLen: 40, example: "TERGAL-DÖNER" },
  { key: "frameCount", label: "Çerçeve Sayısı", type: "int", example: "8" },
  { key: "repeatCm", label: "Desen Boyu (cm)", type: "number", example: "1,5" },
  {
    key: "liftPlan",
    label: "Armür Izgarası",
    type: "text",
    maxLen: 20000,
    help: "Atkı satırları noktalı virgülle; her satır çerçeve başına 0/1 (ör. 1010;0101). Boş = dokunma.",
    example: "",
  },
  { key: "loomFileName", label: "Tezgâh Desen Dosyası", type: "text", maxLen: 64, example: "D2017.DOP" },
  { key: "lenoSetup", label: "Döner Kurulumu", type: "text", maxLen: 100, example: "" },
  { key: "notes", label: "Not", type: "text", maxLen: 500, example: "" },
  { key: "isActive", label: "Aktif", type: "bool", example: "Evet" },
];

const SCALARS = ["code", "name", "kind", "familyLabel", "frameCount", "repeatCm", "loomFileName", "lenoSetup", "notes"] as const;

const SELECT = {
  id: true,
  code: true,
  name: true,
  kind: true,
  familyLabel: true,
  frameCount: true,
  repeatCm: true,
  liftPlan: true,
  loomFileName: true,
  lenoSetup: true,
  notes: true,
  isActive: true,
} as const;

function flatten(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    repeatCm: r.repeatCm === null ? null : Number(r.repeatCm),
    liftPlan: encodeLiftPlan(r.liftPlan),
  };
}

export const weaveDesignImportAdapter: ImportAdapter = {
  entity: "weaveDesign",
  label: "Desen Kartları",
  tableName: "WEAVE_DESIGN",
  writePermission: "warpspec:write",
  readPermission: "warpspec:read",
  module: "dokuma",
  keyColumns: ["code"],
  columns: COLUMNS,
  nameGuard: { model: "weaveDesign", field: "name", label: "desen kartı", codeField: "code" },
  notes: ["Desen kodunu siz yazarsınız. Armür ızgarası okunamadıysa hücreyi boş bırakın."],

  async findExisting(keys) {
    const rows = await prisma.weaveDesign.findMany({ where: { code: { in: keys, mode: "insensitive" } }, select: SELECT });
    return new Map(rows.map((r) => [importKey(r.code), flatten(r)]));
  },

  validateRow(row: PreparedRow) {
    if (row.values.liftPlan === undefined) return;
    const text = cellText(row.values.liftPlan);
    if (text === null) {
      setCanonical(row, "liftPlan", null);
      row.values.liftPlan__grid = null;
      return;
    }
    const parsed = parseLiftPlanCell(text);
    if (parsed.error) {
      row.result.errors.push({ column: "liftPlan", message: parsed.error });
      return;
    }
    try {
      row.values.liftPlan__grid = parseLiftPlan(parsed.plan);
    } catch (e) {
      row.result.errors.push({ column: "liftPlan", message: e instanceof AppError ? e.message : "Armür ızgarası geçersiz." });
      return;
    }
    setCanonical(row, "liftPlan", encodeLiftPlan(parsed.plan));
  },

  async createOne(row: PreparedRow, ctx) {
    const created = await createWeaveDesign(toBody(row), ctx.userId);
    if (row.values.isActive === false) await deactivateWeaveDesign(created.id, ctx.userId);
    return { id: created.id };
  },

  async updateOne(row: PreparedRow, ctx) {
    const id = row.result.targetId as string;
    const body = toBody(row);
    delete body.code;
    if (Object.keys(body).length > 0) await updateWeaveDesign(id, body, ctx.userId);
    const wantActive = row.values.isActive;
    const wasActive = row.existing?.isActive;
    if (wantActive === true && wasActive === false) await activateWeaveDesign(id, ctx.userId);
    if (wantActive === false && wasActive === true) await deactivateWeaveDesign(id, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.weaveDesign.findMany({ orderBy: { code: "asc" }, select: SELECT });
    return rows.map((r) => {
      const f = flatten(r);
      const out: Record<string, string> = {};
      for (const c of COLUMNS) {
        const v = f[c.key];
        out[c.key] = c.type === "bool" ? (v ? "Evet" : "Hayır") : v === null || v === undefined ? "" : String(v);
      }
      return out;
    });
  },
};

function toBody(row: PreparedRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SCALARS) if (row.values[k] !== undefined) out[k] = row.values[k];
  if (row.values.liftPlan__grid !== undefined) out.liftPlan = row.values.liftPlan__grid;
  return out;
}
