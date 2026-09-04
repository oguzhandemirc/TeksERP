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
 * Kayıt defteri — yeni istemci eklemek route'a değil BURAYA bir satır.
 */
export const CLIENT_VERSION_POLICIES: Record<string, ClientVersionPolicy> = {
  electron: ELECTRON_VERSION_POLICY,
  mobil: MOBIL_VERSION_POLICY,
  web: WEB_VERSION_POLICY,
};
