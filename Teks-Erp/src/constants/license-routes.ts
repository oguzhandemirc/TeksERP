// =============================================================================
// TeksERP — LİSANS KAPISI YOL LİSTELERİ (TEK KAYNAK)
// =============================================================================
// `licenseGate` isteği YÖNTEM + YOL ile sınıflar. Varsayılan KAPALI: KISITLI'da yazma,
// DURDURULMUŞ'ta her şey RED; açık olan her yol burada GEREKÇESİYLE beyanlıdır. Kapalı yolda
// kimlik önce gelir: oturumsuz istek rotanın 401'ini alır, yalnız kimlik istemeyen uçlarda
// (`PUBLIC_ROUTES`) kapı genel `LICENSE_GATE` döner. Bekçi: `scripts/test_lisans_kapisi.ts`
// (rota envanterine karşı: ölü desen yok · K5 ⊂ K4 · kimliksiz uç listesi envanterle birebir).
// =============================================================================
import type { StateTier } from "../lib/license/protocol";

export type LicenseRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "*";

/** `path`: Express biçimi — `:ad` tek segment, sondaki `*` kalan her şey (0+ segment). */
export interface LicenseRouteRule {
  readonly method: LicenseRouteMethod;
  readonly path: string;
  readonly reason: string;
}

/** Güvenli yöntemler: KISITLI kipte okuma serbesttir (okuma + rapor + dışa aktarma). */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * K5 "verilerimi al" yolları — `GET /api/license/veri-disari` bunları istemciye bildirir.
 * HER kademede açıktır; yönetici kısıtı uçların KENDİ izin guard'ındadır, kapıda değil.
 */
export const DATA_EXPORT_PATHS = {
  yedekAl: "POST /api/admin/backup",
  yedekListesi: "GET /api/admin/backups",
  yedekIndir: "GET /api/admin/backups/{ad}/download",
  varliklar: "GET /api/import/entities",
  disariAktar: "GET /api/import/{entity}/export",
} as const;

function ruleFromExportPath(spec: string): LicenseRouteRule {
  const [method, path] = spec.split(" ");
  return {
    method: method as LicenseRouteMethod,
    path: path.replace(/\{([A-Za-z0-9_]+)\}/g, ":$1"),
    reason: "verilerimi al: yedek + dışa aktarma (TCK 244 — veri erişimi her kademede açık)",
  };
}

/** HER kademede açık — lisans ekranı, giriş ve kurtarma yolları. */
export const ALWAYS_OPEN_ROUTES: readonly LicenseRouteRule[] = [
  { method: "*", path: "/api/license/*", reason: "lisans ekranı: durum, etkinleştirme, çevrimdışı/aktarma, taşıma, DR" },
  { method: "GET", path: "/api/admin/health", reason: "sunucu durumu; lisans kilidi burada görünür" },
  { method: "GET", path: "/api/mobile/updates/*", reason: "tablet OTA kurtarması (giriş öncesi, kimliksiz)" },
  { method: "GET", path: "/api/client-policy/*", reason: "panel sürüm politikası (giriş öncesi güncelleme kurtarması)" },
  { method: "GET", path: "/api/discovery/identity", reason: "servis keşfi: istemci sunucuyu tanır" },
  { method: "GET", path: "/api/auth/login-methods", reason: "giriş ekranı açık giriş yöntemlerini öğrenir" },
  { method: "POST", path: "/api/auth/login", reason: "giriş (K5'te yönetici 'verilerimi al' için girer)" },
  { method: "POST", path: "/api/auth/login-card", reason: "kartla giriş" },
  { method: "POST", path: "/api/auth/login-quick-pin", reason: "PIN ile giriş" },
  { method: "POST", path: "/api/auth/logout", reason: "oturum kapatma daima mümkün" },
  // Giriş akışının parçası: sıfırlanan yönetici TOTP'yi kuramazsa K5'te "verilerimi al" için giremez.
  { method: "GET", path: "/api/auth/totp/enroll", reason: "iki adımlı doğrulama kurulumu (giriş akışı; K5'te veri erişimi için)" },
  { method: "POST", path: "/api/auth/totp/enroll", reason: "iki adımlı doğrulama kurulumu (giriş akışı; K5'te veri erişimi için)" },
  // Kilitli kurulum da satıcıya ulaşabilmeli: destek talebi kurtarma yoludur, iş verisi yazmaz.
  { method: "*", path: "/api/destek", reason: "satıcıya destek talebi aç / talepleri gör (kurtarma yolu)" },
  { method: "GET", path: "/api/destek/:id", reason: "destek talebi ve satıcı yanıtları (kurtarma yolu)" },
];

/** KISITLI kipte AYRICA açık yazmalar (okuma zaten serbest). Beyan dışı her yazma RED. */
export const RESTRICTED_OPEN_ROUTES: readonly LicenseRouteRule[] = [
  // Kişisel tercih ve iki adımlı doğrulama
  { method: "PUT", path: "/api/auth/preferences", reason: "kişisel tercih; iş verisi değil" },
  { method: "POST", path: "/api/admin/users/:id/totp/window", reason: "iki adımlı doğrulama kurulum penceresi — sıfırlanan kullanıcı yeniden kurabilsin (güvenlik)" },
  { method: "POST", path: "/api/devices/announce", reason: "cihaz duyurusu (tablet el sıkışması)" },
  // DB'ye yazmayan önizleme / gövdeli okuma
  { method: "POST", path: "/api/number-series/preview", reason: "numara biçimi önizlemesi; yazmaz" },
  { method: "POST", path: "/api/work-orders/:id/manual-move-preview", reason: "elle taşıma önizlemesi; yazmaz" },
  { method: "POST", path: "/api/tambur/manual/bring-preview", reason: "tambur önizlemesi; yazmaz" },
  { method: "POST", path: "/api/tambur/manual/send-to-dye-preview", reason: "tambur önizlemesi; yazmaz" },
  { method: "POST", path: "/api/labels/preview/html", reason: "etiket önizlemesi; yazmaz" },
  { method: "POST", path: "/api/labels/preview/native-text", reason: "etiket önizlemesi; yazmaz" },
  { method: "POST", path: "/api/label-templates/preview", reason: "şablon önizlemesi; yazmaz" },
  { method: "POST", path: "/api/label-templates/preview-raw", reason: "şablon önizlemesi; yazmaz" },
  { method: "POST", path: "/api/shipping/sacks/distribute/preview", reason: "dağıtım önizlemesi; yazmaz" },
  { method: "POST", path: "/api/shipping/shipments/preview", reason: "sevkiyat önizlemesi; yazmaz" },
  { method: "POST", path: "/api/shipping/sacks/mismatch-check", reason: "gövdeli okuma (READ izni); yazmaz" },
  { method: "POST", path: "/api/shipping/sack-search/content-dump", reason: "çuval içerik raporu (READ izni); yazmaz" },
  { method: "POST", path: "/api/shipping/sack-search/pick-list", reason: "toplama listesi raporu (READ izni); yazmaz" },
  { method: "POST", path: "/api/orders/order-lines/coverage", reason: "karşılama hesabı (gövdeli okuma); yazmaz" },
  { method: "POST", path: "/api/rolls/stats-batch", reason: "top istatistikleri (gövdeli okuma); yazmaz" },
  { method: "POST", path: "/api/import/:entity/preview", reason: "içe aktarım önizlemesi; yazmaz" },
  { method: "POST", path: "/api/master-data/:entity/merge/preview", reason: "birleştirme önizlemesi; yazmaz" },
  { method: "POST", path: "/api/config-bundle/preview", reason: "yapılandırma paketi planı; yazmaz" },
  { method: "POST", path: "/api/printed-documents/:docType/sample-html", reason: "belge örneği; yazmaz" },
  { method: "POST", path: "/api/traveler-cards/sample-html", reason: "refakat kartı örneği; yazmaz" },
  { method: "POST", path: "/api/traveler-templates/inspect", reason: "şablon incelemesi; yazmaz" },
  // Baskı ve yeniden basım (yalnız ayak izi yazar; yeni resmi belge sürümü DEĞİL)
  { method: "POST", path: "/api/labels/rolls/:id/print", reason: "etiket baskı ayak izi (yeniden basım)" },
  { method: "POST", path: "/api/labels/rolls/:id/print-native", reason: "etiket yeniden basımı" },
  { method: "POST", path: "/api/labels/rolls/bulk-html", reason: "toplu etiket yeniden basımı" },
  { method: "POST", path: "/api/labels/rolls/bulk-native", reason: "toplu etiket yeniden basımı" },
  { method: "POST", path: "/api/labels/sacks/:id/print-event", reason: "çuval etiketi baskı ayak izi" },
  { method: "POST", path: "/api/labels/test-native", reason: "yazıcı deneme baskısı; iş verisi yazmaz" },
  { method: "POST", path: "/api/traveler-cards/:id/print-event", reason: "refakat kartı baskı ayak izi" },
  { method: "POST", path: "/api/work-orders/:id/traveler-cards/reprint", reason: "refakat kartı yeniden basımı" },
  { method: "POST", path: "/api/shipping/sack-search/pick-list/print", reason: "toplama listesi baskısı" },
  // Yedek (al · makine dışı kopya · DB kopyası)
  { method: "POST", path: "/api/admin/backup", reason: "yedek al (veri erişimi)" },
  { method: "PATCH", path: "/api/admin/backups/offsite", reason: "yedeğin makine dışı kopyası (veri erişimi)" },
  { method: "POST", path: "/api/admin/backups/offsite/test", reason: "makine dışı yedek bağlantı denemesi" },
  { method: "POST", path: "/api/admin/backups/offsite/sweep", reason: "makine dışı yedek süpürmesi" },
  { method: "POST", path: "/api/admin/backups/offsite/authorize", reason: "makine dışı yedek yetkilendirmesi" },
  { method: "POST", path: "/api/admin/db-copies", reason: "DB kopyası (veri erişimi)" },
  { method: "POST", path: "/api/admin/db-copies/:name/verify", reason: "DB kopyası doğrulaması" },
  { method: "DELETE", path: "/api/admin/db-copies/:name", reason: "DB kopyası temizliği (disk); iş verisi değil" },
  // Güvenlik: işten çıkan biri kısıtlı kipte de kapatılabilmeli
  { method: "POST", path: "/api/admin/users/:id/deactivate", reason: "kullanıcıyı pasifleştirme (güvenlik)" },
  { method: "POST", path: "/api/admin/users/:id/reset-password", reason: "parola sıfırlama (güvenlik)" },
  { method: "POST", path: "/api/admin/users/:id/totp/reset", reason: "iki adımlı doğrulama sıfırlama (güvenlik)" },
  { method: "POST", path: "/api/admin/devices/:id/revoke", reason: "cihaz iptali (güvenlik)" },
  // Bakım ve çalışma oturumu
  { method: "POST", path: "/api/admin/sessions/purge", reason: "bakım: eski oturum budaması (telemetri)" },
  { method: "POST", path: "/api/admin/system-logs/archive", reason: "bakım: denetim kaydı arşivi" },
  { method: "POST", path: "/api/work-sessions", reason: "çalışma oturumu aç" },
  { method: "POST", path: "/api/work-sessions/close", reason: "çalışma oturumu kapat" },
  { method: "POST", path: "/api/work-sessions/:id/force-close", reason: "çalışma oturumu kapat (yönetici)" },
];

/** DURDURULMUŞ (K5) kipte açık olanlar: yalnız her-kademe listesi + "verilerimi al". */
export const SUSPENDED_OPEN_ROUTES: readonly LicenseRouteRule[] = [
  ...Object.values(DATA_EXPORT_PATHS).map(ruleFromExportPath),
  { method: "GET", path: "/api/auth/me", reason: "oturum sahibi ve izinleri — 'verilerimi al' ekranı yetkiyi çözer" },
];

/**
 * KİMLİK İSTEMEYEN uçlar (`test_route_auth_coverage` muaf listesinin kapıdaki karşılığı).
 * Kapalı bir yolda oturumsuz istek rotaya geçer ve rotanın `verifyToken`ı 401 döner; bu
 * uçlarda geçecek bir kimlik duvarı olmadığından kapı kendisi genel `LICENSE_GATE` döner.
 * Bekçi listeyi rota envanterinin kimliksiz uçlarıyla İKİ YÖNLÜ ölçer — eksik satır bir
 * kaçak yoldur (oturumsuz istek kapıyı rotaya geçerek atlar).
 */
export const PUBLIC_ROUTES: readonly LicenseRouteRule[] = [
  { method: "GET", path: "/api/discovery/identity", reason: "servis keşfi; istemci sunucuyu tanımadan çağırır" },
  { method: "GET", path: "/api/auth/login-methods", reason: "giriş ekranı" },
  { method: "POST", path: "/api/auth/login", reason: "token üreten uç" },
  { method: "POST", path: "/api/auth/login-card", reason: "token üreten uç" },
  { method: "POST", path: "/api/auth/login-quick-pin", reason: "token üreten uç" },
  { method: "GET", path: "/api/auth/mobile-users", reason: "tablet giriş ekranı kullanıcı listesi" },
  { method: "GET", path: "/api/auth/totp/enroll", reason: "iki adımlı doğrulama kurulumu; koruma tek kullanımlık token" },
  { method: "POST", path: "/api/auth/totp/enroll", reason: "iki adımlı doğrulama kurulumu; koruma tek kullanımlık token" },
  { method: "POST", path: "/api/devices/announce", reason: "cihaz el sıkışması; eşleşmeden token yok" },
  { method: "GET", path: "/api/devices/status", reason: "cihaz atama durumu yoklaması" },
  { method: "GET", path: "/api/devices/pairing-required", reason: "eşleşme zorunluluğu (giriş öncesi)" },
  { method: "GET", path: "/api/mobile/updates/*", reason: "tablet OTA (giriş öncesi)" },
  { method: "GET", path: "/api/client-policy/*", reason: "panel sürüm politikası (giriş öncesi)" },
  { method: "GET", path: "/api/license/durum", reason: "lisans bandı; kimliksize ayrıntı yok" },
  { method: "GET", path: "/api/license/indirme-belirteci", reason: "onaylı cihaz ya da oturum" },
];

/** Adı açık listeye benzeyen ama BİLEREK kapalı yazmalar (bekçi bunları sınıflı sayar). */
export const DECLARED_CLOSED_ROUTES: readonly LicenseRouteRule[] = [
  { method: "POST", path: "/api/printed-documents/:docType/:sourceId/reissue", reason: "yeni resmi belge sürümü = yeni iş" },
  { method: "POST", path: "/api/labels/rolls/:id/seed-snapshot", reason: "etiket içeriğini dondurur (yazma)" },
  { method: "POST", path: "/api/labels/rolls/seed-snapshot-bulk", reason: "etiket içeriğini dondurur (yazma)" },
];

function splitPath(path: string): string[] {
  const parts = path.split("/");
  if (parts[0] === "") parts.shift();
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Express'le aynı: sabit segment büyük/küçük harf duyarsız, `:ad` boş olmayan tek segment. */
export function routePatternMatches(pattern: string, path: string): boolean {
  const pat = splitPath(pattern);
  const segs = splitPath(path);
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i];
    if (p === "*" && i === pat.length - 1) return true;
    const s = segs[i];
    if (s === undefined || s === "") return false;
    if (p.startsWith(":")) continue;
    if (p.toLowerCase() !== s.toLowerCase()) return false;
  }
  return segs.length === pat.length;
}

export function ruleMatches(rule: LicenseRouteRule, method: string, path: string): boolean {
  const m = method.toUpperCase();
  const methodOk = rule.method === "*" || rule.method === m || (rule.method === "GET" && m === "HEAD");
  return methodOk && routePatternMatches(rule.path, path);
}

function anyMatch(rules: readonly LicenseRouteRule[], method: string, path: string): boolean {
  return rules.some((r) => ruleMatches(r, method, path));
}

/** Uç kimlik istemiyor mu — kapalı yolda oturumsuz isteğe rotanın 401'i yerine `LICENSE_GATE`. */
export function isPublicRoute(method: string, path: string): boolean {
  return anyMatch(PUBLIC_ROUTES, method, path);
}

/** İstek bu kademede açık mı? Tanınmayan kademe fail-closed (RED). */
export function isOpenInTier(tier: StateTier, method: string, path: string): boolean {
  if (tier === "NORMAL" || tier === "UYARI" || tier === "EK_SURE") return true;
  if (anyMatch(ALWAYS_OPEN_ROUTES, method, path)) return true;
  if (tier === "KISITLI") {
    return SAFE_METHODS.has(method.toUpperCase()) || anyMatch(RESTRICTED_OPEN_ROUTES, method, path);
  }
  if (tier === "DURDURULMUS") return anyMatch(SUSPENDED_OPEN_ROUTES, method, path);
  return false;
}
