// =============================================================================
// SATICI HESABI (süperadmin) KURULUM SCRIPT'İ — `npm run superadmin:kur`
// =============================================================================
// Hesabın TEK doğuş yolu budur (2026-09-03, P8 kullanıcı kararı). `.env`
// tohumlaması KALDIRILDI: iki doğuş yolu = iki sır yüzeyi. `.env` yolunda parola
// hash'i, PIN ve TOTP sırrı diskte KALICI duruyordu (yedeğe, `kur.ps1`in taşıdığı
// dosyaya, ekran paylaşımına giriyordu) ve "FORCE_SYNC satırını sonra kaldırın"
// gibi unutulabilir bir adım istiyordu. Burada sır yalnız süreç belleğinde yaşar
// ve terminale BİR KEZ basılır.
//
// KULLANIM (fabrika sunucusunda, `Teks-Erp/` içinden):
//     npm run superadmin:kur                # kurulum (idempotent)
//     npm run superadmin:kur -- --rotate    # parola + PIN + TOTP yenile
//
// ⚠️ GERÇEK TERMİNAL ŞART. Script parolayı maskeleyerek okur; girdi boru/dosya
// olduğunda readline soruları sırayla cevaplayamaz. Uzaktan koşulacaksa
// `ssh -t sunucu '…'` ya da `docker exec -it …` kullanın — `-t` YOKSA script
// ilk soruda durur. Kapı bunu SESSİZ DONMA yerine gürültülü hataya çevirir
// (`interaktif()` ilk işi; ölçüm: kapı olmadan boruda 120 sn boyunca donuyor,
// DB'ye hiçbir şey yazılmıyor, süreç ölmüyordu).
//
// ÜÇ KURAL — üçü de bilinçli:
//   ① İDEMPOTENT: hesap varsa DOKUNULMAZ ("zaten kurulu", çıkış 0). Yoksa ikinci
//      koşum sahadaki bir rotasyonu sessizce geri alırdı.
//   ② MEVCUT KULLANICI YÜKSELTİLMEZ (S4). Var olan bir `username` verilirse hata
//      + gerekçe. Gizli hesap görünür bir hesaptan türetilemez: o kullanıcının
//      geçmişi, oturumları ve audit satırları maskeli hesaba TAŞINAMAZ (audit
//      maskesi satır düzeyindedir — geçmiş satırlar bir anda "Sistem Bakımı"
//      adına geçer ve fabrikanın kendi kayıtları yalanlanır).
//   ③ SIR DİSKE YAZILMAZ. Ham parola/PIN/TOTP sırrı hiçbir dosyaya, log'a ya da
//      audit yüküne düşmez; yalnız `provisionSuperadmin`ın DÖNÜŞ değerinde
//      yaşar ve interaktif katman onu bir kez ekrana basar.
//
// TEST EDİLEBİLİRLİK: girdi okuma (TTY, maskeli parola, QR) ile karar verme
// AYRI katmanlardır. Bekçi (`scripts/test_superadmin_provision.ts`)
// `provisionSuperadmin(input, deps)`i DOĞRUDAN çağırır — TTY sondası yazmaz.
// Bu yüzden çekirdek HİÇBİR ŞEY YAZDIRMAZ (stdout sessizdir) ve bekçi bunu
// ölçer: bir `console.log` sızarsa sır ekrana iki kez basılmış olurdu.
// =============================================================================

import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import bwipjs from "bwip-js";

import prisma, { pool } from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";
import { buildOtpauthUri, generateTotpSecret } from "../src/services/totp.service";
import {
  SYSTEM_ACCOUNT_FULLNAME,
  logSuperadminLifecycleEvent,
} from "../src/jobs/superadmin.job";
import { setSystemAccountExists } from "../src/services/helpers/system-account.registry";
import { p2002Mentions } from "../src/utils/p2002";

/** Authenticator uygulamasında görünen ad — `totp-account.service` ile AYNI. */
const TOTP_ISSUER = "TeksERP";

/** `quickPin` sözleşmesi: TAM 6 hane (`auth.service.loginWithQuickPin` ile aynı). */
const PIN_RE = /^\d{6}$/;
/** Kullanıcı adı: boşluksuz, ASCII, giriş kutusuna elle yazılabilir. */
const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;
/** bcrypt 72 BAYT'tan sonrasını sessizce kırpar → sınır BAYT cinsinden. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72;
/** PIN üretim denemesi — `quickPin` sistem genelinde `@unique`. */
const PIN_TRY = 60;

// -----------------------------------------------------------------------------
// SAF ÇEKİRDEK — bekçi bunu doğrudan çağırır
// -----------------------------------------------------------------------------

export interface ProvisionInput {
  /** Yeni hesabın giriş adı. Rotasyonda YOK SAYILIR (ad giriş kimliğidir). */
  username: string;
  /** Ham parola — hash'lenir, hiçbir yere ham yazılmaz. */
  password: string;
  /** 6 hane; `null` ise ÜRETİLİR. */
  pin: string | null;
  /** `true` → mevcut hesabın parola/PIN/TOTP'si yenilenir + `tokenVersion++`. */
  rotate: boolean;
}

export interface ProvisionDeps {
  hashPassword(plain: string): Promise<string>;
  randomPin(): string;
  generateTotpSecret(): string;
  now(): Date;
  logLifecycle(params: {
    rotated: boolean;
    userId: string;
    totp: "seeded" | "cleared";
  }): Promise<void>;
}

export type ProvisionErrorCode =
  | "USERNAME_INVALID"
  | "USERNAME_TAKEN"
  | "PASSWORD_INVALID"
  | "PIN_INVALID"
  | "PIN_TAKEN"
  | "PIN_EXHAUSTED"
  | "NOT_PROVISIONED"
  | "RACE";

export interface ProvisionSecrets {
  id: string;
  username: string;
  /** Ekrana BİR KEZ basılır; hiçbir yere kaydedilmez. */
  pin: string;
  totpSecret: string;
  otpauthUri: string;
}

export type ProvisionResult =
  | ({ kind: "created" } & ProvisionSecrets)
  | ({ kind: "rotated" } & ProvisionSecrets)
  /** İdempotent dal: hesap zaten kurulu, HİÇBİR ŞEY değişmedi. */
  | { kind: "exists"; id: string; username: string }
  | { kind: "error"; code: ProvisionErrorCode; message: string };

export const defaultProvisionDeps: ProvisionDeps = {
  hashPassword: (plain) => AuthService.hashPassword(plain),
  // 6 hane — baştaki sıfır da meşru (PIN bir SAYI değil, bir dizidir).
  randomPin: () =>
    String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0"),
  generateTotpSecret,
  now: () => new Date(),
  logLifecycle: logSuperadminLifecycleEvent,
};

function hata(code: ProvisionErrorCode, message: string): ProvisionResult {
  return { kind: "error", code, message };
}

/** Parola sözleşmesi — bcrypt'in sessiz kırpması yüzünden ÜST sınır da var. */
function parolaKusuru(password: string): string | null {
  if (password.length < PASSWORD_MIN) {
    return `Parola en az ${PASSWORD_MIN} karakter olmalı.`;
  }
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    return (
      `Parola ${PASSWORD_MAX_BYTES} BAYT'ı aşıyor — bcrypt fazlasını SESSİZCE kırpar ` +
      "(Türkçe harfler 2 bayt sayılır)."
    );
  }
  return null;
}

/**
 * Çakışmayan bir PIN çözer.
 * `istenen` verilmişse doğrulanır ve çakışıyorsa HATA döner (sessizce başka bir
 * PIN üretmek, kurulumcunun yazdığı kâğıtla sistemi ayrıştırırdı).
 */
async function pinCoz(
  istenen: string | null,
  deps: ProvisionDeps,
  haricUserId: string | null,
): Promise<{ pin: string } | { code: ProvisionErrorCode; message: string }> {
  const kullanimda = async (pin: string): Promise<boolean> => {
    const row = await prisma.user.findFirst({
      where: { quickPin: pin, ...(haricUserId ? { id: { not: haricUserId } } : {}) },
      select: { id: true },
    });
    return row !== null;
  };

  if (istenen !== null) {
    if (!PIN_RE.test(istenen)) {
      return { code: "PIN_INVALID", message: "PIN TAM 6 haneli rakam olmalı." };
    }
    if (await kullanimda(istenen)) {
      return {
        code: "PIN_TAKEN",
        message: "Bu PIN başka bir kullanıcıda — PIN sistem genelinde benzersizdir.",
      };
    }
    return { pin: istenen };
  }

  for (let i = 0; i < PIN_TRY; i++) {
    const aday = deps.randomPin();
    if (!PIN_RE.test(aday)) continue;
    if (!(await kullanimda(aday))) return { pin: aday };
  }
  return {
    code: "PIN_EXHAUSTED",
    message: `${PIN_TRY} denemede boş PIN bulunamadı — PIN'i elle verin.`,
  };
}

/**
 * Satıcı hesabını kurar ya da rotasyonlar. SAF KATMAN — hiçbir şey YAZDIRMAZ.
 *
 * ⚠️ Sırlar yalnız DÖNÜŞ değerinde. Çağıran onları bir kez ekrana basar; log'a,
 * dosyaya, audit yüküne GEÇMEZ.
 */
export async function provisionSuperadmin(
  input: ProvisionInput,
  deps: ProvisionDeps = defaultProvisionDeps,
): Promise<ProvisionResult> {
  const mevcut = await prisma.user.findFirst({
    where: { isSystemAccount: true },
    select: { id: true, username: true },
  });

  // ── ROTASYON ──────────────────────────────────────────────────────────────
  if (input.rotate) {
    if (!mevcut) {
      return hata(
        "NOT_PROVISIONED",
        "Kurulu satıcı hesabı yok — önce `--rotate` olmadan çalıştırın.",
      );
    }
    const parolaHata = parolaKusuru(input.password);
    if (parolaHata) return hata("PASSWORD_INVALID", parolaHata);

    const pinSonuc = await pinCoz(input.pin, deps, mevcut.id);
    if (!("pin" in pinSonuc)) return hata(pinSonuc.code, pinSonuc.message);

    const secret = deps.generateTotpSecret();
    const passwordHash = await deps.hashPassword(input.password);
    try {
      await prisma.user.update({
        where: { id: mevcut.id },
        data: {
          passwordHash,
          quickPin: pinSonuc.pin,
          totpSecret: secret,
          totpEnabledAt: deps.now(),
          totpLastStep: null,
          isActive: true,
          // ⚠️ Eski oturumlar ANINDA düşer (parola/PIN değişiminin her yerdeki
          // sözleşmesi). Aksi halde rotasyon "sızmış oturumu" kapatmazdı.
          tokenVersion: { increment: 1 },
          // ⚠️ KULLANICI ADI DEĞİŞTİRİLMEZ: ad GİRİŞ KİMLİĞİdir ve sessizce
          // değiştirmek satıcıyı bir sonraki girişte dışarıda bırakır.
        },
      });
    } catch (err) {
      if (p2002Mentions(err, /users_(username_key|username_lower_uq|quickPin_key)/)) {
        return hata("RACE", "PIN/kullanıcı adı bu sırada başka bir kullanıcıya yazıldı.");
      }
      throw err;
    }
    setSystemAccountExists(true);
    await deps.logLifecycle({ rotated: true, userId: mevcut.id, totp: "seeded" });
    return {
      kind: "rotated",
      id: mevcut.id,
      username: mevcut.username,
      pin: pinSonuc.pin,
      totpSecret: secret,
      otpauthUri: buildOtpauthUri({
        username: mevcut.username,
        secretBase32: secret,
        issuer: TOTP_ISSUER,
      }),
    };
  }

  // ── İDEMPOTENT DAL ────────────────────────────────────────────────────────
  if (mevcut) {
    setSystemAccountExists(true);
    return { kind: "exists", id: mevcut.id, username: mevcut.username };
  }

  // ── KURULUM ───────────────────────────────────────────────────────────────
  const username = input.username.trim();
  if (!USERNAME_RE.test(username)) {
    return hata(
      "USERNAME_INVALID",
      "Kullanıcı adı 3-50 karakter, boşluksuz ve yalnız `A-Z a-z 0-9 . _ -` olmalı.",
    );
  }
  // ⚠️ S4 — MEVCUT KULLANICI YÜKSELTİLMEZ. Küçük/büyük harf duyarsız bakılır:
  // DB'de şema-dışı `users_username_lower_uq` var, düz eşitlik "BAKIM" yazılınca
  // kontrolü geçer ve INSERT ham P2002 ile düşerdi.
  const cakisan = await prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { id: true },
  });
  if (cakisan) {
    return hata(
      "USERNAME_TAKEN",
      "Bu kullanıcı adı zaten var — gizli hesap görünür bir hesaptan TÜRETİLEMEZ: " +
        "o kullanıcının geçmişi, oturumları ve audit satırları maskeli hesaba taşınamaz. " +
        // ⚠️ ÖRNEK, VARSAYILANDAN FARKLI OLMAK ZORUNDA: soru satırının önerisi
        // de `bakim` ve hata "bakim dolu" derken yine `bakim` önerirse
        // kurulumcu döngüye girer (P8-D notu).
        "Kullanılmamış, nötr bir ad seçin (örn. `satici` ya da `bakim2`).",
    );
  }

  const parolaHata = parolaKusuru(input.password);
  if (parolaHata) return hata("PASSWORD_INVALID", parolaHata);

  const pinSonuc = await pinCoz(input.pin, deps, null);
  if (!("pin" in pinSonuc)) return hata(pinSonuc.code, pinSonuc.message);

  const secret = deps.generateTotpSecret();
  const passwordHash = await deps.hashPassword(input.password);
  let created: { id: string };
  try {
    created = await prisma.user.create({
      data: {
        username,
        // Takma ad DOĞUŞTA yazılır: `record-info`/künye yüzeylerinin çoğu
        // `fullName`i basar, yani gerçek ad hiçbir zaman DB'ye girmez.
        fullName: SYSTEM_ACCOUNT_FULLNAME,
        passwordHash,
        quickPin: pinSonuc.pin,
        totpSecret: secret,
        // ⚠️ İKİ ALAN BİRDEN: `getStatus` yalnız ikisi de doluyken "kurulu" der.
        totpEnabledAt: deps.now(),
        isSystemAccount: true,
        isActive: true,
      },
      select: { id: true },
    });
  } catch (err) {
    // ÜÇ unique çarpabilir ve üçüncüsü ŞEMA-DIŞIDIR (`users_username_lower_uq`,
    // migration 20260731160000) — regex'e konmazsa yarış "bilinmeyen hata" sayılır.
    if (p2002Mentions(err, /users_(username_key|username_lower_uq|quickPin_key)/)) {
      return hata(
        "RACE",
        "Kullanıcı adı ya da PIN bu sırada başka bir kullanıcıya yazıldı — tekrar deneyin.",
      );
    }
    throw err;
  }

  setSystemAccountExists(true);
  await deps.logLifecycle({ rotated: false, userId: created.id, totp: "seeded" });
  return {
    kind: "created",
    id: created.id,
    username,
    pin: pinSonuc.pin,
    totpSecret: secret,
    otpauthUri: buildOtpauthUri({ username, secretBase32: secret, issuer: TOTP_ISSUER }),
  };
}

// -----------------------------------------------------------------------------
// TERMİNAL QR — bwip-js `raw()` matrisi + yarım blok karakterleri
// -----------------------------------------------------------------------------
/**
 * QR'ı 1 modül = 1 sütun, 2 modül = 1 satır olacak şekilde basar (yarım blok).
 * Tam blok kullanılsaydı modül başına 2 sütun gerekirdi (~106 karakter) ve 80
 * sütunluk bir terminalde satır SARAR — sarmış QR okunmaz.
 *
 * Renkler AÇIKÇA verilir (siyah üzerine beyaz DEĞİL, ANSI 30/47): terminal
 * teması koyu ise varsayılan renklerle QR ters çıkar ve telefon okumaz.
 */
export function qrTerminalMetni(text: string, quiet = 4): string {
  const raw = bwipjs.raw({ bcid: "qrcode", text }) as Array<{
    pixs?: ArrayLike<number>;
    pixx?: number;
    pixy?: number;
  }>;
  const m = raw[0];
  if (!m?.pixs || !m.pixx || !m.pixy) throw new Error("QR matrisi okunamadı");
  const w = m.pixx;
  const h = m.pixy;
  const dolu = (x: number, y: number): boolean => {
    const mx = x - quiet;
    const my = y - quiet;
    if (mx < 0 || my < 0 || mx >= w || my >= h) return false; // sessiz bölge
    return m.pixs![my * w + mx] !== 0;
  };
  const genislik = w + quiet * 2;
  const yukseklik = h + quiet * 2;
  const satirlar: string[] = [];
  for (let y = 0; y < yukseklik; y += 2) {
    let s = "\x1b[30;47m";
    for (let x = 0; x < genislik; x++) {
      const ust = dolu(x, y);
      const alt = y + 1 < yukseklik ? dolu(x, y + 1) : false;
      s += ust && alt ? "\u2588" : ust ? "\u2580" : alt ? "\u2584" : " ";
    }
    satirlar.push(s + "\x1b[0m");
  }
  return satirlar.join("\n");
}

// -----------------------------------------------------------------------------
// İNTERAKTİF KATMAN — yalnız doğrudan koşulduğunda
// -----------------------------------------------------------------------------

/** Yazdığı karakterleri gizleyebilen çıkış akışı (parola maskesi). */
class SessizCikis extends Writable {
  sessiz = false;
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    if (!this.sessiz) process.stdout.write(chunk);
    cb();
  }
}

/** Kapının metni — bekçi (non-TTY sondası) bunu ARAR. */
export const TTY_GEREKLI_MESAJI =
  "Bu script etkileşimli terminal ister — `ssh -t`, `docker exec -it` ya da " +
  "doğrudan sunucu konsolu kullanın.";

async function interaktif(): Promise<number> {
  const argv = process.argv.slice(2);
  const rotate = argv.includes("--rotate");
  // Yardım metni kapıdan ÖNCE: `--help | less` meşru bir kullanım ve hiçbir
  // soru sormadığı için donma riski taşımaz. Kapı, SORU SORAN her yolun önünde.
  if (argv.includes("--yardim") || argv.includes("--help")) {
    console.log(
      "Kullanım:\n" +
        "  npm run superadmin:kur              satıcı hesabını kurar (idempotent)\n" +
        "  npm run superadmin:kur -- --rotate  parola + PIN + TOTP'yi yeniler\n" +
        "\n  ⚠️ Gerçek terminal ister (`ssh -t` / `docker exec -it`).\n",
    );
    return 0;
  }

  // ── TTY KAPISI — FAIL-LOUD (2026-09-03, P8-D bulgusu) ─────────────────────
  // ⚠️ BORU/DOSYA GİRDİSİ DESTEKLENMİYOR ve bu kapı olmadan bunu KİMSE
  // öğrenemiyordu: `readline` TTY olmayan girdide ilk `question()`dan sonra
  // stream'i tüketip `end`e düşüyor, sonraki soru hiç cevaplanmıyor ve süreç
  // hata vermeden, zaman aşımına düşmeden SONSUZA KADAR bekliyordu (ölçüldü:
  // boruda 120 sn donma, DB'ye tek satır yazılmadı, Prisma havuzu açık kaldı).
  // Hesabın TEK doğuş yolu bu script olduğu için `ssh sunucu 'npm run
  // superadmin:kur'` (`-t` yok), `docker exec` (`-it` yok), pm2 ya da CI ile
  // koşan kurulum SESSİZCE hesapsız kalıyordu.
  // ⚠️ Kapı, parola maskesini de anlamlı kılan şeydir: aşağıdaki `sorGizli`
  // maskeyi koşulsuz uygular, çünkü buradan sonra girdi HER ZAMAN TTY'dir.
  if (!process.stdin.isTTY) {
    console.error(`\n❌ ${TTY_GEREKLI_MESAJI}\n`);
    return 1;
  }

  const cikis = new SessizCikis();
  // ⚠️ ARAYÜZ İLK SORUDAN HEMEN ÖNCE KURULUR, fonksiyonun başında DEĞİL: TTY
  // olmayan girdide (boru) readline `end` olayında kendini kapatır ve araya
  // giren tek bir `await` (DB okuması) yeterdi — sonraki `question()` "readline
  // was closed" ile düşüyordu (ölçüldü). Kapı o girdiyi artık hiç geçirmiyor,
  // ama sıra ucuz bir savunma: kapı taşınırsa hata yine gürültülü kalsın.
  const acik: Array<ReturnType<typeof createInterface>> = [];
  const arayuz = (): ReturnType<typeof createInterface> => {
    if (acik.length === 0) {
      // `terminal: true` — kapı gerçek TTY garanti ediyor. Sabit yazmak burada
      // güvenli; kapıdan önce sabit `true` boru girdisini ekrana AYNEN
      // bastırıyordu (parola dahil) ve sorular sırasını kaybediyordu.
      acik.push(createInterface({ input: process.stdin, output: cikis, terminal: true }));
    }
    return acik[0]!;
  };

  const sor = async (soru: string, varsayilan = ""): Promise<string> => {
    const cevap = (await arayuz().question(soru)).trim();
    return cevap || varsayilan;
  };
  const sorGizli = async (soru: string): Promise<string> => {
    process.stdout.write(soru);
    cikis.sessiz = true;
    const cevap = await arayuz().question("");
    cikis.sessiz = false;
    process.stdout.write("\n");
    return cevap;
  };

  try {
    // Hesap zaten kuruluysa SORU SORMA — idempotentlik burada da geçerli
    // (kurulumcuya boşuna parola yazdırmak, "acaba değişti mi?" sorusu bırakır).
    const mevcut = await prisma.user.findFirst({
      where: { isSystemAccount: true },
      select: { id: true, username: true },
    });
    if (mevcut && !rotate) {
      console.log(
        `\nSatıcı hesabı ZATEN KURULU (${mevcut.username}). Hiçbir şey değiştirilmedi.\n` +
          "Parola/PIN/TOTP yenilemek için: npm run superadmin:kur -- --rotate\n",
      );
      return 0;
    }
    if (!mevcut && rotate) {
      console.error("\n❌ Kurulu satıcı hesabı yok — `--rotate` olmadan çalıştırın.\n");
      return 1;
    }

    console.log(
      rotate
        ? `\n=== Satıcı hesabı ROTASYONU (${mevcut?.username}) ===\n` +
            "Parola, PIN ve iki adımlı doğrulama sırrı YENİLENİR; açık oturumlar düşer.\n"
        : "\n=== Satıcı (süperadmin) hesabı kurulumu ===\n" +
            "Bu hesap fabrikanın hiçbir yüzeyinde görünmez; audit'e 'Sistem Bakımı' yazılır.\n",
    );

    let username = mevcut?.username ?? "";
    if (!rotate) {
      username = await sor("Kullanıcı adı [bakim]: ", "bakim");
    }

    let password = "";
    for (let deneme = 1; deneme <= 3; deneme++) {
      password = await sorGizli("Parola (ekrana basılmaz): ");
      const tekrar = await sorGizli("Parola (tekrar): ");
      if (password && password === tekrar) break;
      password = "";
      console.error(
        deneme < 3 ? "  ⚠️ Parolalar eşleşmedi, tekrar deneyin." : "  ❌ Parolalar eşleşmedi.",
      );
    }
    if (!password) return 1;

    const pinGirdi = await sor("Hızlı giriş PIN'i — 6 hane (boş bırak: üretilsin): ");

    const sonuc = await provisionSuperadmin({
      username,
      password,
      pin: pinGirdi === "" ? null : pinGirdi,
      rotate,
    });

    if (sonuc.kind === "error") {
      console.error(`\n❌ ${sonuc.message}  [${sonuc.code}]\n`);
      return 1;
    }
    if (sonuc.kind === "exists") {
      console.log(`\nSatıcı hesabı ZATEN KURULU (${sonuc.username}). Hiçbir şey değişmedi.\n`);
      return 0;
    }

    console.log(
      `\n✅ Satıcı hesabı ${sonuc.kind === "created" ? "OLUŞTURULDU" : "ROTASYONLANDI"}.\n`,
    );
    console.log("  ┌──────────────────────────────────────────────────────────────┐");
    console.log("  │  AŞAĞIDAKİLER BİR DAHA GÖSTERİLMEZ — şimdi kaydedin.        │");
    console.log("  └──────────────────────────────────────────────────────────────┘\n");
    console.log(`  Kullanıcı adı : ${sonuc.username}`);
    console.log(`  Hızlı PIN     : ${sonuc.pin}`);
    console.log(`  TOTP sırrı    : ${sonuc.totpSecret}`);
    console.log(`  otpauth URI   : ${sonuc.otpauthUri}\n`);
    try {
      console.log(qrTerminalMetni(sonuc.otpauthUri));
    } catch (e) {
      // QR bir KOLAYLIKTIR; basılamazsa sırrı elle girmek yeterlidir. Kurulumu
      // bir çizim hatası yüzünden düşürmek, sahayı hesapsız bırakırdı.
      console.warn(
        `\n⚠️ QR çizilemedi (${e instanceof Error ? e.message : e}) — TOTP sırrını ELLE girin.`,
      );
    }
    console.log(
      "\n  ⚠️ Bu değerler parola yöneticisinde tutulur, FABRİKAYA VERİLMEZ.\n" +
        "  ⚠️ Değişikliğin yürürlüğe girmesi için sunucuyu yeniden başlatmak GEREKMEZ;\n" +
        "     kilit defteri ilk istekte kendini tazeler.\n",
    );
    return 0;
  } finally {
    acik[0]?.close();
  }
}

if (require.main === module) {
  interaktif()
    .catch((e) => {
      console.error("HATA:", e instanceof Error ? e.message : e);
      return 1;
    })
    .then(async (kod) => {
      await prisma.$disconnect();
      await pool.end();
      process.exit(kod);
    })
    .catch(() => process.exit(1));
}
