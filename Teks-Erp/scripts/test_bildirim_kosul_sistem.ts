// =============================================================================
// BEKÇİ — SİSTEM KOŞUL KAYNAKLARI (N1-KOSUL-SIS: yedek · eşitleme · lisans · güncelleme)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_kosul_sistem
// =============================================================================
// Kaynak okuyucuları `sistemKaynakBagimliliklariniDegistir` ile sahteye bağlanır; tur gerçek tarayıcıdan
// (`runConditionSourceOnce`) ve gerçek dağıtıcıdan geçer. Her tür için:
//   §a bozulur → tek ACILDI + tek gelen kutusu satırı · §b sürer (3 tur) → yeni satır yok
//   §e kaynak fırlatır → açık koşul AÇIK, KAPANDI yok · §c düzelir → KAPANDI, kutu `resolvedAt` + "Çözüldü" metni
//   §d tekrar bozulur → YENİ koşul (id farklı) + YENİ kutu satırı
// Ek: §f eşitleme uygun değilken (bulut kapalı) koşul açılmaz, açıksa kapanır · §g ölçülemeyen kaynak
// (açılışta ilk ölçüm yok / offsite henüz koşmadı / lisans durumu hazır değil) açık koşulu KORUR ·
// §h ardışık iki hatalı eşitleme turu açar, tek hata açmaz · §i lisans bitişi ≤ gün → `bitis-yakin` ·
// §M gerçek okuyucularla her `evaluate` süresi (60 sn periyodun maliyeti).
//
// NEGATİF SONDALAR (2026-10-25, md5 ile birebir geri alındı):
//  ① tarayıcıda `evaluate` hatası "boş küme"ye çevrildi (`truths = []`) → §e ×4 ❌ (+ zincirleme §c/§d)
//  ② bastırma kaldırıldı: yedek konu anahtarına tur damgası eklendi (`gece-<now>`) → §b ❌ (çift bildirim)
//  ③ `acikKalsin` boş döndü (ölçülemeyen = düzeldi) → §g ×3 ❌
//  ④ 8040 satırı `period-guard.helper.ts` envanterinden silindi → `test_advisory_lock_namespaces` ❌
// Global ayar yazar (`bildirim.gelenKutusuEnabled`); bulduğu değere `finally`de döner.
// =============================================================================
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import { runConditionSourceOnce } from "../src/jobs/notification-condition.job";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { renderNotification } from "../src/services/helpers/notification-render.helper";
import { getNotificationEntry, type NotificationKind } from "../src/constants/notification-catalog";
import {
  SYSTEM_SOURCE_EVALUATORS,
  SYSTEM_CONDITION_KINDS,
  resetSyncTrace,
  registerSystemConditionSources,
  overrideSystemSourceDeps,
  type SystemSourceDeps,
} from "../src/services/notification-sources/sistem";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { kosulTabaniHazir } from "./lib/bildirim-kosul-tabani";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ek = Date.now().toString(36);
const BASLANGIC = new Date(Date.now() - 1000);
const TURLER = SYSTEM_CONDITION_KINDS as readonly string[];
const users: string[] = [];
const DAK = 60_000;
const GUN = 24 * 60 * DAK;

// ── Sahte dünya ──────────────────────────────────────────────────────────────────────────────────
const d = {
  now: Date.now(),
  yedek: { verdict: "ok", reason: "Son gece yedeği 3 saat önce." },
  offsite: { configured: true, ok: true, missing: [] as string[] } as { configured: boolean; ok: boolean; missing: string[] } | null,
  bulut: { eligible: true, blockReason: null as string | null, lastRoundAt: null as number | null, lastOutcome: null as { status: string } | null },
  lisans: { durumHazir: true, state: { uygulananKademe: "NORMAL", nedenler: [] as { kod: string }[], odenmisTarih: null as { tarihMs: number | null } | null } },
  guncelleme: { guncelleyici: { durum: "CALISIYOR" }, bekleyen: null as { surum: string; karar: string } | null, onay: null as { surum: string } | null },
  firlat: new Set<string>(),
};
function sahte(kaynak: string, fn: () => unknown): never | unknown {
  if (d.firlat.has(kaynak)) throw new Error(`sahte okuyucu hatası: ${kaynak}`);
  return fn();
}
const SAHTE: Partial<SystemSourceDeps> = {
  now: () => d.now,
  backupHealth: () => sahte("yedek", () => d.yedek) as { verdict: string; reason: string },
  offsiteSweep: () => sahte("yedek", () => d.offsite) as ReturnType<SystemSourceDeps["offsiteSweep"]>,
  cloudSyncStatus: () => sahte("bulut", () => d.bulut) as ReturnType<SystemSourceDeps["cloudSyncStatus"]>,
  licenseSnapshot: () => sahte("lisans", () => d.lisans) as ReturnType<SystemSourceDeps["licenseSnapshot"]>,
  updateStatus: async () => sahte("guncelleme", () => d.guncelleme) as Awaited<ReturnType<SystemSourceDeps["updateStatus"]>>,
};

async function kisi(ad: string, codes: string[]): Promise<string> {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (perms.length !== codes.length) throw new Error(`izin kataloğu eksik: ${codes.join(",")}`);
  const u = await prisma.user.create({
    data: { username: `tbks_${ad}_${ek}`.slice(0, 50), fullName: `TEST-BILDIRIM-KOSUL ${ad} ${ek}`, passwordHash: await bcrypt.hash(randomUUID(), 4), isActive: true },
    select: { id: true },
  });
  users.push(u.id);
  for (const p of perms) await prisma.userPermission.create({ data: { userId: u.id, permissionId: p.id } });
  return u.id;
}

async function dagit(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await runNotificationDispatchOnce();
    if (r.processed === 0) break;
  }
}

async function tur(kind: NotificationKind): Promise<Awaited<ReturnType<typeof runConditionSourceOnce>>> {
  const r = await runConditionSourceOnce(kind);
  await dagit();
  return r;
}

const acikKosul = (kind: string, key: string) => prisma.notificationCondition.findFirst({ where: { kind, subjectKey: key, resolvedAt: null } });
const kutu = (userId: string, kind: string, key: string) =>
  prisma.notificationInbox.findMany({ where: { userId, kind, groupKey: { startsWith: `${kind}:${key}:` } }, orderBy: { createdAt: "asc" } });
const acildiSayisi = (kind: string, key: string) => prisma.notificationOutbox.count({ where: { kind, subjectKey: key, phase: "ACILDI", createdAt: { gte: BASLANGIC } } });
const kapandiSayisi = (kind: string, key: string) => prisma.notificationOutbox.count({ where: { kind, subjectKey: key, phase: "KAPANDI", createdAt: { gte: BASLANGIC } } });

/** §a–§e ortak senaryosu: bozuk() → sürer → kaynak fırlatır → saglam() → bozuk() tekrar. */
async function yasamDongusu(o: {
  kind: NotificationKind; key: string; user: string; kaynak: string;
  bozuk: () => void; saglam: () => void;
}): Promise<void> {
  const { kind, key, user } = o;
  const t = kind.replace("sistem.", "");
  o.bozuk();
  const ra = await tur(kind);
  const k1 = await acikKosul(kind, key);
  const kA = await kutu(user, kind, key);
  check(`§a ${t}: bozulur → tek ACILDI + tek gelen kutusu satırı`,
    typeof ra === "object" && ra.opened === 1 && !!k1 && (await acildiSayisi(kind, key)) === 1 && kA.length === 1 && kA[0]!.resolvedAt === null,
    `${JSON.stringify(ra)} kutu=${kA.length}`);
  const sonuc: unknown[] = [];
  for (let i = 0; i < 3; i++) sonuc.push(await tur(kind));
  const kB = await kutu(user, kind, key);
  check(`§b ${t}: sürer (3 tur) → yeni ACILDI / yeni kutu satırı yok`,
    sonuc.every((r) => typeof r === "object" && (r as { opened: number }).opened === 0) && (await acildiSayisi(kind, key)) === 1 && kB.length === 1,
    `${JSON.stringify(sonuc)} ACILDI=${await acildiSayisi(kind, key)} kutu=${kB.length}`);
  o.saglam();
  d.firlat.add(o.kaynak);
  const re = await tur(kind);
  d.firlat.delete(o.kaynak);
  const k2 = k1 ? await prisma.notificationCondition.findUnique({ where: { id: k1.id } }) : null;
  check(`§e ${t}: kaynak fırlatır (durum düzelmiş olsa da) → açık koşul AÇIK, KAPANDI yok`,
    re === "error" && !!k2 && k2.resolvedAt === null && (await kapandiSayisi(kind, key)) === 0, `${JSON.stringify(re)}`);
  const rc = await tur(kind);
  const k3 = k1 ? await prisma.notificationCondition.findUnique({ where: { id: k1.id } }) : null;
  const kC = await kutu(user, kind, key);
  const metin = kC[0] ? renderNotification(kind, kC[0].payload as Record<string, unknown>, "KAPANDI").govde : "";
  const acikMetin = kC[0] ? renderNotification(kind, kC[0].payload as Record<string, unknown>, "ACILDI").govde : "?";
  check(`§c ${t}: düzelir → KAPANDI, koşul + kutu resolvedAt, "Çözüldü" metni (katalog \`cozuldu\`)`,
    typeof rc === "object" && rc.closed === 1 && !!k3?.resolvedAt && kC.length === 1 && kC[0]!.resolvedAt !== null
      && !!getNotificationEntry(kind).cozuldu && metin !== acikMetin && !metin.includes("{") && !metin.includes("—"),
    `${JSON.stringify(rc)} metin="${metin}"`);
  o.bozuk();
  await tur(kind);
  const k4 = await acikKosul(kind, key);
  const kD = await kutu(user, kind, key);
  check(`§d ${t}: tekrar bozulur → YENİ koşul (id farklı) + YENİ kutu satırı, eskisi çözülmüş kalır`,
    !!k4 && k4.id !== k1?.id && kD.length === 2 && kD.filter((r) => r.resolvedAt === null).length === 1,
    `kutu=${kD.length}`);
  o.saglam();
  await tur(kind);
}

async function bayrak(v: boolean): Promise<void> {
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

async function govde(): Promise<void> {
  // Kendi DB'ndeki önceki koşumdan kalan açık koşul ölçümü bozar.
  const kalan = await prisma.notificationCondition.count({ where: { kind: { in: [...TURLER] }, resolvedAt: null } });
  if (kalan > 0) throw new Error(`ön koşul: bu türlerde ${kalan} açık koşul var (önceki koşumun kalıntısı?)`);
  await bayrak(true);
  registerSystemConditionSources();
  const geri = overrideSystemSourceDeps(SAHTE);
  try {
    const yonetici = await kisi("yon", ["system:backups", "admin:users", "license:view", "license:manage"]);

    // ── 1 · Yedek ────────────────────────────────────────────────────────────
    await yasamDongusu({
      kind: "sistem.yedek-basarisiz", key: "gece", user: yonetici, kaynak: "yedek",
      bozuk: () => { d.yedek = { verdict: "kritik", reason: "Son gece yedeği 60 saat önce — gece yedeği ÇALIŞMIYOR." }; },
      saglam: () => { d.yedek = { verdict: "ok", reason: "Son gece yedeği 2 saat önce." }; },
    });
    await yasamDongusu({
      kind: "sistem.yedek-basarisiz", key: "offsite", user: yonetici, kaynak: "yedek",
      bozuk: () => { d.offsite = { configured: true, ok: false, missing: ["a.dump", "b.dump"] }; },
      saglam: () => { d.offsite = { configured: true, ok: true, missing: [] }; },
    });
    d.yedek = { verdict: "yapilandirilmamis", reason: "BACKUP_DIR tanımlı değil — bu kurulumda yedek alınmıyor." };
    d.offsite = { configured: false, ok: false, missing: [] };
    const ry = await runConditionSourceOnce("sistem.yedek-basarisiz");
    check("§f2 yedek yapılandırılmamış / offsite hedefi tanımsız → koşul yok", typeof ry === "object" && ry.opened === 0, JSON.stringify(ry));
    // §g ölçülemeyen offsite (süreç yeni açıldı) açık koşulu KORUR.
    d.yedek = { verdict: "ok", reason: "-" };
    d.offsite = { configured: true, ok: false, missing: [] };
    await tur("sistem.yedek-basarisiz");
    const og1 = await acikKosul("sistem.yedek-basarisiz", "offsite");
    d.offsite = null;
    await tur("sistem.yedek-basarisiz");
    const og2 = og1 ? await prisma.notificationCondition.findUnique({ where: { id: og1.id } }) : null;
    check("§g1 offsite henüz koşmadı (null) → açık offsite koşulu KAPANMAZ", !!og1 && og2?.resolvedAt === null);
    d.offsite = { configured: true, ok: true, missing: [] };
    await tur("sistem.yedek-basarisiz");

    // ── 2 · Eşitleme ─────────────────────────────────────────────────────────
    resetSyncTrace();
    d.now = Date.now();
    d.bulut = { eligible: true, blockReason: null, lastRoundAt: d.now, lastOutcome: { status: "TAMAM" } };
    await tur("sistem.esitleme-gecikti");
    let turAni = d.now;
    await yasamDongusu({
      kind: "sistem.esitleme-gecikti", key: "bulut", user: yonetici, kaynak: "bulut",
      bozuk: () => { d.now = turAni + 31 * DAK; },
      saglam: () => {
        turAni = d.now + DAK;
        d.now = turAni;
        d.bulut = { ...d.bulut, lastRoundAt: turAni, lastOutcome: { status: "TAMAM" } };
      },
    });
    // §h ardışık hata turları
    d.bulut = { ...d.bulut, lastRoundAt: d.now + 1000, lastOutcome: { status: "HATA" } };
    const rh1 = await tur("sistem.esitleme-gecikti");
    d.bulut = { ...d.bulut, lastRoundAt: d.now + 2000, lastOutcome: { status: "KISMI" } };
    const rh2 = await tur("sistem.esitleme-gecikti");
    check("§h tek hatalı tur açmaz, art arda ikinci (HATA→KISMI) açar",
      typeof rh1 === "object" && rh1.opened === 0 && typeof rh2 === "object" && rh2.opened === 1, `${JSON.stringify(rh1)} ${JSON.stringify(rh2)}`);
    // §g açılıştaki ilk ölçümden önce (eligible:false, neden yok) → açık koşul KORUNUR
    d.bulut = { eligible: false, blockReason: null, lastRoundAt: null, lastOutcome: null };
    const rg2 = await tur("sistem.esitleme-gecikti");
    check("§g2 eşitleme henüz ölçülmedi → açık koşul KAPANMAZ", typeof rg2 === "object" && rg2.closed === 0 && !!(await acikKosul("sistem.esitleme-gecikti", "bulut")));
    // §f bulut kapalı (neden belli) → açık koşul kapanır, gecikse de açılmaz
    d.bulut = { eligible: false, blockReason: "KAPALI", lastRoundAt: null, lastOutcome: null };
    const rf1 = await tur("sistem.esitleme-gecikti");
    d.now += 5 * 60 * DAK;
    const rf2 = await tur("sistem.esitleme-gecikti");
    check("§f eşitleme uygun değil → açık koşul kapanır (hata değil), saatler geçse de açılmaz",
      typeof rf1 === "object" && rf1.closed === 1 && typeof rf2 === "object" && rf2.opened === 0 && !(await acikKosul("sistem.esitleme-gecikti", "bulut")),
      `${JSON.stringify(rf1)} ${JSON.stringify(rf2)}`);

    // ── 3 · Lisans ───────────────────────────────────────────────────────────
    d.now = Date.now();
    await yasamDongusu({
      kind: "sistem.lisans-uyarisi", key: "KIRA_SURESI_DOLDU", user: yonetici, kaynak: "lisans",
      bozuk: () => { d.lisans = { durumHazir: true, state: { uygulananKademe: "UYARI", nedenler: [{ kod: "KIRA_SURESI_DOLDU" }], odenmisTarih: null } }; },
      saglam: () => { d.lisans = { durumHazir: true, state: { uygulananKademe: "NORMAL", nedenler: [], odenmisTarih: null } }; },
    });
    await yasamDongusu({
      kind: "sistem.lisans-uyarisi", key: "bitis-yakin", user: yonetici, kaynak: "lisans",
      bozuk: () => { d.lisans = { durumHazir: true, state: { uygulananKademe: "NORMAL", nedenler: [], odenmisTarih: { tarihMs: d.now + 10 * GUN } } }; },
      saglam: () => { d.lisans = { durumHazir: true, state: { uygulananKademe: "NORMAL", nedenler: [], odenmisTarih: { tarihMs: d.now + 40 * GUN } } }; },
    });
    const bk = await prisma.notificationCondition.findFirst({ where: { kind: "sistem.lisans-uyarisi", subjectKey: "bitis-yakin", createdAt: { gte: BASLANGIC } }, orderBy: { createdAt: "asc" } });
    check("§i bitiş ≤14 gün → `bitis-yakin`, payload yalnız görüntü dizeleri (nedenKodu, neden)",
      !!bk && JSON.stringify(Object.keys(bk.payload as object).sort()) === JSON.stringify(["neden", "nedenKodu"]) && String((bk.payload as { neden: string }).neden).includes("bitiyor"),
      JSON.stringify(bk?.payload));
    d.lisans = { durumHazir: true, state: { uygulananKademe: "UYARI", nedenler: [{ kod: "VADE_DOLDU" }], odenmisTarih: null } };
    await tur("sistem.lisans-uyarisi");
    d.lisans = { durumHazir: false, state: { uygulananKademe: "NORMAL", nedenler: [], odenmisTarih: null } };
    const rg3 = await tur("sistem.lisans-uyarisi");
    check("§g3 lisans durumu hazır değil → açık koşul KAPANMAZ", typeof rg3 === "object" && rg3.closed === 0 && !!(await acikKosul("sistem.lisans-uyarisi", "VADE_DOLDU")));
    d.lisans = { durumHazir: true, state: { uygulananKademe: "NORMAL", nedenler: [], odenmisTarih: null } };
    await tur("sistem.lisans-uyarisi");

    // ── 4 · Güncelleme ───────────────────────────────────────────────────────
    await yasamDongusu({
      kind: "sistem.guncelleme-onay-bekliyor", key: "9.9.1", user: yonetici, kaynak: "guncelleme",
      bozuk: () => { d.guncelleme = { guncelleyici: { durum: "CALISIYOR" }, bekleyen: { surum: "9.9.1", karar: "ONAY_BEKLIYOR" }, onay: null }; },
      saglam: () => { d.guncelleme = { guncelleyici: { durum: "CALISIYOR" }, bekleyen: { surum: "9.9.1", karar: "KUR" }, onay: { surum: "9.9.1" } }; },
    });
    d.guncelleme = { guncelleyici: { durum: "CALISIYOR" }, bekleyen: { surum: "9.9.2", karar: "ONAY_BEKLIYOR" }, onay: { surum: "9.9.2" } };
    const ru = await runConditionSourceOnce("sistem.guncelleme-onay-bekliyor");
    check("§f3 aday sürüm onaylanmışsa koşul yok", typeof ru === "object" && ru.opened === 0, JSON.stringify(ru));

    // ── §M ölçüm: gerçek okuyucularla her evaluate ──────────────────────────────
    geri();
    for (const kind of SYSTEM_CONDITION_KINDS) {
      const t0 = process.hrtime.bigint();
      let not = "";
      try {
        const r = await SYSTEM_SOURCE_EVALUATORS[kind]();
        not = `${r.length} konu`;
      } catch (err) {
        not = `fırlattı (${(err as Error).message.slice(0, 60)})`;
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(`   ⓘ ÖLÇÜM: ${kind} evaluate ${ms.toFixed(1)} ms — ${not}`);
    }
  } finally {
    geri();
  }
}

async function temizle(): Promise<void> {
  try {
    await prisma.notificationInbox.deleteMany({ where: { OR: [{ userId: { in: users } }, { kind: { in: [...TURLER] }, createdAt: { gte: BASLANGIC } }] } });
    await prisma.notificationOutbox.deleteMany({ where: { kind: { in: [...TURLER] }, createdAt: { gte: BASLANGIC } } });
    await prisma.notificationCondition.deleteMany({ where: { kind: { in: [...TURLER] }, createdAt: { gte: BASLANGIC } } });
    if (users.length > 0) {
      await prisma.userPermission.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
  } catch (err) {
    fail++;
    console.error("❌ temizlik başarısız", err);
  }
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim — sistem koşul kaynakları (tür 1–4) ===\n");
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const tabanGeri = await kosulTabaniHazir(TURLER);
  try {
    await govde();
  } finally {
    stopNotificationJobs();
    await tabanGeri();
    await temizle();
    if (ilk) await prisma.systemSetting.update({ where: { key }, data: { value: ilk.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
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
    process.exit(fail > 0 ? 1 : 0);
  });
