// =============================================================================
// BEKÇİ — TİCARET BOOTSTRAP BETİĞİ (`scripts/setup-ticaret.ts`)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_setup_ticaret.ts
//
// NEDEN: Bu betik GERÇEK müşteri veritabanında koşmak için yazıldı ve bu yüzden
// `seed-ticaret-demo.ts`in DB-adı kapısını TAŞIMAZ. Geriye tek koruma kalıyor:
// "kuru anlatım tek bayt yazmaz" ve "uygulama idempotenttir" sözleşmesi. Bu
// sözleşme SESSİZ kırılır — dry-run bir gün yazmaya başlarsa hata çıkmaz, log
// çıkmaz; yalnız bir gün canlı bir kurulumda "ben sadece bakıyordum" diyen biri
// bayrağı açmış olur.
//
// ÖLÇÜLENLER:
//   §1 Ön kontroller yazma ÖNCESİ: olmayan kullanıcı → hata + SIFIR yazım
//   §2 KURU ANLATIM hiçbir şey yazmaz (önce/sonra sayımları BİREBİR)
//   §3 --apply uygular: bayraklar açık, izinler eklendi, varsayılan depo var
//   §4 Şablon merge DOĞRU: kullanıcının izin kümesi WEB_TRADE'i KAPSAR
//   §5 İDEMPOTENT: ikinci --apply koşumunda HER adım "atlandı"
//   §6 CLI onay kapısı: etkileşimsiz oturumda `--apply` (--yes YOK) → exit 1 + SIFIR yazım
//
// ── ÖLÇÜM HEDEFİ NEDEN "TEST KULLANICISININ İZİN SATIRLARI" ──────────────────
// §2'nin sondası (dry-run yazar hâle gelirse kırmızı) İZOLE bir çıpaya oturmalı:
// bu ağaç ve bu dev veritabanı EŞZAMANLI oturumlarla paylaşılıyor. Bayrak
// değerlerine ya da genel audit sayacına bakan bir kontrol, başka bir ajanın
// yazımıyla sahte kırmızı/yeşil verirdi. Testin kendi yarattığı kullanıcının
// `user_permissions` satırları yalnız bu teste aittir ve dry-run bozulursa
// 0 → 39 olur; ölçüm buradan yapılır.
//
// ── PAYLAŞILAN AYARLAR GERİ YÜKLENİR ─────────────────────────────────────────
// `--apply` `finance.enabled`/`finance.pricingEnabled`i AÇAR. Bunlar paylaşılan
// dev DB'sinin ayarlarıdır → `finally` bloğunda ÖNCEKİ değerlerine geri yazılır
// (emsal: `test_timed_permissions`). Cache de invalidate edilir, yoksa aynı
// süreçteki sonraki okuma bayat değeri görürdü.
//
// NEGATİF SONDALAR — ÜÇÜ de 2026-08-14'te koşuldu, ÜÇÜ de kırmızı verdi (ölçüm
// çıkış kodundan; her sonda `cp` yedeği + `shasum` ile birebir geri yüklendi):
//   ① dry-run YAZAR hâle getirilirse:
//      sed 's/} else if (!opts.apply) {/} else if (false) {/g'   → exit 1, 6 ❌
//      (§2b 0→39 izin yazıldı · §2c "yapıldı" · §2d 0/39 · §6a/§6b · §3b)
//   ② CLI onay kapısı (TTY reddi) düşerse:
//      sed 's/if (!process.stdin.isTTY) {/if (false) {/'         → exit 1, 1 ❌
//      (§6a exit=143 — çocuk süreç stdin'i bekleyip ASILDI, `timeout` yakaladı)
//   ③ yetki adımının "zaten var" atlaması düşerse (idempotentlik):
//      sed 's/if (missingIds.length === 0) {/if (false) {/'      → exit 1, 1 ❌
//      (§5a role:WEB_TRADE=yapıldı — ikinci koşum "atlandı" demedi)
// =============================================================================
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import {
  invalidateFeatureFlagsCache,
  SETTING_KEYS,
} from "../src/services/system-setting.service";
import {
  runTicaretSetup,
  parseArgs,
  SetupTicaretError,
  TRADE_TEMPLATE_CODE,
  type SetupReport,
} from "./setup-ticaret";

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

const USERNAME = `TEST-SETUP-TIC-${Date.now()}`;

/** Adımın raporda gerçekten bulunduğunu da doğrular — anahtar yeniden adlandırılırsa
 *  `undefined === "atlandı"` sessizce false döner, ama sebebi görünmez olurdu. */
function statusOf(r: SetupReport, key: string): string {
  const s = r.steps.find((x) => x.key === key);
  return s ? s.status : `(ADIM YOK: ${key})`;
}

/** İzole çıpa: yalnız bu testin kullanıcısına ait satırlar. */
async function permCount(userId: string): Promise<number> {
  return prisma.userPermission.count({ where: { userId } });
}

async function main(): Promise<void> {
  console.log("=== Ticaret bootstrap betiği bekçisi ===\n");

  const template = await prisma.permissionTemplate.findUnique({
    where: { code: TRADE_TEMPLATE_CODE },
    select: { isActive: true, permissions: { select: { permission: { select: { code: true } } } } },
  });
  if (!template) {
    // Testin ölçtüğü şeyin ön koşulu; sessizce atlamak "yeşil ama hiçbir şey
    // ölçülmedi" demek olurdu (körlük zemini).
    console.error(
      `❌ ${TRADE_TEMPLATE_CODE} şablonu bu DB'de yok — backend bir kez açılıp rol ` +
        "uzlaştırmasını koşturmalı. Test ölçüm yapamaz.",
    );
    process.exit(1);
  }
  const templateCodes = template.permissions.map((p) => p.permission.code).sort();
  check(
    "§0 Ön koşul: WEB_TRADE şablonu aktif ve dolu",
    template.isActive && templateCodes.length >= 20,
    `${templateCodes.length} izin`,
  );

  // Paylaşılan ayarların ÖNCEKİ hâli — finally'de geri yazılır.
  // ⚠️ Modül anahtarları da bu listede: `--apply` artık ticaret+iplik
  // şalterlerini de açıyor ve bunlar paylaşılan dev DB'sinin ayarlarıdır →
  // `finally` bloğu hepsini ÖNCEKİ değerine geri yazar.
  const FLAG_KEYS = [
    SETTING_KEYS.FINANCE_ENABLED,
    SETTING_KEYS.FINANCE_PRICING_ENABLED,
    SETTING_KEYS.TICARET_ENABLED,
    SETTING_KEYS.IPLIK_ENABLED,
  ];
  const savedRows = await prisma.systemSetting.findMany({
    where: { key: { in: FLAG_KEYS } },
    select: { key: true, value: true },
  });
  const saved = new Map(savedRows.map((r) => [r.key, r.value]));

  const user = await prisma.user.create({
    data: { username: USERNAME, passwordHash: "TEST-NO-LOGIN", fullName: "TEST Ticaret Kurulum" },
    select: { id: true },
  });
  const uid = user.id;

  try {
    // ── §1 ÖN KONTROLLER YAZMA ÖNCESİ ─────────────────────────────────────
    const whBefore = await prisma.warehouse.count();
    let threw = false;
    try {
      await runTicaretSetup({ username: `${USERNAME}-YOK`, apply: true });
    } catch (e) {
      threw = e instanceof SetupTicaretError;
    }
    check("§1a Olmayan kullanıcı → SetupTicaretError", threw);
    check(
      "§1b Ön kontrol düşünce depo YARATILMADI",
      (await prisma.warehouse.count()) === whBefore,
      `depo ${whBefore}`,
    );

    // ── §2 KURU ANLATIM YAZMAZ ────────────────────────────────────────────
    const permBefore = await permCount(uid);
    check("§2a Başlangıç: test kullanıcısının izni yok", permBefore === 0);

    const dry = await runTicaretSetup({ username: USERNAME, apply: false });
    const permAfterDry = await permCount(uid);
    check(
      "§2b KURU ANLATIM tek satır izin YAZMADI",
      permAfterDry === permBefore,
      `${permBefore} → ${permAfterDry}`,
    );
    check(
      "§2c KURU ANLATIM yetki adımını 'yapılacak' der (yapmaz)",
      statusOf(dry, "role:WEB_TRADE") === "yapılacak",
      statusOf(dry, "role:WEB_TRADE"),
    );
    check(
      "§2d KURU ANLATIM eksik izinleri ADIYLA listeler",
      dry.missingPermissionCodes.length === templateCodes.length,
      `${dry.missingPermissionCodes.length}/${templateCodes.length}`,
    );
    check("§2e Rapor apply=false işaretli", dry.apply === false);
    check(
      "§2f Rapor bağlanılan veritabanını taşır (onay ekranının çıpası)",
      dry.database.length > 0,
      dry.database,
    );

    // ── §6 CLI ONAY KAPISI (etkileşimsiz oturumda --yes ŞART) ─────────────
    // Bu dal SÜREÇ olarak koşulur: kapı `main()`de yaşıyor ve `runTicaretSetup`
    // çağrılarak ölçülemez. Ölçüm ÇIKIŞ KODUNDAN + yazım olmamasından.
    //
    // ⚠️ `timeout` LOAD-BEARING (negatif sondayla ölçüldü): TTY reddi kaldırılırsa
    // çocuk süreç `readline.question` ile stdin'i bekler ve SONSUZA KADAR ASILIR.
    // O hâlde test kırmızı vermez, ASILIR — koşucunun 180 sn SIGTERM'i "zaman
    // aşımı" der ama tek bir ❌ basılmaz (en sessiz kırmızı). Zaman aşımı,
    // `status` yerine `signal` döndürür → `cliExit` 1 OLMAZ ve kontrol kırmızıya
    // döner. Bu satırı silme.
    let cliExit: number | string = 0;
    try {
      execFileSync("npx", ["tsx", join(__dirname, "setup-ticaret.ts"), "--user", USERNAME, "--apply"], {
        cwd: join(__dirname, ".."),
        stdio: "pipe",
        // stdin borudur → isTTY false → betik onay alamadığını söyleyip çıkmalı.
        timeout: 60_000,
      });
    } catch (e) {
      const err = e as { status?: number | null; signal?: string | null };
      cliExit = err.status ?? (err.signal ? `signal:${err.signal}` : -1);
    }
    check("§6a --apply (--yes YOK, TTY YOK) → exit 1", cliExit === 1, `exit=${cliExit}`);
    check(
      "§6b Onaysız koşum tek satır izin YAZMADI",
      (await permCount(uid)) === 0,
      `${await permCount(uid)}`,
    );

    // ── §3 UYGULAMA ───────────────────────────────────────────────────────
    const applied = await runTicaretSetup({ username: USERNAME, apply: true });
    check("§3a Rapor apply=true işaretli", applied.apply === true);
    check(
      "§3b Yetki adımı 'yapıldı'",
      statusOf(applied, "role:WEB_TRADE") === "yapıldı",
      statusOf(applied, "role:WEB_TRADE"),
    );
    check(
      "§3c Uygulama sonrası EKSİK izin kalmadı",
      applied.missingPermissionCodes.length === 0,
      `${applied.missingPermissionCodes.length} eksik`,
    );

    const flagRows = await prisma.systemSetting.findMany({
      where: { key: { in: FLAG_KEYS } },
      select: { key: true, value: true },
    });
    const flagMap = new Map(flagRows.map((r) => [r.key, r.value]));
    check(
      "§3d finance.enabled AÇIK",
      flagMap.get(SETTING_KEYS.FINANCE_ENABLED) === true,
      String(flagMap.get(SETTING_KEYS.FINANCE_ENABLED)),
    );
    check(
      "§3e finance.pricingEnabled AÇIK",
      flagMap.get(SETTING_KEYS.FINANCE_PRICING_ENABLED) === true,
      String(flagMap.get(SETTING_KEYS.FINANCE_PRICING_ENABLED)),
    );
    check(
      "§3d2 ticaret.enabled AÇIK",
      flagMap.get(SETTING_KEYS.TICARET_ENABLED) === true,
      String(flagMap.get(SETTING_KEYS.TICARET_ENABLED)),
    );
    // ⚠️ İplik ticarete BAĞIMLI: bu satır aynı zamanda adım SIRASININ ölçümüdür.
    // Ters sırada ilk `setFeatureFlags` çağrısı 400 `MODULE_DEPENDENCY` alırdı.
    check(
      "§3e2 iplik.enabled AÇIK (ticaretten SONRA açıldı)",
      flagMap.get(SETTING_KEYS.IPLIK_ENABLED) === true,
      String(flagMap.get(SETTING_KEYS.IPLIK_ENABLED)),
    );
    const def = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { code: true } });
    check("§3f Varsayılan depo var", def !== null, def?.code ?? "(yok)");

    // ── §4 MERGE DOĞRU: kullanıcı kümesi ŞABLONU KAPSAR ───────────────────
    const ownedCodes = (
      await prisma.userPermission.findMany({
        where: { userId: uid },
        select: { permission: { select: { code: true } } },
      })
    ).map((r) => r.permission.code);
    const ownedSet = new Set(ownedCodes);
    const notCovered = templateCodes.filter((c) => !ownedSet.has(c));
    check(
      "§4a Kullanıcının izinleri WEB_TRADE kümesini KAPSAR",
      notCovered.length === 0,
      notCovered.length ? notCovered.join(", ") : `${ownedCodes.length} izin`,
    );
    // Merge FAZLA yazmamalı: yeni kullanıcıda küme birebir şablon kadardır.
    check(
      "§4b Merge şablon dışına izin YAZMADI",
      ownedCodes.length === templateCodes.length,
      `${ownedCodes.length} = ${templateCodes.length}`,
    );
    // Ticaret personasının anahtar izinleri — şablon içeriği sessizce daralırsa
    // (biri listeden düşerse) kurulum "başarılı" der, ekran açılmaz.
    for (const code of ["goods-receipt:read", "warehouse:read", "finance:read", "report:finance"]) {
      check(`§4c '${code}' kullanıcıda`, ownedSet.has(code));
    }

    // ── §5 İDEMPOTENTLİK ──────────────────────────────────────────────────
    const permAfterFirst = await permCount(uid);
    const again = await runTicaretSetup({ username: USERNAME, apply: true });
    const allSkipped = again.steps.every((s) => s.status === "atlandı");
    check(
      "§5a İkinci --apply: HER adım 'atlandı'",
      allSkipped,
      again.steps.map((s) => `${s.key}=${s.status}`).join(" · "),
    );
    check(
      "§5b İkinci koşum yeni izin satırı DOĞURMADI",
      (await permCount(uid)) === permAfterFirst,
      `${permAfterFirst} → ${await permCount(uid)}`,
    );
    check("§5c İkinci koşumda eksik izin yok", again.missingPermissionCodes.length === 0);

    // ── CLI argüman ayrıştırma (küçük ama sessiz kırılır) ──────────────────
    const a1 = parseArgs(["--user", "ali", "--apply"]);
    check("§7a --user + --apply okunur", a1.username === "ali" && a1.apply && !a1.yes);
    const a2 = parseArgs(["--user", "--apply"]);
    check(
      "§7b Değersiz --user bayrağı sonraki BAYRAĞI değer sanmaz",
      a2.username === null && a2.apply,
      String(a2.username),
    );
    const a3 = parseArgs(["--user", "veli", "--apply", "--yes", "--actor", "admin"]);
    check("§7c --yes + --actor okunur", a3.yes && a3.actorUsername === "admin");
  } finally {
    // Ayarları geri yaz (yoktu → sil; vardı → eski değer). Cache invalidate:
    // aynı süreçteki sonraki okuma bayat değeri görmesin.
    // ⚠️ Geri yükleme hatası YUTULMAZ, UYARI basar: sessizce yutulursa paylaşılan
    // dev DB'sinde bayrak AÇIK kalır ve bir sonraki oturum sebebini bulamaz.
    // `upsert` — satır bu arada silinmişse yeniden doğar (`update` P2025 verirdi).
    for (const key of FLAG_KEYS) {
      const v = saved.get(key);
      try {
        if (v === undefined) {
          await prisma.systemSetting.deleteMany({ where: { key } });
        } else {
          await prisma.systemSetting.upsert({
            where: { key },
            update: { value: v as never },
            create: { key, value: v as never },
          });
        }
      } catch (e) {
        console.warn(`⚠️ Ayar geri yüklenemedi: ${key} — ${(e as Error).message}`);
      }
    }
    invalidateFeatureFlagsCache();

    // FK sırası: sessions → user_permissions → system_logs → user.
    await prisma.session.deleteMany({ where: { userId: uid } }).catch(() => {});
    await prisma.userPermission.deleteMany({ where: { userId: uid } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { userId: uid } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: uid } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Beklenmeyen hata:", e);
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
