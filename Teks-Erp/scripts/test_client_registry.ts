// =============================================================================
// Test: Bağlı istemci defteri — künye başlığı KAPI OLMASIN (2026-09-04)
// Çalıştır: npx tsx scripts/test_client_registry.ts
// =============================================================================
// NEDEN: `X-Client-*` başlıkları BİLGİLENDİRMEDİR ve istemci onları tek satır
// curl ile uydurabilir. Bu dosyanın EN KRİTİK kontrolü §1'dir: başlık adlarının
// izinli üç dosya dışında HİÇBİR kaynak dosyada geçmemesi. Bir gün biri
// "istek panelden geliyorsa şu kontrolü atla" derse, kapı UYDURULMUŞ BİR
// BAŞLIKLA geçilir hale gelir — bu depoda `CLIENT_IP_HEADER` ile birebir bu
// sınıf bir hata bir kez ısırdı (2026-09-01, patron modülü).
//
// Diğer üç invariant:
//   §2 yazma kısıtlaması GERÇEKTEN tutuyor mu (sıcak yol maliyeti)
//   §3 "aktif" eşiği TEK KAYNAKTAN mı geliyor (ekran kendi sayısını yazamaz)
//   §4 fail-open + uydurmama (tanınmayan tür/sürüm null, kullanıcı "bilinmiyor")
// =============================================================================
import fs from "fs";
import path from "path";

import { CLIENT_VERSION_POLICIES } from "../src/config/client-version-policy";
import { CLIENT_INFO_HEADERS, CLIENT_KINDS } from "../src/constants/client-info";
import {
  CLIENT_ACTIVE_WINDOW_MS,
  CLIENT_RETENTION_MS,
  CLIENT_TOUCH_THROTTLE_MS,
  clientRegistryStats,
  isClientActive,
  listClients,
  resetClientRegistryForTest,
  shouldTouchClient,
  touchClient,
} from "../src/lib/client-registry";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const SRC = path.resolve(__dirname, "../src");

/** src/ altındaki tüm .ts dosyaları (özyineli). */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

// =============================================================================
console.log("\n§1 — KÜNYE BAŞLIĞI HİÇBİR KAPIYA BAĞLI DEĞİL (EN KRİTİK)");
// =============================================================================
// İzinli üç dosya: adları tanımlayan sabit, onları OKUYAN middleware ve
// doğrulayan defter. Başka bir dosyada geçmesi, bir karar noktasının bu
// uydurulabilir değere bakmaya başladığının ilk sinyalidir.
const ALLOWED = new Set(
  [
    "constants/client-info.ts",
    "middlewares/client-info.middleware.ts",
    "lib/client-registry.ts",
  ].map((p) => path.join(SRC, p)),
);

const headerNames = Object.values(CLIENT_INFO_HEADERS);
const ihlaller: string[] = [];
for (const file of walk(SRC)) {
  if (ALLOWED.has(file)) continue;
  const text = fs.readFileSync(file, "utf-8");
  for (const h of headerNames) {
    // Büyük/küçük harf duyarsız: Express küçültür ama biri "X-Client-Kind"
    // yazarak aynı değere ulaşabilir.
    if (text.toLowerCase().includes(h.toLowerCase())) {
      ihlaller.push(`${path.relative(SRC, file)} → ${h}`);
    }
  }
}
check(
  "künye başlığı izinli üç dosya DIŞINDA hiç geçmiyor",
  ihlaller.length === 0,
  ihlaller.join(" · ") || "temiz",
);

// Middleware gerçekten fail-open mı: reddetme/yanıt yazma yüzeyi taşımamalı.
const mwPath = path.join(SRC, "middlewares/client-info.middleware.ts");
const mw = fs.readFileSync(mwPath, "utf-8");
check("middleware hiçbir isteği reddetmiyor (res.status/res.json/throw YOK)",
  !/res\.status\(|res\.json\(|res\.send\(|throw /.test(mw));
check("middleware `req`e alan yazmıyor (kapılar ondan bir şey okuyamaz)",
  !/req\.(user|device|isRemote|isSystemAccount)\s*=/.test(mw));
check("middleware her dalda next() çağırıyor",
  (mw.match(/next\(\)/g) ?? []).length >= 3);
check("mount app.ts'te ve latency'den sonra",
  (() => {
    const app = fs.readFileSync(path.join(SRC, "app.ts"), "utf-8");
    const iLat = app.indexOf("app.use(latencyMiddleware)");
    const iCli = app.indexOf("app.use(clientInfoMiddleware)");
    return iLat > -1 && iCli > iLat;
  })());

// =============================================================================
console.log("\n§2 — YAZMA KISITLAMASI GERÇEKTEN TUTUYOR");
// =============================================================================
resetClientRegistryForTest();
const ID = "11111111-2222-3333-4444-555555555555";
const t0 = Date.now();

let gecen = 0;
for (let i = 0; i < 50; i++) {
  // Aynı ANDA gelen 50 istek — sıcak yolun birebir taklidi.
  if (shouldTouchClient(ID, t0)) {
    gecen++;
    touchClient({ instanceId: ID, kind: "electron", version: "1.2.6" }, t0);
  }
}
check("50 eşzamanlı istekten YALNIZ 1'i kapıdan geçti", gecen === 1, `geçen=${gecen}`);
check("49'u kısıtlamaya takıldı (sayaç)", clientRegistryStats().throttledCount === 49,
  String(clientRegistryStats().throttledCount));
check("defterde tek satır var", clientRegistryStats().size === 1);

// Kısıtlama penceresi dolunca yeniden geçer.
check("pencere dolunca (30 sn + 1 ms) yeniden geçiyor",
  shouldTouchClient(ID, t0 + CLIENT_TOUCH_THROTTLE_MS + 1));
check("pencere DOLMADAN (30 sn - 1 ms) geçmiyor",
  !shouldTouchClient(ID, t0 + CLIENT_TOUCH_THROTTLE_MS - 1));

// Middleware'de kapı, başlıkların GERİ KALANINI okumadan ve `finish`
// dinleyicisini kurmadan ÖNCE olmalı — kısıtlamanın kazancı budur.
const iGate = mw.indexOf("shouldTouchClient");
const iFinish = mw.indexOf('res.once("finish"');
const iKind = mw.indexOf("CLIENT_INFO_HEADERS.kind");
check("kapı, `finish` dinleyicisinden ÖNCE", iGate > -1 && iFinish > iGate);
check("kapı, tür/sürüm başlıklarının okunmasından ÖNCE", iGate > -1 && iKind > iGate);

// =============================================================================
console.log("\n§3 — 'AKTİF' EŞİĞİ TEK KAYNAK");
// =============================================================================
check("eşik sabiti dakikaya bölünebilir bir değer", CLIENT_ACTIVE_WINDOW_MS === 5 * 60_000,
  String(CLIENT_ACTIVE_WINDOW_MS));
check("liste ömrü (retention) eşikten UZUN — pasif satır da görünmeli",
  CLIENT_RETENTION_MS > CLIENT_ACTIVE_WINDOW_MS);

const now2 = Date.now();
check("eşik İÇİNDE = aktif",
  isClientActive({ lastSeenAt: now2 - CLIENT_ACTIVE_WINDOW_MS + 1_000 }, now2));
check("eşik DIŞINDA = pasif",
  !isClientActive({ lastSeenAt: now2 - CLIENT_ACTIVE_WINDOW_MS - 1_000 }, now2));

// Uç eşiği YANITTA döndürüyor mu — ekranın metni buradan üretiliyor.
const adminRoutes = fs.readFileSync(path.join(SRC, "routes/admin.routes.ts"), "utf-8");
const svc = fs.readFileSync(path.join(SRC, "services/client-registry.service.ts"), "utf-8");
check("servis `activeWindowMs`i yanıtta döndürüyor (eşik SUNUCUDAN gider)",
  svc.includes("activeWindowMs: CLIENT_ACTIVE_WINDOW_MS"));
// Katman kuralı: DB okuması route'ta DEĞİL serviste (eslint no-restricted-imports).
check("uç ince — defter yükünü servisten alıyor",
  adminRoutes.includes("ClientRegistryService.snapshot()"));
check("uç `admin:settings` arkasında (yeni izin kodu AÇILMADI)",
  /"\/clients",\s*\n\s*verifyToken,\s*\n\s*requirePermission\("admin:settings"\)/.test(adminRoutes));

// Ekran kendi eşiğini YAZMAMALI — sunucudan gelen değeri basmalı.
const EL = path.resolve(__dirname, "../../Electron/src/pages/System/Clients");
if (!fs.existsSync(EL)) {
  check("Electron ekran klasörü bulundu", false, EL);
} else {
  // ⚠️ Test dosyaları HARİÇ: bekçinin kendisi eşiği GİRDİ olarak kullanır
  // ("eşik değişirse metin de değişir" kontrolü 10 * 60_000 geçirir). İddia
  // "EKRAN kendi eşiğini yazmasın"; test dosyası ekran değildir.
  const ekranDosyalari = fs
    .readdirSync(EL)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .filter((f) => !/\.test\.tsx?$/.test(f));
  check("ekran kaynak dosyaları bulundu (körlük zemini)", ekranDosyalari.length >= 3,
    ekranDosyalari.join(", "));
  const ekran = ekranDosyalari
    .map((f) => fs.readFileSync(path.join(EL, f), "utf-8"))
    .join("\n");
  check("ekran `activeWindowMs`i sunucudan okuyor", ekran.includes("activeWindowMs"));
  // Sabit dakika/ms literali = ikinci bir eşik kaynağı.
  check("ekranda gömülü eşik literali YOK (5 * 60_000 / 300000 / '5 dakika')",
    !/5\s*\*\s*60[_ ]?000|300000|300_000|"5 dakika"|'5 dakika'/.test(ekran));
  check("ekran otomatik yoklama YAPMIYOR (kullanıcı kararı)",
    !ekran.includes("refetchInterval"));
  check("ekran açılışta bir kez çekiyor (refetchOnMount)", ekran.includes("refetchOnMount"));
}

// =============================================================================
console.log("\n§4 — UYDURMAMA + FAIL-OPEN");
// =============================================================================
resetClientRegistryForTest();
const t1 = Date.now();

// Tanınmayan tür / bozuk sürüm → null. "electron" diye varsayılmaz.
shouldTouchClient("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", t1);
touchClient(
  { instanceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", kind: "korsan", version: "sürüm yok" },
  t1,
);
const r1 = listClients(t1)[0];
check("tanınmayan tür → null (uydurulmaz)", r1?.kind === null, String(r1?.kind));
check("doğrulamayı geçmeyen sürüm → null", r1?.version === null, String(r1?.version));
check("kimliksiz istekte kullanıcı null ('kimse yok' DEĞİL, bilinmiyor)",
  r1?.lastUserId === null);

// Tanınan türler `CLIENT_VERSION_POLICIES` kümesiyle aynı olmalı — ayrışırsa
// ekran "yayındaki sürüm" kıyasını sessizce yapamaz hale gelir.
check("CLIENT_KINDS ↔ CLIENT_VERSION_POLICIES anahtarları birebir",
  CLIENT_KINDS.slice().sort().join(",") ===
    Object.keys(CLIENT_VERSION_POLICIES).slice().sort().join(","),
  `${CLIENT_KINDS.join(",")} vs ${Object.keys(CLIENT_VERSION_POLICIES).join(",")}`);

// Çöp kimlik belleğe girmez.
resetClientRegistryForTest();
check("çok kısa kimlik reddedilir", !shouldTouchClient("abc"));
check("çok uzun kimlik reddedilir", !shouldTouchClient("x".repeat(200)));
check("kaçış karakterli kimlik reddedilir", !shouldTouchClient("../../etc/passwd"));
check("reddedilen kimlikten kayıt doğmadı", clientRegistryStats().size === 0);

// Bilinen bir değer, künyesiz tek bir istekle SİLİNMEZ.
resetClientRegistryForTest();
const ID2 = "99999999-8888-7777-6666-555555555555";
shouldTouchClient(ID2, t1);
touchClient({ instanceId: ID2, kind: "mobil", version: "1.0.5", userId: "u-1" }, t1);
touchClient({ instanceId: ID2 }, t1 + 1); // künyesiz/kimliksiz istek
const r2 = listClients(t1 + 1)[0];
check("künyesiz istek bilinen sürümü null'a DÜŞÜRMÜYOR", r2?.version === "1.0.5");
check("künyesiz istek bilinen türü null'a DÜŞÜRMÜYOR", r2?.kind === "mobil");
check("künyesiz istek son kullanıcıyı SİLMİYOR", r2?.lastUserId === "u-1");
check("son görülme yine de güncellendi", r2?.lastSeenAt === t1 + 1);

// Retention: bayat satır listeden düşer.
resetClientRegistryForTest();
shouldTouchClient(ID2, t1);
touchClient({ instanceId: ID2, kind: "electron" }, t1);
check("retention dolunca satır listeden düşüyor",
  listClients(t1 + CLIENT_RETENTION_MS + 1).length === 0);

console.log(`\n${fail === 0 ? "✅ TÜMÜ GEÇTİ" : "❌ BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı\n`);
process.exit(fail === 0 ? 0 : 1);
