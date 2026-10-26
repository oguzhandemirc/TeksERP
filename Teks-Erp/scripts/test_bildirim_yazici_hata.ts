// =============================================================================
// BEKÇİ — BİLDİRİM: `yazici.hata` OLAY'ı (izlenebilirlik A4; plan IZLENEBILIRLIK-CIHAZ-PLAN §3.6)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_yazici_hata
// =============================================================================
//   §0 (AST) `yazici.hata` TEK yayma noktası: `services/print-job.service.ts`, `$transaction` İÇİNDE
//   §1 ⭐ tablet HATA raporu → TEK basım satırı + TEK outbox satırı (konu = yazıcı, aktör = basan)
//      §1b payload yalnız katalog alanları; yazici = kayıtlı cihaz id'si, yaziciAd = cihaz adı
//   §2 aynı token tekrar (replay) → satır ve outbox sayısı değişmez
//   §3 ⭐ 600 sn içinde aynı yazıcının ikinci hatası → izinli alıcıda TEK gelen kutusu satırı, count=2;
//      izinsiz kullanıcı ve basan (aktör) almaz
//   §4 HATA dışı sonuç (ILETILDI · IPTAL · BELIRSIZ) → outbox yok
//   §5 sunucu yolu (`recordPrintJob`) HATA → aynı tek noktadan outbox
//   §6 ⭐ bayrak kapalı → HATA satırı doğar, outbox yok (bugünkü davranış)
//   §7 outbox yazımı düşerse rapor satırı da doğmaz (aynı tx; istemci aynı token'la yeniden dener)
//
// NEGATİF SONDALAR (2026-10-25, md5 ile birebir geri alındı): ① emit `$transaction` dışına (`prisma` ile,
// satırdan sonra) ⇒ §0b · §7 ❌ (2 kırmızı) · ② `status !== "HATA"` erken dönüşü kaldırıldı (her sonuç
// yayar) ⇒ §4 ❌ (1 kırmızı).
// Global ayar yazar (`bildirim.gelenKutusuEnabled`); bulduğu değere `finally`de döner. Kendi satırlarını temizler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import * as bcrypt from "bcryptjs";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { NOTIFICATION_CATALOG, type NotificationKind } from "../src/constants/notification-catalog";
import { notificationDedupeKey } from "../src/services/helpers/notification-emit.helper";
import { notificationGroupKey, runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import { recordPrintJob, reportPrintJob, type PrintJobReport } from "../src/services/print-job.service";
import type { PrintJobRequestContext } from "../src/services/helpers/print-job-context.helper";
import { factoryYmd } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const OLAY: NotificationKind = "yazici.hata";
const SRC = join(__dirname, "..", "src");
const EMIT_HELPER = "services/helpers/notification-emit.helper.ts";

// ── §0 AST ──────────────────────────────────────────────────────────────────
interface EmitCagri { dosya: string; tur: string | null; txIcinde: boolean }
function txIcinde(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isCallExpression(p.parent)) {
      const c = p.parent.expression;
      if (ts.isPropertyAccessExpression(c) && c.name.text === "$transaction") return true;
    }
  }
  return false;
}
function emitCagrilari(dosya: string, metin: string): EmitCagri[] {
  const sf = ts.createSourceFile(dosya, metin, ts.ScriptTarget.Latest, true);
  const out: EmitCagri[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "emitNotification") {
      const a = n.arguments[1];
      out.push({ dosya, tur: a && ts.isStringLiteral(a) ? a.text : null, txIcinde: txIcinde(n) });
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}
function bolum0(): void {
  console.log("\n§0 AST — tek yayma noktası");
  const cagrilar: EmitCagri[] = [];
  for (const f of walkTs(SRC)) {
    const rel = relative(SRC, f).split(sep).join("/");
    if (rel === EMIT_HELPER) continue;
    cagrilar.push(...emitCagrilari(rel, readFileSync(f, "utf8")));
  }
  const bu = cagrilar.filter((c) => c.tur === OLAY);
  check("§0a katalogda OLAY, pencere 600 sn, izin system:print-history", NOTIFICATION_CATALOG[OLAY].altTur === "OLAY" && NOTIFICATION_CATALOG[OLAY].pencereSn === 600
    && JSON.stringify(NOTIFICATION_CATALOG[OLAY].izinler) === JSON.stringify([["system:print-history"]]));
  check("§0b ⭐ tek nokta: services/print-job.service.ts, `$transaction` geri çağrısının İÇİNDE",
    bu.length === 1 && bu[0]!.dosya === "services/print-job.service.ts" && bu[0]!.txIcinde, JSON.stringify(bu));
}

// ── DB ──────────────────────────────────────────────────────────────────────
const ek = Date.now().toString(36);
const BASLANGIC = new Date(Date.now() - 1000);
const yaratilan = { kullanici: [] as string[], cihaz: [] as string[], token: [] as string[] };
const SONDA_FN = `tbyh_${ek}_boz`;

async function bayrak(v: boolean): Promise<void> {
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}
async function kisi(ad: string, codes: string[]): Promise<string> {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (perms.length !== codes.length) throw new Error(`izin kataloğu eksik: ${codes.join(",")}`);
  const u = await prisma.user.create({
    data: { username: `tbyh_${ad}_${ek}`.slice(0, 50), fullName: `TEST-BYH ${ad}`, passwordHash: await bcrypt.hash(randomUUID(), 4) },
    select: { id: true },
  });
  yaratilan.kullanici.push(u.id);
  for (const p of perms) await prisma.userPermission.create({ data: { userId: u.id, permissionId: p.id } });
  return u.id;
}
const ctx = (userId: string): PrintJobRequestContext => ({ userId, deviceRefId: null, source: "TABLET", appVersion: "9.9.9", stationId: null, machineId: null });
function rapor(peripheralId: string, ekAlan: Partial<PrintJobReport> = {}): PrintJobReport {
  const clientToken = randomUUID();
  yaratilan.token.push(clientToken);
  return {
    clientToken, subjectKind: "ETIKET_TOP", status: "HATA", transport: "BLUETOOTH", peripheralId,
    printerName: `BYH Yazıcı ${ek}`, printerAddress: "00:11:22:33:44:55", errorCode: "BT_BAGLANTI", errorMessage: "Yazıcıya bağlanılamadı",
    ...ekAlan,
  } as PrintJobReport;
}
const outbox = (konu: string) => prisma.notificationOutbox.findMany({ where: { kind: OLAY, subjectKey: `printer:${konu}`, createdAt: { gte: BASLANGIC } } });
async function dagit(): Promise<void> {
  for (let i = 0; i < 100; i++) if ((await runNotificationDispatchOnce()).processed === 0) break;
}
const statsOnce = new Map<string, number | null>();
async function statsKaydet(gun: string): Promise<void> {
  if (statsOnce.has(gun)) return;
  const r = await prisma.notificationDailyStats.findUnique({ where: { factoryDay_kind: { factoryDay: new Date(`${gun}T00:00:00Z`), kind: OLAY } }, select: { events: true } });
  statsOnce.set(gun, r?.events ?? null);
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim — yazici.hata OLAY'ı ===");
  bolum0();
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  try {
    await bayrak(true);
    await statsKaydet(factoryYmd(new Date()));
    await dagit(); // önceki koşumların satırları bu kovaya karışmasın
    const basan = await kisi("basan", []);
    const sorumlu = await kisi("sorumlu", ["system:print-history"]);
    const izinsiz = await kisi("izinsiz", ["order:read"]);
    const cihaz = await prisma.peripheralDevice.create({
      data: { code: `BYH-${ek}`, name: `BYH Etiket ${ek}`, kind: "LABEL_PRINTER", connectionType: "BLUETOOTH_SPP", address: "00:11:22:33:44:55" },
      select: { id: true, name: true },
    });
    yaratilan.cihaz.push(cihaz.id);

    console.log("\n§1 HATA raporu");
    const r1 = rapor(cihaz.id);
    const job1 = await reportPrintJob(ctx(basan), r1);
    const o1 = await outbox(cihaz.id);
    check("§1a ⭐ TEK basım satırı + TEK outbox satırı, konu = yazıcı, aktör = basan",
      job1.status === "HATA" && o1.length === 1 && o1[0]!.subjectType === "printer" && o1[0]!.subjectId === cihaz.id && o1[0]!.actorUserId === basan,
      `outbox=${o1.length}`);
    const yuk = (o1[0]?.payload ?? {}) as Record<string, unknown>;
    const izinli = new Set<string>(NOTIFICATION_CATALOG[OLAY].payloadAlanlari);
    check("§1b payload yalnız katalog alanları; yazici = cihaz id'si, kişi/tür/neden Türkçe",
      Object.keys(yuk).every((k) => izinli.has(k)) && yuk.yazici === cihaz.id && yuk.yaziciAd === `BYH Yazıcı ${ek}` && yuk.kisi === "TEST-BYH basan"
        && yuk.tur === "Top etiketi" && yuk.neden === "Yazıcıya bağlanılamadı", JSON.stringify(yuk));

    console.log("\n§2 replay");
    const tekrar = await reportPrintJob(ctx(basan), r1);
    const satir = await prisma.printJob.count({ where: { clientToken: r1.clientToken } });
    check("§2 aynı token → aynı satır, outbox değişmez", tekrar.id === job1.id && satir === 1 && (await outbox(cihaz.id)).length === 1);

    console.log("\n§3 600 sn penceresi");
    await reportPrintJob(ctx(basan), rapor(cihaz.id, { errorCode: "BT_ESLESME", errorMessage: "Eşleşme reddedildi" }));
    await dagit();
    const o3 = await outbox(cihaz.id);
    const gk = notificationGroupKey({ kind: OLAY, subjectId: cihaz.id, subjectKey: `printer:${cihaz.id}`, conditionId: null, dedupeKey: notificationDedupeKey(OLAY, `printer:${cihaz.id}`, { yazici: cihaz.id }), occurredAt: o3[0]!.occurredAt });
    const kutu = await prisma.notificationInbox.findMany({ where: { userId: sorumlu, kind: OLAY, createdAt: { gte: BASLANGIC } } });
    check("§3a ⭐ aynı yazıcının iki hatası → sorumluda TEK satır, count=2", o3.length === 2 && kutu.length === 1 && kutu[0]!.count === 2 && kutu[0]!.groupKey === gk,
      `outbox=${o3.length} rows=${kutu.length} count=${kutu[0]?.count}`);
    const diger = await prisma.notificationInbox.count({ where: { userId: { in: [izinsiz, basan] }, kind: OLAY } });
    check("§3b izinsiz kullanıcı ve basan almaz", diger === 0, `rows=${diger}`);

    console.log("\n§4 HATA dışı sonuçlar");
    const once4 = (await outbox(cihaz.id)).length;
    for (const status of ["ILETILDI", "IPTAL", "BELIRSIZ"] as const) {
      await reportPrintJob(ctx(basan), rapor(cihaz.id, { status, errorCode: undefined, errorMessage: undefined }));
    }
    check("§4 ⭐ ILETILDI · IPTAL · BELIRSIZ → outbox yok", (await outbox(cihaz.id)).length === once4);

    console.log("\n§5 sunucu yolu");
    const sunucuYazici = `BYH Sunucu ${ek}`;
    await recordPrintJob({ ctx: { ...ctx(basan), source: "SUNUCU" }, subjectKind: "ETIKET_TOP", status: "HATA", transport: "SUNUCU_TCP", printerName: sunucuYazici, errorCode: "ZAMAN_ASIMI", errorMessage: "Zaman aşımı" });
    check("§5 recordPrintJob HATA → aynı noktadan TEK outbox (konu = yazıcı adı)", (await outbox(sunucuYazici)).length === 1);

    console.log("\n§6 bayrak kapalı");
    await bayrak(false);
    const once6 = (await outbox(cihaz.id)).length;
    const r6 = rapor(cihaz.id);
    const job6 = await reportPrintJob(ctx(basan), r6);
    check("§6 ⭐ bayrak kapalı → HATA satırı doğar, outbox yok", job6.status === "HATA" && (await outbox(cihaz.id)).length === once6);
    await bayrak(true);

    console.log("\n§7 outbox düşerse");
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${SONDA_FN}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'tbyh sonda'; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${SONDA_FN}_o BEFORE INSERT ON "notification_outbox" FOR EACH ROW WHEN (NEW."kind" = '${OLAY}') EXECUTE FUNCTION ${SONDA_FN}()`);
    const r7 = rapor(cihaz.id);
    const sonuc7 = await reportPrintJob(ctx(basan), r7).then(() => "yazildi", () => "hata");
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${SONDA_FN}_o ON "notification_outbox"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${SONDA_FN}()`);
    const satir7 = await prisma.printJob.count({ where: { clientToken: r7.clientToken } });
    check("§7 outbox düşer → rapor hata döner, satır doğmaz (aynı tx)", sonuc7 === "hata" && satir7 === 0, `sonuc=${sonuc7} satir=${satir7}`);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${SONDA_FN}_o ON "notification_outbox"`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${SONDA_FN}()`).catch(() => {});
    for (const [gun, v] of statsOnce) {
      const factoryDay = new Date(`${gun}T00:00:00Z`);
      if (v === null) await prisma.notificationDailyStats.deleteMany({ where: { factoryDay, kind: OLAY } });
      else await prisma.notificationDailyStats.updateMany({ where: { factoryDay, kind: OLAY }, data: { events: v } });
    }
    await prisma.notificationInbox.deleteMany({ where: { kind: OLAY, createdAt: { gte: BASLANGIC } } });
    await prisma.notificationOutbox.deleteMany({ where: { kind: OLAY, createdAt: { gte: BASLANGIC } } });
    await prisma.printJob.deleteMany({ where: { OR: [{ userId: { in: yaratilan.kullanici } }, { peripheralDeviceId: { in: yaratilan.cihaz } }] } });
    await prisma.peripheralDevice.deleteMany({ where: { id: { in: yaratilan.cihaz } } });
    await prisma.notificationInbox.deleteMany({ where: { userId: { in: yaratilan.kullanici } } });
    await prisma.userPermission.deleteMany({ where: { userId: { in: yaratilan.kullanici } } });
    await prisma.user.deleteMany({ where: { id: { in: yaratilan.kullanici } } });
    if (ilk) await prisma.systemSetting.update({ where: { key }, data: { value: ilk.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main()
  .catch((e: unknown) => {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exitCode ||= fail === 0 ? 0 : 1;
  });
