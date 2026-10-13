// =============================================================================
// GÜVENLİK BİLDİRİMİ (Bölge 7 B3) — güvenlik olayı → giden kutusu → AYRI güvenlik sohbeti; taşıyıcılar SAHTE (ağ yok).
//   §1 çekirdek: eşik altı sessiz · eşikte TEK ilk ileti · pencere içindeki olaylar pencere sonunda TEK iletide sayaçla ·
//      boş pencere kapanır · sel sürdükçe pencere başına bir ileti · günlük özet günde bir · son 24 saat sayacı
//   §2 teslim: olay giden kutusuna sınıf × pencere başına kanal başına TEK satır (kurulumsuz, gövde allowlist)
//   §3 yönlendirme: güvenlik satırı YALNIZ güvenlik taşıyıcısına gider, işletme taşıyıcısı görmez; işletme satırı tersine
//   §4 kanal kapalı: güvenlik taşıyıcısı yoksa satır KAPALI, hiçbir taşıyıcı çağrılmaz; sağlık "güvenlik bildirimi: KAPALI"
//   §5 yapılandırma: güvenlik sohbeti yalnız `GUVENLIK_TELEGRAM_CHAT_ID`den (işletme sohbetine düşmez); sır dosyası İSTEĞE
//      BAĞLI (/dev/null → KAPALI 'boş', dolu → AÇIK); e-posta ikincil
//      yalnız `GUVENLIK_EPOSTA_ALICI` ile; nabız metni "güvenlik bildirimi: KAPALI" der
//   §6 olay yerleri: her sınıfın üretim kodunda en az bir `securityEvent` çağrısı var (sınıf sessizce düşmez)
//   §7 JWKS yaşı: istek beklemeden ölçüm; yarı tavan/aşım kademesi JWKS_YASI olayı, aynı kademe saatte bir
//   N4 (dosya DIŞI, geri alındı): `warnAge`teki `securityEvent("JWKS_YASI"…)` silinir → §6a · §7b · §7d ❌
//   §8 yedek tazeliği: istek beklemeden ölçüm; en yeni DB dökümü/anahtar arşivi tavandan eski ya da dizin yok →
//      YEDEK_ALINAMADI (kademe değişince hemen, aynı kademe 6 saatte bir); taze yedek sessiz
//   N5 (dosya DIŞI, geri alındı): `BackupFreshness.check`teki `securityEvent` silinir → §6a · §8b–§8g ❌
// NEGATİF SONDA (dosya DIŞI, geri alındı): N1 güvenlik kapsamı + `transportFor` işletme taşıyıcısına düşer → §3a/§3b/§4a/§4b
//   ❌ (yalnız `transportFor`daki düşüş ISIRMAZ: kapsam süzgeci satırı önce KAPALI yapar — iki katman) ·
//   N2 çekirdekte açık pencere yok sayılır (her eşik aşımı ilk ileti) → §1c/§2a ❌ · N3 güvenlik sohbeti boşsa
//   `TELEGRAM_CHAT_ID`e düşer → §5a ❌.
// Koşum: npx tsx scripts/test_guvenlik_bildirimi.ts   (yalnız *_test DB)
// =============================================================================
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BildirimKanali } from "@prisma/client";
import { generateKeyPairSync } from "node:crypto";
import { JwksCache } from "../src/http/access-jwt";
import { BackupFreshness } from "../src/lib/yedek-tazeligi";
import { GuvenlikAlarmi } from "../src/lib/guvenlik-alarm";
import { SECURITY_CLASSES, outboxDelivery, refreshSecurityChannelState, resetSecurityEventsForTest, securityEvent, securityHealth, securityTick, SECURITY_WINDOW_MS } from "../src/lib/security-events";
import { SECURITY_EVENTS } from "../src/notifications/catalog";
import { runSenderCycle, type SenderDeps } from "../src/notifications/sender";
import { loadSenderConfig, securityChannelSummary } from "../src/notifications/sender-config";
import type { NotificationTransport } from "../src/notifications/transports";
import type { RenderedMessage } from "../src/notifications/message";
import { hedefDbKapisi, kapat, kontrol, sonuc } from "./lib/test-ortam";

type Prisma = (typeof import("../src/lib/prisma"))["prisma"];
const T0 = Date.UTC(2026, 9, 12, 9, 0, 0);
const DK = 60_000;

class Sahte implements NotificationTransport {
  readonly giden: RenderedMessage[] = [];
  constructor(readonly channel: BildirimKanali) {}
  async send(msg: RenderedMessage) {
    this.giden.push(msg);
    return { kind: "OK" as const, providerId: null };
  }
  guvenlik(): number {
    return this.giden.filter((m) => m.subject.includes("GÜVENLİK") || m.subject.includes("güvenlik")).length;
  }
}

function cekirdek(): void {
  console.log("§1 çekirdek");
  const a = new GuvenlikAlarmi({ esikDk: { SEL: 3, TEK: 1 }, pencereMs: 5 * DK }, T0);
  kontrol("§1a eşik altı sessiz", a.kaydet("SEL", T0) === null && a.kaydet("SEL", T0 + 1000) === null);
  const ilk = a.kaydet("SEL", T0 + 2000, "KOD");
  kontrol("§1b eşikte TEK ilk ileti", ilk?.tur === "ILK" && ilk.adet === 3 && ilk.ornek === "KOD", JSON.stringify(ilk));
  let ek = 0;
  for (let i = 0; i < 20; i++) if (a.kaydet("SEL", T0 + 3000 + i * 1000)) ek++;
  kontrol("§1c pencere içindeki 20 olay ileti doğurmaz", ek === 0 && a.tick(T0 + 4 * DK).length === 0);
  const bir = a.tick(T0 + 2000 + 5 * DK);
  kontrol("§1d pencere sonunda TEK birleşik ileti + sayaç", bir.length === 1 && bir[0]?.tur === "BIRLESIK" && bir[0].adet === 20, JSON.stringify(bir));
  a.kaydet("SEL", T0 + 6 * DK);
  const iki = a.tick(T0 + 2000 + 10 * DK);
  kontrol("§1e sel sürerken pencere başına bir ileti (yeni İLK yok)", iki.length === 1 && iki[0]?.adet === 1);
  kontrol("§1f boş geçen pencere kapanır", a.tick(T0 + 2000 + 15 * DK).length === 0 && a.kaydet("TEK", T0 + 16 * DK)?.tur === "ILK");
  const oz1 = a.gunlukOzet(T0 + 16 * DK);
  kontrol("§1g günlük özet günde bir + son 24 saat sayacı", oz1?.sayac.SEL === 24 && oz1.sayac.TEK === 1 && a.gunlukOzet(T0 + 17 * DK) === null && a.gunlukOzet(T0 + 24 * 60 * DK) !== null);
  kontrol("§1h 24 saatten eski olay sayaçtan düşer", (a.son24Saat(T0 + 26 * 60 * DK).SEL ?? 0) === 0);
}

async function teslim(prisma: Prisma): Promise<void> {
  console.log("§2 teslim");
  const bekleyen: Promise<void>[] = [];
  const d = outboxDelivery(prisma);
  resetSecurityEventsForTest(T0, (m) => {
    const p = d(m);
    bekleyen.push(p);
    return p;
  });
  for (let i = 0; i < 3; i++) securityEvent("PORTAL_KILIT", "ERISIM", T0 + i * 1000);
  await Promise.all(bekleyen.splice(0));
  const satir = await prisma.bildirim.findMany({ where: { olay: "GUVENLIK_OLAYI" }, select: { kanal: true, kurulumId: true, govde: true } });
  kontrol("§2a üç olay → kanal başına TEK satır (kurulumsuz)", satir.length === 2 && satir.every((s) => s.kurulumId === null), `satır ${satir.length}`);
  securityTick(T0 + SECURITY_WINDOW_MS + 1000);
  await Promise.all(bekleyen.splice(0));
  const sonra = await prisma.bildirim.findMany({ where: { olay: { in: [...SECURITY_EVENTS] } }, select: { olay: true, govde: true } });
  const birlesik = sonra.filter((s) => s.olay === "GUVENLIK_OLAYI" && JSON.stringify(s.govde).includes("2 olay daha"));
  kontrol("§2b pencere sonu TEK birleşik satır (sayaç 2) + günlük özet", birlesik.length === 2 && sonra.filter((s) => s.olay === "GUVENLIK_OZETI").length === 2, `satır ${sonra.length}`);
  kontrol("§2c sağlık son 24 saat sayacı", securityHealth(T0 + 10 * DK).son24Saat.PORTAL_KILIT === 3);
}

async function yonlendirme(prisma: Prisma): Promise<void> {
  console.log("§3 yönlendirme · §4 kanal kapalı");
  const isTg = new Sahte("TELEGRAM");
  const isEp = new Sahte("EPOSTA");
  const gvTg = new Sahte("TELEGRAM");
  const ayar = { maxAttempts: 3, maxAgeHours: 24 * 365, portalBase: null, timeZone: "Europe/Istanbul" };
  // §4 önce: güvenlik taşıyıcısı YOK → satırlar KAPALI, işletme taşıyıcısı güvenlik iletisi görmez.
  const kapali: SenderDeps = { db: prisma as never, transports: { TELEGRAM: isTg, EPOSTA: isEp }, securityTransports: {}, settings: ayar };
  await runSenderCycle(kapali, Date.now());
  const k = await prisma.bildirim.findMany({ where: { olay: { in: [...SECURITY_EVENTS] } }, select: { durum: true } });
  kontrol("§4a güvenlik hedefi yokken satırlar KAPALI, işletme kanalına DÜŞMEZ", k.length > 0 && k.every((s) => s.durum === "KAPALI") && isTg.guvenlik() + isEp.guvenlik() === 0, `${k.map((s) => s.durum).join(",")} · işletme ${isTg.guvenlik() + isEp.guvenlik()}`);
  await refreshSecurityChannelState(prisma);
  kontrol("§4b sağlık uyarısı: güvenlik bildirimi: KAPALI", securityHealth().uyari?.startsWith("güvenlik bildirimi: KAPALI") === true, securityHealth().uyari ?? "null");
  // §3: yeni olay, güvenlik Telegram'ı açık, güvenlik e-postası kapalı.
  const bekleyen: Promise<void>[] = [];
  const d = outboxDelivery(prisma);
  resetSecurityEventsForTest(T0 + 60 * DK, (m) => {
    const p = d(m);
    bekleyen.push(p);
    return p;
  });
  securityEvent("IMZA_KILIDI", null, T0 + 61 * DK);
  await Promise.all(bekleyen.splice(0));
  const acik: SenderDeps = { db: prisma as never, transports: { TELEGRAM: isTg, EPOSTA: isEp }, securityTransports: { TELEGRAM: gvTg }, settings: ayar };
  await runSenderCycle(acik, Date.now());
  kontrol("§3a güvenlik satırı YALNIZ güvenlik sohbetine", gvTg.guvenlik() >= 1 && isTg.guvenlik() + isEp.guvenlik() === 0, `güvenlik ${gvTg.guvenlik()} · işletme ${isTg.guvenlik() + isEp.guvenlik()}`);
  const ep = await prisma.bildirim.findMany({ where: { olay: { in: [...SECURITY_EVENTS] }, kanal: "EPOSTA", durum: { not: "KAPALI" } } });
  kontrol("§3b güvenlik e-postası hedefsizken KAPALI (gönderim yok)", ep.length === 0);
  await refreshSecurityChannelState(prisma);
  kontrol("§3c teslim sonrası sağlık uyarısı kalkar", securityHealth().kanal.TELEGRAM === "GONDERILDI" && securityHealth().uyari === null, JSON.stringify(securityHealth().kanal));
}

function yapilandirma(): void {
  console.log("§5 yapılandırma");
  const ortak = { DATABASE_URL: "postgresql://x@localhost/y_test", TELEGRAM_BOT_TOKEN: `123456:${"A".repeat(35)}`, TELEGRAM_CHAT_ID: "-1001", RESEND_API_KEY: `re_${"b".repeat(20)}`, BILDIRIM_EPOSTA_ALICI: "a@ornek.com", BILDIRIM_EPOSTA_GONDEREN: "b@ornek.com" };
  const yok = loadSenderConfig(ortak);
  kontrol("§5a güvenlik sohbeti yokken işletme sohbetine düşmez (KAPALI)", yok.telegram.ok && !yok.security.telegram.ok && !yok.security.email.ok);
  kontrol("§5b nabız: güvenlik bildirimi: KAPALI", securityChannelSummary(yok).TELEGRAM.startsWith("güvenlik bildirimi: KAPALI (GUVENLIK_TELEGRAM_CHAT_ID yok"), securityChannelSummary(yok).TELEGRAM);
  const var_ = loadSenderConfig({ ...ortak, GUVENLIK_TELEGRAM_CHAT_ID: "-1002", GUVENLIK_EPOSTA_ALICI: "guvenlik@ornek.com" });
  kontrol(
    "§5c aynı bot, ayrı sohbet + ikincil e-posta ayrı alıcı",
    var_.security.telegram.ok && var_.security.telegram.settings.chatId === "-1002" && var_.security.email.ok && var_.security.email.settings.to.join() === "guvenlik@ornek.com",
  );
  kontrol("§5d biçimsiz güvenlik sohbeti KAPALI", !loadSenderConfig({ ...ortak, GUVENLIK_TELEGRAM_CHAT_ID: "abc" }).security.telegram.ok);
  // Sır dosyası İSTEĞE BAĞLI: compose değişken yoksa /dev/null bağlar → KAPALI ("boş"), gönderici açılır; dolu dosya → AÇIK.
  const bos = loadSenderConfig({ ...ortak, GUVENLIK_TELEGRAM_CHAT_ID_DOSYASI: "/dev/null" });
  kontrol("§5e /dev/null bağı → işletme kanalı açık, güvenlik KAPALI 'boş' ('herkese okunur' DEĞİL)", bos.telegram.ok && !bos.security.telegram.ok && /_DOSYASI boş/.test(securityChannelSummary(bos).TELEGRAM) && !/herkese/.test(securityChannelSummary(bos).TELEGRAM), securityChannelSummary(bos).TELEGRAM);
  const d = mkdtempSync(path.join(os.tmpdir(), "satici-guvenlik-"));
  try {
    writeFileSync(path.join(d, "c"), "-1003\n");
    chmodSync(path.join(d, "c"), 0o440);
    const dolu = loadSenderConfig({ ...ortak, GUVENLIK_TELEGRAM_CHAT_ID_DOSYASI: path.join(d, "c") });
    kontrol("§5f dolu sır dosyası (0440) → güvenlik sohbeti AÇIK", dolu.security.telegram.ok && dolu.security.telegram.settings.chatId === "-1003", securityChannelSummary(dolu).TELEGRAM);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

function olayYerleri(): void {
  console.log("§6 olay yerleri");
  const kok = path.join(__dirname, "../src");
  const dosyalar: string[] = [];
  const gez = (d: string): void => {
    for (const ad of readdirSync(d)) {
      const p = path.join(d, ad);
      if (statSync(p).isDirectory()) gez(p);
      else if (p.endsWith(".ts") && !p.endsWith("security-events.ts")) dosyalar.push(readFileSync(p, "utf8"));
    }
  };
  gez(kok);
  const metin = dosyalar.join("\n");
  const eksik = SECURITY_CLASSES.filter((c) => !metin.includes(`securityEvent("${c}"`) && !metin.includes(`sinif: "${c}"`));
  kontrol("§6a her güvenlik sınıfının üretimde olay yeri var", eksik.length === 0, eksik.join(",") || `${SECURITY_CLASSES.length} sınıf`);
}

/** §7 JWKS yaşı (B3 artığı): yaş kademesi istek beklemeden ölçülür, uyarı güvenlik olayına döner. */
async function jwksYasi(): Promise<void> {
  console.log("§7 JWKS yaşı");
  const jwk = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
  const body = JSON.stringify({ keys: [{ kid: "k1", kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" }] });
  const SA = 60 * DK; // tavan 2 saat: iki kademe 24 saatlik sayaç içinde kalır
  let saat = T0;
  let kaynak = T0;
  const c = new JwksCache({ source: "/yok", fetchJwks: async () => ({ status: 200, body, sourceTimeMs: kaynak }), now: () => saat, ttlMs: 60_000, cooldownMs: 0, maxSourceAgeMs: 2 * SA, warn: () => undefined });
  const say = () => securityHealth(saat).son24Saat.JWKS_YASI ?? 0;
  resetSecurityEventsForTest(T0);
  await c.checkAge();
  kontrol("§7a taze küme → olay yok", say() === 0, String(say()));
  saat = T0 + 1.5 * SA; // yarısı geçti, istek YOK
  await c.checkAge();
  kontrol("§7b istek gelmeden yarı tavan → JWKS_YASI olayı (UYARI)", say() === 1, String(say()));
  saat += 10 * DK;
  await c.checkAge();
  kontrol("§7c aynı kademede saat dolmadan yeni olay yok", say() === 1, String(say()));
  saat = T0 + 2.5 * SA;
  await c.checkAge();
  kontrol("§7d ASILDI'ya geçiş hemen olay", say() === 2, String(say()));
  kaynak = saat; // yan konteyner dosyayı yeniledi
  saat += 2 * DK;
  await c.checkAge();
  kontrol("§7e ✓K kaynak yenilenince TAZE, yeni olay yok", c.state().ageLevel === "TAZE" && say() === 2, `${c.state().ageLevel} · ${say()}`);
  resetSecurityEventsForTest(Date.now());
}

/** §8 yedek tazeliği (B3 artığı): satıcı yedek dizinini salt okur, bayat yedek güvenlik olayına döner. */
async function yedekTazeligi(): Promise<void> {
  console.log("§8 yedek tazeliği");
  const dir = mkdtempSync(path.join(os.tmpdir(), "yedek-tazelik-"));
  const SA = 60 * DK;
  let saat = T0;
  const dosya = (ad: string, yasMs: number): void => {
    const f = path.join(dir, ad);
    writeFileSync(f, "şifreli");
    utimesSync(f, (saat - yasMs) / 1000, (saat - yasMs) / 1000);
  };
  const b = new BackupFreshness({ dir, maxAgeMs: 26 * SA, now: () => saat, warn: () => undefined });
  const say = () => securityHealth(saat).son24Saat.YEDEK_ALINAMADI ?? 0;
  try {
    resetSecurityEventsForTest(T0);
    dosya("satici_20261012_080000.dump.tkenc", SA);
    dosya("anahtarlar_20261012_080000.tar.tkenc.tkenc", SA);
    kontrol("§8a taze döküm + anahtar arşivi → TAZE, olay yok", (await b.check()) === "TAZE" && say() === 0, String(say()));
    saat += 30 * SA; // döngü durdu: ikisi de 31 saatlik
    kontrol("§8b döküm tavandan eski → DB_BAYAT olayı (istek yok)", (await b.check()) === "DB_BAYAT" && say() === 1, String(say()));
    saat += 2 * SA;
    await b.check();
    kontrol("§8c aynı kademede 6 saat dolmadan yeni olay yok", say() === 1, String(say()));
    saat += 5 * SA;
    await b.check();
    kontrol("§8d 6 saat sonra aynı kademe yeniden bildirilir", say() === 2, String(say()));
    dosya("satici_20261013_210000.dump.tkenc", 0); // döküm alındı, anahtar arşivi alınamadı (B8 katmanı yok)
    kontrol("§8e döküm taze, anahtar arşivi eski → ANAHTAR_BAYAT hemen", (await b.check()) === "ANAHTAR_BAYAT" && say() === 3, String(say()));
    dosya("anahtarlar_20261013_210000.tar.tkenc.tkenc", 0);
    kontrol("§8f ✓K ikisi taze → TAZE, yeni olay yok", (await b.check()) === "TAZE" && say() === 3, String(say()));
    const yok = new BackupFreshness({ dir: path.join(dir, "yok"), maxAgeMs: 26 * SA, now: () => saat, warn: () => undefined });
    kontrol("§8g yedek dizini okunamıyor → DIZIN_YOK olayı", (await yok.check()) === "DIZIN_YOK" && say() === 4, String(say()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    resetSecurityEventsForTest(Date.now());
  }
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const { prisma } = await import("../src/lib/prisma");
  const temizle = () => prisma.bildirim.deleteMany({ where: { olay: { in: [...SECURITY_EVENTS] } } });
  try {
    cekirdek();
    await temizle();
    await teslim(prisma);
    await yonlendirme(prisma);
    yapilandirma();
    olayYerleri();
    await jwksYasi();
    await yedekTazeligi();
  } catch (err) {
    kontrol("beklenmeyen hata", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    await temizle().catch(() => undefined);
    resetSecurityEventsForTest(Date.now());
    await kapat();
  }
  sonuc();
}

void main();
