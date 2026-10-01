// =============================================================================
// Test: HER route kimlik doğrulaması taşır (2026-08-09 denetimi, F-CORE-GUV-001)
// Çalıştır: npx tsx scripts/test_route_auth_coverage.ts
// =============================================================================
// `verifyToken` router'ların çoğunda her route SATIRINA tek tek takılıyor.
// Bu FAIL-OPEN bir desendir:
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
// ⚠️ 2026-08-13: ROUTER SEVİYESİ GUARD ARTIK TANINIYOR. Ön muhasebe router'ı
// `router.use(verifyToken, requireFinanceEnabled)` kullanıyor (24 ucun tamamı
// için tek satır) — ve bu, satır-içi tekrardan DAHA güvenlidir: yeni bir uç
// eklendiğinde guard'ı unutmak İMKÂNSIZ. Eski tarayıcı yalnız `route.stack`e
// bakıyordu, yani `router.use` ile korunan her ucu "korumasız" sayıyordu:
// bekçi 24 SAHTE KIRMIZI veriyordu ve bunun tehlikesi görünürden büyük —
// düzeltilmezse ekip kırmızı bekçiyi görmezden gelmeyi öğrenir.
// Çözüm: ağaç gezilirken üstteki router katmanlarının `use` yığını taşınır
// (`inherited`), route kendi zincirinde YA DA miras aldığı zincirde
// `verifyToken` taşıyorsa korumalı sayılır.
//
// SAF: DB'ye yazmaz, HTTP isteği atmaz; yalnız Express route ağacını gezer.
// =============================================================================
import { readFileSync } from "fs";
import { join } from "path";
import app from "../src/app";
import { rotaEnvanteri, type RotaEnvanteri } from "./lib/rota-envanteri";

/**
 * Kimlik doğrulaması TAŞIMAYAN uçlar — her biri GEREKÇELİ.
 * Anahtar **TAM YOL**: `METOD /api/<mount>/<route>`.
 *
 * ⚠️ Eskiden anahtar router'a göreliydi (`METOD /route/path`) çünkü Express 5'te
 * mount katmanı `path`i eşleşme anına kadar doldurmuyor. O sözleşmenin dayandığı
 * "bu anahtarların hepsi uygulama genelinde benzersiz" varsayımı 2026-08-29
 * denetiminde ÇÖKTÜ: `GET /api/client-policy/` eklenince anahtar `GET /` oldu ve
 * o anahtar DÖRT ayrı router'ın kök ucuna birden uyuyor — muafiyet tek ucu değil
 * bir DESENİ affederdi (bekçinin kendi kör noktası). Önek artık katmanın kendi
 * eşleştiricisine (`layer.match(aday)`) sorularak çözülüyor; aday listesi
 * `app.ts` + `routes/**` içindeki `.use("/...")` satırlarından toplanır ve önek
 * çözülemezse körlük zemini KIRMIZI verir (eksik yollu anahtar sessiz geçmez).
 */
const EXEMPT: Record<string, string> = {
  // Canlılık ucu — Electron login ÖNCESİ sunucu adresini bununla test ediyor
  // (ApiEndpointDialog) ve useServerClock yanıttaki Date başlığını okuyor.
  // 2026-08-09'dan beri YALNIZ canlılık döndürür; zengin panel
  // /api/admin/health arkasına alındı (F-CORE-GUV-002). Alan kümesi aşağıda kilitli.
  "GET /health": "canlılık ucu; login öncesi erişilebilir olmak zorunda",
  // Güncelleyicinin sağlık sondası (Dağıtım v2, GUNCELLEYICI.md §8.7): SYSTEM hizmeti oturum taşıyamaz. Koruma
  // kimlik değil ADRESTİR — yalnız döngü adresinden doğrudan (vekil başlıksız) gelen istek cevap alır, dışarıya
  // 404; `lisans{kip,butunluk,cekirdek}` bu yüzden donmuş public `/health`e girmez. Bekçi: test_yerel_saglik.
  "GET /health/yerel": "güncelleyicinin yerel sağlık sondası; yalnız döngü adresine cevap verir (dışarıya 404)",
  // Servis keşfi kimlik ucu: istemci HENÜZ HANGİ SUNUCUYA bağlanacağını
  // bilmiyorken çağırır — guard takılamaz (/health ile birebir aynı gerekçe).
  // Yük DB'siz ve minimaldir; sızdırdığı her alan (hostname, firma adı, sürüm)
  // zaten aynı LAN'da /health, mDNS ilanı ve login ekranı üzerinden açık.
  "GET /api/discovery/identity": "servis keşfi kimlik ucu; istemci sunucuyu tanımadan çağırır",
  // Giriş uçları: token ÜRETEN uç token isteyemez.
  "POST /api/auth/login": "token üreten uç",
  "POST /api/auth/login-card": "kartla giriş — token üreten uç",
  "POST /api/auth/login-quick-pin": "PIN ile giriş — token üreten uç",
  "GET /api/auth/login-methods": "istemci hangi giriş yöntemleri açık öğrenir (login ekranı)",
  "GET /api/auth/mobile-users": "mobil giriş ekranı kullanıcı listesi (cihaz eşleşmesi zorunluysa 401)",
  // İki adımlı doğrulama KURULUMU (2026-09-01, uzaktan erişim). Kimlik aranamaz
  // çünkü kurulumu yapacak kişi tanımı gereği HENÜZ GİREMEYEN kişidir: uzaktan
  // giriş TOTP olmadan reddediliyor, TOTP de bu uçtan kuruluyor. Guard takmak
  // "kilidi açmak için içeride olmalısın" döngüsü kurardı.
  // Koruma kimlik DEĞİL, TOKEN'dır: tek kullanımlık, 15 dk ömürlü ve yalnız
  // `admin:users` taşıyan biri üretebiliyor (POST /api/admin/users/:id/totp/window).
  // Yanlış kod da kurulumu tamamlamaz ve pencere ikinci kez kullanılamaz.
  "GET /api/auth/totp/enroll": "2FA kurulum penceresini okur; koruma tek kullanımlık token (yalnız admin üretir)",
  "POST /api/auth/totp/enroll": "2FA kurulumunu tamamlar; aynı token koruması + kod doğrulaması",
  // Cihaz el sıkışması: cihaz EŞLEŞMEDEN token alamaz.
  "POST /api/devices/announce": "tablet kendini bildirir — eşleşmeden önce token alamaz",
  "GET /api/devices/status": "cihaz atama durumu yoklaması (x-device-id)",
  "GET /api/devices/pairing-required": "eşleşme zorunlu mu — login öncesi gate",
  // Mobil uzaktan güncelleme (LAN ikizi): tablet güncellemeyi GİRİŞ EKRANINDAN
  // ÖNCE sorar — kimlik aransaydı "açılmayan tablete düzeltme gönderme" yolu,
  // yani kurtarmanın kendisi kapanırdı (`/health` ile aynı gerekçe sınıfı).
  // Uçlar SALT-OKUNUR ve fabrika verisi TAŞIMAZ; servis ettikleri şey zaten her
  // tablete kurulu olan uygulamanın kendisidir. Sahadaki asıl kanal internettir
  // (VPS) ve orada da aynı dosyalar kimliksiz servis edilir — Electron'un
  // `Setup.exe`si ile aynı durum. Paketin DEĞİŞTİRİLMESİNE karşı koruma kimlik
  // değil KOD İMZALAMADIR (imza geçersizse istemci güncellemeyi reddeder).
  // Depo dışına çıkış `dosyaYolu()` ile kapalı; bekçi `test_mobile_update.ts` §6.
  "GET /api/mobile/updates/ota/:runtimeVersion/manifest": "tablet güncellemeyi giriş öncesi sorar; koruma kod imzalamada",
  // İstemci sürüm politikası: masaüstü panel "bu sunucu hangi panel sürümünü
  // bekliyor" sorusunu GİRİŞ EKRANINDAN ÖNCE sorar. Kimlik aransaydı, sözleşmesi
  // bozulduğu için giriş yapamayan bir panele "güncelle" diyebilme yolu — yani
  // kurtarmanın kendisi — kapanırdı (`/health` ve mobil güncelleme uçlarıyla
  // aynı gerekçe sınıfı). Yük SALT-OKUNUR, DB'ye dokunmaz ve iki sürüm
  // numarasından ibarettir; fabrika verisi taşımaz. Sızdırdığı tek bilgi
  // "sunucu şu panel sürümünü istiyor" — aynı LAN'da zaten `/identity` sürüm
  // basıyor. Değer KODDA sabittir, uçtan yazılamaz. Bekçi: test_client_policy.ts
  "GET /api/client-policy/:istemci": "istemci sürüm politikasını giriş öncesi sorar; salt-okunur, iki sürüm numarası",
  // Aynı politikanın ÇOĞUL hâli (`GET /api/client-policy/`, `ce8681d1`): sunucu
  // "ben şu sürümüm ve şu istemcilerden şunları bekliyorum" cümlesini tek
  // istekte verir. Tekil uçla AYNI veriyi, aynı gerekçeyle döner — panel bunu
  // giriş ekranından önce sorar; yükü `CLIENT_VERSION_POLICIES` sabitinden
  // gelir, DB'ye dokunmaz ve uçtan yazılamaz. Muafiyet BEYANI bu satırdır:
  // uç 2026-08-28'de eklendiğinde listeye yazılmadığı için bekçi kırmızıya
  // düştü ve `npm test` tip kapısından sonra ilk adımda duruyordu (BULGU-T1-016).
  "GET /api/client-policy/": "sürüm künyesi (çoğul) — giriş öncesi sorulur; salt-okunur, DB'siz, sabitten",
  "GET /api/mobile/updates/{*yol}": "güncelleme paketi dosyaları — kimliksiz, yol kaçışı kapalı, imzayla korunur",
  // Lisans durumu (Faz 1c): panel ve tablet bandı için HERKES çağırır; başlık varsa TAM
  // doğrulama (geçersiz token 401), yoksa yalnız `{ayrinti:false}` — kademe/gün/modül
  // sinyali kimliksize SIZMAZ (K5 bilgisi dışarı verilmez). Bekçi: test_lisans_motoru §2a.
  "GET /api/license/durum": "herkes; kimliksiz çağırana ayrıntı yok (başlık varsa tam doğrulama)",
  // İndirme belirteci: tablet OTA denetimini GİRİŞ ÖNCESİ yapar (mobil güncelleme uçlarıyla
  // aynı gerekçe). Kimlik yerine ONAYLI CİHAZ (`req.device` yalnız onaylı+aktif cihazda dolar)
  // ya da tam doğrulanan oturum; ikisi de yoksa 401 DEVICE_OR_SESSION_REQUIRED.
  "GET /api/license/indirme-belirteci": "tablet giriş öncesi güncelleme; onaylı cihaz ya da oturum şart",
};

/**
 * Kimlik doğrulaması VAR ama route satırında izin guard'ı olmayan uç SAYISI.
 * Bugünkü küme: self-servis 4 (`/me`, `/logout`, `/preferences` ×2) +
 * salt-okuma lookup 6 (currency, document-profiles ×2, feature-flags ×2,
 * **hazır sebep katalogları**) + kayıt bilgisi 1 (`GET /record-info/:table/:id`).
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
/**
 * ⚠️ 10 → 11 (2026-08-19, BİLİNÇLİ): `GET /api/reason-presets` yalnız
 * `verifyToken` taşır. Hazır sebep listeleri (fire/kayıt düzeltmesi/elle
 * ekleme/iptal) ZATEN her operatör ekranında çiziliyor; ayrı bir okuma izni
 * koymak, izni atanmamış her tablette Tambur'un sebep adımını 403'e düşürür ve
 * fire kararını kaydedilemez yapardı (sebep zorunlu alan). YAZMA uçları guard'lı
 * (`roll:manual-adjust` ∨ `mobile:tambur-duzelt`) — açık olan yalnız okuma.
 */
/**
 * ⚠️ 11 → 12 (2026-08-19, BİLİNÇLİ): `GET /api/search` (global arama) yalnız
 * `verifyToken` taşır. Sebep, uç ÇOK VARLIKLI olmasıdır: tek bir statik izin
 * kodu doğru cevabı veremez — müşteriyi okuyabilen ama sevkiyatı okuyamayan
 * kullanıcı aramayı kullanabilmeli, yalnız sevkiyat sonuçlarını GÖRMEMELİ.
 * Route satırına `customer:read` yazmak aramayı sevkiyatçıya kapatır,
 * hiçbir şey yazmamak ise KOVA BAZINDA elemeyi zorunlu kılar — ikincisi
 * seçildi (F221 deseni): `search.service` her kovayı `matchesPermission` ile
 * eler, yetkisiz kova HİÇ SORGULANMAZ. `record-info` ile birebir aynı gerekçe.
 * Kapsam `test_permission_catalog`in `DINAMIK_IZIN_KAYNAKLARI` tablosunda
 * beyanlı ve `test_global_search §1-2` mekanik doğruluyor (kova izni ⊆ liste
 * ucunun izni + her kod katalogda tanımlı).
 */
/**
 * ⚠️ 13 → 15 (2026-09-22, BİLİNÇLİ): `GET /api/scan/series` ve
 * `GET /api/scan/resolve` yalnız `verifyToken` taşır — `GET /api/reason-presets`
 * emsaliyle BİREBİR aynı gerekçe. Okutma her operatör ekranının İLK adımıdır;
 * route satırına dar bir izin kodu yazmak, o kod atanmamış her tablette
 * okutmayı 403'e düşürür — yani özelliğin kendisini kırar. Geniş bir kod
 * yazmak ise izni anlamsızlaştırır.
 *
 * Asıl gerekçe yükün NE OLMADIĞIDIR: bu iki uç iş verisi değil BİÇİM META
 * VERİSİ döner (ön ek · tarih segmenti · hane · infix). `/resolve` KAYIT
 * tablolarına inmez; yalnız `number_series` yapılandırma önbelleğini
 * tazeleyebilir (`resolveSeriesFormat` → arka plan `findMany`). Ne bir topun
 * ya da çuvalın VARLIĞINI doğrular ne bir alanını döndürür — "bu kod çuval
 * kodu biçimindedir" der, "böyle bir çuval vardır" demez. Sızıntı kaydın
 * varlığından doğar, yapılandırma satırından değil; sızdırdığı ön ekler zaten
 * her basılı etikette okunabiliyor.
 *
 * ⚠️ Bu gerekçenin taşıyıcı cümlesi çürümeye açıktır: biri yarın "bulamadıysan
 * `rolls`a bak" ekleyebilir ve blok sessizce yalan olur. Bu yüzden cümle bir
 * KAPIYA bağlandı — `scripts/test_scan_series.ts §6` her koşumda
 * `scan.service.ts` ve `scan.routes.ts` kaynağında `prisma.`/`tx.` çağrısı ve
 * prisma import'u ARAR. Gerekçe değişirse bekçi kırmızı verir.
 */
/** 15 → 14 (B6): `GET /api/boss/overview` tünelle kalktı; özet yalnız `cloud-sync/overview`de. */
const BARE_CHAIN_BASELINE = 14;

/** Körlük zemini: tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın. */
const MIN_ROUTE_LAYERS = 400;

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

/**
 * Route ağacının yürüyücüsü `scripts/lib/rota-envanteri.ts`e taşındı (lisans kapısı bekçisi
 * aynı envanteri okur — kopya yürüyücü, bir düzeltmenin yalnız birine girmesi demekti).
 * Anahtar biçimi ve kimlik zinciri sayımı aynen korunur.
 */
function collectRoutes(): RotaEnvanteri {
  return rotaEnvanteri(app);
}

function main(): void {
  console.log("=== Route kimlik doğrulama kapsaması ===\n");
  const { routes, cozulemeyen } = collectRoutes();
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
  // Önek çözülemeyen bir mount, o router'ın TÜM uçlarını yanlış anahtarla
  // (kısa yolla) kaydeder; muafiyet eşleşmesi de yanlış olur. Sessizce geçme.
  check(
    "körlük zemini: her mount önekinin karşılığı çözüldü",
    cozulemeyen === 0,
    cozulemeyen ? `${cozulemeyen} mount çözülemedi — anahtarlar eksik yol taşıyor` : "",
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
