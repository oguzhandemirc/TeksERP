// =============================================================================
// Test: Servis keşfi — kurulum kimliği + kimlik ucunun sözleşmesi (2026-08-26)
// Çalıştır: npx tsx scripts/test_discovery_identity.ts
// =============================================================================
// NEDEN: keşif özelliğinin tamamı üç sessiz varsayıma dayanıyor ve üçü de
// kırıldığında HİÇBİR hata vermez, yalnız yanlış davranır:
//
//  1) Kimlik BİR KEZ üretilir ve bir daha DEĞİŞMEZ. Her boot'ta yenilenirse
//     sahadaki her cihaz her restart'tan sonra "bu farklı bir sunucu" uyarısı
//     alır; operatör onu ezberden geçer ve koruma değersizleşir.
//  2) `/health`in alan kümesi DONMUŞTUR. Kimliği oraya eklemek cazip ama o ucun
//     dört tüketicisi var (deploy/kur.ps1 `Saglik`, public/status.js, Electron
//     `useServerClock` + `ApiEndpointDialog`). Bu bekçi kümeyi kilitler.
//  3) Kimlik ucu DB'YE DOKUNMAZ. Backend'de rate limiter yok ve alt ağ taraması
//     yapan istemciler bu ucu sık çağıracak; ayrıca Postgres düştüğünde keşif
//     çalışmaya devam etmeli. Bir `await prisma...` eklemek bunu sessizce iptal eder.
//
// Körlük zemini: kaynak taramaları gerçekten bir şey bulmuş olmalı. Dosya taşınır
// ya da regex kayarsa "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile çıkar.
//
// NEGATİF SINAMA KAYDI (2026-08-26) — üçü de ölçüldü, dosyalar sonra birebir
// geri yüklendi (`diff -q`):
//   • `/health` yanıtına `uptime: 42` eklendi           → §4 KIRMIZI (1 hata)
//   • route handler'ına `void prisma.systemSetting;`    → §5 KIRMIZI (1 hata)
//   • `ensureInstallationIdentity` her çağrıda yenilendi → §1 KIRMIZI (2 hata)
// ⚠️ Sondayı `/health`e yerleştirirken çıpaya dikkat: `api: "UP"` ve
// `message: "TeksERP API is running."` metinleri `buildRichHealth` içinde DE
// geçiyor; çıpasız bir `s///` sondayı yanlış fonksiyona yazar ve bekçi haklı
// olarak yeşil kalır ("sonda ateşlemedi" ≠ "bekçi kör").
// =============================================================================
import { readFileSync } from "fs";
import { resolve } from "path";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import {
  ensureInstallationIdentity,
  __resetInstallationIdentityForTests,
} from "../src/jobs/installation-identity.job";
import {
  buildDiscoveryIdentity,
  __resetDiscoveryCacheForTests,
} from "../src/services/discovery.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const SRC = resolve(__dirname, "../src");

/** `/health` yanıtının DONMUŞ alan kümesi. Değiştirmeden önce yukarıdaki 2. maddeyi oku. */
const FROZEN_HEALTH_FIELDS = ["status", "message", "api", "db", "version", "time"].sort();

/** Kimlik yükünün DONMUŞ alan kümesi. */
const IDENTITY_FIELDS = [
  "product",
  "discoveryVersion",
  "installationId",
  "serverName",
  "companyName",
  "version",
  "protocol",
  "apiPort",
  "apiBasePath",
  "time",
].sort();

/**
 * Kimlik ucuna ASLA girmemesi gereken alanlar — hepsi `buildRichHealth`in işi ve
 * orası `admin:settings` arkasında. Kimliksiz bir uçtan sızmamalılar.
 */
const FORBIDDEN_IN_IDENTITY = [
  "db",
  "dbSizeBytes",
  "dbConnections",
  "lanAddresses",
  "lastBackup",
  "auditGuard",
  "presence",
  "pool",
  "diskFreeBytes",
  "error",
];

/** `/health` bloğundaki `res.status(200).json({...})` anahtarlarını çıkarır. */
function extractHealthFields(source: string): string[] {
  const at = source.indexOf('app.get("/health"');
  if (at < 0) return [];
  const jsonAt = source.indexOf("res.status(200).json({", at);
  if (jsonAt < 0) return [];
  const open = source.indexOf("{", jsonAt + "res.status(200).json(".length);
  const close = source.indexOf("});", open);
  if (open < 0 || close < 0) return [];
  const body = source.slice(open + 1, close);
  // ⚠️ `[:,]` — `db` KISAYOL yazımıyla duruyor (`db,` — `db: db` değil). Yalnız
  // `ad:` arayan bir regex onu sessizce kaçırır ve küme eksik çıkar; bu bekçinin
  // ilk yazımında tam olarak bu oldu.
  return [...body.matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[:,]/gm)].map((m) => m[1]).sort();
}

/**
 * Yorumları sıyırır. Kaynak taraması yapan bekçiler yorumdaki örnek kodu ihlal
 * sanar — bu dosyanın ilk koşumunda `discovery.routes.ts`'in "buraya `await
 * prisma...` ekleme" uyarısı tam da yasakladığı deseni tetikledi.
 * Satır yorumları YALNIZ satır başında sıyrılır (satır ortasındaki `http://`
 * kodun parçası olabilir).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * NEGATİF SINAMA yardımcısı: bir nesnenin yasaklı alan taşıyıp taşımadığını söyler.
 * Aynı yardımcı hem gerçek yükte hem kasten kirletilmiş bir nesnede koşturulur —
 * ikincisi, kontrolün DÜŞEBİLDİĞİNİN kanıtıdır (yoksa kontrol süstür).
 */
function forbiddenKeysIn(obj: Record<string, unknown>): string[] {
  return FORBIDDEN_IN_IDENTITY.filter((k) => Object.prototype.hasOwnProperty.call(obj, k));
}

async function main(): Promise<void> {
  const key = SETTING_KEYS.SYSTEM_INSTALLATION_ID;
  // Testin kendi yarattığı satırı sonda geri koyabilmek için mevcut değeri sakla.
  const before = await prisma.systemSetting.findUnique({ where: { key } });

  try {
    // -----------------------------------------------------------------------
    // §1 — Kimlik idempotansı: iki çağrı AYNI kimliği vermeli
    // -----------------------------------------------------------------------
    __resetInstallationIdentityForTests();
    const first = await ensureInstallationIdentity();
    __resetInstallationIdentityForTests(); // bellek cache'ini boşalt → gerçekten DB'den okusun
    const second = await ensureInstallationIdentity();

    check(
      "§1 kimlik iki çağrıda AYNI (her boot'ta yenilenmiyor)",
      first.installationId === second.installationId,
      `${first.installationId} / ${second.installationId}`,
    );
    check(
      "§1 kimlik uuid v4 şeklinde",
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        first.installationId,
      ),
      first.installationId,
    );
    check(
      "§1 doğuş anı korunuyor (ikinci okumada değişmedi)",
      first.createdAt === second.createdAt,
      first.createdAt,
    );

    // -----------------------------------------------------------------------
    // §2 — Bozuk değer: yeniden üretilir (sessiz kalmaz)
    // -----------------------------------------------------------------------
    await prisma.systemSetting.update({
      where: { key },
      data: { value: { bozuk: "veri" } as unknown as object },
    });
    __resetInstallationIdentityForTests();
    const regenerated = await ensureInstallationIdentity();
    check(
      "§2 bozuk kayıt yeni kimlikle onarıldı",
      regenerated.installationId !== first.installationId &&
        /^[0-9a-f-]{36}$/i.test(regenerated.installationId),
      regenerated.installationId,
    );

    // -----------------------------------------------------------------------
    // §3 — Kimlik yükü: alan kümesi + senkronluk + yasaklı alan yok
    // -----------------------------------------------------------------------
    __resetDiscoveryCacheForTests();
    const payload = buildDiscoveryIdentity();

    check(
      "§3 yük SENKRON (Promise değil — uç DB'ye dokunmuyor)",
      typeof (payload as unknown as { then?: unknown }).then !== "function",
      typeof payload,
    );
    check(
      "§3 alan kümesi birebir dondurulmuş liste",
      JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(IDENTITY_FIELDS),
      Object.keys(payload).sort().join(","),
    );
    check(
      "§3 yasaklı (operasyonel) alan taşımıyor",
      forbiddenKeysIn(payload as unknown as Record<string, unknown>).length === 0,
      forbiddenKeysIn(payload as unknown as Record<string, unknown>).join(",") || "temiz",
    );
    check(
      "§3 kimlik gerçekten dolu (cache bağlandı)",
      payload.installationId === regenerated.installationId,
      String(payload.installationId),
    );

    // NEGATİF SINAMA: aynı denetim, kasten kirletilmiş nesnede DÜŞMELİ.
    const dirty = { ...payload, dbSizeBytes: 123, lanAddresses: ["10.0.0.1"] };
    check(
      "§3b NEGATİF: kirletilmiş yükte yasaklı alan YAKALANIYOR",
      forbiddenKeysIn(dirty as unknown as Record<string, unknown>).length === 2,
      forbiddenKeysIn(dirty as unknown as Record<string, unknown>).join(","),
    );

    // -----------------------------------------------------------------------
    // §4 — `/health` alan kümesi DONMUŞ (kaynak taraması)
    // -----------------------------------------------------------------------
    const appSrc = readFileSync(resolve(SRC, "app.ts"), "utf8");
    const healthFields = extractHealthFields(appSrc);
    check(
      "§4 körlük zemini: /health bloğu bulundu ve alan çıkarıldı",
      healthFields.length >= 6,
      `${healthFields.length} alan: ${healthFields.join(",")}`,
    );
    check(
      "§4 /health alan kümesi DEĞİŞMEMİŞ (kimlik oraya sızmadı)",
      JSON.stringify(healthFields) === JSON.stringify(FROZEN_HEALTH_FIELDS),
      healthFields.join(","),
    );

    // -----------------------------------------------------------------------
    // §5 — Uç DB'siz ve MOUNT edilmiş
    // -----------------------------------------------------------------------
    const routeSrc = readFileSync(resolve(SRC, "routes/discovery.routes.ts"), "utf8");
    const routeCode = stripComments(routeSrc);
    check(
      "§5 körlük zemini: route dosyası okundu",
      routeSrc.length > 500,
      `${routeSrc.length} bayt`,
    );
    // Yorumlar sıyrıldıktan sonra GERÇEK kod hâlâ duruyor olmalı — aksi halde
    // "prisma yok" iddiası boş bir metin üzerinde vakumen doğru çıkardı.
    check(
      "§5 körlük zemini: yorum sıyrıldıktan sonra kod duruyor",
      routeCode.includes("router.get") && routeCode.includes("buildDiscoveryIdentity"),
      `${routeCode.replace(/\s+/g, " ").trim().length} bayt kod`,
    );
    check(
      "§5 route KODUNDA `prisma.` YOK (uç DB'ye dokunmuyor)",
      !/\bprisma\s*\./.test(routeCode),
      "temiz",
    );
    // "Yazıldı ama mount edilmedi" bu repoda bilinen bir hata sınıfı.
    check(
      "§5 uç app.ts'te MOUNT edilmiş",
      appSrc.includes('app.use("/api/discovery"'),
      "app.use(\"/api/discovery\", …)",
    );
    check(
      "§5 uç kimlik doğrulaması TAŞIMIYOR (verifyToken yok)",
      !routeSrc.includes("verifyToken"),
      "guard'sız (bilinçli)",
    );

    // -----------------------------------------------------------------------
    // §6 — Kimlik feature-flag DEĞİL (dört kapıya sızmamış)
    // -----------------------------------------------------------------------
    const flagSchemaSrc = readFileSync(resolve(SRC, "routes/feature-flag.routes.ts"), "utf8");
    check(
      "§6 körlük zemini: feature-flag route dosyası okundu",
      flagSchemaSrc.length > 500,
      `${flagSchemaSrc.length} bayt`,
    );
    check(
      "§6 kimlik `updateSchema`'ya sızmamış (panelden değiştirilemez)",
      !/installationId/i.test(flagSchemaSrc),
      "yok (doğru)",
    );
  } finally {
    // Testin ürettiği kimliği geri al — bu satır KURULUMUN kimliği, çöp değil.
    if (before) {
      await prisma.systemSetting.update({
        where: { key },
        data: { value: before.value as unknown as object },
      });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key } });
    }
    __resetInstallationIdentityForTests();
    __resetDiscoveryCacheForTests();
    await prisma.$disconnect();
    await pool.end();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
