// =============================================================================
// BEKÇİ — GECE BAKIM İŞLERİ (perf-6 B2/B4/B5/B6/B7)
// Çalıştır: npx tsx scripts/run-all-tests.ts bakim_isleri
// =============================================================================
//   §1 zamanlayıcı kayıtlı: server.ts `startMaintenanceScheduler`ı doğrulama kipi dışında çağırır,
//      o arşivleyiciyi de başlatır, üç görev (yedek rotasyonu · audit arşivi budaması · oturum) listede.
//   §2 pencere kapısı: fabrika saatiyle [02:00, 05:00); arşivleyici ve bakım işi kapıdan geçer,
//      arşivleyici partiler arasında pencereyi yeniden ölçer.
//   §3 premigrate_ rotasyonu: en yeni 3 HER ZAMAN kalır (keep 0 verilse bile), kalanlardan 90 günden
//      eskiler silinir; tekserp_/pre-restore_/.part dokunulmaz; geçici dizinde gerçek silme.
//   §4 audit arşivi saklama: 3 yıl varsayılan, 0 = budama yok, geçersiz değer varsayılana düşer;
//      aylık dilim filigrandan kesime ilerler; DB'de 3 yıldan eski satır gider, gencine dokunulmaz.
//   §5 B2: altı tabloda autovacuum reloptions DB'de.
//   §6 negatif sondalar (her koşumda): bozuk seçici/pencere/kesim/kayıt → ilgili kontrol kırmızı.
//   §7 rapor budaması (R1-ZAMAN): görev kayıtlı; DB'de 90 günden eski koşu gider, genci kalır; süresi
//      dolmuş ZAMANLANMIS görüntü gider, KULLANICI görüntüsü (süresi dolmuş olsa da) ve süresi dolmamış kalır.
//      Negatif sonda (2026-10-25): budayıcının `kind` süzgeci kaldırılınca §7b ❌ (KULLANICI görüntüsü gitti).
// DB GEREKTİRİR (§4c, §5) ve YAZAR: kapı dosyanın ilk ifadesi.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { factoryMinuteOfDay } from "../src/constants/time";
import { isInMaintenanceWindow } from "../src/services/helpers/maintenance-window.helper";
import { selectExpiredRollbackBackups, type RotationCandidate } from "../src/services/helpers/backup-rotation.helper";
import {
  AUDIT_PURGE_FLOOR,
  auditArchivePurgeCutoff,
  nextAuditPurgeSliceEnd,
} from "../src/services/helpers/audit-retention.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

// Yazan bekçi: kapı modül gövdesinin İLK ifadesi (import'lar DB'ye dokunmaz).
const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

const KOK = path.join(__dirname, "..");
const oku = (rel: string): string => fs.readFileSync(path.join(KOK, rel), "utf8");
const DAY = 24 * 60 * 60 * 1000;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

// ── §1 zamanlayıcı kaydı (statik) ────────────────────────────────────────────
export function kayitIhlalleri(d: { server: string; job: string; arsiv: string; kip: string }): string[] {
  const ih: string[] = [];
  if (!/if \(!JOBS_OFF\) startMaintenanceScheduler\(\)/.test(d.server)) ih.push("server.ts bakım işini doğrulama/yardımcı sunucu kipi dışında başlatmıyor");
  if (/startArchiveScheduler\(\)/.test(d.server)) ih.push("server.ts arşivleyiciyi ayrıca başlatıyor (tek giriş startMaintenanceScheduler)");
  const bas = d.job.slice(d.job.indexOf("export function startMaintenanceScheduler"));
  if (!/startArchiveScheduler\(\)/.test(bas)) ih.push("startMaintenanceScheduler arşivleyiciyi başlatmıyor");
  for (const g of ["rollback-backup-rotation", "audit-archive-purge", "session-purge"]) {
    if (!d.job.includes(`name: "${g}"`)) ih.push(`görev listede yok: ${g}`);
  }
  if (!/"startMaintenanceScheduler"/.test(d.kip)) ih.push("doğrulama kipi listesinde startMaintenanceScheduler yok");
  return ih;
}

// ── §2 pencere kapısı ────────────────────────────────────────────────────────
export function pencereIhlalleri(fn: (at: Date) => boolean): string[] {
  const taban = new Date("2026-06-15T12:00:00.000Z");
  const beklenen: Array<[number, boolean]> = [[0, false], [119, false], [120, true], [180, true], [299, true], [300, false], [720, false], [1439, false]];
  return beklenen
    .filter(([dk, ok]) => fn(factoryMinuteOfDay(taban, dk)) !== ok)
    .map(([dk, ok]) => `fabrika ${String(Math.floor(dk / 60)).padStart(2, "0")}:${String(dk % 60).padStart(2, "0")} → ${!ok} (beklenen ${ok})`);
}

export function arsivKapisiIhlalleri(arsiv: string): string[] {
  const ih: string[] = [];
  const run = arsiv.slice(arsiv.indexOf("async function runIfDue"), arsiv.indexOf("export function startArchiveScheduler"));
  const kapi = run.indexOf("if (!isInMaintenanceWindow(new Date())) return;");
  const bayrak = run.indexOf("running = true;\n  runningSince");
  if (kapi < 0 || bayrak < 0 || kapi > bayrak) ih.push("arşivleyici koşmadan ÖNCE pencereyi ölçmüyor");
  const dongu = run.slice(run.indexOf("for (let i = 0; i < MAX_BATCHES_PER_RUN"));
  if (!/if \(!isInMaintenanceWindow\(new Date\(\)\)\) break;/.test(dongu)) ih.push("arşivleyici partiler arasında pencereyi yeniden ölçmüyor");
  if (!/if \(finished\) await setLastRun/.test(run)) ih.push("birikim bitmeden damga yazılıyor");
  if (!/ARCHIVE_BATCH_SIZE = 5000/.test(oku("src/services/audit.service.ts"))) ih.push("parti 5000 değil");
  return ih;
}

// ── §3 rotasyon ──────────────────────────────────────────────────────────────
type Secici = (files: readonly RotationCandidate[], nowMs: number, keep?: number) => string[];
export function rotasyonIhlalleri(sec: Secici): string[] {
  const now = Date.UTC(2026, 9, 12, 3, 0, 0);
  const f = (name: string, gun: number): RotationCandidate => ({ name, mtimeMs: now - gun * DAY });
  const ih: string[] = [];
  const esit = (a: string[], b: string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const karma = [f("premigrate_a.dump", 200), f("premigrate_b.dump.tkenc", 150), f("premigrate_c.dump", 120),
    f("premigrate_d.dump", 100), f("premigrate_e.dump", 10), f("premigrate_f.dump", 1),
    f("tekserp_x.dump", 400), f("pre-restore_x.dump", 400), f("premigrate_g.dump.part", 400)];
  const r1 = sec(karma, now);
  if (!esit(r1, ["premigrate_a.dump", "premigrate_b.dump.tkenc", "premigrate_c.dump"])) ih.push(`karma küme: ${r1.join(",") || "—"}`);
  const hepsiEski = [100, 120, 150, 200, 300].map((g, i) => f(`premigrate_${i}.dump`, g));
  const r2 = sec(hepsiEski, now);
  if (!esit(r2, ["premigrate_3.dump", "premigrate_4.dump"])) ih.push(`hepsi 90 günden eski → en yeni 3 kalmalı: ${r2.join(",")}`);
  const r3 = sec(hepsiEski, now, 0);
  if (r3.length > 2) ih.push(`keep=0 verilince "son 3" taban kalktı: ${r3.length} silinecek`);
  const r4 = sec([f("premigrate_1.dump", 300), f("premigrate_2.dump", 300), f("premigrate_3.dump", 300)], now);
  if (r4.length) ih.push(`üç dosya varken silme: ${r4.join(",")}`);
  // Ad damgası GENÇ, mtime eski (arşivden mtime korunarak dönmüş) → genç sayılır, silinmez.
  const stamp = "20261001_020000";
  const r5 = sec([f(`premigrate_${stamp}.dump`, 400), ...[200, 210, 220].map((g, i) => f(`premigrate_o${i}.dump`, g))], now);
  if (r5.includes(`premigrate_${stamp}.dump`)) ih.push("yaş min(ad, mtime) ile ölçülüyor (silmede GENÇ olan esas)");
  return ih;
}

async function rotasyonDosyada(): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bakim-rot-"));
  const onceki = process.env.BACKUP_DIR;
  try {
    const now = Date.now();
    const mk = (n: string, gun: number): void => {
      const p = path.join(dir, n);
      fs.writeFileSync(p, "x");
      const t = new Date(now - gun * DAY);
      fs.utimesSync(p, t, t);
    };
    mk("premigrate_a.dump", 200); mk("premigrate_b.dump.tkenc", 150); mk("premigrate_c.dump", 120);
    mk("premigrate_d.dump", 100); mk("premigrate_e.dump", 10); mk("premigrate_f.dump", 1);
    mk("tekserp_x.dump", 400); mk("pre-restore_x.dump", 400);
    process.env.BACKUP_DIR = dir;
    const svc = await import("../src/services/backup.service");
    const r = await svc.rotateRollbackBackups(now);
    const kalan = fs.readdirSync(dir).sort();
    const beklenen = ["pre-restore_x.dump", "premigrate_d.dump", "premigrate_e.dump", "premigrate_f.dump", "tekserp_x.dump"];
    const ih: string[] = [];
    if (JSON.stringify(kalan) !== JSON.stringify(beklenen)) ih.push(`kalan: ${kalan.join(",")}`);
    if (r.deleted.length !== 3 || r.failed.length !== 0) ih.push(`sonuç: ${JSON.stringify(r)}`);
    return ih;
  } finally {
    if (onceki === undefined) delete process.env.BACKUP_DIR; else process.env.BACKUP_DIR = onceki;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── §4 saklama süresi ────────────────────────────────────────────────────────
export function kesimIhlalleri(fn: (years: number, now: Date) => Date | null): string[] {
  const now = new Date("2026-10-12T00:30:00.000Z");
  const ih: string[] = [];
  const uc = fn(3, now);
  if (uc?.toISOString() !== "2023-10-12T00:30:00.000Z") ih.push(`3 yıl → ${uc?.toISOString() ?? "null"}`);
  for (const v of [0, -1, 2.5, 51, Number.NaN]) if (fn(v, now) !== null) ih.push(`${v} → budama VAR (beklenen yok)`);
  return ih;
}

export function dilimIhlalleri(fn: (wm: Date | null, cutoff: Date) => Date | null): string[] {
  const ih: string[] = [];
  const cutoff = new Date("2023-10-12T00:30:00.000Z");
  let wm: Date | null = null;
  let adim = 0;
  for (; adim < 500; adim++) {
    const end = fn(wm, cutoff);
    if (!end) break;
    if (end.getTime() > cutoff.getTime()) { ih.push(`dilim kesimi aştı: ${end.toISOString()}`); break; }
    if (wm && end.getTime() <= wm.getTime()) { ih.push("dilim ilerlemiyor"); break; }
    wm = end;
  }
  if (wm?.getTime() !== cutoff.getTime()) ih.push(`süpürme kesimde bitmedi: ${wm?.toISOString() ?? "null"}`);
  if (adim > 200) ih.push(`taban→kesim ${adim} dilim (gecelik tavan 200)`);
  const ilk = fn(null, cutoff);
  if (!ilk || ilk.getTime() > AUDIT_PURGE_FLOOR.getTime() + 32 * DAY) ih.push("ilk dilim tabandan başlamıyor");
  if (fn(new Date(cutoff.getTime() + DAY), cutoff) !== null) ih.push("filigran kesimi geçmişken yine dilim var");
  return ih;
}

async function okuyucuIhlalleri(): Promise<string[]> {
  const { readAuditArchiveRetentionYears } = await import("../src/services/system-setting.service");
  const stub = (value: unknown) => ({ systemSetting: { findUnique: async () => (value === undefined ? null : { value }) } }) as never;
  const ih: string[] = [];
  const durumlar: Array<[unknown, number]> = [[undefined, 3], ["0", 0], [0, 0], ["5", 5], ["abc", 3], [-2, 3], [99, 3]];
  for (const [v, b] of durumlar) {
    const g = await readAuditArchiveRetentionYears(stub(v));
    if (g !== b) ih.push(`ayar ${JSON.stringify(v)} → ${g} (beklenen ${b})`);
  }
  return ih;
}

async function dbBudamasi(): Promise<string[]> {
  const prisma = (await import("../src/lib/prisma")).default;
  const { AuditService } = await import("../src/services/audit.service");
  const ETIKET = "BEKCI_BAKIM_BUDAMA";
  const now = new Date();
  const eski = new Date(now.getTime() - 4 * 365 * DAY);
  const genc = new Date(now.getTime() - 2 * 365 * DAY);
  const ids = ["eski", "genc"].map(() => crypto.randomUUID());
  const temizle = async (): Promise<void> => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL teks.audit_purge = 'on'`;
      await tx.systemLogArchive.deleteMany({ where: { tableName: ETIKET } });
    });
  };
  try {
    await prisma.systemLogArchive.createMany({
      data: [
        { id: ids[0]!, action: "UPDATE", tableName: ETIKET, recordId: "eski", createdAt: eski, updatedAt: eski },
        { id: ids[1]!, action: "UPDATE", tableName: ETIKET, recordId: "genc", createdAt: genc, updatedAt: genc },
      ],
    });
    const cutoff = auditArchivePurgeCutoff(3, now)!;
    await AuditService.purgeArchiveBefore(cutoff);
    const kalan = await prisma.systemLogArchive.findMany({ where: { tableName: ETIKET }, select: { recordId: true } });
    const ad = kalan.map((k) => k.recordId).sort().join(",");
    return ad === "genc" ? [] : [`kalan arşiv satırları: ${ad || "—"} (beklenen genc)`];
  } finally {
    await temizle();
  }
}

async function relOptions(): Promise<string[]> {
  const prisma = (await import("../src/lib/prisma")).default;
  const tablolar = ["rolls", "machine_stop_events", "machine_runs", "system_logs", "system_log_archives", "sessions"];
  const rows = await prisma.$queryRaw<Array<{ relname: string; reloptions: string[] | null }>>`
    SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname = ANY(${tablolar})`;
  const ih: string[] = [];
  for (const t of tablolar) {
    const o = rows.find((r) => r.relname === t)?.reloptions ?? [];
    if (!o.includes("autovacuum_vacuum_scale_factor=0.02") || !o.includes("autovacuum_analyze_scale_factor=0.01")) ih.push(`${t}: ${o.join(",") || "varsayılan"}`);
  }
  return ih;
}

async function raporBudamasi(): Promise<string[]> {
  const prisma = (await import("../src/lib/prisma")).default;
  const { pruneReportRuns, pruneExpiredScheduledSnapshots } = await import("../src/services/report-prune.service");
  const ETIKET = "BEKCI_BAKIM_RAPOR";
  const now = new Date();
  const { testActorId } = await import("./fixture-test-user");
  const user = { id: await testActorId() };
  const cat = await prisma.reportCategory.create({ data: { code: ETIKET, name: ETIKET } });
  const def = await prisma.reportDefinition.create({ data: { kind: "OZEL", name: ETIKET, categoryId: cat.id, ownerId: user.id } });
  try {
    const run = (ad: string, yas: number) => prisma.reportRun.create({
      data: { paramsDigest: `${ETIKET}_${ad}`, userId: user.id, status: "TAMAM", createdAt: new Date(now.getTime() - yas * DAY), startedAt: new Date(now.getTime() - yas * DAY) },
    });
    const eski = await run("eski", 91);
    const genc = await run("genc", 89);
    const snap = (ad: string, kind: string, bitis: number | null) => prisma.reportSnapshot.create({
      data: { definitionId: def.id, runId: eski.id, params: { ad }, result: {}, kind, expiresAt: bitis === null ? null : new Date(now.getTime() + bitis * DAY), createdById: kind === "KULLANICI" ? user.id : null },
    });
    await snap("zamanlanmisBitti", "ZAMANLANMIS", -1);
    await snap("zamanlanmisSuruyor", "ZAMANLANMIS", 1);
    await snap("kullaniciBitti", "KULLANICI", -1);
    await snap("kullaniciSuresiz", "KULLANICI", null);
    await pruneReportRuns(now);
    await pruneExpiredScheduledSnapshots(now);
    const out: string[] = [];
    const runs = (await prisma.reportRun.findMany({ where: { id: { in: [eski.id, genc.id] } }, select: { paramsDigest: true } })).map((r) => r.paramsDigest.replace(`${ETIKET}_`, "")).sort().join(",");
    if (runs !== "genc") out.push(`kalan koşular: ${runs || "—"} (beklenen genc)`);
    const snaps = await prisma.reportSnapshot.findMany({ where: { definitionId: def.id }, select: { params: true, runId: true } });
    const adlar = snaps.map((x) => (x.params as { ad: string }).ad).sort().join(",");
    if (adlar !== "kullaniciBitti,kullaniciSuresiz,zamanlanmisSuruyor") out.push(`kalan görüntüler: ${adlar || "—"} (beklenen kullaniciBitti,kullaniciSuresiz,zamanlanmisSuruyor)`);
    if (snaps.some((x) => x.runId !== null)) out.push("budanan koşunun görüntüsü runId taşıyor (SET NULL beklenir)");
    return out;
  } finally {
    await prisma.reportSnapshot.deleteMany({ where: { definitionId: def.id } });
    await prisma.reportRun.deleteMany({ where: { paramsDigest: { startsWith: ETIKET } } });
    await prisma.reportDefinition.delete({ where: { id: def.id } });
    await prisma.reportCategory.delete({ where: { id: cat.id } });
  }
}

async function main(): Promise<void> {
  console.log("=== GECE BAKIM İŞLERİ ===\n");
  const kaynak = {
    server: oku("src/server.ts"),
    job: oku("src/jobs/maintenance.job.ts"),
    arsiv: oku("src/jobs/archive-scheduler.ts"),
    kip: oku("src/lib/dogrulama-kipi.ts"),
  };
  const k1 = kayitIhlalleri(kaynak);
  check("§1 ⭐ bakım zamanlayıcısı kayıtlı (doğrulama kipi dışı, arşivleyiciyi o başlatır, üç görev)", k1.length === 0, k1.join(" | "));

  const p = pencereIhlalleri(isInMaintenanceWindow);
  check("§2 ⭐ pencere fabrika saatiyle [02:00, 05:00)", p.length === 0, p.join(" | "));
  const a = arsivKapisiIhlalleri(kaynak.arsiv);
  check("§2b ⭐ arşivleyici pencere kapısından geçer, partiler arasında yeniden ölçer, parti 5000", a.length === 0, a.join(" | "));
  check("§2c bakım işi koşmadan ÖNCE pencereyi ölçer",
    /if \(!isInMaintenanceWindow\(now\)\) return false;\n {2}running = true;/.test(kaynak.job));

  const r = rotasyonIhlalleri(selectExpiredRollbackBackups);
  check("§3 ⭐ premigrate_ rotasyonu: en yeni 3 her zaman, kalan 90 günden eskiler, başka ön ek yok", r.length === 0, r.join(" | "));
  const rd = await rotasyonDosyada();
  check("§3b ⭐ rotasyon geçici dizinde gerçekten siler (tekserp_/pre-restore_ dokunulmaz)", rd.length === 0, rd.join(" | "));

  const c = kesimIhlalleri(auditArchivePurgeCutoff);
  check("§4 ⭐ audit arşivi kesimi: 3 yıl, 0/geçersiz = budama yok", c.length === 0, c.join(" | "));
  const o = await okuyucuIhlalleri();
  check("§4a ⭐ ayar okuyucusu: kayıt yok → 3, \"0\" → 0, geçersiz → 3", o.length === 0, o.join(" | "));
  const dl = dilimIhlalleri(nextAuditPurgeSliceEnd);
  check("§4b aylık dilim tabandan kesime ilerler, aşmaz, gecelik tavana sığar", dl.length === 0, dl.join(" | "));
  const db = await dbBudamasi();
  check("§4c ⭐ DB: 3 yıldan eski arşiv satırı budanır, 2 yıllık kalır (tamper kapısı tx içinde)", db.length === 0, db.join(" | "));
  const tdd = oku("scripts/test_telemetri_defter_degil.ts");
  // G4 (2026-10-13): budayan yol SECURITY DEFINER `audit_arsiv_buda` (uygulama rolü DELETE'siz).
  check("§4d SystemLogArchive budanan-defter-dışı beyanında TELEMETRİ, budayan audit_arsiv_buda göçü",
    /model: "SystemLogArchive", sinif: "TELEMETRI"[\s\S]{0,600}?silen: \["prisma\/migrations\/20261013120000_audit_hash_zinciri\/migration\.sql"\]/.test(tdd));

  const ro = await relOptions();
  check("§5 B2: altı tabloda autovacuum 0.02 / analyze 0.01", ro.length === 0, ro.join(" | "));

  console.log("\n=== §7 RAPOR BUDAMASI (R1-ZAMAN) ===");
  check("§7a rapor budaması bakım görevlerinde kayıtlı", /name: "report-run-prune"/.test(kaynak.job) && /pruneReportRuns\(\)/.test(kaynak.job) && /pruneExpiredScheduledSnapshots\(\)/.test(kaynak.job));
  const rb = await raporBudamasi();
  check("§7b ⭐ DB: 90 günden eski koşu + süresi dolmuş ZAMANLANMIS görüntü gider; KULLANICI görüntüsü kalır", rb.length === 0, rb.join(" | "));

  console.log("\n=== §6 SONDALAR ===");
  const sonda = (ad: string, ihlal: string[]): void => check(`§6 sonda: ${ad} → kırmızı`, ihlal.length > 0);
  sonda("server.ts bakım çağrısı silindi", kayitIhlalleri({ ...kaynak, server: kaynak.server.replace("startMaintenanceScheduler()", "noop()") }));
  sonda("oturum görevi listeden çıktı", kayitIhlalleri({ ...kaynak, job: kaynak.job.replace('name: "session-purge"', 'name: "x"') }));
  sonda("pencere her an açık", pencereIhlalleri(() => true));
  sonda("pencere bitişi dahil (<= 05:00)", pencereIhlalleri((at) => isInMaintenanceWindow(at) || at.getTime() === factoryMinuteOfDay(at, 300).getTime()));
  sonda("arşivleyici kapısı silindi", arsivKapisiIhlalleri(kaynak.arsiv.replace("  if (!isInMaintenanceWindow(new Date())) return;\n", "")));
  sonda("arşivleyici koşulsuz damga", arsivKapisiIhlalleri(kaynak.arsiv.replace("if (finished) await setLastRun", "await setLastRun")));
  sonda("rotasyon 'son 3' tabanı yok", rotasyonIhlalleri((fs2, now) => fs2.filter((x) => x.name.startsWith("premigrate_") && x.mtimeMs < now - 90 * DAY).map((x) => x.name)));
  sonda("rotasyon keep parametresine teslim", rotasyonIhlalleri((fs2, now, keep = 3) =>
    fs2.filter((x) => x.name.startsWith("premigrate_") && /\.dump(\.tkenc)?$/.test(x.name)).sort((p1, p2) => p2.mtimeMs - p1.mtimeMs)
      .slice(keep).filter((x) => x.mtimeMs < now - 90 * DAY).map((x) => x.name)));
  sonda("rotasyon ön ek süzmüyor", rotasyonIhlalleri((fs2, now, keep) => selectExpiredRollbackBackups(fs2.map((x) => ({ ...x, name: x.name.replace(/^(tekserp_|pre-restore_)/, "premigrate_") })), now, keep)));
  sonda("0 yıl budama yapıyor", kesimIhlalleri((y, now) => auditArchivePurgeCutoff(y || 3, now)));
  sonda("kesim 3 yıl değil 2", kesimIhlalleri((y, now) => auditArchivePurgeCutoff(y === 3 ? 2 : y, now)));
  sonda("dilim kesimi aşıyor", dilimIhlalleri((wm, cut) => { const e = nextAuditPurgeSliceEnd(wm, cut); return e && e.getTime() === cut.getTime() ? new Date(cut.getTime() + DAY) : e; }));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  const prisma = (await import("../src/lib/prisma")).default;
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
