// =============================================================================
// BEKÇİ — CARİ BİLDİRİMLERİ (D4-I5; tasarım DALGA4 §12.2): cari.kilitlendi · cari.kilit-acildi (OLAY) ·
// cari.risk-limiti-asildi (KOSUL)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_cari
// =============================================================================
//   §0 statik — iki OLAY türünün TEK yayma noktası `cari-hold.service.ts`, `$transaction` İÇİNDE (AST); risk
//      kaynağı yüklemi KOPYALAMAZ: `notification-sources/` altında `riskLimit` okuyan ya da Decimal kıyaslayan
//      (`.gt/.gte/.lt/.lte/.cmp/.comparedTo`) kod yok, `cari.ts` çekirdeği (`riskExposureTx`) çağırıp `exceeded` okur.
//   §1 kilit koy → tek OUTBOX satırı (kilit başına), aynı token replay ikinci bildirim DOĞURMAZ, aktif kilit
//      varken ikinci koyma 409 ve bildirimsiz; yük = katalog payloadAlanlari, sayısal tutar yok.
//   §2 görme: finance:read'li kişi gelen kutusunda görür; finance:read'siz sevkçi (shipping:write) de görür (D4-KUC3a);
//      derin bağlantı `?focus=<hesapId>`.
//   §3 kilit aç → tek `cari.kilit-acildi`; ikinci açma 409 → ikinci bildirim yok.
//   §4 KOSUL (gerçek okuyucu, gerçek tarayıcı): ilk tur SESSİZ TABAN (0 ACILDI, koşul açık) · tabandan sonra
//      yeni aşım → tek ACILDI + kutu · sürer → yeni satır yok · okuyucu fırlatır → koşul AÇIK · bakiye limit
//      içine → KAPANDI + "çözüldü" metni · limitsiz cari koşul doğurmaz · ön muhasebe kapalı → küme boş.
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31, geri alındı):
//   ① `cari.ts` yüküne `bakiye: e.balance.toString()` eklendi → §4h ❌ (23/1); katalogda `payloadAlanlari`na
//      `riskLimiti` eklendi → `test_bildirim_katalogu` §8 + §5b ❌ (27/2) · ② is.ts'e `riskLimit` okuyup `.gt(`
//      kıyaslayan kopya fonksiyon → §0c ❌ (23/1)
// Global ayar yazar (`bildirim.gelenKutusuEnabled`, `finance.enabled`, koşul damgası); `finally`de geri koyar.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { AuditService } from "../src/services/audit.service";
import { cariService } from "../src/services/cari.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { cariHoldService } from "../src/services/cari-hold.service";
import { NOTIFICATION_CATALOG, type NotificationKind } from "../src/constants/notification-catalog";
import { runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import { runConditionSourceOnce } from "../src/jobs/notification-condition.job";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { renderNotification } from "../src/services/helpers/notification-render.helper";
import { notificationBaselineKey } from "../src/services/helpers/notification-baseline.helper";
import { overrideCariSourceDeps, registerCariConditionSources, riskLimitExceededSubjects, RISK_LIMIT_KIND } from "../src/services/notification-sources/cari";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const SRC = join(__dirname, "..", "src");
const TAG = `TEST-BCR-${process.pid}`;
const BASLANGIC = new Date(Date.now() - 1000);
const KILIT: NotificationKind = "cari.kilitlendi";
const ACILDI: NotificationKind = "cari.kilit-acildi";
const RISK: NotificationKind = RISK_LIMIT_KIND;
const TURLER = [KILIT, ACILDI, RISK] as const;
const AYARLAR = [SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, SETTING_KEYS.FINANCE_ENABLED, notificationBaselineKey(RISK)];
const ids = { customers: [] as string[], users: [] as string[] };

AuditService.log = async () => {};

// ── §0 statik ────────────────────────────────────────────────────────────────
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
interface EmitCall { file: string; kind: string | null; inTx: boolean }
function emitCalls(file: string, text: string): EmitCall[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: EmitCall[] = [];
  const inTx = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isCallExpression(p.parent)) {
        const c = p.parent.expression;
        if (ts.isPropertyAccessExpression(c) && c.name.text === "$transaction") return true;
      }
    }
    return false;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "emitNotification") {
      const a = n.arguments[1];
      out.push({ file, kind: a && ts.isStringLiteral(a) ? a.text : null, inTx: inTx(n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
/** Decimal kıyası ya da `riskLimit` okuması — risk yüklemi kopyasının izi. */
function predicateCopies(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === "riskLimit") out.push(`${file}: riskLimit`);
    if (ts.isIdentifier(n) && n.text === "riskLimit" && ts.isPropertyAssignment(n.parent)) out.push(`${file}: riskLimit seçimi`);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["gt", "gte", "lt", "lte", "cmp", "comparedTo"].includes(n.expression.name.text)) {
      out.push(`${file}: .${n.expression.name.text}(`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function statik(): void {
  console.log("\n── §0 statik ──");
  const calls = walk(SRC).flatMap((f) => {
    const rel = relative(SRC, f).split(sep).join("/");
    return rel === "services/helpers/notification-emit.helper.ts" ? [] : emitCalls(rel, readFileSync(f, "utf8"));
  });
  for (const kind of [KILIT, ACILDI]) {
    const c = calls.filter((x) => x.kind === kind);
    check(`§0a ⭐ ${kind}: TEK yayma noktası cari-hold.service.ts, $transaction İÇİNDE`,
      c.length === 1 && c[0]!.file === "services/cari-hold.service.ts" && c[0]!.inTx, JSON.stringify(c));
  }
  const sonda = emitCalls("x.ts", `async function f(){ await emitNotification(db, "${KILIT}", s, p); await prisma.$transaction(async (tx) => { await emitNotification(tx, "${KILIT}", s, p); }); }`);
  check("§0b sonda: tarayıcı tx dışı/içi çağrıyı ayırır", sonda.length === 2 && !sonda[0]!.inTx && sonda[1]!.inTx);
  const srcDir = join(SRC, "services/notification-sources");
  const copies = walk(srcDir).flatMap((f) => predicateCopies(relative(SRC, f), readFileSync(f, "utf8")));
  check("§0c ⭐ notification-sources/ altında risk yüklemi kopyası yok (riskLimit okuması / Decimal kıyası)", copies.length === 0, copies.join(" · ") || "temiz");
  const kopyaSonda = predicateCopies("y.ts", "const a = cari.riskLimit; if (bal.gt(a)) x();");
  check("§0d sonda: kopya tarayıcısı riskLimit + .gt( görür", kopyaSonda.length === 2, kopyaSonda.join(", "));
  const cariKod = readFileSync(join(srcDir, "cari.ts"), "utf8");
  check("§0e cari.ts çekirdeği çağırır: riskExposureTx(…) + `.exceeded`",
    /from "\.\.\/helpers\/risk-exposure\.helper"/.test(cariKod) && /riskExposureTx\(/.test(cariKod) && /\.exceeded\b/.test(cariKod));
}

// ── DB yardımcıları ────────────────────────────────────────────────────────────
async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
}
async function person(ad: string, codes: string[]): Promise<string> {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (perms.length !== codes.length) throw new Error(`izin kataloğu eksik: ${codes.join(",")}`);
  const u = await prisma.user.create({
    data: { username: `${TAG}-${ad}`.toLowerCase(), fullName: `${TAG} ${ad}`, passwordHash: await bcrypt.hash(randomUUID(), 4), isActive: true },
    select: { id: true },
  });
  ids.users.push(u.id);
  await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id })) });
  return u.id;
}
async function card(adminId: string): Promise<{ customerId: string; cariId: string }> {
  const r = (await customerService.create({ name: `${TAG} ${Math.random().toString(36).slice(2, 7)}`, isCustomerRole: true }, adminId)) as { data: { id: string } };
  ids.customers.push(r.data.id);
  const acc = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: r.data.id }, select: { id: true } });
  return { customerId: r.data.id, cariId: acc.id };
}
async function dispatch(): Promise<void> {
  for (let i = 0; i < 100; i++) if ((await runNotificationDispatchOnce()).processed === 0) break;
}
async function errorOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    if (e instanceof AppError) return String((e.details as { code?: string } | undefined)?.code ?? e.statusCode);
    throw e;
  }
}
const outbox = (kind: string, key: string, phase?: string) =>
  prisma.notificationOutbox.findMany({ where: { kind, subjectKey: key, createdAt: { gte: BASLANGIC }, ...(phase ? { phase } : {}) } });
const inbox = (userId: string, kind: string) => prisma.notificationInbox.count({ where: { userId, kind, createdAt: { gte: BASLANGIC } } });
const openCond = (key: string) => prisma.notificationCondition.findFirst({ where: { kind: RISK, subjectKey: key, resolvedAt: null } });
function payloadClean(kind: NotificationKind, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const declared = [...NOTIFICATION_CATALOG[kind].payloadAlanlari].sort();
  const keys = Object.keys(p).sort();
  if (JSON.stringify(keys) !== JSON.stringify(declared)) return `anahtar ${keys.join(",")} ≠ beyan ${declared.join(",")}`;
  const numeric = Object.entries(p).filter(([, v]) => typeof v !== "string" || /^-?\d+([.,]\d+)?$/.test(v));
  return numeric.length ? `sayısal değer: ${numeric.map(([k]) => k).join(",")}` : "";
}
async function setBalance(cariId: string, balance: number): Promise<void> {
  await prisma.cariBalance.upsert({
    where: { cariId_currency: { cariId, currency: "TRY" } },
    create: { cariId, currency: "TRY", balance },
    update: { balance },
  });
}

// ── gövde ─────────────────────────────────────────────────────────────────────
async function body(): Promise<void> {
  statik();
  const admin = await ensureTestAdmin();
  await setSetting(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, true);
  await setSetting(SETTING_KEYS.FINANCE_ENABLED, true);
  const muhasebe = await person("muh", ["finance:read", "finance:invoice"]);
  const sevkci = await person("sevk", ["shipping:read", "shipping:write"]);
  const acan = await person("acan", ["finance:read", "finance:hold-release"]);

  console.log("\n── §1 kilit koy ──");
  const k = await card(admin.id);
  const g = { blocksIntake: true, blocksShipment: true, blocksInvoice: false, reasonCode: "BORC" as const, reasonText: `${TAG} gizli not 12500 TL`, clientToken: randomUUID() };
  const r1 = await cariHoldService.place(k.cariId, g, admin.id);
  const holdId = r1.data!.id;
  const o1 = await outbox(KILIT, holdId);
  check("§1a kilit koy → tek cari.kilitlendi (konu = kilit, OLAY)", o1.length === 1 && o1[0]!.phase === "OLAY" && o1[0]!.subjectId === holdId, `${o1.length}`);
  await cariHoldService.place(k.cariId, g, admin.id);
  check("§1b ⭐ aynı token replay → ikinci bildirim YOK", (await outbox(KILIT, holdId)).length === 1, `${(await outbox(KILIT, holdId)).length}`);
  const e1c = await errorOf(() => cariHoldService.place(k.cariId, { ...g, clientToken: randomUUID() }, admin.id));
  const turdeKilit = await prisma.notificationOutbox.count({ where: { kind: KILIT, createdAt: { gte: BASLANGIC } } });
  check("§1c aktif kilit varken ikinci koyma 409 CARI_HOLD_EXISTS, bildirim doğmaz", e1c === "CARI_HOLD_EXISTS" && turdeKilit === 1, `${e1c} outbox=${turdeKilit}`);
  const temiz1 = payloadClean(KILIT, o1[0]?.payload);
  const json1 = JSON.stringify(o1[0]?.payload ?? {});
  check("§1d yük = katalog beyanı, sayısal tutar yok, serbest metin (reasonText) yok", temiz1 === "" && !json1.includes("12500") && !json1.includes("gizli"), temiz1 || json1);
  const t1 = renderNotification(KILIT, (o1[0]?.payload ?? {}) as Record<string, unknown>, "OLAY");
  check("§1e metin dolu: cari adı + kapsam + sebep etiketi, yer tutucu kalmadı", t1.baslik.includes(TAG) && /sevk/.test(t1.govde) && !`${t1.baslik}${t1.govde}`.includes("{"), `${t1.baslik} | ${t1.govde}`);

  console.log("\n── §2 görme ──");
  await dispatch();
  const im = await inbox(muhasebe, KILIT);
  const isv = await inbox(sevkci, KILIT);
  check("§2a ⭐ finance:read'li muhasebeci gelen kutusunda TEK satır görür", im === 1, `${im}`);
  // 1e kararı (D4-KUC3a): kilitli caride sevk durur → sevkçi (shipping:write) kilidi bilmeli; görme DNF'si genişledi.
  check("§2b ⭐ finance:read'siz sevkiyatçı (shipping:write) kilit bildirimini GÖRÜR", isv === 1, `${isv}`);
  const yol1 = renderNotification(KILIT, (o1[0]?.payload ?? {}) as Record<string, unknown>, "OLAY").yol;
  check("§2c derin bağlantı cari hesabına odaklanır (?focus=<hesapId>)", yol1 === `/finance/cari?focus=${k.cariId}`, yol1);
  const odak = await cariService.list({ id: k.cariId, pageSize: 5 });
  check("§2d odak hedefi: cari listesi `filter[id]` ile o hesabı tek satır döner", odak.data.length === 1 && odak.data[0]!.id === k.cariId, `${odak.data.length}`);

  console.log("\n── §3 kilit aç ──");
  await cariHoldService.release(holdId, `${TAG} tahsil edildi`, acan);
  const e3b = await errorOf(() => cariHoldService.release(holdId, "ikinci", acan));
  const o3 = await outbox(ACILDI, holdId);
  check("§3a ⭐ aç → tek cari.kilit-acildi; ikinci açma 409 → ikinci bildirim yok", o3.length === 1 && e3b === "CARI_HOLD_NOT_ACTIVE", `${o3.length} ${e3b}`);
  const temiz3 = payloadClean(ACILDI, o3[0]?.payload);
  check("§3b açılış yükü beyanlı, açılış sebebi (serbest metin) yok", temiz3 === "" && !JSON.stringify(o3[0]?.payload ?? {}).includes("tahsil"), temiz3);
  await dispatch();
  check("§3c açılış muhasebeciye ve sevkiyatçıya gider (sevk yeniden açık — D4-KUC3a), açan kişinin kendisine değil", (await inbox(muhasebe, ACILDI)) === 1 && (await inbox(sevkci, ACILDI)) === 1 && (await inbox(acan, ACILDI)) === 0);

  console.log("\n── §4 KOSUL risk limiti aşıldı ──");
  registerCariConditionSources();
  const onceAcik = await prisma.notificationCondition.count({ where: { kind: RISK, resolvedAt: null } });
  if (onceAcik > 0) console.log(`   ⓘ ön durum: bu türde ${onceAcik} açık koşul (başka cari) — ölçüm konu anahtarıyla yapılır`);
  const a = await card(admin.id);
  const b = await card(admin.id);
  const limitsiz = await card(admin.id);
  await prisma.cariAccount.update({ where: { id: a.cariId }, data: { riskLimit: new Prisma.Decimal(100) } });
  await prisma.cariAccount.update({ where: { id: b.cariId }, data: { riskLimit: new Prisma.Decimal(100) } });
  await setBalance(a.cariId, 500);
  await setBalance(limitsiz.cariId, 999_999);
  const keyA = `${a.cariId}:TRY`;
  const keyB = `${b.cariId}:TRY`;
  const keyL = `${limitsiz.cariId}:TRY`;

  // Taban: damga yok → ilk tur sessiz.
  await prisma.systemSetting.deleteMany({ where: { key: notificationBaselineKey(RISK) } });
  const w = await runConditionSourceOnce(RISK);
  await dispatch();
  check("§4a ⭐ ilk tur SESSİZ TABAN: aşımdaki cari için koşul açık, ACILDI 0, kutu 0",
    typeof w === "object" && w.baseline !== undefined && !!(await openCond(keyA)) && (await outbox(RISK, keyA)).length === 0 && (await inbox(muhasebe, RISK)) === 0,
    JSON.stringify(w));

  await setBalance(b.cariId, 250);
  const r2 = await runConditionSourceOnce(RISK);
  await dispatch();
  const ob = await outbox(RISK, keyB, "ACILDI");
  check("§4b tabandan sonra yeni aşım → tek ACILDI + muhasebeciye tek kutu satırı, sevkiyatçıya yok",
    typeof r2 === "object" && ob.length === 1 && (await inbox(muhasebe, RISK)) === 1 && (await inbox(sevkci, RISK)) === 0, `${JSON.stringify(r2)} acildi=${ob.length}`);
  for (let i = 0; i < 2; i++) await runConditionSourceOnce(RISK);
  check("§4c sürer (2 tur) → yeni ACILDI yok", (await outbox(RISK, keyB, "ACILDI")).length === 1);
  check("§4d limitsiz (riskLimit NULL) cari, bakiyesi ne olursa olsun koşul doğurmaz", !(await openCond(keyL)));

  const geri = overrideCariSourceDeps({ exposure: async () => { throw new Error("sahte okuyucu hatası"); } });
  await setBalance(b.cariId, 10);
  const re = await runConditionSourceOnce(RISK);
  geri();
  check("§4e okuyucu fırlatır → koşul AÇIK kalır, KAPANDI yok", re === "error" && !!(await openCond(keyB)) && (await outbox(RISK, keyB, "KAPANDI")).length === 0, JSON.stringify(re));

  const rc = await runConditionSourceOnce(RISK);
  await dispatch();
  const kap = await outbox(RISK, keyB, "KAPANDI");
  const pl = (kap[0]?.payload ?? {}) as Record<string, unknown>;
  const kapali = renderNotification(RISK, pl, "KAPANDI").govde;
  const acik = renderNotification(RISK, pl, "ACILDI").govde;
  check("§4f bakiye limit içine → KAPANDI + 'çözüldü' metni (ters bildirim değil, geri düşüş)",
    typeof rc === "object" && kap.length === 1 && !(await openCond(keyB)) && kapali !== acik && kapali.includes("içinde") && !kapali.includes("{"), `${kapali}`);

  await setSetting(SETTING_KEYS.FINANCE_ENABLED, false);
  const kapaliModul = await riskLimitExceededSubjects();
  await setSetting(SETTING_KEYS.FINANCE_ENABLED, true);
  check("§4g ön muhasebe kapalı → konu kümesi boş", kapaliModul.length === 0, `${kapaliModul.length}`);

  const subjects = await riskLimitExceededSubjects();
  const sa = subjects.find((s) => s.key === keyA);
  const temiz4 = payloadClean(RISK, sa?.payload);
  check("§4h ⭐ koşul yükü = katalog beyanı, bakiye/limit/tutar yok", !!sa && temiz4 === "" && !JSON.stringify(sa.payload).includes("500"), temiz4 || JSON.stringify(sa?.payload));
}

async function cleanup(): Promise<void> {
  const accs = await prisma.cariAccount.findMany({ where: { customerId: { in: ids.customers } }, select: { id: true } });
  const accIds = accs.map((a) => a.id);
  const holds = await prisma.cariHold.findMany({ where: { cariId: { in: accIds } }, select: { id: true } });
  await prisma.notificationInbox.deleteMany({ where: { OR: [{ userId: { in: ids.users } }, { kind: { in: [...TURLER] }, createdAt: { gte: BASLANGIC } }] } });
  await prisma.notificationOutbox.deleteMany({ where: { kind: { in: [...TURLER] }, createdAt: { gte: BASLANGIC } } });
  await prisma.notificationCondition.deleteMany({ where: { kind: RISK, createdAt: { gte: BASLANGIC } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...holds.map((h) => h.id), ...ids.customers, ...accIds] } } });
  await prisma.cariHold.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  for (const u of ids.users) {
    await prisma.userPermission.deleteMany({ where: { userId: u } });
    await prisma.systemLog.deleteMany({ where: { userId: u } });
    await prisma.user.delete({ where: { id: u } }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim — cari türleri (D4-I5) ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`⛔ DURDURULDU — ${engel}`);
  const snapshot = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  try {
    await body();
  } finally {
    stopNotificationJobs();
    await cleanup().catch((e) => {
      fail++;
      console.error("❌ temizlik", e);
    });
    for (const key of AYARLAR) {
      const v = snapshot.find((s) => s.key === key);
      if (v) await setSetting(key, v.value);
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
}

main()
  .catch((err) => {
    fail++;
    console.error("❌ beklenmeyen hata", err);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
