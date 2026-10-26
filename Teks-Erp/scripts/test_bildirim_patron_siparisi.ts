// =============================================================================
// BEKÇİ — BİLDİRİM: `siparis.patron-siparisi` OLAY'ı (N1-OLAY; plan §3.6, §3.7, §4 satır 5)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_patron_siparisi
// =============================================================================
//   §0 (AST) katalogdaki her OLAY türünün `src/`de en çok TEK yayma noktası var; patron siparişininki
//      `cloud-inbox.service.ts`te ve bir `$transaction` geri çağrısının İÇİNDE; değişken türlü emit yalnız
//      koşul tarayıcısında; literal tür katalogda (tanınmayan tür kırmızı)
//   §1 ⭐ bulut mesajı → sipariş + TEK outbox satırı (konu = sipariş, aktör = teknik kullanıcı)
//      §1b commit'te düşen sipariş tx'i → outbox satırı da yok · §1c outbox INSERT'ü düşerse sipariş de doğmaz
//   §2 aynı mesaj tekrar → aynı sonuç, outbox sayısı değişmez
//   §3 ⭐ 600 sn kovasında 3 sipariş → order:write sahibinde TEK gelen kutusu satırı count=3;
//      order:write'sız okuyucu ve aktör almaz
//   §4 ret yolları (olmayan ürün · gövde katı · mesaj çakışması) → outbox yok
//   §5 bayrak kapalı → sipariş doğar, outbox yok (bugünkü davranış)
//   §6 payload yalnız katalog `payloadAlanlari`; tutar/fiyat/miktar yok
//
// NEGATİF SONDALAR (2026-10-25, md5 ile birebir geri alındı): ① emit commit sonrası AYRI `$transaction`a
// taşındı ⇒ yalnız §1c ❌ (14/1; sipariş + makbuz outbox'sız doğdu) · ② emit tx dışına (`prisma` ile, commit
// sonrası) + ret yoluna da kondu ⇒ §0a · §0b · §1c · §4 ❌ (11/4).
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
import { AuditService } from "../src/services/audit.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { processInboxMessage } from "../src/services/cloud-inbox.service";
import { activatePatronCloud, readPatronCloudUserId, __resetPatronCloudStateForTests } from "../src/services/patron-cloud.service";
import { PATRON_CLOUD_USER_SETTING_KEY } from "../src/constants/reserved-settings";
import { NOTIFICATION_CATALOG, type NotificationKind } from "../src/constants/notification-catalog";
import { notificationDedupeKey } from "../src/services/helpers/notification-emit.helper";
import { notificationGroupKey, runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import type { InboxMessage, InboxOutcome } from "../src/cloud-sync/wire";
import { factoryYmd } from "../src/constants/time";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

// ── §0 AST: tek yayma noktası ────────────────────────────────────────────────
const SRC = join(__dirname, "..", "src");
const EMIT_HELPER = "services/helpers/notification-emit.helper.ts";
/** Türü değişkenle yayan tek izinli dosya: koşul tarayıcısı (yalnız KOSUL türleri). */
const DEGISKEN_TURLU_IZINLI = new Set(["jobs/notification-condition.job.ts"]);
const OLAY: NotificationKind = "siparis.patron-siparisi";

interface EmitCagri { dosya: string; satir: number; tur: string | null; txIcinde: boolean }

function txGeriCagrisiIcinde(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isCallExpression(p.parent)) {
      const callee = p.parent.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "$transaction") return true;
    }
  }
  return false;
}

function emitCagrilari(dosyaYolu: string, metin: string): EmitCagri[] {
  const sf = ts.createSourceFile(dosyaYolu, metin, ts.ScriptTarget.Latest, true);
  const out: EmitCagri[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "emitNotification") {
      const a = n.arguments[1];
      out.push({
        dosya: dosyaYolu,
        satir: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        tur: a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null,
        txIcinde: txGeriCagrisiIcinde(n),
      });
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

function bolum0(): void {
  console.log("\n§0 AST — her OLAY türünün tek yayma noktası");
  const cagrilar: EmitCagri[] = [];
  for (const f of walkTs(SRC)) {
    const rel = relative(SRC, f).split(sep).join("/");
    if (rel === EMIT_HELPER) continue;
    cagrilar.push(...emitCagrilari(rel, readFileSync(f, "utf8")));
  }
  const olaylar = Object.values(NOTIFICATION_CATALOG).filter((e) => e.altTur === "OLAY").map((e) => e.kod);
  const coklu = olaylar.filter((k) => cagrilar.filter((c) => c.tur === k).length > 1);
  check("§0a katalogdaki her OLAY türünün en çok TEK yayma noktası var", coklu.length === 0,
    coklu.map((k) => `${k}: ${cagrilar.filter((c) => c.tur === k).map((c) => `${c.dosya}:${c.satir}`).join(", ")}`).join(" · "));
  const ps = cagrilar.filter((c) => c.tur === OLAY);
  check("§0b ⭐ patron siparişi: tek nokta, `cloud-inbox.service.ts`, `$transaction` geri çağrısının İÇİNDE",
    ps.length === 1 && ps[0]!.dosya === "services/cloud-inbox.service.ts" && ps[0]!.txIcinde, JSON.stringify(ps));
  const tanimsiz = cagrilar.filter((c) => c.tur !== null && !(c.tur in NOTIFICATION_CATALOG));
  check("§0c literal tür katalogda (tanınmayan tür yok)", tanimsiz.length === 0, JSON.stringify(tanimsiz));
  const degisken = cagrilar.filter((c) => c.tur === null && !DEGISKEN_TURLU_IZINLI.has(c.dosya));
  check("§0d türü değişkenle yayan yalnız koşul tarayıcısı", degisken.length === 0, JSON.stringify(degisken));
  // Sonda: tarayıcı tx dışı çağrıyı ve ikinci noktayı gerçekten görüyor mu (körlük zemini).
  const sonda = emitCagrilari("x.ts", `async function f(){ await emitNotification(db, "${OLAY}", s, p); await prisma.$transaction(async (tx) => { await emitNotification(tx, "${OLAY}", s, p); }); }`);
  check("§0e sonda: tx dışı çağrı txIcinde=false, tx içi true, iki nokta sayılır",
    sonda.length === 2 && sonda[0]!.txIcinde === false && sonda[1]!.txIcinde === true && sonda.every((c) => c.tur === OLAY));
}

// ── DB bölümleri ────────────────────────────────────────────────────────────
AuditService.log = async () => {};
AuditService.logEvent = async () => {};

const DAMGA = Date.now().toString(36).toUpperCase();
const ek = DAMGA.toLowerCase();
const BASLANGIC = new Date(Date.now() - 1000);
const yaratilan = { siparis: new Set<string>(), kart: new Set<string>(), mesaj: new Set<string>(), kullanici: [] as string[] };
const fikstur = { urunId: "", renkId: "", kartId: "" };
let onceTeknik: string | null = null;
const SONDA_FN = `tbps_${ek}_boz`;

function mesaj(tur: "SIPARIS" | "CARI", govde: unknown, ekAlan: Partial<InboxMessage> = {}): InboxMessage {
  const m: InboxMessage = { mesajId: randomUUID(), tur, govde, hesapId: "7d4b1f1e-2f44-4c2a-9a55-3f9d8f0a1b2c", hesapAdi: "Bulut Patron", olusturulma: new Date().toISOString(), ...ekAlan };
  yaratilan.mesaj.add(m.mesajId);
  return m;
}
async function isle(m: InboxMessage, aktor: string): Promise<InboxOutcome | null> {
  const o = await processInboxMessage(m, aktor);
  if (o?.durum === "ISLENDI" && o.varlikId) (m.tur === "SIPARIS" ? yaratilan.siparis : yaratilan.kart).add(o.varlikId);
  return o;
}
function siparisGovdesi(ekAlan: Record<string, unknown> = {}): Record<string, unknown> {
  return { cariKartId: fikstur.kartId, doviz: "TRY", kalemler: [{ urunId: fikstur.urunId, renkId: fikstur.renkId, miktar: "12.5", birimFiyat: "99.75" }], ...ekAlan };
}
const outboxSay = (): Promise<number> => prisma.notificationOutbox.count({ where: { kind: OLAY, createdAt: { gte: BASLANGIC } } });

async function bayrak(v: boolean): Promise<void> {
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}
async function kisi(ad: string, codes: string[]): Promise<string> {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (perms.length !== codes.length) throw new Error(`izin kataloğu eksik: ${codes.join(",")}`);
  const u = await prisma.user.create({
    data: { username: `tbps_${ad}_${ek}`.slice(0, 50), fullName: `TEST-BPS ${ad} ${ek}`, passwordHash: await bcrypt.hash(randomUUID(), 4) },
    select: { id: true },
  });
  yaratilan.kullanici.push(u.id);
  for (const p of perms) await prisma.userPermission.create({ data: { userId: u.id, permissionId: p.id } });
  return u.id;
}
/** Dağıtıcı günlük sayacı artırır (telemetri); koşum öncesi değeri saklanır, temizlikte geri yazılır. */
const statsOnce = new Map<string, number | null>();
async function statsKaydet(gun: string): Promise<void> {
  if (statsOnce.has(gun)) return;
  const r = await prisma.notificationDailyStats.findUnique({ where: { factoryDay_kind: { factoryDay: new Date(`${gun}T00:00:00Z`), kind: OLAY } }, select: { events: true } });
  statsOnce.set(gun, r?.events ?? null);
}
async function statsGeriYaz(): Promise<void> {
  for (const [gun, v] of statsOnce) {
    const factoryDay = new Date(`${gun}T00:00:00Z`);
    if (v === null) await prisma.notificationDailyStats.deleteMany({ where: { factoryDay, kind: OLAY } });
    else await prisma.notificationDailyStats.updateMany({ where: { factoryDay, kind: OLAY }, data: { events: v } });
  }
}
async function dagit(): Promise<void> {
  for (let i = 0; i < 100; i++) if ((await runNotificationDispatchOnce()).processed === 0) break;
}
async function sondaKaldir(): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${SONDA_FN}_t ON "orders"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${SONDA_FN}_o ON "notification_outbox"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${SONDA_FN}()`);
}

async function bolum1ile2(aktor: string): Promise<string> {
  console.log("\n§1 mesaj → sipariş + tek outbox satırı (aynı tx)");
  const m = mesaj("SIPARIS", siparisGovdesi());
  const o1 = await isle(m, aktor);
  const satirlar = o1?.varlikId ? await prisma.notificationOutbox.findMany({ where: { kind: OLAY, subjectId: o1.varlikId } }) : [];
  check("§1a ⭐ ISLENDI + TEK outbox satırı, konu = sipariş, aktör = teknik kullanıcı",
    o1?.durum === "ISLENDI" && satirlar.length === 1 && satirlar[0]!.subjectType === "order" && satirlar[0]!.actorUserId === aktor && satirlar[0]!.phase === "OLAY",
    `durum=${o1?.durum} outbox=${satirlar.length}`);
  const yuk = (satirlar[0]?.payload ?? {}) as Record<string, unknown>;
  check("§1d payload: siparisId · siparisNo = belge no · musteriAd dolu",
    yuk.siparisId === o1?.varlikId && yuk.siparisNo === o1?.belgeNo && typeof yuk.musteriAd === "string" && (yuk.musteriAd as string).endsWith(DAMGA), JSON.stringify(yuk));

  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${SONDA_FN}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'tbps sonda'; END $$`);
  // §1b: sipariş tx'i COMMIT anında düşer (emit çoktan koştu) → outbox satırı da yaşamamalı.
  const mb = mesaj("SIPARIS", siparisGovdesi());
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER ${SONDA_FN}_t AFTER INSERT ON "orders" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."clientToken" = '${mb.mesajId}'::uuid) EXECUTE FUNCTION ${SONDA_FN}()`);
  const onceB = await outboxSay();
  const ob = await isle(mb, aktor).catch(() => null);
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${SONDA_FN}_t ON "orders"`);
  const sipB = await prisma.order.count({ where: { clientToken: mb.mesajId } });
  check("§1b ⭐ sipariş tx'i commit'te düşer → sipariş yok, outbox satırı da yok", ob === null && sipB === 0 && (await outboxSay()) === onceB,
    `sonuc=${ob?.durum ?? "null"} siparis=${sipB}`);
  // §1c: outbox INSERT'ü düşer → sipariş de doğmamalı (emit ayrı/sonraki tx'te olsaydı sipariş kalırdı).
  const mc = mesaj("SIPARIS", siparisGovdesi());
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${SONDA_FN}_o BEFORE INSERT ON "notification_outbox" FOR EACH ROW WHEN (NEW."kind" = '${OLAY}') EXECUTE FUNCTION ${SONDA_FN}()`);
  const oc = await isle(mc, aktor).catch(() => null);
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${SONDA_FN}_o ON "notification_outbox"`);
  const sipC = await prisma.order.count({ where: { clientToken: mc.mesajId } });
  const makC = await prisma.cloudInboxReceipt.count({ where: { messageId: mc.mesajId } });
  check("§1c ⭐ outbox yazımı düşer → sipariş ve makbuz doğmaz (sonuç belirsiz, bulut yeniden dener)", oc === null && sipC === 0 && makC === 0,
    `sonuc=${oc?.durum ?? "null"} siparis=${sipC} makbuz=${makC}`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${SONDA_FN}()`);

  console.log("\n§2 aynı mesaj tekrar");
  const once2 = await outboxSay();
  const o2 = await isle(m, aktor);
  const [e1, e2] = await Promise.all([isle(m, aktor), isle(m, aktor)]);
  check("§2 ⭐ aynı mesaj (sıralı + eşzamanlı) → aynı sonuç, outbox sayısı değişmez",
    JSON.stringify(o2) === JSON.stringify(o1) && JSON.stringify(e1) === JSON.stringify(o1) && JSON.stringify(e2) === JSON.stringify(o1) && (await outboxSay()) === once2,
    `outbox ${once2} → ${await outboxSay()}`);
  return o1?.varlikId ?? "";
}

async function bolum3(aktor: string): Promise<void> {
  console.log("\n§3 600 sn kovası");
  const yazar = await kisi("yazar", ["order:read", "order:write"]);
  const okur = await kisi("okur", ["order:read"]);
  await statsKaydet(factoryYmd(new Date()));
  await dagit(); // önceki bölümlerin satırları bu kovaya karışmasın
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const o = await isle(mesaj("SIPARIS", siparisGovdesi()), aktor);
    if (o?.varlikId) ids.push(o.varlikId);
  }
  const sabit = new Date("2026-05-01T00:00:00Z");
  await statsKaydet(factoryYmd(sabit));
  const satirlar = await prisma.notificationOutbox.findMany({ where: { kind: OLAY, subjectId: { in: ids } }, orderBy: { createdAt: "asc" } });
  for (const [i, r] of satirlar.entries()) await prisma.notificationOutbox.update({ where: { id: r.id }, data: { occurredAt: new Date(sabit.getTime() + i * 60_000) } });
  await dagit();
  const gk = notificationGroupKey({ kind: OLAY, subjectId: null, subjectKey: "", conditionId: null, dedupeKey: notificationDedupeKey(OLAY, "", {}), occurredAt: sabit });
  const kutuYazar = await prisma.notificationInbox.findMany({ where: { userId: yazar, groupKey: gk } });
  check("§3a ⭐ 3 sipariş → order:write sahibinde TEK satır, count=3", satirlar.length === 3 && kutuYazar.length === 1 && kutuYazar[0]!.count === 3,
    `outbox=${satirlar.length} rows=${kutuYazar.length} count=${kutuYazar[0]?.count}`);
  const digerleri = await prisma.notificationInbox.count({ where: { userId: { in: [okur, aktor] }, groupKey: gk } });
  check("§3b order:write'sız okuyucu ve aktör (teknik kullanıcı) almaz", digerleri === 0, `rows=${digerleri}`);
}

async function bolum4(aktor: string, ilkSiparis: string): Promise<void> {
  console.log("\n§4 ret yolları");
  const once = await outboxSay();
  const u = await isle(mesaj("SIPARIS", { ...siparisGovdesi(), kalemler: [{ urunId: randomUUID(), miktar: "1" }] }), aktor);
  const g = await isle(mesaj("SIPARIS", { ...siparisGovdesi(), gizliAlan: 1 }), aktor);
  const ilkMakbuz = await prisma.cloudInboxReceipt.findFirst({ where: { entityId: ilkSiparis }, select: { messageId: true } });
  const c = ilkMakbuz ? await isle(mesaj("SIPARIS", siparisGovdesi({ doviz: "USD" }), { mesajId: ilkMakbuz.messageId }), aktor) : null;
  check("§4 ⭐ URUN_BULUNAMADI · GOVDE_GECERSIZ · MESAJ_CAKISMASI → outbox yok",
    u?.kod === "URUN_BULUNAMADI" && g?.kod === "GOVDE_GECERSIZ" && c?.kod === "MESAJ_CAKISMASI" && (await outboxSay()) === once,
    `${u?.kod}/${g?.kod}/${c?.kod} outbox ${once} → ${await outboxSay()}`);
}

async function bolum5ile6(aktor: string): Promise<void> {
  console.log("\n§5 bayrak kapalı");
  await bayrak(false);
  const once = await outboxSay();
  const o = await isle(mesaj("SIPARIS", siparisGovdesi()), aktor);
  check("§5 ⭐ bayrak kapalı → sipariş doğar, outbox yok", o?.durum === "ISLENDI" && (await outboxSay()) === once, `durum=${o?.durum}`);
  await bayrak(true);

  console.log("\n§6 payload");
  const izinli = new Set<string>(NOTIFICATION_CATALOG[OLAY].payloadAlanlari);
  const satirlar = await prisma.notificationOutbox.findMany({ where: { kind: OLAY, createdAt: { gte: BASLANGIC } }, select: { payload: true } });
  const anahtarlar = new Set(satirlar.flatMap((r) => Object.keys((r.payload ?? {}) as Record<string, unknown>)));
  const disari = [...anahtarlar].filter((k) => !izinli.has(k));
  const yasak = [...anahtarlar].filter((k) => /tutar|fiyat|miktar|amount|price|total|kur/i.test(k));
  const degerler = JSON.stringify(satirlar.map((r) => r.payload));
  check("§6 ⭐ payload yalnız katalog alanları; tutar/fiyat/miktar anahtarı ya da değeri yok",
    satirlar.length > 0 && disari.length === 0 && yasak.length === 0 && !degerler.includes("99.75") && !degerler.includes("12.5"),
    `anahtarlar=${[...anahtarlar].join(",")}`);
}

async function temizlik(): Promise<void> {
  await sondaKaldir().catch(() => {});
  await statsGeriYaz();
  const siparisler = [...yaratilan.siparis];
  const kartlar = [...yaratilan.kart];
  await prisma.notificationInbox.deleteMany({ where: { kind: OLAY, createdAt: { gte: BASLANGIC } } });
  await prisma.notificationOutbox.deleteMany({ where: { kind: OLAY, createdAt: { gte: BASLANGIC } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: siparisler } } });
  await prisma.order.deleteMany({ where: { id: { in: siparisler } } });
  await prisma.cloudInboxReceipt.deleteMany({ where: { messageId: { in: [...yaratilan.mesaj] } } });
  await prisma.customerItemAlias.deleteMany({ where: { customerId: { in: kartlar } } });
  await prisma.customerColorAlias.deleteMany({ where: { customerId: { in: kartlar } } });
  await prisma.cariAccount.deleteMany({ where: { customerId: { in: kartlar } } });
  await prisma.customer.deleteMany({ where: { id: { in: kartlar } } });
  if (fikstur.urunId) await prisma.item.deleteMany({ where: { id: fikstur.urunId } });
  if (fikstur.renkId) await prisma.color.deleteMany({ where: { id: fikstur.renkId } });
  const kullanicilar = [...yaratilan.kullanici];
  const simdiki = await readPatronCloudUserId();
  if (simdiki && simdiki !== onceTeknik) {
    kullanicilar.push(simdiki);
    await prisma.session.deleteMany({ where: { userId: simdiki } });
    await prisma.systemSetting.deleteMany({ where: { key: PATRON_CLOUD_USER_SETTING_KEY } });
  }
  await prisma.notificationInbox.deleteMany({ where: { userId: { in: kullanicilar } } });
  await prisma.userPermission.deleteMany({ where: { userId: { in: kullanicilar } } });
  await prisma.user.deleteMany({ where: { id: { in: kullanicilar } } });
  __resetPatronCloudStateForTests();
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim — patron siparişi OLAY'ı ===");
  bolum0();
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  onceTeknik = await readPatronCloudUserId();
  try {
    await bayrak(true);
    const admin = await ensureTestAdmin();
    const aktor = (await activatePatronCloud(admin.id)).userId;
    fikstur.urunId = (await prisma.item.create({ data: { code: `BPS-${DAMGA}`, name: `BPS URUN ${DAMGA}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
    fikstur.renkId = (await prisma.color.create({ data: { code: `BPS-${DAMGA}`, name: `BPS RENK ${DAMGA}` }, select: { id: true } })).id;
    const kart = await isle(mesaj("CARI", { ad: `Bps Cari ${DAMGA}`, roller: { musteri: true, tedarikci: false } }), aktor);
    if (kart?.durum !== "ISLENDI" || !kart.varlikId) throw new Error(`fikstür cari doğmadı: ${JSON.stringify(kart)}`);
    fikstur.kartId = kart.varlikId;
    const ilkSiparis = await bolum1ile2(aktor);
    await bolum3(aktor);
    await bolum4(aktor, ilkSiparis);
    await bolum5ile6(aktor);
  } finally {
    await temizlik();
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
