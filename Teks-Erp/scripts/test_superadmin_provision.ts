// =============================================================================
// BEKÇİ — SATICI HESABI KURULUM SCRIPT'İ (`superadmin-olustur.ts`, P8)
// =============================================================================
// NE KORUYOR: 2026-09-03'te satıcı hesabının doğuş yolu `.env` tohumlamasından
// sunucuda elle koşulan interaktif bir script'e taşındı. `.env` yolu KALDIRILDI
// — yani hesabın DOĞUŞU artık tek bir dosyada yaşıyor ve o dosya kırılırsa
// kurulum sessizce hesapsız kalır (modül anahtarları emniyet supabına düşer ve
// fabrika admini onları yazabilir hale gelir; hata yok, log yok).
//
// ALTI SESSİZ BOZULMA YOLU:
//   1. İDEMPOTENTLİK DÜŞER — ikinci koşum mevcut hesabın parolasını EZER. Sahada
//      kurulumcu "bir daha çalıştırayım" der ve satıcının elindeki parola ölür.
//   2. MEVCUT KULLANICI YÜKSELTİLİR — görünür bir hesap `isSystemAccount`
//      olursa o kullanıcının TÜM geçmişi bir anda "Sistem Bakımı" maskesine
//      girer (maske satır düzeyindedir) ve fabrikanın kendi kayıtları yalanlanır.
//   3. SUPAP AÇIK KALIR — hesap doğar ama kilit defteri tazelenmezse modül
//      anahtarları restart'a kadar `admin:settings` ile yazılmaya DEVAM eder.
//   4. ROTASYON OTURUM DÜŞÜRMEZ — `tokenVersion` artmazsa sızmış bir oturum
//      parola değişiminden SONRA da geçerli kalır (rotasyonun tek sebebi buydu).
//   5. SIR DİSKE/AUDIT'E SIZAR — `AuditService` `payload`ı HAM yazar; tek bir
//      alan eklemek PIN'i `system_logs`a kalıcı yazar ve `pg_dump` onu taşır.
//   6. `.env` YOLU GERİ GELİR — iki doğuş yolu = iki sır yüzeyi; kaldırma
//      metinden ölçülür (job dosyasında `SUPERADMIN_PASSWORD_HASH` GEÇMEZ).
//   7. TTY KAPISI DÜŞER — script gerçek terminal olmadan koşulunca `readline`
//      ilk sorudan sonra girdiyi tüketip `end`e düşer ve süreç HATA VERMEDEN,
//      ZAMAN AŞIMINA DÜŞMEDEN sonsuza kadar bekler (ölçüldü: boruda 120 sn
//      donma, DB'ye tek satır yazılmadı). `ssh sunucu '…'` (`-t` yok) ya da
//      `docker exec` (`-it` yok) ile koşan kurulum SESSİZCE hesapsız kalır —
//      hesabın tek doğuş yolu bu script olduğu için hiç kimse fark etmez.
//   8. ÖLÜ `.env` SATIRI UYARISI SUSAR ya da DEĞERİ BASAR — P2 yolunu kullanmış
//      kurulumda o satırlar hâlâ CANLI kimlik bilgisidir; susarsak sır diskte
//      unutulur, değeri basarsak pm2 log'una sır yazmış oluruz.
//
// ⚠️ BU BEKÇİ YAZAR: mevcut sistem hesabını GEÇİCİ olarak pasifleştirir
//    (`isSystemAccount=false`), kendi fixture'ını yaratır ve `finally`de İKİSİNİ
//    de geri alır. Doğum yolunu ölçmenin başka yolu yok — `provisionSuperadmin`
//    hesap varken (doğru şekilde) hiçbir şey yapmaz. Bu yüzden:
//      • hedef-DB kapısından geçer (`lib/hedef-db-kapisi.ts`),
//      • `test_db_invariants` §10 ("sistem hesabı ≤ 1") ile EŞZAMANLI KOŞMAZ
//        (her an EN FAZLA bir hesap işaretli kalır, ama pencere içinde
//        işaretli hesap BİZİMKİdir),
//      • süreç öldürülürse kalan artığı BİR SONRAKİ koşum onarır (açılıştaki
//        `onarBayatDurum` — takma adı taşıyan pasifleştirilmiş hesap geri alınır).
//
// Koşum: npx tsx scripts/test_superadmin_provision.ts
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

import prisma, { pool } from "../src/lib/prisma";
import bcrypt from "bcryptjs";
import {
  provisionSuperadmin,
  defaultProvisionDeps,
  type ProvisionDeps,
  type ProvisionResult,
} from "./superadmin-olustur";
import { SYSTEM_ACCOUNT_FULLNAME, ensureSuperadminAccount } from "../src/jobs/superadmin.job";
import {
  setSystemAccountExists,
  systemAccountLockActive,
  resolveSystemAccountLock,
  __resetSystemAccountRegistryForTests,
} from "../src/services/helpers/system-account.registry";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const SRC = path.join(__dirname, "..", "src");
const KOK = path.join(__dirname, "..");

const FIXTURE_USERNAME = `bekci.p8.${process.pid}`;
/**
 * Geçici pasifleştirmenin İMZASI — onarım bunu arar.
 *
 * ⚠️ SEZGİSEL BİR YÜKLEM YETMEZ. İlk yazımda onarım "takma adı taşıyan ama
 * işareti düşmüş hesap" arıyordu; o yüklem, satıcı ilişkisi biten (reçetedeki
 * `UPDATE users SET "isSystemAccount"=false`) bir kurulumu YANLIŞLIKLA yeniden
 * kilitler — ölçüldü: hesapsız prova DB'sinde onarım hesabı DİRİLTTİ ve bekçi
 * "hesapsız kurulum" ölçümünü hiç yapamadı. İmza tek anlamlıdır: bu adı yalnız
 * bu bekçi yazar.
 */
const GECICI_IMZA = `${SYSTEM_ACCOUNT_FULLNAME} [bekci.p8 geçici]`;
const PAROLA_1 = "bekci-p8-parola-1";
const PAROLA_2 = "bekci-p8-parola-2";

/** `finally` için: geri alınacak durum. */
let fixtureId: string | null = null;
let pasifleşenler: Array<{ id: string; fullName: string }> = [];
/** Sızıntı taramasının arayacağı sırlar (ölçüm sonunda dolar). */
const sirlar: string[] = [];

// -----------------------------------------------------------------------------

/**
 * Bayat artık onarımı — süreç öldürülmüşse `finally` hiç koşmaz.
 * İki artık olabilir: (a) bizim fixture hesabımız, (b) GEÇİCİ pasifleştirilmiş
 * gerçek satıcı hesabı. (b) daha tehlikelidir: kilit sessizce açık kalır.
 */
async function onarBayatDurum(): Promise<void> {
  const bayatFixture = await prisma.user.findMany({
    where: { username: { startsWith: "bekci.p8." } },
    select: { id: true },
  });
  for (const b of bayatFixture) {
    await prisma.session.deleteMany({ where: { userId: b.id } });
    await prisma.workSession.deleteMany({ where: { userId: b.id } });
    await prisma.systemLog.deleteMany({ where: { userId: b.id } });
    await prisma.userPermission.deleteMany({ where: { userId: b.id } });
    await prisma.user.delete({ where: { id: b.id } });
  }
  // İMZALI artık = yarıda kalmış bir koşum (başka hiçbir yol bu adı yazmaz).
  const yarim = await prisma.user.findMany({
    where: { fullName: GECICI_IMZA },
    select: { id: true, username: true },
  });
  if (yarim.length) {
    // ⚠️ Orijinal `fullName` çökmede kayboldu; doğru geri değer takma adın
    // KENDİSİdir — satıcı hesabı DOĞUŞTA onu taşır (`superadmin-olustur.ts`).
    await prisma.user.updateMany({
      where: { id: { in: yarim.map((y) => y.id) } },
      data: { isSystemAccount: true, fullName: SYSTEM_ACCOUNT_FULLNAME },
    });
    console.log(
      `   ℹ️  yarıda kalmış koşumdan ${yarim.length} satıcı hesabı GERİ ALINDI ` +
        `(${yarim.map((y) => y.username).join(", ")})`,
    );
  }
}

/** stdout + console'u yutar; çekirdeğin SESSİZ olduğunu ölçer. */
async function ciktiyiYakala<T>(f: () => Promise<T>): Promise<{ sonuc: T; cikti: string }> {
  let biriken = "";
  const gercekWrite = process.stdout.write.bind(process.stdout);
  const gercekLog = console.log;
  const gercekWarn = console.warn;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    biriken += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  console.log = (...a: unknown[]): void => {
    biriken += a.join(" ") + "\n";
  };
  console.warn = (...a: unknown[]): void => {
    biriken += a.join(" ") + "\n";
  };
  try {
    const sonuc = await f();
    return { sonuc, cikti: biriken };
  } finally {
    process.stdout.write = gercekWrite;
    console.log = gercekLog;
    console.warn = gercekWarn;
  }
}

function sirlariTopla(r: ProvisionResult): void {
  if (r.kind === "created" || r.kind === "rotated") {
    sirlar.push(r.pin, r.totpSecret);
  }
}

// =============================================================================

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  console.log(`Hedef DB: ${hedefDbAdi()}`);
  if (engel) {
    console.log(`⛔ ${engel}`);
    fail++;
    return;
  }

  await onarBayatDurum();

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== 0) Kurulum — mevcut satıcı hesabı GEÇİCİ pasifleştirilir ===");
  const mevcutlar = await prisma.user.findMany({
    where: { isSystemAccount: true },
    select: { id: true, username: true, fullName: true },
  });
  pasifleşenler = mevcutlar.map((m) => ({ id: m.id, fullName: m.fullName }));
  for (const m of mevcutlar) {
    await prisma.user.update({
      where: { id: m.id },
      data: { isSystemAccount: false, fullName: GECICI_IMZA },
    });
  }
  console.log(
    pasifleşenler.length
      ? `   ${pasifleşenler.length} hesap geçici pasifleştirildi (${mevcutlar.map((m) => m.username).join(", ")}) — finally'de geri alınacak`
      : "   DB'de satıcı hesabı yoktu — doğum yolu doğrudan ölçülüyor",
  );
  check(
    "başlangıç durumu: hesapsız kurulum",
    (await prisma.user.count({ where: { isSystemAccount: true } })) === 0,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== 1) MEVCUT KULLANICI YÜKSELTİLEMEZ (S4) ===");
  {
    const gorunur = await prisma.user.findFirst({
      where: { isSystemAccount: false, isActive: true },
      select: { username: true },
    });
    if (!gorunur) {
      check("körlük zemini: DB'de görünür bir kullanıcı var", false, "kontrol kurulamadı");
    } else {
      const oncekiSayi = await prisma.user.count();
      const red = await provisionSuperadmin({
        username: gorunur.username,
        password: PAROLA_1,
        pin: null,
        rotate: false,
      });
      check(
        "var olan kullanıcı adı REDDEDİLİR",
        red.kind === "error" && red.code === "USERNAME_TAKEN",
        red.kind === "error" ? red.code : red.kind,
      );
      check(
        "reddedilen çağrı HİÇBİR kullanıcı yaratmadı",
        (await prisma.user.count()) === oncekiSayi,
      );
      check(
        "sistem hesabı hâlâ YOK (yükseltme olmadı)",
        (await prisma.user.count({ where: { isSystemAccount: true } })) === 0,
      );
      // BÜYÜK HARFLE de reddedilmeli — DB'de şema-dışı `users_username_lower_uq`
      // var; düz eşitlik kontrolü geçer ve INSERT ham P2002 ile düşerdi.
      const redBuyuk = await provisionSuperadmin({
        username: gorunur.username.toUpperCase(),
        password: PAROLA_1,
        pin: null,
        rotate: false,
      });
      check(
        "BÜYÜK harfli yazımı da reddedilir (users_username_lower_uq)",
        redBuyuk.kind === "error" && redBuyuk.code === "USERNAME_TAKEN",
        redBuyuk.kind === "error" ? redBuyuk.code : redBuyuk.kind,
      );
    }
    // Rotasyon, kurulu hesap yokken hiçbir şey yaratmaz.
    const rotasyonYok = await provisionSuperadmin({
      username: FIXTURE_USERNAME,
      password: PAROLA_1,
      pin: null,
      rotate: true,
    });
    check(
      "hesap yokken `--rotate` → NOT_PROVISIONED (hesap YARATMAZ)",
      rotasyonYok.kind === "error" && rotasyonYok.code === "NOT_PROVISIONED",
      rotasyonYok.kind === "error" ? rotasyonYok.code : rotasyonYok.kind,
    );
    check(
      "rotasyon denemesi sistem hesabı doğurmadı",
      (await prisma.user.count({ where: { isSystemAccount: true } })) === 0,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== 2) DOĞUM — hesapsız kurulumda hesap doğar, SUPAP KAPANIR ===");
  let ilk: ProvisionResult;
  {
    // Supap AÇIK varsayımıyla başla: `resolveSystemAccountLock` fail-closed
    // olduğu için `null` durumda zaten `true` döner — o vakumen yeşil olurdu.
    __resetSystemAccountRegistryForTests();
    setSystemAccountExists(false);
    check("ön koşul: kilit defteri 'hesap YOK' diyor (supap açık)", true);

    const { sonuc, cikti } = await ciktiyiYakala(() =>
      provisionSuperadmin({
        username: FIXTURE_USERNAME,
        password: PAROLA_1,
        pin: null,
        rotate: false,
      }),
    );
    ilk = sonuc;
    sirlariTopla(ilk);
    check("hesap DOĞDU ('created')", ilk.kind === "created", ilk.kind);
    check(
      "çekirdek SESSİZ (sır iki kez basılmaz — yazdırma interaktif katmanın işi)",
      cikti === "",
      cikti ? JSON.stringify(cikti.slice(0, 120)) : "0 bayt",
    );

    if (ilk.kind !== "created") {
      console.log("   ⚠️ doğum ölçülemedi, kalan bölümler atlanıyor");
      return;
    }
    fixtureId = ilk.id;

    const satir = await prisma.user.findUnique({
      where: { id: ilk.id },
      select: {
        username: true,
        fullName: true,
        isSystemAccount: true,
        isActive: true,
        quickPin: true,
        totpSecret: true,
        totpEnabledAt: true,
        passwordHash: true,
        tokenVersion: true,
        updatedAt: true,
      },
    });
    check("doğan hesap `isSystemAccount: true`", satir?.isSystemAccount === true);
    check(
      `tam adı takma ad ("${SYSTEM_ACCOUNT_FULLNAME}")`,
      satir?.fullName === SYSTEM_ACCOUNT_FULLNAME,
      satir?.fullName ?? "—",
    );
    check("hesap aktif", satir?.isActive === true);
    check("PIN yazıldı ve dönüş değeriyle AYNI", satir?.quickPin === ilk.pin);
    check("PIN 6 hane", /^\d{6}$/.test(ilk.pin), ilk.pin.replace(/\d/g, "•"));
    check(
      "TOTP sırrı + `totpEnabledAt` İKİSİ BİRDEN yazıldı (getStatus 'kurulu' der)",
      satir?.totpSecret === ilk.totpSecret && satir?.totpEnabledAt !== null,
    );
    check("körlük zemini: TOTP sırrı ≥ 16 karakter", ilk.totpSecret.length >= 16, `${ilk.totpSecret.length}`);
    check(
      "parola HAM DEĞİL, bcrypt hash olarak yazıldı",
      /^\$2[aby]\$\d{2}\$/.test(satir?.passwordHash ?? "") &&
        (await bcrypt.compare(PAROLA_1, satir?.passwordHash ?? "")),
    );
    check(
      "otpauth URI issuer + sır taşıyor",
      ilk.otpauthUri.startsWith("otpauth://totp/") && ilk.otpauthUri.includes(ilk.totpSecret),
    );
    const grant = await prisma.userPermission.count({ where: { userId: ilk.id } });
    check("GRANT satırı YOK (yetki koddan gelir, panelden atanamaz)", grant === 0, `${grant} satır`);

    // ⚠️ ASIL ÖLÇÜM: supap kapandı mı? `resolveSystemAccountLock` yalnız defter
    // "yok" derken DB'ye gider (tembel doğrulama) — script yazdıktan sonra o yol
    // `true` dönmek ZORUNDA, yoksa modül anahtarları restart'a kadar açık kalır.
    // ⚠️ İKİ AYRI YÜKLEM, ikisi de gerekli:
    //   (a) SENKRON defter — `setSystemAccountExists(true)` gerçekten yazıldı mı?
    //       Yalnız (b) ölçülseydi kontrol FAIL-OPEN körü olurdu: `resolve…`
    //       defter "yok" derken DB'ye gider (tembel doğrulama) ve defter hiç
    //       yazılmasa DA `true` döner (ölçüldü — sonda yeşil kalıyordu).
    //   (b) UÇTAN UCA — kilit gerçekten yürürlükte mi.
    check(
      "kurulum kilit defterini SENKRON tazeledi (`systemAccountLockActive`)",
      systemAccountLockActive() === true,
    );
    check(
      "kurulumdan sonra SUPAP KAPALI (`resolveSystemAccountLock` → true)",
      (await resolveSystemAccountLock()) === true,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== 3) İDEMPOTENT — ikinci koşum HİÇBİR ŞEYE dokunmaz ===");
  if (ilk.kind === "created") {
    const once = await prisma.user.findUnique({
      where: { id: ilk.id },
      select: { passwordHash: true, quickPin: true, totpSecret: true, tokenVersion: true, updatedAt: true },
    });
    const sayiOnce = await prisma.user.count({ where: { isSystemAccount: true } });
    // Bilerek FARKLI parola/PIN ile: "aynı değeri yazdı" ile "hiç yazmadı"
    // ayrımı ancak farklı girdiyle ölçülür.
    const ikinci = await provisionSuperadmin({
      username: "bambaska-ad",
      password: PAROLA_2,
      pin: null,
      rotate: false,
    });
    check("ikinci koşum → 'exists'", ikinci.kind === "exists", ikinci.kind);
    const sonra = await prisma.user.findUnique({
      where: { id: ilk.id },
      select: { passwordHash: true, quickPin: true, totpSecret: true, tokenVersion: true, updatedAt: true },
    });
    check("parola hash'i DEĞİŞMEDİ", once?.passwordHash === sonra?.passwordHash);
    check("PIN DEĞİŞMEDİ", once?.quickPin === sonra?.quickPin);
    check("TOTP sırrı DEĞİŞMEDİ", once?.totpSecret === sonra?.totpSecret);
    check("`tokenVersion` ARTMADI (açık oturumlar düşmedi)", once?.tokenVersion === sonra?.tokenVersion);
    check(
      "`updatedAt` SABİT (satıra hiç UPDATE atılmadı)",
      once?.updatedAt.getTime() === sonra?.updatedAt.getTime(),
      `${once?.updatedAt.toISOString()} → ${sonra?.updatedAt.toISOString()}`,
    );
    check(
      "İKİNCİ sistem hesabı doğmadı",
      (await prisma.user.count({ where: { isSystemAccount: true } })) === sayiOnce,
      `${sayiOnce}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== 4) ROTASYON — parola + PIN + TOTP yenilenir, oturumlar düşer ===");
  if (ilk.kind === "created") {
    const once = await prisma.user.findUnique({
      where: { id: ilk.id },
      select: { passwordHash: true, quickPin: true, totpSecret: true, tokenVersion: true, username: true },
    });
    // Deterministik deps: PIN'i biz veriyoruz ki "değişti mi" ölçümü şansa kalmasın.
    const sabitSir = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    const deps: ProvisionDeps = { ...defaultProvisionDeps, generateTotpSecret: () => sabitSir };
    const rot = await provisionSuperadmin(
      { username: "yok-sayilir", password: PAROLA_2, pin: null, rotate: true },
      deps,
    );
    sirlariTopla(rot);
    check("rotasyon → 'rotated'", rot.kind === "rotated", rot.kind);
    const sonra = await prisma.user.findUnique({
      where: { id: ilk.id },
      select: {
        passwordHash: true,
        quickPin: true,
        totpSecret: true,
        totpLastStep: true,
        tokenVersion: true,
        username: true,
      },
    });
    check("parola hash'i DEĞİŞTİ", once?.passwordHash !== sonra?.passwordHash);
    check(
      "yeni parola gerçekten geçerli (hash yazıldı, bozulmadı)",
      await bcrypt.compare(PAROLA_2, sonra?.passwordHash ?? ""),
    );
    check("PIN DEĞİŞTİ", once?.quickPin !== sonra?.quickPin, `${once?.quickPin} → ${sonra?.quickPin}`);
    check("TOTP sırrı DEĞİŞTİ", once?.totpSecret !== sonra?.totpSecret && sonra?.totpSecret === sabitSir);
    check("`totpLastStep` sıfırlandı (eski kod tekrar kullanılamaz)", sonra?.totpLastStep === null);
    check(
      "`tokenVersion` ARTTI (açık oturumlar düştü)",
      (sonra?.tokenVersion ?? 0) === (once?.tokenVersion ?? 0) + 1,
      `${once?.tokenVersion} → ${sonra?.tokenVersion}`,
    );
    check(
      "KULLANICI ADI DEĞİŞMEDİ (ad giriş kimliğidir)",
      sonra?.username === once?.username,
      sonra?.username ?? "—",
    );
    check(
      "rotasyon İKİNCİ satır yaratmadı",
      (await prisma.user.count({ where: { isSystemAccount: true } })) === 1,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== 5) SIR SIZINTISI — audit · DB · dosya sistemi ===");
  {
    check("körlük zemini: aranacak sır toplandı", sirlar.length >= 3, `${sirlar.length} değer`);
    // Audit best-effort ve tx dışında — yazılma penceresi verilir.
    await new Promise((r) => setTimeout(r, 400));

    if (fixtureId) {
      const izler = await prisma.systemLog.findMany({
        where: { recordId: fixtureId },
        select: { action: true, newData: true, oldData: true, changes: true },
      });
      check(
        "yaşam döngüsü audit satırları doğdu (PROVISIONED + ROTATED)",
        izler.some((i) => i.action === "SUPERADMIN_PROVISIONED") &&
          izler.some((i) => i.action === "SUPERADMIN_ROTATED"),
        izler.map((i) => i.action).join(", ") || "—",
      );
      const yuk = JSON.stringify(izler);
      check(
        "audit yükünde HAM PAROLA yok",
        !yuk.includes(PAROLA_1) && !yuk.includes(PAROLA_2),
      );
      check(
        "audit yükünde PIN / TOTP sırrı yok",
        sirlar.every((s) => !yuk.includes(s)),
      );
      check(
        "audit yükünde GERÇEK kullanıcı adı yok (takma ad korunur)",
        !yuk.includes(FIXTURE_USERNAME),
        yuk.slice(0, 140),
      );
    }

    // Tüm `system_logs` — başka bir yol (örn. generic audit) sırrı yazmış olabilir.
    for (const s of sirlar) {
      const say = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM system_logs
        WHERE COALESCE("newData"::text,'') LIKE ${"%" + s + "%"}
           OR COALESCE("oldData"::text,'') LIKE ${"%" + s + "%"}
           OR COALESCE("changes"::text,'') LIKE ${"%" + s + "%"}`;
      check(`\`system_logs\` içinde sır geçmiyor (${s.slice(0, 4)}…)`, Number(say[0]?.n ?? 0) === 0);
    }

    // Dosya sistemi — script hiçbir şey YAZMAMALI.
    const scriptSrc = fs.readFileSync(path.join(__dirname, "superadmin-olustur.ts"), "utf8");
    check(
      "script hiçbir dosyaya YAZMIYOR (writeFile/appendFile/createWriteStream yok)",
      !/\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\s*\(/.test(scriptSrc),
    );
    const taranan = [
      path.join(KOK, ".env"),
      path.join(KOK, ".env.example"),
      path.join(KOK, "ecosystem.config.js"),
    ].filter((p) => fs.existsSync(p));
    check("körlük zemini: taranacak dosya bulundu", taranan.length >= 1, taranan.map((p) => path.basename(p)).join(", "));
    const dosyaIcerik = taranan.map((p) => fs.readFileSync(p, "utf8")).join("\n");
    check(
      "`.env` / `.env.example` / `ecosystem.config.js` sır TAŞIMIYOR",
      sirlar.every((s) => !dosyaIcerik.includes(s)) &&
        !dosyaIcerik.includes(PAROLA_1) &&
        !dosyaIcerik.includes(PAROLA_2),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== 6) `.env` DOĞUŞ YOLU GERÇEKTEN KALKTI ===");
  {
    const jobSrc = fs.readFileSync(path.join(SRC, "jobs", "superadmin.job.ts"), "utf8");
    check(
      "job dosyasında `SUPERADMIN_PASSWORD_HASH` GEÇMİYOR",
      !jobSrc.includes("SUPERADMIN_PASSWORD_HASH"),
    );
    for (const anahtar of ["SUPERADMIN_USERNAME", "SUPERADMIN_PIN", "SUPERADMIN_TOTP_SECRET", "SUPERADMIN_FORCE_SYNC"]) {
      check(`job dosyasında \`${anahtar}\` GEÇMİYOR`, !jobSrc.includes(anahtar));
    }
    check(
      "job `process.env`den satıcı değeri OKUMUYOR",
      !/env\.SUPERADMIN/.test(jobSrc),
    );
    // ⚠️ Job'un KORUNAN işi: kilit defterini tazeleme. Silinirse supap her
    // boot'ta açık kalırdı ve hiçbir test kırılmazdı.
    check(
      "job kilit defterini hâlâ tazeliyor (`setSystemAccountExists`)",
      /setSystemAccountExists\(/.test(jobSrc),
    );
    const envOrnek = path.join(KOK, ".env.example");
    if (fs.existsSync(envOrnek)) {
      const src = fs.readFileSync(envOrnek, "utf8");
      check(
        "`.env.example` artık SUPERADMIN_* satırı ÖNERMİYOR",
        !/SUPERADMIN_(USERNAME|PASSWORD_HASH|PIN|TOTP_SECRET|FORCE_SYNC)/.test(src),
      );
      check(
        "`.env.example` yeni yolu SÖYLÜYOR (`superadmin:kur`)",
        src.includes("superadmin:kur"),
      );
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(KOK, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    check(
      "`npm run superadmin:kur` script satırı var ve doğru dosyayı gösteriyor",
      (pkg.scripts?.["superadmin:kur"] ?? "").includes("superadmin-olustur.ts"),
      pkg.scripts?.["superadmin:kur"] ?? "—",
    );
    // Electron sözlüğü: iki yeni olayın Türkçesi.
    const etiketler = fs.readFileSync(
      path.join(KOK, "..", "Electron", "src", "lib", "audit-labels.ts"),
      "utf8",
    );
    for (const olay of ["SUPERADMIN_PROVISIONED", "SUPERADMIN_ROTATED"]) {
      check(`audit sözlüğünde \`${olay}\` Türkçesi var`, new RegExp(`${olay}:\\s*"`).test(etiketler));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== 7) TTY KAPISI — boru/dosya girdisinde GÜRÜLTÜLÜ düşer ===");
  {
    // ⚠️ ASIL RİSK DONMADIR, HATA DEĞİL. Bu yüzden ölçüm bir zaman aşımıyla
    // kurulur: kapı kaldırılırsa süreç cevap vermez ve sonda ❌ basar. Süreye
    // güvenen bir kontrol değil — kapı varken çıkış ANINDA olur (DB'ye hiç
    // gidilmez), yokken HİÇ olmaz; arada gri bölge yok.
    const BEKLEME_MS = 25_000;
    const scriptYolu = path.join(__dirname, "superadmin-olustur.ts");
    // ⚠️ `--rotate` İLE KOŞULUR ve bu SEÇİM ÖLÇÜLMÜŞTÜR. Bayraksız koşumda bu
    // noktada hesap ZATEN VAR (§2'nin fixture'ı) ve script hiç soru sormadan
    // "zaten kurulu" deyip 0 ile çıkar — yani kapı kaldırılsa bile donma OLMAZ
    // ve "DONMUYOR" kontrolü VAKUMEN YEŞİL kalırdı (sonda ile ölçüldü: kapı
    // silinince 3 ❌ geliyordu ama donma kontrolü yeşildi). `--rotate` SORU
    // SORAN yolu açar — arızanın gerçekleştiği yol.
    const tokenOnce = fixtureId
      ? (await prisma.user.findUnique({ where: { id: fixtureId }, select: { tokenVersion: true } }))
          ?.tokenVersion
      : undefined;
    const tsxBin = path.join(KOK, "node_modules", ".bin", "tsx");
    check("körlük zemini: `tsx` çalıştırılabiliri bulundu", fs.existsSync(tsxBin), tsxBin);

    const kosum = await new Promise<{ kod: number | null; cikti: string; asti: boolean }>(
      (resolve) => {
        // `stdin: "pipe"` + hemen `end()` = boru girdisi (TTY YOK). `ssh -t`siz
        // koşumun birebir aynısı.
        const cocuk = spawn(tsxBin, [scriptYolu, "--rotate"], {
          cwd: KOK,
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
        });
        let cikti = "";
        cocuk.stdout.on("data", (d: Buffer) => (cikti += d.toString("utf8")));
        cocuk.stderr.on("data", (d: Buffer) => (cikti += d.toString("utf8")));
        cocuk.stdin.end();
        const zamanlayici = setTimeout(() => {
          cocuk.kill("SIGKILL");
          resolve({ kod: null, cikti, asti: true });
        }, BEKLEME_MS);
        cocuk.on("close", (kod) => {
          clearTimeout(zamanlayici);
          resolve({ kod, cikti, asti: false });
        });
        cocuk.on("error", (e) => {
          clearTimeout(zamanlayici);
          resolve({ kod: null, cikti: cikti + String(e), asti: false });
        });
      },
    );

    check(
      "TTY'siz koşum DONMUYOR (süreç kendi kendine çıktı)",
      !kosum.asti,
      kosum.asti ? `${BEKLEME_MS / 1000}sn sonunda hâlâ bekliyordu — KAPI DÜŞMÜŞ` : "çıktı",
    );
    check(
      "TTY'siz koşum HATA ile çıkıyor (çıkış kodu 1)",
      kosum.kod === 1,
      `kod=${kosum.kod ?? "—"}`,
    );
    check(
      "hata metni ÇÖZÜMÜ söylüyor (`ssh -t` / `docker exec -it`)",
      /etkileşimli terminal/i.test(kosum.cikti) &&
        kosum.cikti.includes("ssh -t") &&
        kosum.cikti.includes("docker exec -it"),
      JSON.stringify(kosum.cikti.trim().slice(0, 160)),
    );
    const soruSoruldu = /Kullanıcı adı \[/.test(kosum.cikti) || /Parola/.test(kosum.cikti);
    check(
      "kapı DB'ye gitmeden kesiyor (soru sorulmadı)",
      !soruSoruldu,
      // ⚠️ Ayrıntı metni SONUCA bağlı: sabit "girdi okunmaya çalışılmadı" yazılırsa
      // kırmızı satır kendi kendini yalanlar (negatif sondada ölçüldü).
      soruSoruldu ? "SORU SORULDU — kapı geçilmiş" : "girdi okunmaya çalışılmadı",
    );
    check(
      "sistem hesabı sayısı DEĞİŞMEDİ (kapı yazma yapmadı)",
      (await prisma.user.count({ where: { isSystemAccount: true } })) <= 1,
    );
    if (fixtureId) {
      const tokenSonra = (
        await prisma.user.findUnique({ where: { id: fixtureId }, select: { tokenVersion: true } })
      )?.tokenVersion;
      check(
        "`--rotate` GERÇEKLEŞMEDİ (kapı her şeyden önce kesti)",
        tokenOnce !== undefined && tokenOnce === tokenSonra,
        `${tokenOnce} → ${tokenSonra}`,
      );
    }

    // `--help` KAPININ DIŞINDA: boruya basılabilmeli (meşru kullanım).
    const yardim = await new Promise<{ kod: number | null; cikti: string }>((resolve) => {
      const cocuk = spawn(tsxBin, [scriptYolu, "--help"], {
        cwd: KOK,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      let cikti = "";
      cocuk.stdout.on("data", (d: Buffer) => (cikti += d.toString("utf8")));
      cocuk.stderr.on("data", (d: Buffer) => (cikti += d.toString("utf8")));
      cocuk.stdin.end();
      const t = setTimeout(() => {
        cocuk.kill("SIGKILL");
        resolve({ kod: null, cikti });
      }, BEKLEME_MS);
      cocuk.on("close", (kod) => {
        clearTimeout(t);
        resolve({ kod, cikti });
      });
      cocuk.on("error", () => {
        clearTimeout(t);
        resolve({ kod: null, cikti });
      });
    });
    check(
      "`--help` boruda ÇALIŞIR (kapı soru soran yolun önünde, yardımın değil)",
      yardim.kod === 0 && yardim.cikti.includes("superadmin:kur"),
      `kod=${yardim.kod ?? "—"}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== 8) ÖLÜ `.env` SATIRI UYARISI — anahtar ADI evet, DEĞER asla ===");
  {
    // ⚠️ Anahtar adı ÇALIŞMA ANINDA kurulur: bu dosyada tam literal dursaydı
    // §6'nın "job dosyasında geçmiyor" ikizi olan taramalar zamanla bu bekçiye
    // de sızardı; ayrıca ölçüm gerçek ortam değişkeni üzerinden yapılmalı.
    const anahtar = ["SUPERADMIN", "PASSWORD", "HASH"].join("_");
    const SENTINEL = "sentinel-gizli-deger-9f2c";
    const eskiDeger = process.env[anahtar];
    process.env[anahtar] = SENTINEL;
    let cikti = "";
    const gercekWarn = console.warn;
    const gercekLog = console.log;
    console.warn = (...a: unknown[]): void => {
      cikti += a.join(" ") + "\n";
    };
    console.log = (...a: unknown[]): void => {
      cikti += a.join(" ") + "\n";
    };
    try {
      await ensureSuperadminAccount();
    } finally {
      console.warn = gercekWarn;
      console.log = gercekLog;
      if (eskiDeger === undefined) delete process.env[anahtar];
      else process.env[anahtar] = eskiDeger;
    }
    check("ölü ortam satırı UYARI üretiyor", /ARTIK KULLANILMAYAN/.test(cikti), cikti.trim().slice(0, 120));
    check("uyarı ANAHTAR ADINI basıyor", cikti.includes(anahtar));
    check(
      "uyarı DEĞERİ BASMIYOR (pm2 log'una sır yazılmaz)",
      !cikti.includes(SENTINEL),
      cikti.includes(SENTINEL) ? "SIR SIZDI" : "değer yok",
    );
    // Körlük zemini: satır YOKKEN uyarı da yok (her boot'ta bağıran uyarı
    // görmezden gelinir hale gelir).
    let temiz = "";
    const w2 = console.warn;
    const l2 = console.log;
    console.warn = (...a: unknown[]): void => {
      temiz += a.join(" ") + "\n";
    };
    console.log = (...a: unknown[]): void => {
      temiz += a.join(" ") + "\n";
    };
    try {
      await ensureSuperadminAccount();
    } finally {
      console.warn = w2;
      console.log = l2;
    }
    check(
      "ortam temizken uyarı YOK (gürültü değil, sinyal)",
      !/ARTIK KULLANILMAYAN/.test(temiz),
      temiz.trim().slice(0, 120),
    );
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (fixtureId) {
        await prisma.session.deleteMany({ where: { userId: fixtureId } });
        await prisma.workSession.deleteMany({ where: { userId: fixtureId } });
        await prisma.systemLog.deleteMany({ where: { userId: fixtureId } });
        await prisma.systemLog.deleteMany({ where: { recordId: fixtureId } });
        await prisma.userPermission.deleteMany({ where: { userId: fixtureId } });
        await prisma.user.delete({ where: { id: fixtureId } });
      }
      for (const p of pasifleşenler) {
        await prisma.user.update({
          where: { id: p.id },
          data: { isSystemAccount: true, fullName: p.fullName },
        });
      }
      await onarBayatDurum();
    } catch (e) {
      console.error("⚠️ temizlik başarısız:", e instanceof Error ? e.message : e);
      fail++;
    }
    __resetSystemAccountRegistryForTests();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
