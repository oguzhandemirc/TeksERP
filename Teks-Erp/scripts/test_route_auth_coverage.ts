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
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import app from "../src/app";

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
  // Aynı politikanın ÇOĞUL hâli (`GET /api/client-policy/`, ce8681d1): sunucu
  // "ben şu sürümüm ve şu istemcilerden şunları bekliyorum" cümlesini tek
  // istekte verir. Tekil uçla AYNI veriyi, aynı gerekçeyle döner — panel bunu
  // giriş ekranından önce sorar; yükü `CLIENT_VERSION_POLICIES` sabitinden
  // gelir, DB'ye dokunmaz ve uçtan yazılamaz. Muafiyet BEYANI bu satırdır:
  // uç 2026-08-28'de eklendiğinde listeye yazılmadığı için bekçi kırmızıya
  // düştü ve `npm test` tip kapısından sonra ilk adımda duruyordu (BULGU-T1-016).
  "GET /api/client-policy/": "sürüm künyesi (çoğul) — giriş öncesi sorulur; salt-okunur, DB'siz, sabitten",
  "GET /api/mobile/updates/{*yol}": "güncelleme paketi dosyaları — kimliksiz, yol kaçışı kapalı, imzayla korunur",
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
 * ⚠️ 12 → 13 (2026-09-01, BİLİNÇLİ): `GET /api/boss/overview` (patron özeti)
 * yalnız `verifyToken` taşır — `GET /api/search` ile BİREBİR aynı gerekçe.
 * Uç ÇOK BÖLÜMLÜDÜR (stok · sipariş · üretim · sevkiyat · fason) ve tek bir
 * statik izin kodu doğru cevabı veremez: yalnız `report:sales` taşıyan biri
 * sipariş özetini görebilmeli ama stok ve fason rakamlarını GÖRMEMELİ.
 * Route satırına dar bir kod yazmak özeti o kişiye tamamen kapatır, geniş bir
 * kod yazmak ise izni anlamsızlaştırır — bu yüzden eleme BÖLÜM BAZINDA
 * serviste yapılır (F221 deseni): `getBossOverview` her bölümü
 * `matchesPermission` ile eler ve yetkisiz bölüm HİÇ SORGULANMAZ.
 * Kapsam `test_permission_catalog`in `DINAMIK_IZIN_KAYNAKLARI` tablosunda
 * beyanlı; `test_boss_overview §1` her bölümü hem pozitif hem NEGATİF yönde
 * mekanik doğruluyor (tek izin yalnız kendi bölümünü açıyor mu).
 */
const BARE_CHAIN_BASELINE = 13;

/** Körlük zemini: tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın. */
const MIN_ROUTE_LAYERS = 400;

type Layer = {
  name?: string;
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> };
  handle?: { stack?: Layer[] };
  /** Express 5 katmanı: mount önekini düz metin vermez, yalnız eşleştirici sunar. */
  match?: (path: string) => boolean;
  path?: string;
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

/**
 * MOUNT ÖNEKİ ADAYLARI — `app.use("/api/x", router)` ve `router.use("/y", alt)`
 * satırlarından toplanır. Express 5 katmanı öneki düz metin TAŞIMAZ (`layer.path`
 * ancak `match()` çağrıldıktan sonra dolar, `regexp` yoktur); bu yüzden önek,
 * adayları katmanın kendi eşleştiricisine sorarak çözülür.
 */
function mountCandidates(): string[] {
  const dosyalar: string[] = [join(__dirname, "..", "src", "app.ts")];
  const routesDir = join(__dirname, "..", "src", "routes");
  const gez = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) gez(p);
      else if (e.name.endsWith(".ts")) dosyalar.push(p);
    }
  };
  gez(routesDir);
  const set = new Set<string>();
  for (const f of dosyalar) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\.use\(\s*["'`](\/[^"'`]*)["'`]/g)) set.add(m[1]);
  }
  // Uzun önek önce denenir: "/api" kısa öneki "/api/admin/devices"i gölgelemesin.
  return [...set].sort((a, b) => b.length - a.length);
}

function birlestir(onek: string, yol: string): string {
  const tam = `${onek}${yol}`.replace(/\/{2,}/g, "/");
  return tam.length > 1 && tam.endsWith("/") ? tam : tam;
}

function collectRoutes(): { routes: RouteInfo[]; cozulemeyen: number } {
  const out: RouteInfo[] = [];
  const adaylar = mountCandidates();
  let cozulemeyen = 0;
  /**
   * İKİ AYRI DÜZELTME BİRLİKTE YAŞIYOR (merge, 2026-09-01):
   *  ① `onek` — anahtar TAM YOL olsun (muafiyet bir deseni değil TEK ucu affetsin).
   *  ② `inheritedAuth/Count` — `router.use(verifyToken)` ile MİRAS alınan kimlik
   *     guard'ı sayılsın; ticaret route'ları kimliği router seviyesinde kuruyor
   *     ve bu olmadan hepsi "kimliksiz uç" diye yanlış kırmızı verir.
   * İkisi birbirinden bağımsızdır; biri çıkarılırsa o sınıf hata geri döner.
   *
   * @param inheritedAuth üstteki router katmanlarından `router.use(verifyToken)`
   *   ile miras alınan kimlik guard'ı var mı.
   */
  const walk = (
    layers: Layer[],
    onek: string,
    inheritedAuth: boolean,
    inheritedCount: number,
  ): void => {
    // Bu seviyedeki `router.use(...)` katmanları — route TANIMLARINDAN ÖNCE
    // gelenler sonrakileri korur. Express sırayı korur; bu yüzden tek geçişte
    // biriktirilir ve o andan itibaren geçerli sayılır.
    let levelAuth = inheritedAuth;
    let levelCount = inheritedCount;
    for (const l of layers) {
      if (l.route) {
        const methods = Object.keys(l.route.methods)
          .filter((m) => l.route!.methods[m])
          .join(",")
          .toUpperCase();
        out.push({
          // ANAHTAR TAM YOLDUR (mount öneki dahil). Router'a göreli anahtar
          // ("GET /") HER router'ın kök ucuna uyar; muafiyet listesi o zaman
          // tek bir ucu değil bir DESENİ affeder — bekçinin kendi kör noktası
          // (BULGU-T1-016 düzeltmesinde ölçüldü: "GET /" 4 ayrı uca uyuyordu).
          key: `${methods} ${birlestir(onek, l.route.path)}`,
          // Kimlik ya route zincirinde ya da ÜST router'da (`router.use`) kurulmuş
          // olabilir — ikisi de geçerlidir.
          hasAuth: levelAuth || l.route.stack.some((s) => s.name === "verifyToken"),
          chainLength: levelCount + l.route.stack.length,
        });
      } else if (l.handle?.stack) {
        let alt = "";
        if (typeof l.match === "function") {
          for (const c of adaylar) {
            try {
              if (l.match(c)) { alt = c; break; }
            } catch {
              /* eşleştirici bu adayı reddetti */
            }
          }
        }
        if (!alt && l.handle.stack.some((x) => x.route)) cozulemeyen++;
        walk(l.handle.stack, birlestir(onek, alt), levelAuth, levelCount);
      } else if (l.name === "verifyToken") {
        // `router.use(verifyToken)` — bundan SONRAKİ her route korumalı.
        levelAuth = true;
        levelCount += 1;
      } else if (levelAuth) {
        // Kimlikten SONRA gelen router seviyesi guard'lar (örn.
        // `requireFinanceEnabled`) da etkin zincire dahildir.
        levelCount += 1;
      }
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack, "", false, 0);
  return { routes: out, cozulemeyen };
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
