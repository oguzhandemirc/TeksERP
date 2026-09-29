// =============================================================================
// Portal KULLANICI CLI'ı — ilk yöneticinin açılışı ve kurtarma (kilit · TOTP · parola).
// =============================================================================
// Portaldan kullanıcı açmak için bir yönetici oturumu gerekir; ilk yönetici (ve yöneticisiz kalan
// portalın kurtarılması) yalnız sunucuda bu CLI ile yapılır. Parola TTY'den (gizli) ya da stdin'den;
// argv/env'den ASLA. TOTP sırrı YALNIZ bu çıktıda bir kez görünür (DB'de sarılı; loga/denetime girmez) —
// çıktıyı dosyaya/loga yönlendirmeyin, authenticator uygulamasına girip ekranı kapatın.
//
// Kullanım (satici/sunucu içinden; DATABASE_URL + ANAHTAR_DIZINI .env'den):
//   npx tsx scripts/portal-kullanici.ts ekle --kullanici=ad --ad-soyad="Ad Soyad" --rol=SATICI_YONETICI [--bayi-id=<uuid>]
//   npx tsx scripts/portal-kullanici.ts totp-sifirla --kullanici=ad --sebep="telefon kayboldu"
//   npx tsx scripts/portal-kullanici.ts parola-sifirla --kullanici=ad --sebep="parola unutuldu"
//   npx tsx scripts/portal-kullanici.ts kilit-ac --kullanici=ad
// Stdin'den parola (TTY yoksa): parola + tekrar, her biri bir satır.
// =============================================================================
import { mkdirSync } from "node:fs";
import { loadConfig } from "../src/config";
import { KeyStore } from "../src/keys/key-store";
import { recordAudit } from "../src/lib/audit";
import { loadEnvFile } from "../src/lib/env";
import { normalizeUsername } from "../src/portal/auth.service";
import { hashPortalPassword } from "../src/portal/password";
import { PORTAL_ROLES, type PortalRole } from "../src/portal/roles";
import { PortalSecretBox } from "../src/portal/secret-box";
import { createPortalUserTx, resetPortalUserTotpTx, setPortalUserPasswordTx, unlockPortalUserTx } from "../src/portal/users.service";
import type { VendorContext } from "../src/services/context";
import { CliError, args, askPassword } from "./lib/cli-girdi";

const ACTOR = "cli";

function required(flags: Map<string, string>, name: string): string {
  const v = flags.get(name);
  if (!v) throw new CliError(`--${name} zorunlu`);
  return v;
}

async function newPassword(): Promise<string> {
  const first = await askPassword("Yeni parola: ");
  const second = await askPassword("Parola (tekrar): ");
  try {
    if (first.length !== second.length || !first.equals(second)) throw new CliError("Parolalar eşleşmedi");
    return first.toString("utf8");
  } finally {
    first.fill(0);
    second.fill(0);
  }
}

function printTotp(username: string, totp: { sir: string; otpauthUri: string }): void {
  process.stdout.write(
    `\nTOTP kurulumu (${username}) — YALNIZ BU KEZ gösterilir:\n` +
      `  Sır        : ${totp.sir}\n` +
      `  otpauth URI: ${totp.otpauthUri}\n` +
      `Authenticator uygulamasına girin; bu çıktıyı saklamayın, loga yönlendirmeyin.\n`,
  );
}

async function main(): Promise<void> {
  const { command, flags } = args(process.argv.slice(2));
  loadEnvFile();
  const config = loadConfig();
  mkdirSync(config.ANAHTAR_DIZINI, { recursive: true, mode: 0o700 });
  const ctx: VendorContext = { config, keys: KeyStore.load(config), portalSecrets: PortalSecretBox.load(config.ANAHTAR_DIZINI, { create: true }) };
  const { prisma, pool } = await import("../src/lib/prisma");
  try {
    const find = async () => {
      const username = normalizeUsername(required(flags, "kullanici"));
      const user = await prisma.portalKullanici.findUnique({ where: { kullaniciAdi: username } });
      if (!user) throw new CliError(`Kullanıcı yok: ${username}`);
      return user;
    };
    switch (command) {
      case "ekle": {
        const role = required(flags, "rol") as PortalRole;
        if (!PORTAL_ROLES.includes(role)) throw new CliError(`--rol: ${PORTAL_ROLES.join(" | ")}`);
        const passwordHash = await hashPortalPassword(await newPassword());
        const created = await createPortalUserTx(prisma, ctx, {
          username: required(flags, "kullanici"),
          fullName: required(flags, "ad-soyad"),
          role,
          dealerId: flags.get("bayi-id") ?? null,
          passwordHash,
        });
        await recordAudit({ event: "PORTAL_KULLANICI_EKLENDI", entity: "PortalKullanici", entityId: created.user.id, actor: ACTOR, summary: { rol: role } });
        process.stdout.write(`Kullanıcı açıldı: ${created.user.kullaniciAdi} (${role})\n`);
        printTotp(created.user.kullaniciAdi, created.totp);
        return;
      }
      case "totp-sifirla": {
        const user = await find();
        const r = await resetPortalUserTotpTx(prisma, ctx, { userId: user.id, reason: required(flags, "sebep") });
        await recordAudit({ event: "PORTAL_TOTP_SIFIRLANDI", entity: "PortalKullanici", entityId: user.id, actor: ACTOR, summary: { sebep: flags.get("sebep") ?? "" } });
        printTotp(user.kullaniciAdi, r.totp);
        return;
      }
      case "parola-sifirla": {
        const user = await find();
        const passwordHash = await hashPortalPassword(await newPassword());
        await setPortalUserPasswordTx(prisma, { userId: user.id, passwordHash, reason: required(flags, "sebep") });
        await recordAudit({ event: "PORTAL_PAROLA_SIFIRLANDI", entity: "PortalKullanici", entityId: user.id, actor: ACTOR, summary: { sebep: flags.get("sebep") ?? "" } });
        process.stdout.write(`Parola değişti; açık oturumlar kapandı: ${user.kullaniciAdi}\n`);
        return;
      }
      case "kilit-ac": {
        const user = await find();
        await unlockPortalUserTx(prisma, { userId: user.id });
        await recordAudit({ event: "PORTAL_KILIT_ACILDI", entity: "PortalKullanici", entityId: user.id, actor: ACTOR });
        process.stdout.write(`Kilit açıldı: ${user.kullaniciAdi}\n`);
        return;
      }
      default:
        throw new CliError("Komut: ekle | totp-sifirla | parola-sifirla | kilit-ac (ayrıntı dosya başında)");
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  (err: Error) => {
    process.stderr.write(`HATA: ${err.message}\n`);
    process.exit(err instanceof CliError ? 2 : 1);
  },
);
