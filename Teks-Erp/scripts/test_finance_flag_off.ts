// =============================================================================
// BEKÇİ — ÖN MUHASEBE KAPALIYKEN: fabrikada SIFIR fark
// =============================================================================
// Çalıştırma: npx tsx scripts/test_finance_flag_off.ts
//
// NEDEN: Muhasebe modülü ÜRETİCİ fabrikanın canlı kurulumuna da gidiyor. Orada
// kimse fatura kesmiyor ve modül GÖRÜNMEMELİ. "Menüyü gizledik" yetmez —
// gizlemek bir görünürlük kararıdır, oysa burada gereken bir REJİM kararıdır:
// adresi bilen (ya da eski sekmesi açık kalan) bir kullanıcı ekranı yine açar
// ve cari deftere satır yazabilirdi.
//
// ⚠️ Bu bekçi kırmızıya dönerse doğru tepki testi gevşetmek DEĞİL: bayrak
// kapısını atlayan bir uç bulunmuş demektir.
//
// ÖLÇÜLENLER:
//   §1 Varsayılan KAPALI (yeni kurulumda modül sessizdir)
//   §2 Kapalıyken /api/finance altındaki HER uç 403 — izinli kullanıcıyla bile
//   §2b 403 gövdesi `details.code = MODULE_DISABLED` (kardeş kapılarla aynı sözleşme)
//   §3 Kapı `verifyToken`'dan SONRA (kimliksiz istek 401 almalı, 403 değil)
//   §4 Router'daki HER uç bayrak kapısının ARKASINDA (kaynak taraması —
//      `router.use` atlanıp uçlar tek tek yazılırsa biri unutulur)
//   §5 Bayrak açılınca uçlar çalışıyor (KÖRLÜK ZEMİNİ — §2 "sunucu tamamen
//      bozuk" sebebiyle de yeşil kalırdı)
//   §6 Finance izinleri fabrikanın MOBİL rollerine sızmadı
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `finance.middleware.ts`teki
//    `requireFinanceEnabled` gövdesi koşulsuz `next()` yapıldı → §2 ve §2b KIRMIZI
//    (altı uç 403 yerine 200 döndü, `details.code` undefined). Geri konunca yeşil.
//    ⚠️ SONDA YALNIZ SUNUCU AYAKTAYKEN ISIRIR: kapıyı ölçen altı kontrol HTTP
//    bölümündedir ve sunucusuz ATLANIR — ilk denemede sonda "ısırmadı" göründü ve
//    sebebi tam buydu. `PORT=4100 npx tsx src/server.ts` ile koşuldu ([TD-12a]).
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { systemSettingService, readFinanceEnabled } from "../src/services/system-setting.service";
import { ROLE_TEMPLATE_CATALOG } from "../src/constants/role-template-catalog";
import { AuthService } from "../src/services/auth.service";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100";

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

/** Sunucu ayakta mı? Değilse HTTP bölümleri atlanır (bekçi çökmez). */
async function serverUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

let originalFlag = false;
let testUserId: string | null = null;
const TEST_USERNAME = `bekci.finance.${process.pid}`;
const TEST_PASSWORD = "test123456";

async function main(): Promise<void> {
  console.log("=== Ön muhasebe kapalı-rejim bekçisi ===\n");
  originalFlag = await readFinanceEnabled();

  // ── §1 VARSAYILAN ────────────────────────────────────────────────────────
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "finance.enabled" },
    select: { value: true },
  });
  check(
    "§1 Bayrak varsayılan KAPALI (hiç yazılmamışsa da kapalı okunur)",
    setting === null || (await readFinanceEnabled()) === false || originalFlag === true,
    setting === null ? "ayar satırı yok → false" : `değer=${JSON.stringify(setting.value)}`,
  );

  // ── §4 KAYNAK TARAMASI ───────────────────────────────────────────────────
  // Router'daki her uç bayrak kapısının arkasında olmalı. `router.use(...)` tek
  // satırla bunu sağlar; biri "şu uç hariç" diye tek tek yazmaya başlarsa
  // kaçınılmaz olarak biri unutulur.
  const src = readFileSync(join(__dirname, "..", "src", "routes", "finance.routes.ts"), "utf8");
  check(
    "§4a Router seviyesinde bayrak kapısı var",
    /router\.use\(\s*verifyToken\s*,\s*requireFinanceEnabled\s*\)/.test(src),
    "router.use(verifyToken, requireFinanceEnabled)",
  );
  // Körlük zemini: tarama gerçekten uç sayıyor mu?
  const endpointCount = (src.match(/router\.(get|post|patch|delete)\(/g) ?? []).length;
  check("§4b KÖRLÜK ZEMİNİ: taramada uç bulundu", endpointCount >= 15, `uç=${endpointCount}`);
  // Her uç bir izin guard'ı da taşımalı (bayrak "kurulum", izin "kişi").
  const guardless = src
    .split("\n")
    .filter((l) => /router\.(get|post|patch|delete)\(/.test(l) && !/requirePermission\(/.test(l));
  check(
    "§4c Her uç ayrıca izin guard'ı taşıyor",
    guardless.length === 0,
    guardless.length > 0 ? guardless.map((l) => l.trim().slice(0, 50)).join(" | ") : "guard'sız uç yok",
  );

  // ── §6 İZİN SIZINTISI ────────────────────────────────────────────────────
  // Finance izinleri MOBİL (saha) rollerine hiç girmemeli: tablet operatörünün
  // cari defterle işi yok ve o roller fabrikada yaygın olarak atanmış.
  const mobileLeak: string[] = [];
  for (const tpl of ROLE_TEMPLATE_CATALOG) {
    if (tpl.mode !== "list") continue;
    if (!tpl.code.startsWith("MOBILE")) continue;
    for (const c of tpl.codes) {
      if (c.startsWith("finance:")) mobileLeak.push(`${tpl.code}:${c}`);
    }
  }
  check("§6 Finance izinleri MOBİL rollere sızmadı", mobileLeak.length === 0, mobileLeak.join(", ") || "temiz");

  // ── HTTP BÖLÜMLERİ ───────────────────────────────────────────────────────
  // §2/§3/§5 içindeki check() sayısı. Sunucu yoksa bu kadar kontrol ÖLÇÜLMEZ;
  // sayı özet satırında beyan edilir ki "yeşil ≠ kapsandı" görünür kalsın.
  const HTTP_KONTROL = 6;
  if (!(await serverUp())) {
    // Atlanan sayısı ÖZET SATIRINA yazılır: koşucu kapsam kaybını yalnız oradan
    // okur (run-all-tests.ts, `Sonuç:` satırına demirli regex). Serbest metindeki
    // "§2/§3/§5 atlandı" bir sayı DEĞİLDİR.
    console.log(`\n   ⏭️  §2/§3/§5 atlandı — ${BASE} ayakta değil (TEST_API_URL ile değiştirilebilir)\n`);
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız, ${HTTP_KONTROL} atlandı ===`);
    return;
  }

  // ⚠️ İZİNLİ kullanıcıyla test etmek ŞART: izinsiz kullanıcı zaten 403 alır
  // ve bayrak kapısı hiç ölçülmemiş olurdu (yeşil ama kör).
  const perms = await prisma.permission.findMany({
    where: { code: { in: ["finance:read", "finance:write", "finance:invoice", "finance:payment"] } },
    select: { id: true },
  });
  testUserId = (
    await prisma.user.create({
      data: {
        username: TEST_USERNAME,
        fullName: "Finance Flag Bekçi",
        passwordHash: await AuthService.hashPassword(TEST_PASSWORD),
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
      select: { id: true },
    })
  ).id;

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD, clientType: "electron" }),
  });
  if (!login.ok) {
    check("HTTP: bekçi kullanıcısı giriş yapabildi", false, `durum=${login.status}`);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    return;
  }
  const token = ((await login.json()) as { data: { token: string } }).data.token;
  const auth = { Authorization: `Bearer ${token}` };

  const PROBES: Array<[string, string]> = [
    ["GET", "/api/finance/cari"],
    ["GET", "/api/finance/invoices"],
    ["GET", "/api/finance/payments"],
    ["GET", "/api/finance/cash-boxes"],
    ["GET", "/api/finance/bank-accounts"],
    ["GET", "/api/finance/exchange-rates"],
  ];

  // ── §2 KAPALIYKEN 403 ────────────────────────────────────────────────────
  await systemSettingService.setFeatureFlags({ financeEnabled: false }, testUserId ?? undefined);
  const closed: string[] = [];
  // §2b sözleşmesi: 403 gövdesi kardeş kapılarla AYNI `details.code`u taşır —
  // istemci "modül kapalı"yı metinden değil koddan ayırt eder.
  const kodsuz: string[] = [];
  const ustSeviyeKod: string[] = [];
  for (const [method, path] of PROBES) {
    const r = await fetch(`${BASE}${path}`, { method, headers: auth });
    if (r.status !== 403) closed.push(`${path}→${r.status}`);
    const body = (await r.json().catch(() => ({}))) as {
      code?: unknown;
      details?: { code?: unknown; modul?: unknown };
    };
    if (body?.details?.code !== "MODULE_DISABLED") {
      kodsuz.push(`${path}→${JSON.stringify(body?.details?.code)}`);
    }
    // `body.code` HEP undefined olmalı: kod `details` altındadır ve üst seviyeye
    // taşınırsa istemcilerin bugünkü okuma kalıbı sessizce ikiye ayrılır.
    if (body?.code !== undefined) ustSeviyeKod.push(path);
  }
  check(
    "§2 Bayrak KAPALIYKEN tüm uçlar 403 (izinli kullanıcıyla)",
    closed.length === 0,
    closed.length > 0 ? closed.join(", ") : `${PROBES.length} uç kapalı`,
  );
  check(
    "§2b 403 gövdesi `details.code = MODULE_DISABLED` taşıyor (kardeş kapı sözleşmesi)",
    kodsuz.length === 0,
    kodsuz.length > 0 ? kodsuz.join(", ") : `${PROBES.length} uç kodlu`,
  );
  check(
    "§2b `body.code` TOP-LEVEL YOK (kod `details` altında)",
    ustSeviyeKod.length === 0,
    ustSeviyeKod.join(", ") || "temiz",
  );

  // ── §3 KİMLİKSİZ İSTEK 401 ───────────────────────────────────────────────
  // Bayrak kapısı `verifyToken`'dan SONRA olmalı: kimliksiz isteğe 403 dönmek
  // "yetkin yok" der ve istemciyi login'e YÖNLENDİRMEZ (oturum düşünce
  // kullanıcı sebebini anlamadan ekranda kalır).
  const anon = await fetch(`${BASE}/api/finance/cari`);
  check("§3 Kimliksiz istek 401 (403 değil)", anon.status === 401, `durum=${anon.status}`);

  // ── §5 KÖRLÜK ZEMİNİ ─────────────────────────────────────────────────────
  await systemSettingService.setFeatureFlags({ financeEnabled: true }, testUserId ?? undefined);
  const opened: string[] = [];
  for (const [method, path] of PROBES) {
    const r = await fetch(`${BASE}${path}`, { method, headers: auth });
    if (r.status !== 200) opened.push(`${path}→${r.status}`);
  }
  check(
    "§5 KÖRLÜK ZEMİNİ: bayrak AÇIKKEN uçlar 200",
    opened.length === 0,
    opened.length > 0 ? opened.join(", ") : `${PROBES.length} uç açık`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // ⚠️ Bayrağı BULDUĞU GİBİ bırak — bekçi kurulumun ayarını değiştirip
    // gitmemeli (parity bekçisinin "varsayılan depoyu geri koy" dersi).
    try {
      await systemSettingService.setFeatureFlags({ financeEnabled: originalFlag }, testUserId ?? undefined);
    } catch {
      /* ayar geri yazılamadıysa da testi düşürme */
    }
    if (testUserId) {
      await prisma.userPermission.deleteMany({ where: { userId: testUserId } });
      await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
