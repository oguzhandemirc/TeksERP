// =============================================================================
// TeksERP — İstemci sürüm politikası ("bu backend hangi paneli bekliyor")
// =============================================================================
// Bu projenin deploy sırası pazarlık dışıdır: **backend ÖNCE** gider. Bu, yeni
// bir API sözleşmesi çıktığında sahada bir süre ESKİ panellerin çalışması
// demektir — ve o panellerin nasıl bozulacağı sözleşmeye bağlıdır: bazen 400
// döner (görünür), bazen alan sessizce düşer (görünmez, en tehlikelisi).
//
// Politika bu boşluğu kapatır: backend "en az şu sürümü bekliyorum" der, panel
// kendi sürümünü kıyaslar ve altındaysa kullanıcıyı güncellemeye zorlar.
//
// ⚠️ NEDEN KODDA SABİT, PANELDE AYAR DEĞİL:
//  ① Doğal eşleşme — "şu API sürümü şu paneli gerektirir" cümlesi backend
//     deploy'uyla birlikte değişmeli, ayrı bir insan hamlesiyle değil (unutulan
//     ayar = sessizce korumasız kalan saha).
//  ② Yanlış girilen bir değer SAHADAKİ TÜM PANELLERİ kilitler. Böyle bir kolu
//     panele koymak, gece yarısı yanlışlıkla "3.0.0" yazılmasına açık kapı
//     bırakmaktır. Kod yolunda değişiklik code review + deploy'dan geçer.
//  ③ Katalog koda, atama panele (bu repoda izin kataloğu ve rol şablonları da
//     aynı kuralla kodda yaşıyor).
//
// ⚠️ İSTEMCİ TARAFI FAIL-OPEN olmalıdır (bkz. Electron `useClientPolicy`):
// politika okunamazsa panel KİLİTLENMEZ. Bu, projenin genel fail-closed
// eğiliminin bilinçli istisnasıdır — burada "kapalı" tarafın bedeli, bozuk bir
// yanıt yüzünden fabrikanın tüm panellerinin çalışmaz hale gelmesidir.
// =============================================================================

/**
 * Sunucunun tek bakışta okunabilir sürüm beyanı:
 * "Ben şu API sürümüyüm ve şu istemcilerden şunları bekliyorum."
 *
 * Neden tek yanıtta: eskiden API sürümü `/health`te, beklentiler
 * `/client-policy/:istemci`te ayrı ayrı duruyordu — "2.9.0 yayında, panelden
 * 2.8.1, tabletten 2.9.8 bekliyor" cümlesini kurmak için üç ayrı istek ve elle
 * birleştirme gerekiyordu. Uyum bir İLİŞKİDİR; ilişkinin iki ucu ayrı yerlerde
 * durursa kimse bütünü görmez.
 */
export interface VersionManifest {
  /** Bu backend'in sürümü (package.json). */
  apiVersion: string;
  /** İstemci kodu → politika. */
  clients: Record<string, ClientVersionPolicy>;
}

export interface ClientVersionPolicy {
  /**
   * Bu backend'in çalışabildiği EN DÜŞÜK panel sürümü. Altındaki panel
   * kapatılamaz bir güncelleme kapısı gösterir ve kullanılamaz.
   *
   * ⚠️ Bunu YALNIZ gerçek bir kırılma olduğunda yükselt (kaldırılan uç,
   * değişen sözleşme, sessizce düşen alan). Her sürümde otomatik yükseltmek,
   * güncellemeyi indirememiş her makineyi üretim dışı bırakır.
   */
  minVersion: string;
  /**
   * Yayındaki güncel sürüm — bilgi amaçlı. Panel bunu KİLİT olarak kullanmaz;
   * güncelleme kararını yayın sunucusundaki `latest.yml` verir. Burada durması,
   * "sahadaki panel kaç sürüm geride" sorusunun sunucudan da görülebilmesi
   * içindir.
   */
  currentVersion: string;
  /** Kilit devreye girdiğinde operatöre gösterilecek ek cümle (opsiyonel). */
  message?: string;

  /* ------------------------------------------------------------------ *
   * MOBİLE ÖZEL — İKİNCİ SÜRÜM EKSENİ
   * ------------------------------------------------------------------ */
  /**
   * Tabletin taşıması gereken EN DÜŞÜK uzak paket tarihi (ISO 8601).
   *
   * ⚠️ NEDEN İKİNCİ EKSEN: masaüstünde sürüm = uygulamanın tamamı. Mobilde
   * DEĞİL — JS düzeltmesi uzaktan güncellemeyle gider ve `versionName`i
   * DEĞİŞTİRMEZ. Yani "2.9.8" görünen bir tabletin JS'i haftalarca eski
   * olabilir ve `minVersion` bunu ifade EDEMEZ. Bu alan onu ifade eder;
   * istemci `Updates.createdAt` ile kıyaslar (= paketin yayın damgası).
   *
   * Tanımsızsa yalnız `minVersion` (APK ekseni) uygulanır.
   */
  minPaketTarihi?: string;
}

/**
 * Masaüstü panel (Electron) politikası.
 *
 * `minVersion` 2.8.1: otomatik güncellemeyi taşıyan ilk sürüm. Daha eski bir
 * panel güncelleyiciyi hiç taşımıyor, yani kapıyı gösteremez — onlar zaten elle
 * gezilecek (bkz. docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md §2).
 */
export const ELECTRON_VERSION_POLICY: ClientVersionPolicy = {
  minVersion: "1.0.0",
  currentVersion: "1.2.6",
};

/**
 * WEB PANELİ (2026-09-01, patron modülü) — Electron renderer'ının tarayıcıda
 * koşan ikizi (`npm run build:web` → `dist-web`, `WEB_DIST_DIR` ile aynı
 * origin'den servis edilir).
 *
 * ⚠️ ELECTRON POLİTİKASININ TAKMASI DEĞİL, AYRI BİR EKSEN. Aynı kaynak koddan
 * doğsalar da SÜRÜMLERİ birlikte hareket etmez: panel kendi güncelleyicisiyle
 * (`latest.yml`) gelir, web paneli ise backend paketiyle BİRLİKTE deploy edilir
 * (`deploy/paketle.ps1` → `kur.ps1`). Ortak bir politika, bir kanaldaki
 * gecikmeyi diğerine kilit olarak yansıtırdı.
 *
 * Bugün pratikte drift İMKÂNSIZ (SPA backend'in yanında gidiyor), o yüzden
 * `minVersion` en düşük değerde duruyor. Eksen yine de burada: Faz 2'de mobil
 * patron uygulaması gelirse ya da SPA ayrı bir kanaldan yayınlanırsa
 * yükseltilecek yer burasıdır.
 */
export const WEB_VERSION_POLICY: ClientVersionPolicy = {
  minVersion: "1.0.0",
  currentVersion: "1.0.0",
};

/**
 * İstemci → politika kayıt defteri. Uç bunun üzerinden servis eder
 * (`GET /api/client-policy/:istemci`), böylece yeni bir istemci eklemek
 * BURAYA bir satır yazmaktır — route'a dokunmak gerekmez.
 *
 * ⚠️ Tanımsız istemci **404** döner ve bu doğru davranıştır: istemci tarafı
 * fail-open olduğu için 404'ü "politika yok, kilitleme" diye okur. Boş bir
 * politika döndürmek, "kural yok" ile "kural okunamadı" arasındaki farkı
 * silerdi.
 */

/**
 * Mobil (Android tablet) politikası.
 *
 * ⚠️ POLİTİKA KENDİLİĞİNDEN MÜŞTERİYE ÖZELDİR: her fabrikanın kendi backend'i
 * var ve bu değeri O servis ediyor. Yayın kanalı (VPS'te müşteri bazlı yol) ile
 * politika AYRI eksenlerdir; birbirine bağlanmaz.
 *
 * ⚠️ `minVersion` = `versionName`, ama tabletin gerçek eşiği İKİ EKSENLİDİR —
 * bkz. `minPaketTarihi`. Yalnız birini yükseltmek diğerini kapsamaz.
 *
 * ⚠️ İSTEMCİ TARAFINDA KİLİT KOŞULLUDUR (Electron'dan bilinçli fark): tablet
 * yalnız düzeltme GERÇEKTEN kurulabilir durumdaysa kilitlenir. İnterneti kopuk
 * bir tableti kilitlemek, güncellemeyi indiremediği için ÇIKIŞI OLMAYAN bir
 * üretim durması olurdu; üstelik cihaz çevrimdışı yazabiliyor. Gerekçe:
 * docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md.
 *
 * Bugünkü değer: 2.9.8 = uzaktan güncellemeyi taşıyan İLK sürüm. Daha eskisi
 * güncelleyiciyi hiç taşımıyor, yani kapıyı gösterse bile kendini kurtaramaz —
 * onlar zaten elle gezilecek.
 */
export const MOBIL_VERSION_POLICY: ClientVersionPolicy = {
  minVersion: "1.0.0",
  currentVersion: "1.0.5",
};

/**
 * FAZ B'Yİ TAŞIMAYAN SON SÜRÜMLER — bir TAHMİN değil, ölçülmüş bir GEÇMİŞ.
 *
 * Faz B (barkod türünün sunucu tablosundan çözülmesi) bu sürümlerden SONRAKİ
 * her pakette vardır: değişiklik dala girdi, bu tabandan üretilecek her paket
 * onu taşır. ⇒ `minVersion > buradaki` ise bağlanan her istemci bu daldan
 * üretilmiştir, yani Faz B'yi taşır. İleriye dönük bir sürüm numarası
 * ("1.3.2 olacak") yazmak bir TAHMİN olurdu ve çürüdüğünü kimse görmezdi.
 *
 * Ölçüm 2026-09-22: `Electron/package.json` 1.3.1 · `mobil/app.json` 1.0.7.
 */
export const FAZ_B_ONCESI = { electron: "1.3.1", mobil: "1.0.7" } as const;

/**
 * FAZ D'Yİ (EMEKLİ BİÇİMLE SINIFLANDIRMA) TAŞIMAYAN SON SÜRÜMLER — Faz B'nin
 * birebir emsali, ve AYRI BİR EKSEN olması ÖLÇÜLMÜŞ bir gerekçeye dayanıyor:
 *
 * Faz B istemciye "biçim tablodan gelir" dedi ama tablo satırı SERİ BAŞINA TEK
 * biçim taşıyordu (`prefixes[]` × tek `dateSegment`/`digits`). Yani emekli bir
 * ön ek YÜRÜRLÜKTEKİ hane ile deneniyordu; hane 4 → 6 yapılınca dünkü kod
 * istemcide TANINMIYOR (ölçüldü 2026-09-23, sunucuda da aynıydı — D4② onu
 * düzeltti). Faz B'yi taşıyan ama Faz D'yi taşımayan bir tablet, biçim
 * değiştiği gün eski etiketleri okuyamaz.
 *
 * ⇒ OKUTULAN serinin biçim kilidi (C0b) İKİ eşiğe birden bakar. "minVersion
 * yükseldi" tek başına YETMEZ; `test_number_series_panel` bunu ölçer.
 *
 * Ölçüm 2026-09-23: `Electron/package.json` 1.3.1 · `mobil/app.json` 1.0.7.
 */
export const FAZ_D_ONCESI = { electron: "1.3.1", mobil: "1.0.7" } as const;

/** Sürüm karşılaştırması — SAYISAL, sözlüksel değil ("1.3.10" > "1.3.9"). */
export function compareClientVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Sahadaki İKİ OKUTAN istemci de Faz B'yi taşıyor mu? (`scanned` serilerin
 * biçim değişimi buna bağlıdır — `number-series.service`.)
 *
 * ⚠️ İKİ EKSEN BİRDEN: okutma hem panelde hem tablette yapılıyor; birini
 * güncelleyip ötekini unutmak tam da bu kapının engellediği şeydir.
 *
 * ⚠️ `web` ekseni MUAF ve gerekçesi ÖLÇÜLDÜ — ama "web okutma yapmıyor" DEĞİL:
 * özet kabuğu `operations` yollarını açıyor ve orada okutan yedi yüzey var
 * (`RollsPage` · `RollScanBar` · `KartelaTabs` · `SwatchesPanel` ·
 * `SacksListView` · `ReturnsPage` · `useReturnEntry`). Gerçek gerekçe
 * DRIFT'İN İMKÂNSIZ olmasıdır: web paketi backend'in İÇİNDE gider
 * (`deploy/paketle.ps1` → `dist-web`, `WEB_DIST_DIR` ile aynı origin'den
 * servis edilir), yani Faz B'yi taşıyan bir backend zorunlu olarak Faz B'yi
 * taşıyan bir web paketi servis eder. `minVersion`ın 1.0.0'da durmasının sebebi
 * de zaten budur (bu dosyanın `WEB_VERSION_POLICY` gerekçesi).
 */
export function scanningClientsCarryFazB(): boolean {
  return (
    compareClientVersions(ELECTRON_VERSION_POLICY.minVersion, FAZ_B_ONCESI.electron) > 0 &&
    compareClientVersions(MOBIL_VERSION_POLICY.minVersion, FAZ_B_ONCESI.mobil) > 0
  );
}

/**
 * Sahadaki iki okutan istemci EMEKLİ BİÇİMLERİ de çözebiliyor mu? (Faz D②)
 *
 * ⚠️ Faz B'den AYRI sorulur: Faz B "tabloyu oku" diyordu, Faz D "tablodaki
 * emekli BİÇİMLERİ de dene" diyor. Biri ötekini KAPSAMAZ — Faz B'li bir tablet
 * emekli ön eki yürürlükteki haneyle dener ve hane değişmişse okuyamaz.
 */
export function scanningClientsCarryFazD(): boolean {
  return (
    compareClientVersions(ELECTRON_VERSION_POLICY.minVersion, FAZ_D_ONCESI.electron) > 0 &&
    compareClientVersions(MOBIL_VERSION_POLICY.minVersion, FAZ_D_ONCESI.mobil) > 0
  );
}

/**
 * Kayıt defteri — yeni istemci eklemek route'a değil BURAYA bir satır.
 */
export const CLIENT_VERSION_POLICIES: Record<string, ClientVersionPolicy> = {
  electron: ELECTRON_VERSION_POLICY,
  mobil: MOBIL_VERSION_POLICY,
  web: WEB_VERSION_POLICY,
};
