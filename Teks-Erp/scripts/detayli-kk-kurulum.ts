// =============================================================================
// DETAYLI KK KURULUM BETİĞİ — Gülkesim akış 2 (fabrika cevabı 22, 35-ek; S4)
// =============================================================================
// Kurşun(+KK) → DETAYLI KK → Tambur. Detaylı KK = kurşunsuz kalite istasyonu:
// INTERNAL/PROCESS_QC, kart akışı (`appliesQuality`) + muayene (`inspectionEnabled`) AÇIK,
// özellik yeteneği YOK (tablette gramaj/sayaç/makine çizilmez, hata işaretleme var) ve
// makinesiz (ayrı tablet istasyon oturumu açar). Rota "KURŞUN & DETAYLI KK & TAMBUR"
// iş emri kısayoludur (sıra: taban "kurşun → tambur" kısayolunun hemen arkası).
// İstasyon ve rota VERİDİR (profil/ayar paketine girmez); bu betik onları tek seferde kurar.
//
// Koşum (DATABASE_URL ortamdan):
//   tsx scripts/detayli-kk-kurulum.ts [--girdi=<json>]                          → KURU KOŞU: listeler, 0 yazım
//   tsx scripts/detayli-kk-kurulum.ts [--girdi=<json>] --apply --kullanici=<ad> → listeler, sonra TEK tx'te yazar
// Kurşun/tambur istasyonu girdi kodundan; yoksa tek "kurşun yetenekli → TAMBUR" kısayol
// rotasından (yoksa tek aday istasyondan) çözülür; belirsizlik ÇAKIŞMA'dır, 0 yazım.
// Var olan kayıt koda göre bulunur; eksik yetenek açılır (UPDATE), tür/özellik/adım farkı ÇAKIŞMA.
// Çıkış: 0 tamam · 1 çakışma/uygulanamadı · 2 kullanım/geçersiz girdi.
// =============================================================================
import { readFileSync } from "node:fs";
import { Prisma, StationKind, StationType } from "@prisma/client";
import { z } from "zod";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";
import { KURSUN_DISPATCH_STATION_WHERE } from "../src/services/helpers/quality-station.helper";
import { normalizeDisplayName } from "../src/services/helpers/name-normalize.helper";

type Db = Prisma.TransactionClient;
/** Tablet ekranını tür seçer (mobil stationScreens: PROCESS_QC → kurşun/KK ekranı); kalite sorusu değil, kimlik denetimi. */
const SCREEN_KIND: StationKind = StationKind.PROCESS_QC;
interface CodeName { code: string; name: string }

export interface DetayliKkSetupInput {
  station: CodeName;
  route: CodeName;
  /** null → tek kurşun yetenekli istasyon (KURSUN AUTO + kart akışı). */
  kursunStationCode: string | null;
  /** null → taban kısayolun tamburu, o da yoksa tek aktif TAMBUR istasyonu. */
  tamburStationCode: string | null;
}

export const GULKESIM_DETAYLI_KK_DEFAULTS: DetayliKkSetupInput = {
  station: { code: "DETAYLI-KK", name: "DETAYLI KK" },
  route: { code: "KURSUN-DKK-TAMBUR", name: "KURŞUN & DETAYLI KK & TAMBUR" },
  kursunStationCode: null,
  tamburStationCode: null,
};

export type SetupAction = "CREATE" | "UPDATE" | "SAME" | "CONFLICT";
export interface SetupRecord {
  kind: "STATION" | "ROUTE";
  key: string;
  action: SetupAction;
  detail: string;
  id: string | null;
}

interface StationRef { id: string; code: string }
interface Resolved { kursun: StationRef | null; tambur: StationRef | null; shortcutOrder: number }

/** Kurşun → TAMBUR (iki adımlı) aktif kısayol rotaları: taban kısayol adayları. */
async function baseShortcuts(db: Db, kursunId: string) {
  const rows = await db.route.findMany({
    where: { isActive: true, isWorkOrderShortcut: true },
    select: { shortcutOrder: true, steps: { orderBy: { sequence: "asc" }, select: { station: { select: { id: true, code: true, kind: true } } } } },
  });
  return rows.filter((r) => r.steps.length === 2 && r.steps[0].station.id === kursunId && r.steps[1].station.kind === StationKind.TAMBUR);
}

async function resolveStations(db: Db, input: DetayliKkSetupInput, push: (r: SetupRecord) => void): Promise<Resolved> {
  const kursunRows = await db.station.findMany({
    where: { isActive: true, ...(input.kursunStationCode ? { code: input.kursunStationCode } : {}), ...KURSUN_DISPATCH_STATION_WHERE },
    select: { id: true, code: true },
  });
  const kursun = kursunRows.length === 1 ? kursunRows[0] : null;
  if (!kursun) {
    const why = kursunRows.length === 0 ? "kurşun yetenekli aktif istasyon yok" : `birden çok kurşun istasyonu (${kursunRows.map((s) => s.code).join(", ")}) — girdide kursunStationCode verin`;
    push({ kind: "STATION", key: input.kursunStationCode ?? "(kurşun)", action: "CONFLICT", detail: why, id: null });
    return { kursun: null, tambur: null, shortcutOrder: 0 };
  }
  const bases = await baseShortcuts(db, kursun.id);
  const maxOrder = (await db.route.aggregate({ where: { isWorkOrderShortcut: true }, _max: { shortcutOrder: true } }))._max.shortcutOrder ?? 0;
  let tambur: StationRef | null = null;
  if (input.tamburStationCode) {
    tambur = await db.station.findFirst({ where: { code: input.tamburStationCode, isActive: true, kind: StationKind.TAMBUR }, select: { id: true, code: true } });
    if (!tambur) push({ kind: "STATION", key: input.tamburStationCode, action: "CONFLICT", detail: "aktif TAMBUR istasyonu değil", id: null });
  } else {
    const fromBase = [...new Map(bases.map((b) => [b.steps[1].station.id, b.steps[1].station])).values()];
    const all = fromBase.length > 0 ? fromBase : await db.station.findMany({ where: { isActive: true, kind: StationKind.TAMBUR }, select: { id: true, code: true } });
    tambur = all.length === 1 ? { id: all[0].id, code: all[0].code } : null;
    if (!tambur) {
      const why = all.length === 0 ? "aktif TAMBUR istasyonu yok" : `birden çok tambur adayı (${all.map((s) => s.code).join(", ")}) — girdide tamburStationCode verin`;
      push({ kind: "STATION", key: "(tambur)", action: "CONFLICT", detail: why, id: null });
    }
  }
  const base = tambur ? bases.find((b) => b.steps[1].station.id === tambur!.id) : undefined;
  return { kursun, tambur, shortcutOrder: base ? base.shortcutOrder + 1 : maxOrder + 1 };
}

async function ensureStation(db: Db, s: CodeName, write: boolean, userId: string | null, push: (r: SetupRecord) => void): Promise<string | null> {
  const row = await db.station.findUnique({
    where: { code: s.code },
    select: { id: true, type: true, kind: true, isActive: true, appliesQuality: true, inspectionEnabled: true, _count: { select: { propertyCapabilities: true } } },
  });
  if (row && (row.type !== StationType.INTERNAL || row.kind !== SCREEN_KIND || !row.isActive)) {
    push({ kind: "STATION", key: s.code, action: "CONFLICT", detail: `istasyon var ama ${row.type}/${row.kind}${row.isActive ? "" : " (pasif)"} — beklenen aktif INTERNAL/PROCESS_QC`, id: row.id });
    return null;
  }
  if (row && row._count.propertyCapabilities > 0) {
    push({ kind: "STATION", key: s.code, action: "CONFLICT", detail: `istasyon özellik uyguluyor (${row._count.propertyCapabilities} yetenek) — detaylı KK kurşunsuz olmalı`, id: row.id });
    return null;
  }
  if (row) {
    const fixes = [!row.appliesQuality && "kart akışı → açık", !row.inspectionEnabled && "muayene → açık"].filter(Boolean);
    if (fixes.length === 0) { push({ kind: "STATION", key: s.code, action: "SAME", detail: s.name, id: row.id }); return row.id; }
    if (write) await db.station.update({ where: { id: row.id }, data: { appliesQuality: true, inspectionEnabled: true, ...(userId ? { updatedById: userId } : {}) } });
    push({ kind: "STATION", key: s.code, action: "UPDATE", detail: fixes.join("; "), id: row.id });
    return row.id;
  }
  const name = normalizeDisplayName(s.name);
  const id = write
    ? (await db.station.create({
        data: {
          code: s.code, name, type: StationType.INTERNAL, kind: SCREEN_KIND, department: "KALITE",
          // Kurşunsuz kalite: özellik yeteneği KAPALI (rota özellik kapsamasını bu adım taşımaz).
          appliesQuality: true, inspectionEnabled: true, appliesProperty: false,
          ...(userId ? { createdById: userId, updatedById: userId } : {}),
        },
        select: { id: true },
      })).id
    : null;
  push({ kind: "STATION", key: s.code, action: "CREATE", detail: `${name} (INTERNAL/PROCESS_QC; muayene açık, özelliksiz, makinesiz)`, id });
  return id;
}

async function ensureRoute(db: Db, r: CodeName, steps: StationRef[], order: number, write: boolean, userId: string | null, push: (x: SetupRecord) => void): Promise<void> {
  const name = normalizeDisplayName(r.name);
  const want = steps.map((s) => s.code).join(" → ");
  const byCode = await db.route.findUnique({ where: { code: r.code }, select: { id: true } });
  // Panelden aynı adla açılmış rota da aynı kayıttır (ad tr_fold ile tekil).
  const byName = byCode ? [] : await db.$queryRaw<{ id: string }[]>`SELECT id FROM routes WHERE "nameFold" = public.tr_fold(${name}) LIMIT 1`;
  const id = byCode?.id ?? byName[0]?.id ?? null;
  if (id) {
    const row = await db.route.findUniqueOrThrow({
      where: { id },
      select: { isActive: true, isWorkOrderShortcut: true, steps: { orderBy: { sequence: "asc" }, select: { station: { select: { code: true } } } } },
    });
    const have = row.steps.map((s) => s.station.code).join(" → ");
    if (have !== want || !row.isActive) {
      push({ kind: "ROUTE", key: r.code, action: "CONFLICT", detail: `rota var ama ${row.isActive ? `adımlar farklı: ${have}` : "pasif"} (beklenen ${want})`, id });
      return;
    }
    if (row.isWorkOrderShortcut) { push({ kind: "ROUTE", key: r.code, action: "SAME", detail: `${name}: ${want}`, id }); return; }
    if (write) await db.route.update({ where: { id }, data: { isWorkOrderShortcut: true, shortcutOrder: order, ...(userId ? { updatedById: userId } : {}) } });
    push({ kind: "ROUTE", key: r.code, action: "UPDATE", detail: `iş emri kısayolu → açık (sıra ${order})`, id });
    return;
  }
  const newId = write
    ? (await db.route.create({
        data: {
          code: r.code, name, isWorkOrderShortcut: true, shortcutOrder: order,
          ...(userId ? { createdById: userId, updatedById: userId } : {}),
          steps: { create: steps.map((s, i) => ({ stationId: s.id, sequence: i + 1 })) },
        },
        select: { id: true },
      })).id
    : null;
  push({ kind: "ROUTE", key: r.code, action: "CREATE", detail: `${name}: ${want} (iş emri kısayolu, sıra ${order})`, id: newId });
}

/** Tek yol: kuru koşu (`write=false`) ile uygulama AYNI kararı verir; yalnız yazım dalı farklıdır. */
export async function runDetayliKkSetup(db: Db, input: DetayliKkSetupInput, write: boolean, userId: string | null): Promise<SetupRecord[]> {
  const out: SetupRecord[] = [];
  const push = (r: SetupRecord) => out.push(r);
  const { kursun, tambur, shortcutOrder } = await resolveStations(db, input, push);
  const stationId = await ensureStation(db, input.station, write, userId, push);
  if (!kursun || !tambur) return out;
  // Kuru koşuda yaratılacak istasyonun kimliği yok: rota kararı koda göre verilir, yazım kimlikle.
  const dkk: StationRef = { id: stationId ?? "", code: input.station.code };
  if (write && !stationId) return out;
  await ensureRoute(db, input.route, [kursun, dkk, tambur], shortcutOrder, write, userId, push);
  return out;
}

class RollbackWithRecords extends Error {
  constructor(readonly records: SetupRecord[]) { super("detayli-kk-kurulum: geri sarıldı"); }
}

/** Kuru koşu: tx sonunda bilerek fırlatıp geri sarar (yazım dalı kapalı olsa da emniyet). */
export async function planDetayliKkSetup(input: DetayliKkSetupInput): Promise<SetupRecord[]> {
  const { default: prisma } = await import("../src/lib/prisma");
  try {
    await prisma.$transaction(async (tx) => { throw new RollbackWithRecords(await runDetayliKkSetup(tx, input, false, null)); }, { timeout: 60_000 });
  } catch (e) {
    if (e instanceof RollbackWithRecords) return e.records;
    throw e;
  }
  throw new Error("detayli-kk-kurulum: kuru koşu tx'i geri sarılmadı");
}

/** Önce plan; çakışma varsa 0 yazım. Yazım TEK tx'te (arada çakışma doğarsa geri sarılır); audit tx DIŞINDA. */
export async function applyDetayliKkSetup(input: DetayliKkSetupInput, userId: string): Promise<{ records: SetupRecord[]; conflicts: SetupRecord[] }> {
  const { default: prisma } = await import("../src/lib/prisma");
  const { AuditService } = await import("../src/services/audit.service");
  const plan = await planDetayliKkSetup(input);
  const planConflicts = plan.filter((r) => r.action === "CONFLICT");
  if (planConflicts.length > 0) return { records: plan, conflicts: planConflicts };
  let records: SetupRecord[];
  try {
    records = await prisma.$transaction(async (tx) => {
      const rs = await runDetayliKkSetup(tx, input, true, userId);
      if (rs.some((r) => r.action === "CONFLICT")) throw new RollbackWithRecords(rs);
      return rs;
    }, { timeout: 60_000 });
  } catch (e) {
    if (e instanceof RollbackWithRecords) return { records: e.records, conflicts: e.records.filter((r) => r.action === "CONFLICT") };
    throw e;
  }
  await AuditService.logMany(records.filter((r) => (r.action === "CREATE" || r.action === "UPDATE") && r.id).map((r) => ({
    userId, action: r.action === "CREATE" ? "CREATE" as const : "UPDATE" as const, tableName: r.kind, recordId: r.id!,
    newData: { source: "detayli-kk-kurulum", key: r.key, detail: r.detail },
  })));
  return { records, conflicts: [] };
}

export function formatSetupRecords(records: SetupRecord[]): string[] {
  return records.map((r) => `  ${r.action.padEnd(8)} ${r.kind.padEnd(8)} ${r.key} — ${r.detail}`);
}

const codeName = z.object({ code: z.string().trim().min(1).max(32), name: z.string().trim().min(1).max(100) }).strict();
/** Girdi fail-closed: tanınmayan alan / biçimsiz kayıt kurulumdan ÖNCE reddedilir. */
const inputSchema = z.object({
  station: codeName, route: codeName,
  kursunStationCode: z.string().trim().min(1).max(32).nullable(),
  tamburStationCode: z.string().trim().min(1).max(32).nullable(),
}).partial().strict();

export function parseDetayliKkSetupInput(raw: unknown): DetayliKkSetupInput | string {
  const r = inputSchema.safeParse(raw);
  if (!r.success) return r.error.issues.map((i) => `${i.path.join(".") || "(kök)"}: ${i.message}`).join("; ");
  return { ...GULKESIM_DETAYLI_KK_DEFAULTS, ...r.data } as DetayliKkSetupInput;
}

function readInput(path: string | undefined): DetayliKkSetupInput | string {
  if (!path) return GULKESIM_DETAYLI_KK_DEFAULTS;
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch (e) { return `girdi okunamadı: ${(e as Error).message}`; }
  return parseDetayliKkSetupInput(raw);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const user = args.find((a) => a.startsWith("--kullanici="))?.slice("--kullanici=".length);
  const inputPath = args.find((a) => a.startsWith("--girdi="))?.slice("--girdi=".length);
  const unknown = args.filter((a) => a !== "--apply" && !a.startsWith("--kullanici=") && !a.startsWith("--girdi="));
  if (unknown.length > 0 || (apply && !user)) {
    console.error("❌ kullanım: tsx scripts/detayli-kk-kurulum.ts [--girdi=<json>] [--apply --kullanici=<kullanıcı adı>]");
    return 2;
  }
  if (!process.env.DATABASE_URL) { console.error("❌ DATABASE_URL ortamda yok."); return 2; }
  const input = readInput(inputPath);
  if (typeof input === "string") { console.error(`❌ geçersiz --girdi: ${input}`); return 2; }
  const { default: prisma } = await import("../src/lib/prisma");
  try {
    console.log(`=== Detaylı KK kurulumu — ${apply ? "UYGULAMA" : "KURU KOŞU"} ===`);
    console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
    const plan = await planDetayliKkSetup(input);
    for (const line of formatSetupRecords(plan)) console.log(line);
    const changes = plan.filter((r) => r.action === "CREATE" || r.action === "UPDATE");
    if (plan.some((r) => r.action === "CONFLICT")) { console.error("❌ çakışma — hiçbir kayıt yazılmadı; veriyi panelden inceleyin."); return 1; }
    console.log("ℹ️  Detaylı KK tabletini istasyon oturumuyla açın (makinesiz); operatör rolüne mobile:kk2-kursun izni panelden atanır.");
    if (!apply) { console.log(`KURU KOŞU — ${changes.length} kayıt yaratılacak/değişecekti; yazılan 0. Uygulamak için --apply --kullanici=<ad>.`); return 0; }
    if (changes.length === 0) { console.log("Yazılacak kayıt yok; yazılan 0."); return 0; }
    const row = await prisma.user.findUnique({ where: { username: user }, select: { id: true } });
    if (!row) { console.error(`❌ kullanıcı bulunamadı: ${user}`); return 1; }
    const res = await applyDetayliKkSetup(input, row.id);
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
