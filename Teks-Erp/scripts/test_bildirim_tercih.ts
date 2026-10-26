// =============================================================================
// BEKÇİ — BİLDİRİM TERCİH KATMANI (N4-MOTOR: §5.1 katman çözümü · teslim kararı · sessiz saat · kapsam)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_tercih
// =============================================================================
//   §1 saf `resolvePreference`: katman yok = katalog (varsayılan = BUGÜNKÜ davranış) · fabrika KAPALI + kullanıcı açık → açık ·
//      HER_ZAMAN kilidi fabrika KAPALI'yı ve kullanıcı kapatmasını yok sayar · profil birleşimi (biri açık ⇒ açık;
//      biri kilitli ⇒ kilitli) · NOBETTE kilidi yalnız nöbettekine · UYGULAMA ∧ OZET kapalı → MASAUSTU kapalı · GIZLI
//   §2 sessiz saat FABRİKA diliminde (gece yarısını aşan aralık; UTC okuması ayrışır)
//   §3 teslim kararı (dağıtıcının kendisi, DB'siz konu): ⭐ donmuş alarm listesi GİRDİDİR (değişmez, ek kaynak
//      eklenmez) · nöbetteki ALARM sessiz saati deler, nöbet dışı susar (inbox satırı ikisinde de var) ·
//      nöbet dışı alarmı kapatan almaz, nöbetteki kapatsa da alır · UYGULAMA kapalı + OZET açık → `ozet=true`
//   §4 uçtan uca (gerçek dağıtıcı): ⭐ tercih yokken F1 dağıtımı aynen (reason IZIN, kanallar katalogdan, ozet yok) ·
//      kullanıcı açınca varsayılan dışı kişi alır · takipçi (TAKIPCI) alır, BIRAKTI almaz · `yalnizTakip` daraltır ·
//      fabrika eşiği koşul kaynağına yansır
//
// NEGATİF SONDALAR (2026-10-25, md5 ile birebir geri alındı): ① teslim kararında ALARM ek-kaynak kapısı kaldırıldı
// (donmuş listeye LISTE eklendi) → §3a ❌ (23/1) · ② sessiz saat UTC duvar saatinden okundu → §2a §2b §3b ❌ (21/3) ·
// ③ katalog `varsayilan` kapsaması hep doğru → §1a §4a §4d ❌ (21/3; tercih yokken davranış değişti).
// Global ayar yazar (`bildirim.gelenKutusuEnabled`); bulduğu değere `finally`de döner. Kendi kullanıcı/sipariş/
// tercih satırlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { emitNotification } from "../src/services/helpers/notification-emit.helper";
import { runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import { resolvePreference, EMPTY_LAYERS, prefKey, type PreferenceLayers, type PreferenceRowView } from "../src/services/helpers/notification-preference.helper";
import { decideDeliveries, inQuietHours, type DeliveryContext, type DeliveryReason } from "../src/services/helpers/notification-delivery.helper";
import { effectiveNotificationParams, refreshNotificationParams } from "../src/services/helpers/notification-params.helper";
import { getNotificationEntry, type NotificationKind } from "../src/constants/notification-catalog";
import type { NotificationVisibilityEnv } from "../src/services/helpers/notification-visibility.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ek = Date.now().toString(36);
const users: string[] = [];
const orders: string[] = [];
const customers: string[] = [];
const ALARM: NotificationKind = "dokuma.tezgah-alarmi"; // ALARM · kilit NOBETTE
const PATRON: NotificationKind = "siparis.patron-siparisi"; // OLAY · varsayılan order:write · kanallar UYGULAMA/OZET/MASAUSTU
const TERMIN: NotificationKind = "siparis.termin-gecti"; // KOSUL · varsayılan order:write · kapsam yalnizTakip
const YEDEK: NotificationKind = "sistem.yedek-basarisiz"; // kilit HER_ZAMAN · varsayılan HERKES

const ENV_ACIK: NotificationVisibilityEnv = { modules: { tezgahEnabled: true }, gates: { tezgahAlarm: true } };

function katman(p: Partial<{ factory: Array<[string, string, string[]?]>; profiles: Record<string, Array<[string, Record<string, string>]>>; prefs: Record<string, Record<string, PreferenceRowView>> }>): PreferenceLayers {
  return {
    factory: new Map((p.factory ?? []).map(([k, s, x]) => [k, { state: s as never, extraRecipientIds: x ?? [] }])),
    profiles: new Map(Object.entries(p.profiles ?? {}).map(([u, list]) => [u, list.map(([name, cells]) => ({ name, cells: new Map(Object.entries(cells)) as never }))])),
    prefs: new Map(Object.entries(p.prefs ?? {}).map(([u, m]) => [u, new Map(Object.entries(m))])),
  };
}
const ac = (enabled: boolean, scope: PreferenceRowView["scope"] = null): PreferenceRowView => ({ enabled, scope });

function bolum1(): void {
  const yazar = { userId: "u-yazar", permissions: ["order:read", "order:write"] };
  const okur = { userId: "u-okur", permissions: ["order:read"] };
  const r0 = resolvePreference(yazar, PATRON, "UYGULAMA", { env: ENV_ACIK, layers: EMPTY_LAYERS });
  const r1 = resolvePreference(okur, PATRON, "UYGULAMA", { env: ENV_ACIK, layers: EMPTY_LAYERS });
  check("§1a ⭐ katman yok: varsayılan izni olan ACIK/katalog, olmayan KAPALI (bugünkü davranış)",
    r0.durum === "ACIK" && r0.kaynak === "katalog" && r1.durum === "KAPALI", `${r0.durum}/${r1.durum}`);
  const m0 = resolvePreference(yazar, PATRON, "MASAUSTU", { env: ENV_ACIK, layers: EMPTY_LAYERS });
  check("§1b katman yok: kanal katalog `varsayilanKanallar`ından (MASAUSTU kapalı — tercih yokken masaüstü yok; OZET kapalı)",
    m0.durum === "KAPALI" && resolvePreference(yazar, PATRON, "OZET", { env: ENV_ACIK, layers: EMPTY_LAYERS }).durum === "KAPALI", m0.durum);
  const fk = katman({ factory: [[PATRON, "KAPALI"]], prefs: { "u-yazar": { [prefKey(PATRON, "UYGULAMA")]: ac(true) } } });
  const r2 = resolvePreference(yazar, PATRON, "UYGULAMA", { env: ENV_ACIK, layers: fk });
  check("§1c fabrika KAPALI + kullanıcı açık → ACIK (kilit yok), kaynak kullanici", r2.durum === "ACIK" && r2.kaynak === "kullanici", JSON.stringify(r2));
  check("§1d fabrika KAPALI, kullanıcı sapması yok → KAPALI/fabrika",
    resolvePreference(okur, PATRON, "UYGULAMA", { env: ENV_ACIK, layers: katman({ factory: [[PATRON, "KAPALI"]] }) }).kaynak === "fabrika");
  const yedekci = { userId: "u-yedek", permissions: ["system:backups"] };
  const r3 = resolvePreference(yedekci, YEDEK, "UYGULAMA", { env: ENV_ACIK, layers: katman({ factory: [[YEDEK, "KAPALI"]], prefs: { "u-yedek": { [prefKey(YEDEK, "UYGULAMA")]: ac(false) } } }) });
  check("§1e ⭐ HER_ZAMAN kilidi: fabrika KAPALI ve kullanıcı kapatması yok sayılır", r3.durum === "ACIK" && r3.kilit, JSON.stringify(r3));
  const pb = katman({ profiles: { "u-okur": [["Planlama", { [PATRON]: "KAPALI" }], ["Satış", { [PATRON]: "ACIK" }]] } });
  const r4 = resolvePreference(okur, PATRON, "UYGULAMA", { env: ENV_ACIK, layers: pb });
  check("§1f profil birleşimi: biri KAPALI biri ACIK ⇒ ACIK (kaynak açan profil)", r4.durum === "ACIK" && r4.kaynak === "profil:Satış", JSON.stringify(r4));
  const pk = katman({
    profiles: { "u-okur": [["A", { [PATRON]: "KILITLI" }], ["B", { [PATRON]: "KAPALI" }]] },
    prefs: { "u-okur": { [prefKey(PATRON, "UYGULAMA")]: ac(false) } },
  });
  const r5 = resolvePreference(okur, PATRON, "UYGULAMA", { env: ENV_ACIK, layers: pk });
  check("§1g profil birleşimi: biri KILITLI ⇒ kilitli ACIK, kullanıcı kapatması işlemez", r5.durum === "ACIK" && r5.kilit && r5.kaynak === "profil:A", JSON.stringify(r5));
  check("§1h tüm profiller KAPALI ⇒ KAPALI",
    resolvePreference(yazar, PATRON, "UYGULAMA", { env: ENV_ACIK, layers: katman({ profiles: { "u-yazar": [["A", { [PATRON]: "KAPALI" }]] } }) }).durum === "KAPALI");
  const alarmci = { userId: "u-alarm", permissions: ["loom:alarm-view"] };
  const kapat = katman({ prefs: { "u-alarm": { [prefKey(ALARM, "UYGULAMA")]: ac(false) } } });
  const n1 = resolvePreference(alarmci, ALARM, "UYGULAMA", { env: ENV_ACIK, layers: kapat, nobette: true });
  const n2 = resolvePreference(alarmci, ALARM, "UYGULAMA", { env: ENV_ACIK, layers: kapat, nobette: false });
  check("§1i NOBETTE kilidi yalnız nöbettekine: nöbette ACIK+kilit, nöbet dışı kullanıcı kapatması geçer",
    n1.durum === "ACIK" && n1.kilit && n2.durum === "KAPALI" && !n2.kilit, `${n1.durum}/${n2.durum}`);
  const kapaliHepsi = katman({ prefs: { "u-yazar": { [prefKey(PATRON, "UYGULAMA")]: ac(false) } } });
  const kapaliHepsi2 = katman({ prefs: { "u-yazar": { [prefKey(PATRON, "UYGULAMA")]: ac(false), [prefKey(PATRON, "MASAUSTU")]: ac(true) } } });
  const ozetli = katman({ prefs: { "u-yazar": { [prefKey(PATRON, "UYGULAMA")]: ac(false), [prefKey(PATRON, "OZET")]: ac(true), [prefKey(PATRON, "MASAUSTU")]: ac(true) } } });
  check("§1j UYGULAMA ∧ OZET kapalı → açılmış MASAUSTU da KAPALI; OZET açıkken açılmış MASAUSTU geçer",
    resolvePreference(yazar, PATRON, "MASAUSTU", { env: ENV_ACIK, layers: kapaliHepsi2 }).durum === "KAPALI" &&
    resolvePreference(yazar, PATRON, "MASAUSTU", { env: ENV_ACIK, layers: kapaliHepsi }).durum === "KAPALI" && resolvePreference(yazar, PATRON, "MASAUSTU", { env: ENV_ACIK, layers: ozetli }).durum === "ACIK");
  check("§1k görme süzgeci ilk adım: izinsiz → GIZLI (tercih açık olsa da)",
    resolvePreference({ userId: "x", permissions: [] }, PATRON, "UYGULAMA", { env: ENV_ACIK, layers: katman({ prefs: { x: { [prefKey(PATRON, "UYGULAMA")]: ac(true) } } }) }).durum === "GIZLI");
}

function bolum2(): void {
  // 2026-03-10 20:30Z = İstanbul 23:30 (UTC+3); 05:30Z = 08:30.
  const gece = new Date("2026-03-10T20:30:00Z");
  const sabah = new Date("2026-03-11T05:30:00Z");
  check("§2a ⭐ sessiz saat fabrika diliminde: 22:00–07:00 aralığı İstanbul 23:30'u kapsar (UTC 20:30 kapsamazdı)",
    inQuietHours(gece, "22:00", "07:00"));
  check("§2b gece yarısını aşan aralık: 08:30 22:00–07:00 dışında, 08:00–09:00 içinde",
    !inQuietHours(sabah, "22:00", "07:00") && inQuietHours(sabah, "08:00", "09:00"));
  check("§2c eşit uçlar = boş aralık · null = sessiz saat yok", !inQuietHours(gece, "23:00", "23:00") && !inQuietHours(gece, null, null));
}

async function bolum3(): Promise<void> {
  const nobetci = randomUUID();
  const izinli = randomUUID();
  const disari = randomUUID();
  const grants = new Map<string, string[]>([[nobetci, ["loom:alarm-view"]], [izinli, ["loom:alarm-view"]], [disari, ["loom:alarm-view"]]]);
  const sessiz = { quietStart: "22:00", quietEnd: "07:00", quietChannels: ["MASAUSTU", "TABLET_SES"] };
  const ctx = (layers: PreferenceLayers): DeliveryContext => ({
    layers, now: new Date("2026-03-10T20:30:00Z"), myStations: new Map(),
    settings: new Map([[nobetci, sessiz], [izinli, sessiz]]),
  });
  const donmus: Array<{ userId: string; reason: DeliveryReason }> = [{ userId: nobetci, reason: "NOBET" }, { userId: izinli, reason: "ALARM_ALICISI" }];
  const kopya = JSON.stringify(donmus);
  const row = { subjectType: "loom_alarm", subjectId: null, payload: {}, actorUserId: null };
  // Fabrika LISTE'si alarm türüne yazılmış olsa da (yanlış yapılandırma) alarm alıcısı donmuş listedir.
  const d = await decideDeliveries(
    { tx: prisma, row, kind: ALARM, entry: getNotificationEntry(ALARM), env: ENV_ACIK, grants, ctx: ctx(katman({ factory: [[ALARM, "MIRAS", [disari]]] })) },
    donmus,
  );
  const by = new Map(d.map((x) => [x.userId, x]));
  check("§3a ⭐ donmuş liste GİRDİDİR: teslim kümesi = liste (LISTE/takip eklenmez), girdi değişmez",
    d.length === 2 && !by.has(disari) && JSON.stringify(donmus) === kopya, d.map((x) => x.reason).join(","));
  check("§3b ⭐ sessiz saatte nöbetteki ALARM deler (OS + tablet açık), nöbet dışı susar — ikisi de kutuya düşer",
    by.get(nobetci)?.km === true && by.get(nobetci)?.kt === true && by.get(izinli)?.km === false && by.get(izinli)?.kt === false,
    JSON.stringify(d.map((x) => [x.reason, x.km, x.kt])));
  const kapat = katman({ prefs: { [nobetci]: { [prefKey(ALARM, "UYGULAMA")]: ac(false) }, [izinli]: { [prefKey(ALARM, "UYGULAMA")]: ac(false) } } });
  const d2 = await decideDeliveries({ tx: prisma, row, kind: ALARM, entry: getNotificationEntry(ALARM), env: ENV_ACIK, grants, ctx: ctx(kapat) }, donmus);
  check("§3c alarmı kapatan: nöbet dışı ALMAZ, nöbetteki kilitli olduğundan YİNE alır",
    d2.length === 1 && d2[0].userId === nobetci, d2.map((x) => x.reason).join(","));
  const yazar = randomUUID();
  const g2 = new Map<string, string[]>([[yazar, ["order:read", "order:write"]]]);
  const oz = katman({ prefs: { [yazar]: { [prefKey(PATRON, "UYGULAMA")]: ac(false), [prefKey(PATRON, "OZET")]: ac(true) } } });
  const d3 = await decideDeliveries(
    { tx: prisma, row: { subjectType: "order", subjectId: null, payload: {}, actorUserId: null }, kind: PATRON, entry: getNotificationEntry(PATRON), env: ENV_ACIK, grants: g2,
      ctx: { layers: oz, now: new Date(), myStations: new Map(), settings: new Map() } },
    [{ userId: yazar, reason: "IZIN" }],
  );
  check("§3d UYGULAMA kapalı + OZET açık → satır `ozet=true` (rozete girmez)", d3.length === 1 && d3[0].ozet === true, JSON.stringify(d3));
}

async function kisi(ad: string, codes: string[]): Promise<string> {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (perms.length !== codes.length) throw new Error(`izin kataloğu eksik: ${codes.join(",")}`);
  const u = await prisma.user.create({
    data: { username: `tbt_${ad}_${ek}`.slice(0, 50), fullName: `TEST-TERCIH ${ad} ${ek}`, passwordHash: await bcrypt.hash(randomUUID(), 4), isActive: true },
    select: { id: true },
  });
  users.push(u.id);
  for (const p of perms) await prisma.userPermission.create({ data: { userId: u.id, permissionId: p.id } });
  return u.id;
}

async function dagit(): Promise<void> {
  for (let i = 0; i < 100; i++) if ((await runNotificationDispatchOnce()).processed === 0) break;
}

async function emit(kind: NotificationKind, subject: { type: string; id: string | null; key: string }, payload: Record<string, unknown>): Promise<void> {
  await prisma.$transaction((tx) => emitNotification(tx, kind, subject, payload, { actorUserId: null }));
}

async function bolum4(): Promise<void> {
  const yazar = await kisi("yazar", ["order:read", "order:write"]);
  const okur = await kisi("okur", ["order:read"]);
  const acan = await kisi("acan", ["order:read"]);
  const masaustucu = await kisi("masa", ["order:read", "order:write"]);
  const takipci = await kisi("takip", ["order:read"]);
  const birakan = await kisi("birak", ["order:read"]);
  const daraltan = await kisi("dar", ["order:read", "order:write"]);
  await prisma.notificationPreference.create({ data: { userId: acan, kind: PATRON, channel: "UYGULAMA", enabled: true } });
  await prisma.notificationPreference.create({ data: { userId: masaustucu, kind: PATRON, channel: "MASAUSTU", enabled: true } });
  const anahtar = `tbt-${ek}`;
  await emit(PATRON, { type: "order", id: null, key: anahtar }, { siparisNo: `S-${ek}`, musteriAd: "Test" });
  await dagit();
  const satir = (u: string, kind: string) => prisma.notificationInbox.findFirst({ where: { userId: u, kind, createdAt: { gte: new Date(Date.now() - 60_000) } } });
  const y = await satir(yazar, PATRON);
  check("§4a ⭐ tercih yokken F1 dağıtımı aynen: varsayılan izinli alır (IZIN, ozet yok), izinsiz okur almaz",
    !!y && y.reason === "IZIN" && y.kanalTablet === false && y.ozet === false && !(await satir(okur, PATRON)),
    y ? `${y.reason}/${y.ozet}` : "satır yok");
  const m = await satir(masaustucu, PATRON);
  check("§4a2 ⭐ tercih yokken masaüstü gönderimi YOK (katalog MASAUSTU varsayılanı kapalı); MASAUSTU'yu açan alır",
    y?.kanalMasaustu === false && m?.kanalMasaustu === true, `${y?.kanalMasaustu}/${m?.kanalMasaustu}`);
  check("§4b kullanıcı UYGULAMA'yı açınca varsayılan dışı kişi alır", !!(await satir(acan, PATRON)));

  const customer = await prisma.customer.create({ data: { code: `TBT-${ek}`.slice(0, 32), name: `TEST-TERCIH ${ek}` }, select: { id: true } });
  customers.push(customer.id);
  const o = await prisma.order.create({ data: { orderNumber: `TBT-${ek}`.slice(0, 64), customerId: customer.id }, select: { id: true } });
  orders.push(o.id);
  await prisma.recordFollow.createMany({
    data: [
      { userId: takipci, orderId: o.id, state: "TAKIP", reason: "ELLE" },
      { userId: birakan, orderId: o.id, state: "BIRAKTI", reason: "OLUSTURAN" },
    ],
  });
  await prisma.notificationPreference.create({
    data: { userId: daraltan, kind: TERMIN, channel: "UYGULAMA", enabled: true, scope: { schemaVersion: 1, yalnizTakip: true } },
  });
  await emit(TERMIN, { type: "siparis", id: o.id, key: o.id }, { siparisId: o.id, siparisNo: `TBT-${ek}`, musteriAd: "T", termin: "01.01.2026" });
  await dagit();
  const t = await satir(takipci, TERMIN);
  check("§4c takipçi (izni var, varsayılan dışı) TAKIPCI sebebiyle alır", t?.reason === "TAKIPCI", t?.reason ?? "satır yok");
  check("§4d ⭐ BIRAKTI almaz (oluşturan otomatiği bırakınca)", !(await satir(birakan, TERMIN)));
  check("§4e `yalnizTakip` kapsamı daraltır: takip etmeyen varsayılan alıcı almaz, aynı olayı yazar alır",
    !(await satir(daraltan, TERMIN)) && !!(await satir(yazar, TERMIN)));

  const ilk = effectiveNotificationParams("fason.donus-gecikti").gun;
  await prisma.notificationFactoryDefault.upsert({
    where: { kind: "fason.donus-gecikti" },
    create: { kind: "fason.donus-gecikti", state: "MIRAS", params: { schemaVersion: 1, degerler: { gun: 21 } } },
    update: { params: { schemaVersion: 1, degerler: { gun: 21 } } },
  });
  await refreshNotificationParams(prisma);
  const sonra = effectiveNotificationParams("fason.donus-gecikti").gun;
  await prisma.notificationFactoryDefault.deleteMany({ where: { kind: "fason.donus-gecikti" } });
  await refreshNotificationParams(prisma);
  check("§4f fabrika eşiği koşul kaynağının okuyucusuna yansır, satır gidince katalog varsayılanı döner",
    sonra === 21 && effectiveNotificationParams("fason.donus-gecikti").gun === ilk, `${ilk}→${sonra}`);
}

async function temizle(): Promise<void> {
  if (users.length) {
    await prisma.notificationInbox.deleteMany({ where: { userId: { in: users } } });
    await prisma.recordFollow.deleteMany({ where: { userId: { in: users } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: users } } });
    await prisma.userPermission.deleteMany({ where: { userId: { in: users } } });
  }
  if (orders.length) await prisma.order.deleteMany({ where: { id: { in: orders } } });
  if (customers.length) await prisma.customer.deleteMany({ where: { id: { in: customers } } });
  if (users.length) {
    await prisma.user.deleteMany({ where: { id: { in: users } } }).catch(async () => {
      await prisma.user.updateMany({ where: { id: { in: users } }, data: { isActive: false } });
    });
  }
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim tercih katmanı — çözüm · teslim · sessiz saat · kapsam ===\n");
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    bolum1();
    bolum2();
    await bolum3();
    await bolum4();
  } finally {
    await temizle();
    if (ilk) await prisma.systemSetting.update({ where: { key }, data: { value: ilk.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error("❌ beklenmeyen hata:", err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
