// =============================================================================
// BRODE KURULUM BETİĞİ — Gülkesim iç/dış brode verisi (DALGA4 §5.3–§5.4, K7; D4-D4)
// =============================================================================
// Brode yeri, desen kataloğu ve rota şablonları VERİDİR (profil paketine girmez). Bu betik
// onları tek seferde kurar: brode hizmet kalemi · BRODE bayrağı · "Brode deseni" çeşidi +
// desen değerleri (desen bazında kalem isteğe bağlı, S7) · iç brode istasyonu (PROCESS_QC;
// bayrak AUTO + desen REQUIRED → tablette desen düğmesi) · "Brode" fason kategorisi (özellik
// uygular) · dış brode fason istasyonu (SUBCONTRACTOR + BRODE, varsayılan kategori) · Tambur-2 · iki rota şablonu (iç: Brode → Tambur-2; dış: Fason → Tambur-2).
//
// Koşum (DATABASE_URL ortamdan):
//   tsx scripts/brode-kurulum.ts [--girdi=<json>]                          → KURU KOŞU: listeler, 0 yazım
//   tsx scripts/brode-kurulum.ts [--girdi=<json>] --apply --kullanici=<ad> → listeler, sonra TEK tx'te yazar
// Var olan kayıt koda göre bulunur; yalnız boş alan doldurulur (UPDATE). Tür/çeşit/rota adımı
// farklı olan kayıt ÇAKIŞMA'dır: --apply hiçbir şey yazmadan durur (veri elle incelenir).
// Dış brode FİRMASINI kategoriye bağlamaz (hangi firma — panel, Fason Firmaları).
// Fiyat (ItemPrice) KURMAZ — müşteri/desen fiyatı para kararıdır, panelden girilir.
// Çıkış: 0 tamam · 1 çakışma/uygulanamadı · 2 kullanım/geçersiz girdi.
// =============================================================================
import { readFileSync } from "node:fs";
import { ItemType, Prisma, StationKind, StationPropertyMode, StationType } from "@prisma/client";
import { z } from "zod";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";
import { inspectionDefaultForKind } from "../src/services/helpers/quality-station.helper";

type Db = Prisma.TransactionClient;
interface CodeName { code: string; name: string }

export interface BrodeSetupInput {
  serviceItem: CodeName;
  flag: CodeName;
  patternProperty: CodeName;
  /** Desen bazında ücret (S7) için ayrı hizmet kalemleri; desen satırı `serviceItemCode` ile bağlanır. */
  patternServiceItems: CodeName[];
  patterns: Array<CodeName & { serviceItemCode?: string | null }>;
  internalStation: CodeName;
  externalStation: CodeName;
  /** Fason kategorisi (`appliesProperty`): kabulde uygulanan özellik iş emri hedefinden bu kategoriyle çözülür. */
  externalCategory: CodeName;
  tamburStation: CodeName;
  internalRoute: CodeName;
  externalRoute: CodeName;
}

/** Gülkesim varsayılanı; desen listesi müşteriye göre `--girdi` ile verilir (panelden de eklenebilir). */
export const GULKESIM_BRODE_DEFAULTS: BrodeSetupInput = {
  serviceItem: { code: "HZM-BRODE", name: "Brode hizmeti" },
  flag: { code: "BRODE", name: "Brode" },
  patternProperty: { code: "BRODE-DESEN", name: "Brode deseni" },
  patternServiceItems: [],
  patterns: [],
  internalStation: { code: "BRODE", name: "Brode" },
  externalStation: { code: "BRODE-FASON", name: "Brode (dış fason)" },
  externalCategory: { code: "BRODE", name: "Brode" },
  tamburStation: { code: "TAMBUR-2", name: "Tambur-2" },
  internalRoute: { code: "BRODE-IC", name: "Brode (iç) → Tambur-2" },
  externalRoute: { code: "BRODE-DIS", name: "Brode (dış fason) → Tambur-2" },
};

export type SetupAction = "CREATE" | "UPDATE" | "SAME" | "CONFLICT";
export interface SetupRecord {
  kind: "ITEM" | "FABRIC_PROPERTY" | "FABRIC_PROPERTY_VALUE" | "SUBCONTRACTOR_CATEGORY" | "STATION" | "STATION_PROPERTY" | "ROUTE";
  key: string;
  action: SetupAction;
  detail: string;
  /** Yazılan/okunan kaydın kimliği (kuru koşuda yaratılacak kayıt için null). */
  id: string | null;
  /** Audit için: kaydın tablosu + kaydı. */
  auditTable: string;
  auditRecordId: string | null;
}

/** Tek yol: kuru koşu (`write=false`) ile uygulama AYNI kararı verir; yalnız yazım dalı farklıdır. */
export async function runBrodeSetup(db: Db, input: BrodeSetupInput, write: boolean, userId: string | null): Promise<SetupRecord[]> {
  const out: SetupRecord[] = [];
  const push = (r: Omit<SetupRecord, "auditTable" | "auditRecordId"> & { auditTable?: string; auditRecordId?: string | null }) =>
    out.push({ ...r, auditTable: r.auditTable ?? r.kind, auditRecordId: r.auditRecordId ?? r.id });
  const audit = userId ? { createdById: userId, updatedById: userId } : {};

  const ensureItem = async (it: CodeName): Promise<string | null> => {
    const row = await db.item.findUnique({ where: { code: it.code }, select: { id: true, itemType: true } });
    if (row && row.itemType !== ItemType.SERVICE) {
      push({ kind: "ITEM", key: it.code, action: "CONFLICT", detail: `kalem var ama türü ${row.itemType} (SERVICE değil)`, id: row.id });
      return null;
    }
    if (row) { push({ kind: "ITEM", key: it.code, action: "SAME", detail: it.name, id: row.id }); return row.id; }
    const id = write ? (await db.item.create({ data: { code: it.code, name: it.name, itemType: ItemType.SERVICE, unit: "MT" }, select: { id: true } })).id : null;
    push({ kind: "ITEM", key: it.code, action: "CREATE", detail: `${it.name} (hizmet kalemi, MT)`, id });
    return id;
  };
  const serviceItemId = await ensureItem(input.serviceItem);
  const patternItemIds = new Map<string, string | null>();
  for (const it of input.patternServiceItems) patternItemIds.set(it.code, await ensureItem(it));

  // BRODE bayrağı: kalem boşsa doldurulur; başka kaleme bağlıysa çakışma (faturayı değiştirir).
  const flagRow = await db.fabricProperty.findUnique({ where: { code: input.flag.code }, select: { id: true, valueType: true, serviceItemId: true, variant: { select: { code: true } } } });
  let flagId: string | null = flagRow?.id ?? null;
  if (flagRow && flagRow.valueType !== "FLAG") {
    push({ kind: "FABRIC_PROPERTY", key: input.flag.code, action: "CONFLICT", detail: `özellik var ama tipi ${flagRow.valueType} (BAYRAK değil)`, id: flagRow.id });
    flagId = null;
  } else if (flagRow && flagRow.serviceItemId && flagRow.serviceItemId !== serviceItemId) {
    push({ kind: "FABRIC_PROPERTY", key: input.flag.code, action: "CONFLICT", detail: "bayrak başka bir hizmet kalemine bağlı", id: flagRow.id });
  } else if (flagRow && !flagRow.serviceItemId) {
    if (write && serviceItemId) await db.fabricProperty.update({ where: { id: flagRow.id }, data: { serviceItemId, ...(userId ? { updatedById: userId } : {}) } });
    push({ kind: "FABRIC_PROPERTY", key: input.flag.code, action: "UPDATE", detail: `hizmet kalemi → ${input.serviceItem.code}`, id: flagRow.id });
  } else if (flagRow) {
    push({ kind: "FABRIC_PROPERTY", key: input.flag.code, action: "SAME", detail: input.flag.name, id: flagRow.id });
  } else {
    flagId = write ? (await db.fabricProperty.create({ data: { code: input.flag.code, name: input.flag.name, valueType: "FLAG", serviceItemId, ...audit }, select: { id: true } })).id : null;
    push({ kind: "FABRIC_PROPERTY", key: input.flag.code, action: "CREATE", detail: `${input.flag.name} (bayrak, kalem ${input.serviceItem.code})`, id: flagId });
  }

  // Desen çeşidi: bayrağın TEK çeşidi (variantOfPropertyId @unique) — bayrağın başka çeşidi varsa çakışma.
  const patRow = await db.fabricProperty.findUnique({ where: { code: input.patternProperty.code }, select: { id: true, valueType: true, variantOfPropertyId: true } });
  let patternId: string | null = patRow?.id ?? null;
  if (flagRow?.variant && flagRow.variant.code !== input.patternProperty.code) {
    push({ kind: "FABRIC_PROPERTY", key: input.patternProperty.code, action: "CONFLICT", detail: `bayrağın zaten başka çeşidi var (${flagRow.variant.code})`, id: patRow?.id ?? null });
    patternId = null;
  } else if (patRow && (patRow.valueType !== "CHOICE" || (patRow.variantOfPropertyId && patRow.variantOfPropertyId !== flagId))) {
    push({ kind: "FABRIC_PROPERTY", key: input.patternProperty.code, action: "CONFLICT", detail: "özellik var ama SEÇİM tipi değil ya da başka bayrağın çeşidi", id: patRow.id });
    patternId = null;
  } else if (patRow && !patRow.variantOfPropertyId) {
    if (write && flagId) await db.fabricProperty.update({ where: { id: patRow.id }, data: { variantOfPropertyId: flagId } });
    push({ kind: "FABRIC_PROPERTY", key: input.patternProperty.code, action: "UPDATE", detail: `çeşit bağı → ${input.flag.code}`, id: patRow.id });
  } else if (patRow) {
    push({ kind: "FABRIC_PROPERTY", key: input.patternProperty.code, action: "SAME", detail: input.patternProperty.name, id: patRow.id });
  } else {
    patternId = write && flagId ? (await db.fabricProperty.create({ data: { code: input.patternProperty.code, name: input.patternProperty.name, valueType: "CHOICE", variantOfPropertyId: flagId, ...audit }, select: { id: true } })).id : null;
    push({ kind: "FABRIC_PROPERTY", key: input.patternProperty.code, action: "CREATE", detail: `${input.patternProperty.name} (${input.flag.code} çeşidi)`, id: patternId });
  }

  for (const [i, p] of input.patterns.entries()) {
    const key = `${input.patternProperty.code}/${p.code}`;
    const itemId = p.serviceItemCode ? (patternItemIds.get(p.serviceItemCode) ?? (await db.item.findUnique({ where: { code: p.serviceItemCode }, select: { id: true } }))?.id ?? null) : null;
    if (p.serviceItemCode && !itemId && !input.patternServiceItems.some((it) => it.code === p.serviceItemCode)) {
      push({ kind: "FABRIC_PROPERTY_VALUE", key, action: "CONFLICT", detail: `desen kalemi bulunamadı: ${p.serviceItemCode}`, id: null, auditTable: "FABRIC_PROPERTY", auditRecordId: patternId });
      continue;
    }
    const row = patternId ? await db.fabricPropertyValue.findUnique({ where: { propertyId_code: { propertyId: patternId, code: p.code } }, select: { id: true, serviceItemId: true } }) : null;
    const base = { kind: "FABRIC_PROPERTY_VALUE" as const, key, auditTable: "FABRIC_PROPERTY", auditRecordId: patternId };
    if (row && row.serviceItemId && itemId && row.serviceItemId !== itemId) {
      push({ ...base, action: "CONFLICT", detail: "desen başka bir hizmet kalemine bağlı", id: row.id });
    } else if (row && !row.serviceItemId && itemId) {
      if (write) await db.fabricPropertyValue.update({ where: { id: row.id }, data: { serviceItemId: itemId } });
      push({ ...base, action: "UPDATE", detail: `desen kalemi → ${p.serviceItemCode}`, id: row.id });
    } else if (row) {
      push({ ...base, action: "SAME", detail: p.name, id: row.id });
    } else {
      const id = write && patternId ? (await db.fabricPropertyValue.create({ data: { propertyId: patternId, code: p.code, name: p.name, sortOrder: i, serviceItemId: itemId }, select: { id: true } })).id : null;
      push({ ...base, action: "CREATE", detail: `${p.name}${p.serviceItemCode ? ` (kalem ${p.serviceItemCode})` : ""}`, id });
    }
  }

  // Fason kategorisi: kategorisiz fason adımında kabul hiçbir özelliği uygulamaz (hedef bayrak topa geçmez → brode faturasız).
  const catRow = await db.subcontractorCategory.findUnique({ where: { code: input.externalCategory.code }, select: { id: true, appliesProperty: true } });
  let categoryId: string | null = catRow?.id ?? null;
  if (catRow && !catRow.appliesProperty) {
    if (write) await db.subcontractorCategory.update({ where: { id: catRow.id }, data: { appliesProperty: true, ...(userId ? { updatedById: userId } : {}) } });
    push({ kind: "SUBCONTRACTOR_CATEGORY", key: input.externalCategory.code, action: "UPDATE", detail: "özellik uygular → evet", id: catRow.id });
  } else if (catRow) {
    push({ kind: "SUBCONTRACTOR_CATEGORY", key: input.externalCategory.code, action: "SAME", detail: input.externalCategory.name, id: catRow.id });
  } else {
    categoryId = write ? (await db.subcontractorCategory.create({ data: { code: input.externalCategory.code, name: input.externalCategory.name, appliesProperty: true, ...audit }, select: { id: true } })).id : null;
    push({ kind: "SUBCONTRACTOR_CATEGORY", key: input.externalCategory.code, action: "CREATE", detail: `${input.externalCategory.name} (özellik uygular)`, id: categoryId });
  }

  const ensureStation = async (s: CodeName, type: StationType, kind: StationKind, defaultCategoryId: string | null = null, inspectionEnabled = inspectionDefaultForKind(kind)): Promise<string | null> => {
    const row = await db.station.findUnique({ where: { code: s.code }, select: { id: true, type: true, kind: true, appliesProperty: true, defaultCategoryId: true } });
    if (row && (row.type !== type || row.kind !== kind)) {
      push({ kind: "STATION", key: s.code, action: "CONFLICT", detail: `istasyon var ama ${row.type}/${row.kind} (beklenen ${type}/${kind})`, id: row.id });
      return null;
    }
    const fixes: string[] = [];
    if (row && !row.appliesProperty && kind !== StationKind.TAMBUR) fixes.push("özellik uygular → evet");
    const setCategory = !!row && kind === StationKind.SUBCONTRACTOR && !row.defaultCategoryId;
    if (setCategory) fixes.push(`varsayılan fason kategorisi → ${input.externalCategory.code}`);
    if (row && fixes.length > 0) {
      if (write) await db.station.update({ where: { id: row.id }, data: { appliesProperty: kind === StationKind.TAMBUR ? row.appliesProperty : true, ...(setCategory && defaultCategoryId ? { defaultCategoryId } : {}), ...(userId ? { updatedById: userId } : {}) } });
      push({ kind: "STATION", key: s.code, action: "UPDATE", detail: fixes.join("; "), id: row.id });
      return row.id;
    }
    if (row) { push({ kind: "STATION", key: s.code, action: "SAME", detail: s.name, id: row.id }); return row.id; }
    const id = write ? (await db.station.create({ data: { code: s.code, name: s.name, type, kind, appliesProperty: true, inspectionEnabled, defaultCategoryId, ...audit }, select: { id: true } })).id : null;
    push({ kind: "STATION", key: s.code, action: "CREATE", detail: `${s.name} (${type}/${kind}; muayene ${inspectionEnabled ? "açık" : "kapalı"})`, id });
    return id;
  };
  // Muayene varsayılanı panel yoluyla aynı (türden); iç brode bilerek KAPALI — desen düğmesi (TAP_VALUE) yalnız muayenesiz istasyonda çıkar.
  const internalId = await ensureStation(input.internalStation, StationType.INTERNAL, StationKind.PROCESS_QC, null, false);
  const externalId = await ensureStation(input.externalStation, StationType.EXTERNAL, StationKind.SUBCONTRACTOR, categoryId);
  const tamburId = await ensureStation(input.tamburStation, StationType.INTERNAL, StationKind.TAMBUR);

  // İstasyon yeteneği: iç brode bayrak AUTO + desen REQUIRED (tablette desen düğmesi); dış fason yalnız bayrak.
  const ensureCap = async (st: CodeName, stationId: string | null, prop: CodeName, propertyId: string | null, mode: StationPropertyMode) => {
    const key = `${st.code} × ${prop.code}`;
    const row = stationId && propertyId ? await db.stationProperty.findUnique({ where: { stationId_propertyId: { stationId, propertyId } }, select: { id: true, mode: true } }) : null;
    const base = { kind: "STATION_PROPERTY" as const, key, auditTable: "STATION_CAPABILITY", auditRecordId: stationId };
    if (row && row.mode === mode) { push({ ...base, action: "SAME", detail: mode, id: row.id }); return; }
    if (row) {
      if (write) await db.stationProperty.update({ where: { id: row.id }, data: { mode } });
      push({ ...base, action: "UPDATE", detail: `kip ${row.mode} → ${mode}`, id: row.id });
      return;
    }
    const id = write && stationId && propertyId ? (await db.stationProperty.create({ data: { stationId, propertyId, mode }, select: { id: true } })).id : null;
    push({ ...base, action: "CREATE", detail: mode, id });
  };
  await ensureCap(input.internalStation, internalId, input.flag, flagId, StationPropertyMode.AUTO);
  await ensureCap(input.internalStation, internalId, input.patternProperty, patternId, StationPropertyMode.REQUIRED);
  await ensureCap(input.externalStation, externalId, input.flag, flagId, StationPropertyMode.OPTIONAL);

  // Rota şablonları: var olan rotanın adımları farklıysa çakışma (canlı iş emirleri şablonu kullanmış olabilir).
  const ensureRoute = async (r: CodeName, steps: Array<{ code: string; id: string | null; categoryId?: string | null }>) => {
    const row = await db.route.findUnique({ where: { code: r.code }, select: { id: true, steps: { orderBy: { sequence: "asc" }, select: { station: { select: { code: true } }, requiredCategory: { select: { code: true } } } } } });
    const want = steps.map((s) => (s.categoryId !== undefined ? `${s.code}[${input.externalCategory.code}]` : s.code)).join(" → ");
    if (row) {
      const have = row.steps.map((s) => (s.requiredCategory ? `${s.station.code}[${s.requiredCategory.code}]` : s.station.code)).join(" → ");
      push({ kind: "ROUTE", key: r.code, action: have === want ? "SAME" : "CONFLICT", detail: have === want ? want : `adımlar farklı: ${have} (beklenen ${want})`, id: row.id });
      return;
    }
    const ready = steps.every((s) => s.id);
    const id = write && ready
      ? (await db.route.create({ data: { code: r.code, name: r.name, ...audit, steps: { create: steps.map((s, i) => ({ stationId: s.id!, sequence: i + 1, requiredCategoryId: s.categoryId ?? null })) } }, select: { id: true } })).id
      : null;
    push({ kind: "ROUTE", key: r.code, action: "CREATE", detail: `${r.name}: ${want}`, id });
  };
  await ensureRoute(input.internalRoute, [{ code: input.internalStation.code, id: internalId }, { code: input.tamburStation.code, id: tamburId }]);
  await ensureRoute(input.externalRoute, [{ code: input.externalStation.code, id: externalId, categoryId }, { code: input.tamburStation.code, id: tamburId }]);
  return out;
}

/** tx'i bilerek geri sarmak için taşıyıcı: içindeki kayıt listesi dışarıda okunur. */
class RollbackWithRecords extends Error {
  constructor(readonly records: SetupRecord[]) { super("brode-kurulum: geri sarıldı"); }
}

/** Kuru koşu: yalnız okur; tx sonunda bilerek fırlatıp geri sarar (yazım dalı kapalı olsa da emniyet). */
export async function planBrodeSetup(input: BrodeSetupInput): Promise<SetupRecord[]> {
  const { default: prisma } = await import("../src/lib/prisma");
  try {
    await prisma.$transaction(async (tx) => { throw new RollbackWithRecords(await runBrodeSetup(tx, input, false, null)); }, { timeout: 60_000 });
  } catch (e) {
    if (e instanceof RollbackWithRecords) return e.records;
    throw e;
  }
  throw new Error("brode-kurulum: kuru koşu tx'i geri sarılmadı");
}

/** Yazım TEK tx'te; yazım anında çakışma doğarsa (plan ile arada veri değişti) tx geri sarılır → 0 yazım. */
export async function writeBrodeSetup(input: BrodeSetupInput, userId: string): Promise<{ records: SetupRecord[]; conflicts: SetupRecord[] }> {
  const { default: prisma } = await import("../src/lib/prisma");
  try {
    const records = await prisma.$transaction(async (tx) => {
      const rs = await runBrodeSetup(tx, input, true, userId);
      if (rs.some((r) => r.action === "CONFLICT")) throw new RollbackWithRecords(rs);
      return rs;
    }, { timeout: 120_000 });
    return { records, conflicts: [] };
  } catch (e) {
    if (e instanceof RollbackWithRecords) return { records: e.records, conflicts: e.records.filter((r) => r.action === "CONFLICT") };
    throw e;
  }
}

/** Uygulama: önce plan; çakışma varsa 0 yazım. Yazım TEK tx'te; audit tx DIŞINDA (ayak izi). */
export async function applyBrodeSetup(input: BrodeSetupInput, userId: string): Promise<{ records: SetupRecord[]; conflicts: SetupRecord[] }> {
  const { AuditService } = await import("../src/services/audit.service");
  const plan = await planBrodeSetup(input);
  const conflicts = plan.filter((r) => r.action === "CONFLICT");
  if (conflicts.length > 0) return { records: plan, conflicts };
  const written = await writeBrodeSetup(input, userId);
  if (written.conflicts.length > 0) return written;
  const records = written.records;
  await AuditService.logMany(records.filter((r) => (r.action === "CREATE" || r.action === "UPDATE") && r.auditRecordId).map((r) => ({
    userId, action: r.action === "CREATE" ? "CREATE" as const : "UPDATE" as const, tableName: r.auditTable, recordId: r.auditRecordId!,
    newData: { source: "brode-kurulum", kind: r.kind, key: r.key, detail: r.detail },
  })));
  return { records, conflicts: [] };
}

export function formatSetupRecords(records: SetupRecord[]): string[] {
  return records.map((r) => `  ${r.action.padEnd(8)} ${r.kind.padEnd(22)} ${r.key} — ${r.detail}`);
}

const codeName = z.object({ code: z.string().trim().min(1).max(32), name: z.string().trim().min(1) }).strict();
/** Girdi fail-closed: tanınmayan alan / biçimsiz kayıt kurulumdan ÖNCE reddedilir. */
const inputSchema = z.object({
  serviceItem: codeName, flag: codeName, patternProperty: codeName, internalStation: codeName, externalStation: codeName,
  externalCategory: codeName, tamburStation: codeName, internalRoute: codeName, externalRoute: codeName,
  patternServiceItems: z.array(codeName),
  patterns: z.array(codeName.extend({ serviceItemCode: z.string().trim().min(1).max(32).nullish() })),
}).partial().strict();

export function parseBrodeSetupInput(raw: unknown): BrodeSetupInput | string {
  const r = inputSchema.safeParse(raw);
  if (!r.success) return r.error.issues.map((i) => `${i.path.join(".") || "(kök)"}: ${i.message}`).join("; ");
  return { ...GULKESIM_BRODE_DEFAULTS, ...r.data } as BrodeSetupInput;
}

function readInput(path: string | undefined): BrodeSetupInput | string {
  if (!path) return GULKESIM_BRODE_DEFAULTS;
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch (e) { return `girdi okunamadı: ${(e as Error).message}`; }
  return parseBrodeSetupInput(raw);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const user = args.find((a) => a.startsWith("--kullanici="))?.slice("--kullanici=".length);
  const inputPath = args.find((a) => a.startsWith("--girdi="))?.slice("--girdi=".length);
  const unknown = args.filter((a) => a !== "--apply" && !a.startsWith("--kullanici=") && !a.startsWith("--girdi="));
  if (unknown.length > 0 || (apply && !user)) {
    console.error("❌ kullanım: tsx scripts/brode-kurulum.ts [--girdi=<json>] [--apply --kullanici=<kullanıcı adı>]");
    return 2;
  }
  if (!process.env.DATABASE_URL) { console.error("❌ DATABASE_URL ortamda yok."); return 2; }
  const input = readInput(inputPath);
  if (typeof input === "string") { console.error(`❌ geçersiz --girdi: ${input}`); return 2; }
  const { default: prisma } = await import("../src/lib/prisma");
  try {
    console.log(`=== Brode kurulumu — ${apply ? "UYGULAMA" : "KURU KOŞU"} ===`);
    console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
    const plan = await planBrodeSetup(input);
    for (const line of formatSetupRecords(plan)) console.log(line);
    const changes = plan.filter((r) => r.action === "CREATE" || r.action === "UPDATE");
    const conflicts = plan.filter((r) => r.action === "CONFLICT");
    if (conflicts.length > 0) { console.error(`❌ ${conflicts.length} çakışma — hiçbir kayıt yazılmadı; veriyi panelden inceleyin.`); return 1; }
    console.log(`ℹ️  Dış brode firmasını panelde '${input.externalCategory.name}' fason kategorisine bağlayın; fiyatlar (müşteri/desen) panelden girilir.`);
    if (!apply) { console.log(`KURU KOŞU — ${changes.length} kayıt yaratılacak/değişecekti; yazılan 0. Uygulamak için --apply --kullanici=<ad>.`); return 0; }
    if (changes.length === 0) { console.log("Yazılacak kayıt yok; yazılan 0."); return 0; }
    const row = await prisma.user.findUnique({ where: { username: user }, select: { id: true } });
    if (!row) { console.error(`❌ kullanıcı bulunamadı: ${user}`); return 1; }
    const res = await applyBrodeSetup(input, row.id);
    if (res.conflicts.length > 0) { console.error("❌ plan ile uygulama arasında çakışma doğdu — yazılan 0."); return 1; }
    console.log(`✅ ${res.records.filter((r) => r.action === "CREATE" || r.action === "UPDATE").length} kayıt yazıldı.`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then((k) => { process.exitCode = k; }, (e) => { console.error(`❌ kurulum uygulanamadı: ${(e as Error).message}`); process.exitCode = 1; });
}
