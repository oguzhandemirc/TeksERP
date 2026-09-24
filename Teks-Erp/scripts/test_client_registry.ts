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
import {
  CLIENT_INFO_HEADERS,
  CLIENT_KINDS,
  readClientVersionHeader,
} from "../src/constants/client-info";
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
import { parseLegacyClientFromUserAgent } from "../src/lib/legacy-client-ua";

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
//
// ⚠️ Bu liste ÜÇ KOLLU ölçülür (§1 metin · §1b sabit importu · §1c değeri dışarı
// taşıyan tek fonksiyonun beyanlı okuyucuları) — tek kollu hâli, sabiti import
// eden bir dosyayı GÖRMÜYORDU.
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

// ─────────────────────────────────────────────────────────────────────────────
// §1b — SABİTİ İÇERİ ALMA YOLU DA KAPALI (import kaçağı)
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ Yukarıdaki kontrol METİN eşler: başlık adını yazmadan, `CLIENT_INFO_HEADERS`i
// IMPORT ederek aynı değere ulaşmak onu HİÇ kırmıyordu. Bu, bu depoda adı konmuş
// bir ölüm biçimidir ("sessiz kapı ölümü": bekçi kırmızı vermeden korumayı bırakır).
// ⇒ Sabitin kendisi de aynı üç dosyayla sınırlı.
const sabitIhlalleri: string[] = [];
for (const file of walk(SRC)) {
  if (ALLOWED.has(file)) continue;
  if (/\bCLIENT_INFO_HEADERS\b/.test(fs.readFileSync(file, "utf-8"))) {
    sabitIhlalleri.push(path.relative(SRC, file));
  }
}
check("§1b `CLIENT_INFO_HEADERS` sabiti izinli üç dosya DIŞINDA geçmiyor",
  sabitIhlalleri.length === 0, sabitIhlalleri.join(" · ") || "temiz");

// ─────────────────────────────────────────────────────────────────────────────
// §1c — KÜNYE DEĞERİNİ DIŞARI TAŞIYAN TEK KAPI: `readClientVersionHeader`
// ─────────────────────────────────────────────────────────────────────────────
// Sürüm, 2026-09-17'den beri `Session.clientVersion`e YAZILIYOR — yani künye
// değeri ilk kez üç dosyanın dışına çıkıyor. Çıkışın kendisi meşrudur (kalıcı
// bir GÖZLEM; kaldırma fazı kapısı onu okur), ama çıkış YOLU tekil ve beyanlı
// olmalı: her yeni okuyucu buraya bir satır yazmak zorunda.
//
// ⚠️ Beyan yetmez — değerin KAPIYA dönüşmediği de ölçülür: okuyucu dosyada
// dönen değer yalnız bir nesne alanına konabilir, bir koşula/atmaya giremez.
const SURUM_OKUYUCULARI = new Map<string, string>([
  ["controllers/auth.controller.ts",
   "login/kart/PIN uçlarında `Session.clientVersion` yazımı — yalnız `ctx` nesnesine konur"],
  ["middlewares/auth.middleware.ts",
   "`lastSeenAt` dokunuşunda NULL kalmış satırı doldurur (panel sürümü ASENKRON okuduğu için ilk istek sürümsüz gidebiliyor) — `updateMany`ye argüman"],
]);
const okuyucular: string[] = [];
for (const file of walk(SRC)) {
  if (ALLOWED.has(file)) continue;
  if (/\breadClientVersionHeader\b/.test(fs.readFileSync(file, "utf-8"))) {
    okuyucular.push(path.relative(SRC, file));
  }
}
const beyansiz = okuyucular.filter((f) => !SURUM_OKUYUCULARI.has(f));
const oluBeyan = [...SURUM_OKUYUCULARI.keys()].filter((f) => !okuyucular.includes(f));
check("§1c künye sürümünü okuyan her dosya BEYANLI", beyansiz.length === 0,
  beyansiz.join(" · ") || `${okuyucular.length} okuyucu, hepsi beyanlı`);
// İKİ YÖNLÜ: beyan edilmiş ama artık okumayan satır da kırmızıdır — yoksa
// allowlist zamanla "ne olduğu bilinmeyen dosyalar listesi"ne dönüşür.
check("§1c ÖLÜ beyan yok (listede olup okumayan dosya)", oluBeyan.length === 0,
  oluBeyan.join(" · ") || "temiz");

for (const okuyucu of okuyucular) {
  const metin = fs.readFileSync(path.join(SRC, okuyucu), "utf-8");
  // Değer yalnız ① sarmalayıcı fonksiyonun `return`ünde ② bir nesne alanında
  // görünebilir. `if (`, `?`, `&&`, `throw`, `===` gibi bir bağlamda geçmesi,
  // künyenin bir KARARA girdiğinin ilk sinyalidir.
  const kararSatirlari = metin
    .split("\n")
    .filter((l) => /\b(resolveClientVersion|readClientVersionHeader)\b/.test(l))
    .filter((l) => /\bif\s*\(|\?|&&|\|\||throw |===|!==|return next|res\./.test(l));
  check(`§1c \`${okuyucu}\` künye sürümünü bir KARARA sokmuyor`,
    kararSatirlari.length === 0, kararSatirlari.map((l) => l.trim()).join(" | ") || "temiz");

  // ⚠️ GİRİŞ NOKTASI YETMEZ: değer bir değişkene alınıp AŞAĞIDA bir isteği
  // reddetmek için kullanılabilirdi. Bu kol, taşıyıcı adın (`clientVersion`)
  // istek AKIŞINI değiştiren hiçbir ifadeyle aynı satırda geçmediğini ölçer.
  const akisSatirlari = metin
    .split("\n")
    .filter((l) => /\bclientVersion\b/.test(l))
    .filter((l) => /AppError|throw |res\.status|res\.json|res\.send|return next\(/.test(l));
  check(`§1c \`${okuyucu}\` künye sürümü isteğin AKIŞINI değiştirmiyor`,
    akisSatirlari.length === 0, akisSatirlari.map((l) => l.trim()).join(" | ") || "temiz");
}

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
check("uç `admin:settings` ∨ ekran izni `system:clients` arkasında",
  /"\/clients",\s*\n\s*verifyToken,\s*\n\s*requireAnyPermission\("admin:settings", "system:clients"\)/.test(adminRoutes));

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

// §4b — OTURUM SATIRINA YAZILACAK SÜRÜMÜ ÇÖZEN TEK KAPI
// `Session.clientVersion` bu fonksiyonun döndürdüğü değerdir; buradaki
// "uydurmama" kuralı deftere DEĞİL, KALICI bir satıra yazıldığı için daha da
// bağlayıcıdır: çöp bir etiket, kaldırma fazı kapısının hükmüne girer.
const H = CLIENT_INFO_HEADERS.version;
check("§4b geçerli sürüm okunuyor", readClientVersionHeader({ [H]: "1.3.2" }) === "1.3.2");
check("§4b boşluklar kırpılıyor", readClientVersionHeader({ [H]: "  1.3.2  " }) === "1.3.2");
check("§4b dizi gelirse ilki", readClientVersionHeader({ [H]: ["1.3.2", "9.9.9"] }) === "1.3.2");
check("§4b başlık YOK → null", readClientVersionHeader({}) === null);
check("§4b boş dize → null (uydurulmuyor)", readClientVersionHeader({ [H]: "   " }) === null);
check("§4b kalıba UYMAYAN değer → null (KIRPILMIYOR)",
  readClientVersionHeader({ [H]: "1.3.2; DROP TABLE" }) === null);
check("§4b 32 karakterden uzun → null (kolon sınırı VarChar(32))",
  readClientVersionHeader({ [H]: "1".repeat(33) }) === null);
check("§4b tam 32 karakter kabul", readClientVersionHeader({ [H]: "1".repeat(32) }) === "1".repeat(32));

// ─────────────────────────────────────────────────────────────────────────────
// §5 KÜNYESİZ İSTEMCİ — sürüm User-Agent'tan okunuyor mu (2026-09-10)
// ─────────────────────────────────────────────────────────────────────────────
// SAHA VAKASI: 192.168.1.56'daki panel 2.5.0'da kalmıştı, rapor menüsünün
// TAMAMI 404 veriyordu ve HAFTALARCA fark edilmedi. Sebebi "bayat rozeti
// basılmadı" DEĞİL: künye başlıkları 2026-09-04'te geldiği için o panel onları
// hiç göndermiyordu ve defter künyesiz isteği hiç yazmıyordu → makine listede
// GÖRÜNMÜYORDU. Görülmesi en gereken kitle, kendini tanıtamayacak kadar
// eskilerdir; bu blok o yedek yolu kilitler.
console.log("\n§5 künyesiz istemci — UA yedeği");

// Fabrikanın GERÇEK UA'ları (errorlogs 04-10.09). Türkçe karakterin bozulmuş
// hâli ("Adnan?ahinERP") BİLEREK korunuyor: UA metni taşımada bozuluyor ve
// ayrıştırma buna DAYANMAMALI — uygulama adı beyaz listeye alınamaz.
const UA_ESKI_PANEL =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Adnan?ahinERP/2.5.0 Chrome/148.0.7778.280 Electron/42.7.0 Safari/537.36";
const UA_GUNCEL_PANEL =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Adnan?ahinERP/1.3.1 Chrome/148.0.7778.280 Electron/42.7.0 Safari/537.36";

const eski = parseLegacyClientFromUserAgent(UA_ESKI_PANEL);
check("⭐ saha vakası: 2.5.0 paneli UA'dan ÇÖZÜLÜYOR", eski?.version === "2.5.0");
check("türü tahmin edilmiyor, KESİN olarak electron", eski?.kind === "electron");
check("güncel panel de çözülüyor", parseLegacyClientFromUserAgent(UA_GUNCEL_PANEL)?.version === "1.3.1");

// Motor jetonları uygulama sanılmamalı — bu ayrıştırmanın en kolay hatasıdır.
check("Chrome sürümü uygulama sanılmıyor", eski?.version !== "148.0.7778.280");
check("Electron sürümü uygulama sanılmıyor", eski?.version !== "42.7.0");
check("AppleWebKit sürümü uygulama sanılmıyor", eski?.version !== "537.36");

// Kapsam DAR ve bu bilinçli: yanlış bilgi, bilgisizlikten kötüdür.
check(
  "tablet (okhttp) NULL — kütüphane sürümü uygulama sürümü DEĞİL",
  parseLegacyClientFromUserAgent("okhttp/4.12.0") === null,
);
check(
  "düz tarayıcı NULL (Electron değil)",
  parseLegacyClientFromUserAgent(
    "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  ) === null,
);
check("curl NULL", parseLegacyClientFromUserAgent("curl/8.4.0") === null);
check("UA yok → NULL", parseLegacyClientFromUserAgent(undefined) === null);
check(
  "aşırı uzun UA reddediliyor (bellek savunması)",
  parseLegacyClientFromUserAgent("Electron/1.0 " + "x".repeat(600)) === null,
);

// Defterde beyan ↔ çıkarım ayrımı: ekran ikisini KARIŞTIRMAMALI.
resetClientRegistryForTest();
const ID_ESKI = "legacy:aaaaaaaabbbbbbbbcccccccc";
shouldTouchClient(ID_ESKI, t1);
touchClient({ instanceId: ID_ESKI, kind: "electron", version: "2.5.0", declared: false }, t1);
const esk = listClients(t1)[0];
check("çıkarılmış sürüm defterde 'beyan değil' damgalı", esk?.declared === false);
check("çıkarılmış sürüm yine de okunuyor", esk?.version === "2.5.0");

// Panel güncellenince künyesini bildirmeye başlar — damga TEK YÖNLÜ kalkar.
shouldTouchClient(ID_ESKI, t1 + CLIENT_TOUCH_THROTTLE_MS + 1);
touchClient({ instanceId: ID_ESKI, version: "1.3.2", declared: true }, t1 + CLIENT_TOUCH_THROTTLE_MS + 1);
check("güncellenen istemci 'beyan' damgasına yükseliyor", listClients(t1)[0]?.declared === true);

resetClientRegistryForTest();
const ID_BEYAN = "beyan-eden-kurulum-0001";
shouldTouchClient(ID_BEYAN, t1);
touchClient({ instanceId: ID_BEYAN, kind: "electron", version: "1.3.2" }, t1);
check("başlıkla gelen kayıt varsayılan olarak BEYAN", listClients(t1)[0]?.declared === true);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail === 0 ? 0 : 1);
