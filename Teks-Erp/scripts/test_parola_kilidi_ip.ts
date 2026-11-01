/**
 * Bekçi: parola giriş kilidi başkasının hesabını KİLİTLEYEMEZ (kullanıcı kararı 2026-10-19).
 * Kilit kovası daima istemci IP'sini taşır (fabrikada `ip`, vekil arkasında `ip|kullanıcı` ×1 + `ip` ×5);
 * IP'den bağımsız hesap kilidi YOKTUR ve ceza süreli biter. Kabul: saldırgan IP N yanlışta 429 alır,
 * başka IP'den meşru kullanıcı aynı anda doğru parolayla girer, saldırgan IP'si süre dolunca yeniden girebilir.
 * Gerçek HTTP (app aynı süreçte), barındırılan sınıf; istemci IP'si `CLIENT_IP_HEADER` ile verilir.
 * Koşum: `cd Teks-Erp && npx tsx scripts/test_parola_kilidi_ip.ts` (yalnız fikstür DB)
 */
import prisma from "../src/lib/prisma"; // İLK import: dotenv → DATABASE_URL
import http from "node:http";
import { randomInt } from "node:crypto";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { resetLoginLockout, flushLoginLockoutPersistence } from "../src/middlewares/login-lockout";
import { fixtureHedefEngeli } from "./lib/hedef-db-kapisi";
import { INSTALL_CLASS_ENV } from "../src/services/helpers/install-class.helper";

let gecti = 0;
let kaldi = 0;
function check(etiket: string, ok: boolean, ayrinti = ""): void {
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? "✅" : "❌"} ${etiket}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

type Cevap = { status: number; body: Record<string, unknown> };
const IP_BASLIGI = "x-test-client-ip";

function istek(port: number, yol: string, govde: unknown, ip: string): Promise<Cevap> {
  const veri = JSON.stringify(govde);
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port, path: yol, method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(veri), [IP_BASLIGI]: ip } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let j: Record<string, unknown> = {};
          try { j = JSON.parse(b); } catch { /* düz metin */ }
          resolve({ status: res.statusCode ?? 0, body: j });
        });
      },
    );
    r.on("error", reject);
    r.write(veri);
    r.end();
  });
}
const kod = (c: Cevap): string => String((c.body.details as { code?: string } | undefined)?.code ?? "");
const ozet = (c: Cevap): string => `HTTP ${c.status} ${kod(c)}`;
const kilitli = (c: Cevap): boolean => c.status === 429 && kod(c) === "LOGIN_LOCKED";
const girdi = (c: Cevap): boolean => c.status === 200;
const bekle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Her koşum kendi TEST-NET adreslerini kullanır: kalıcı kovalar önceki koşumdan taşınmaz. */
const ipUret = (): string => `198.51.${randomInt(0, 255)}.${randomInt(1, 254)}`;

async function main(): Promise<void> {
  const engel = fixtureHedefEngeli();
  if (engel) {
    console.error(`HEDEF RED: ${engel}`);
    process.exit(2);
  }
  // Hız sınırı ayrı bekçide (test_web_hardening); burada yalnız kilit ölçülür.
  process.env.RATE_LIMIT_ENABLED = "false";
  process.env.CLIENT_IP_HEADER = IP_BASLIGI;
  delete process.env.REMOTE_PORT;
  delete process.env.TRUST_PROXY;
  process.env[INSTALL_CLASS_ENV] = "BARINDIRILAN";

  const { default: app } = await import("../src/app");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const ts = Date.now();
  const CEZA_SN = 5;
  const ESIK = 5;
  const AYARLAR = [
    SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS, SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER, SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY,
    SETTING_KEYS.AUTH_WEB_TOTP_POLICY,
  ];
  const once = new Map<string, unknown>();
  for (const k of AYARLAR) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    once.set(k, row ? row.value : undefined);
  }
  const parola = `Kilit-${ts}-x`;
  const kurban = await prisma.user.create({
    data: { username: `test-kilit-ip-${ts}`, passwordHash: await AuthService.hashPassword(parola), fullName: "Parola Kilidi Bekçisi", webTotpOptOut: true },
    select: { id: true, username: true },
  });
  const set = async (key: string, value: unknown): Promise<void> => {
    await prisma.systemSetting.upsert({
      where: { key }, create: { key, value: value as never, updatedById: kurban.id }, update: { value: value as never, updatedById: kurban.id },
    });
    invalidateFeatureFlagsCache();
  };
  const kullanilanAnahtarlar: string[] = [];
  const giris = (ip: string, kullanici: string, sifre: string) => {
    kullanilanAnahtarlar.push(ip, `${ip}|u:${kullanici}`);
    return istek(port, "/api/auth/login", { username: kullanici, password: sifre, clientType: "mobile" }, ip);
  };

  try {
    await set(SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS, ESIK);
    await set(SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC, CEZA_SN);
    await set(SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER, 20);
    await set(SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY, "off");
    // Ölçülen kilit; barındırılan kanal-bağımsız 2FA (Y1) USER_CHOICE + tercihle devre dışı.
    await set(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "USER_CHOICE");

    for (const kapsam of ["ip+identity", "ip"] as const) {
      process.env.LOGIN_LOCKOUT_SCOPE = kapsam;
      const e = kapsam === "ip" ? "§2 kapsam ip (fabrika varsayılanı)" : "§1 kapsam ip|kullanıcı (vekil arkası)";
      console.log(`\n=== ${e} ===`);
      const saldirgan = ipUret();
      let mesru = ipUret();
      while (mesru === saldirgan) mesru = ipUret();

      for (let i = 0; i < ESIK; i++) await giris(saldirgan, kurban.username, "yanlis-parola");
      const s1 = await giris(saldirgan, kurban.username, parola);
      check(`⭐ ${e}a saldırgan IP ${ESIK} yanlıştan sonra doğru parolayla da 429 LOGIN_LOCKED`, kilitli(s1), ozet(s1));
      const m1 = await giris(mesru, kurban.username, parola);
      check(`⭐ ${e}b aynı anda BAŞKA IP'den meşru kullanıcı doğru parolayla girer (hesap kilitlenmedi)`, girdi(m1), ozet(m1));
      const m2 = await giris(mesru, kurban.username, parola);
      check(`${e}c meşru IP tekrar girer (meşru girişler saldırganın kovasını taşımaz)`, girdi(m2), ozet(m2));
      const s2 = await giris(saldirgan, kurban.username, parola);
      check(`${e}d meşru giriş saldırgan IP'sinin kilidini KALDIRMAZ`, kilitli(s2), ozet(s2));
      await bekle((CEZA_SN + 1) * 1000);
      const s3 = await giris(saldirgan, kurban.username, parola);
      check(`⭐ ${e}e kilit GEÇİCİ: ceza süresi (${CEZA_SN} sn) dolunca aynı IP doğru parolayla girer`, girdi(s3), ozet(s3));
    }

    // §3 IP başına sınır kullanıcı adından bağımsız: vekil kapsamında geniş kova (×5) çok hesap denemesini keser.
    process.env.LOGIN_LOCKOUT_SCOPE = "ip+identity";
    console.log("\n=== §3 IP başına deneme sınırı (kullanıcı adı değiştirerek) ===");
    const yayici = ipUret();
    const genisButce = ESIK * 5;
    for (let i = 0; i < genisButce; i++) await giris(yayici, `yok-${ts}-${i}`, "yanlis-parola");
    const y1 = await giris(yayici, kurban.username, parola);
    check(`⭐ §3a ${genisButce} farklı kullanıcı adıyla yanlıştan sonra o IP doğru parolada da 429`, kilitli(y1), ozet(y1));
    const y2 = await giris(ipUret(), kurban.username, parola);
    check("§3b başka IP'den kurban girer", girdi(y2), ozet(y2));
  } finally {
    delete process.env.LOGIN_LOCKOUT_SCOPE;
    delete process.env[INSTALL_CLASS_ENV];
    for (const [k, v] of once) {
      if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k, updatedById: kurban.id } });
      else await prisma.systemSetting.update({ where: { key: k }, data: { value: v as never } });
    }
    invalidateFeatureFlagsCache();
    for (const k of new Set(kullanilanAnahtarlar)) resetLoginLockout(k);
    await flushLoginLockoutPersistence();
    await prisma.user.updateMany({ where: { id: kurban.id }, data: { isActive: false } });
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = kaldi === 0 ? 0 : 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
