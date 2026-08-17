// =============================================================================
// Test: HER route kimlik doğrulaması taşır (2026-08-09 denetimi, F-CORE-GUV-001)
// Çalıştır: npx tsx scripts/test_route_auth_coverage.ts
// =============================================================================
// `verifyToken` 47 router'ın her route SATIRINA tek tek takılıyor —
// `router.use(verifyToken)` HİÇ YOK (grep → 0). Bu FAIL-OPEN bir desendir:
// yeni bir uç eklenip guard unutulursa uç SESSİZCE public olur, hata da log da
// çıkmaz. Denetimde ölçüldü: 478 ucun tek koruması bu satırdı ve invariant'ın
// mekanik bir bekçisi YOKTU (`test_permission_catalog.ts` "verifyToken"
// kelimesini hiç geçirmiyor; route stack'i okuyan üç test yalnız KENDİ
// ölçtükleri route'a bakıyor).
//
// ⚠️ RİSK PENCERESİ DAR — ve bunu bilmek önemli: izin guard'ı VARSA zincir
// fail-closed kalır (`rbac.middleware` `req.user` yokken 401 verir). Gerçek
// pencere, izin guard'ı TAŞIMAYAN uç sınıfıdır (self-servis + salt-okuma
// lookup): `router.get("/", verifyToken, controller.findAll)` satırından tek
// kelime düşerse uç tamamen kimlik doğrulamasız çalışır. O sınıf büyüyor —
// bu yüzden aşağıda ayrıca SAYILIYOR.
//
// SAF: DB'ye yazmaz, HTTP isteği atmaz; yalnız Express route ağacını gezer.
// =============================================================================
import { readFileSync } from "fs";
import { join } from "path";
import app from "../src/app";

/**
 * Kimlik doğrulaması TAŞIMAYAN uçlar — her biri GEREKÇELİ.
 * Anahtar `METOD /route/path` (mount öneki YOK: Express 5'te mount layer'ın
 * `path`i eşleşme anına kadar dolmuyor, statik okunamıyor). Denetimde ölçüldü:
 * bu dokuz anahtarın HEPSİ uygulama genelinde BENZERSİZ, yani kimlik yeterli.
 * Yeni bir public uç çakışan bir anahtarla gelse bile listede olmadığı için
 * KIRMIZI verir — hata yönü doğru.
 */
const EXEMPT: Record<string, string> = {
  // Canlılık ucu — Electron login ÖNCESİ sunucu adresini bununla test ediyor
  // (ApiEndpointDialog) ve useServerClock yanıttaki Date başlığını okuyor.
  // 2026-08-09'dan beri YALNIZ canlılık döndürür; zengin panel
  // /api/admin/health arkasına alındı (F-CORE-GUV-002). Alan kümesi aşağıda kilitli.
  "GET /health": "canlılık ucu; login öncesi erişilebilir olmak zorunda",
  // Giriş uçları: token ÜRETEN uç token isteyemez.
  "POST /login": "token üreten uç",
  "POST /login-card": "kartla giriş — token üreten uç",
  "POST /login-quick-pin": "PIN ile giriş — token üreten uç",
  "GET /login-methods": "istemci hangi giriş yöntemleri açık öğrenir (login ekranı)",
  "GET /mobile-users": "mobil giriş ekranı kullanıcı listesi (cihaz eşleşmesi zorunluysa 401)",
  // Cihaz el sıkışması: cihaz EŞLEŞMEDEN token alamaz.
  "POST /announce": "tablet kendini bildirir — eşleşmeden önce token alamaz",
  "GET /status": "cihaz atama durumu yoklaması (x-device-id)",
  "GET /pairing-required": "eşleşme zorunlu mu — login öncesi gate",
};

/**
 * Kimlik doğrulaması VAR ama route satırında izin guard'ı olmayan uç SAYISI.
 * Bugünkü küme: self-servis 4 (`/me`, `/logout`, `/preferences` ×2) +
 * salt-okuma lookup 5 (currency, document-profiles ×2, feature-flags ×2) +
 * kayıt bilgisi 1 (`GET /record-info/:table/:id`).
 * Bu sayı ARTARSA karar BİLİNÇLİ olmak zorundadır — yeni bir guard'sız uç,
 * yukarıdaki "gerçek risk penceresi"ni büyütür.
 *
 * ⚠️ `record-info` GUARD'SIZ DEĞİLDİR — yetkiyi handler İÇİNDE, istenen KAYIT
 * TÜRÜNE göre çözer (`TABLE_PERMISSIONS`), çünkü tek bir statik izin kodu
 * doğru cevabı veremez: siparişi okuyamayan biri siparişin "kim değiştirdi"sini
 * de okuyamamalı, ama iş emrini okuyabilen okuyabilmeli. Route satırına sabit
 * bir izin yazmak ya hepsini fazla açardı ya da hepsini gereksiz kısardı.
 * Dinamik çözüm `test_permission_catalog`'un `DINAMIK_IZIN_KAYNAKLARI`
 * tablosunda beyanlıdır — yani kapsam boşluğu görünür kalır.
 */
const BARE_CHAIN_BASELINE = 10;

/** Körlük zemini: tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın. */
const MIN_ROUTE_LAYERS = 400;

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> };
  handle?: { stack?: Layer[] };
};

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

interface RouteInfo {
  key: string;
  hasAuth: boolean;
  chainLength: number;
}

function collectRoutes(): RouteInfo[] {
  const out: RouteInfo[] = [];
  const walk = (layers: Layer[]): void => {
    for (const l of layers) {
      if (l.route) {
        const methods = Object.keys(l.route.methods)
          .filter((m) => l.route!.methods[m])
          .join(",")
          .toUpperCase();
        out.push({
          key: `${methods} ${l.route.path}`,
          hasAuth: l.route.stack.some((s) => s.name === "verifyToken"),
          chainLength: l.route.stack.length,
        });
      } else if (l.handle?.stack) {
        walk(l.handle.stack);
      }
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack);
  return out;
}

function main(): void {
  console.log("=== Route kimlik doğrulama kapsaması ===\n");
  const routes = collectRoutes();
  const unauth = routes.filter((r) => !r.hasAuth);
  console.log(
    `  (tarandı: ${routes.length} route layer · ${unauth.length} tanesi verifyToken taşımıyor)\n`,
  );

  // ── KÖRLÜK ZEMİNİ (önce — sayım çökmüşse aşağıdaki yeşiller anlamsız) ──────
  check(
    `körlük zemini: en az ${MIN_ROUTE_LAYERS} route layer tarandı`,
    routes.length >= MIN_ROUTE_LAYERS,
    `bulunan: ${routes.length}`,
  );
  check(
    "körlük zemini: verifyToken taşıyan route BULUNDU (isim eşleşmesi çalışıyor)",
    routes.some((r) => r.hasAuth),
  );

  // ── 1) Muaf listesi DIŞINDA korumasız uç OLMAMALI ─────────────────────────
  const unexpected = unauth.filter((r) => !(r.key in EXEMPT));
  check(
    "muaf listesi dışında kimlik doğrulamasız uç YOK",
    unexpected.length === 0,
    unexpected.map((r) => r.key).join(" | "),
  );

  // ── 2) Muaf listesi İKİ YÖNLÜ denetlenir ──────────────────────────────────
  // Ölü muaf, gerçek bir açığı sessizce kapsam dışında tutar: uç silinmiş ya da
  // guard'lanmış olabilir ve liste bunu bilmeden bir sonraki aynı-adlı ucu
  // otomatik affeder. (test_timestamptz_contract'ın muaf-bayatlığı deseni.)
  const byKey = new Map(routes.map((r) => [r.key, r] as const));
  const deadExempt = Object.keys(EXEMPT).filter((k) => !byKey.has(k));
  check("ölü muaf yok (listedeki her uç gerçekten var)", deadExempt.length === 0, deadExempt.join(" | "));
  const nowGuarded = Object.keys(EXEMPT).filter((k) => byKey.get(k)?.hasAuth === true);
  check(
    "gereksiz muaf yok (listedeki hiçbir uç artık guard'lı değil)",
    nowGuarded.length === 0,
    nowGuarded.join(" | "),
  );
  check(
    "her muafın yazılı gerekçesi var",
    Object.values(EXEMPT).every((v) => v.trim().length > 10),
  );

  // ── 3) İzin guard'ı taşımayan uç sayısı ARTMAMALI ─────────────────────────
  // İzin guard'ları çalışma zamanında ANONİM fonksiyonlardır (factory'nin
  // döndürdüğü arrow) → adla tanınamazlar. Yan etkisiz vekil ölçü: zincirde
  // verifyToken ile handler ARASINDA hiçbir halka olmaması.
  const bare = routes.filter((r) => r.hasAuth && r.chainLength <= 2);
  check(
    `route satırında izin guard'ı olmayan uç sayısı ${BARE_CHAIN_BASELINE}'u AŞMIYOR`,
    bare.length <= BARE_CHAIN_BASELINE,
    `bulunan: ${bare.length} → ${bare.map((r) => r.key).join(" | ")}`,
  );
  if (bare.length < BARE_CHAIN_BASELINE) {
    console.log(
      `  ℹ️  taban düştü (${bare.length} < ${BARE_CHAIN_BASELINE}) — BARE_CHAIN_BASELINE güncellenebilir.`,
    );
  }

  // ── 4) PUBLIC /health SÖZLEŞMESİ — alan kümesi DONDURULMUŞ ────────────────
  // Kimlik doğrulamasız tek "veri" ucu bu; buraya alan eklemek, kapatılan bilgi
  // ifşasını (F-CORE-GUV-002) sessizce geri getirmenin en kolay yoludur. Zengin
  // panel /api/admin/health arkasındadır. Bu kontrol KAYNAKTAN okur (sunucu
  // ayağa kaldırmaz): app.ts'teki public handler'ın döndürdüğü nesne literali.
  const appSrc = readFileSync(join(__dirname, "../src/app.ts"), "utf8");
  const pubStart = appSrc.indexOf('app.get("/health"');
  const pubEnd = appSrc.indexOf("});", appSrc.indexOf("res.status(200).json({", pubStart));
  const pubBlock = pubStart === -1 ? "" : appSrc.slice(pubStart, pubEnd);
  check("public /health handler'ı çözülebildi", pubBlock.length > 50);
  const LEAKY = [
    "lastBackup",
    "lastAuditError",
    "lastPoolTimeoutError",
    "dbSizeBytes",
    "diskUsedPct",
    "diskFreeBytes",
    "activeUsers",
    "activeDevices",
    "poolMax",
    "restoreCopyCount",
  ];
  const leaked = LEAKY.filter((k) => pubBlock.includes(k));
  check(
    "public /health operasyonel telemetri DÖNDÜRMÜYOR",
    leaked.length === 0,
    leaked.join(", "),
  );
  for (const k of ["status", "api", "db", "version", "time"]) {
    check(`public /health '${k}' alanını koruyor (istemci sözleşmesi)`, pubBlock.includes(k));
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
