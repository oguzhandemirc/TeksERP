import axios from "axios";
import { toast } from "sonner";
import { tokenStore } from "@/lib/secure-token";
import { useAuthStore } from "@/store/auth";
import { useServerStatusStore } from "@/store/serverStatus";
import { recordNetSample } from "@/services/netStats";
import { applyClientInfoHeaders } from "@/lib/client-info";
import { shouldToastWarnings, showServerWarnings } from "@/lib/serverNotes";

/** İstek süresi ölçümü için config'e damgalanan başlangıç zamanı. */
interface TimedConfig {
  __startedAt?: number;
}

function sampleFromConfig(
  config: { method?: string; url?: string } | undefined,
  status: number | "ERR" | "TIMEOUT",
  startedAt: number | undefined,
): void {
  if (!startedAt) return;
  recordNetSample({
    method: (config?.method ?? "GET").toUpperCase(),
    url: config?.url ?? "?",
    status,
    ms: Date.now() - startedAt,
    at: Date.now(),
  });
}

/** Yanıt header'ından `Date`'i (sunucu saati) güvenli oku — yoksa undefined. */
function readDateHeader(headers: unknown): string | undefined {
  const d = (headers as Record<string, unknown> | undefined)?.date;
  return typeof d === "string" ? d : undefined;
}

/**
 * Build sırasında gömülen varsayılan adres. Çalışma anında kullanıcı bunu
 * yerel ayardan değiştirebilir — bkz. `@/lib/api-config` (açılışta `baseURL`'e
 * uygulanır). Kayıtlı adres yoksa bu değer geçerli kalır.
 */
export const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

const apiClient = axios.create({
  baseURL: DEFAULT_API_BASE_URL,
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use(async (config) => {
  (config as TimedConfig).__startedAt = Date.now();
  const token = await tokenStore.get();
  // Per-istek açık Authorization (ör. logout revoke'unun YAKALANMIŞ token'ı)
  // EZİLMEZ — aksi hâlde logout→anında re-login yarışında revoke isteği yeni
  // oturumun token'ıyla gidip YENİ oturumu iptal ederdi.
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // İSTEMCİ KÜNYESİ (`X-Client-*`) — Sistem → Bağlı İstemciler ekranını besler.
  // BİLGİLENDİRME, kimlik kanıtı DEĞİL; sunucuda hiçbir kapı bu başlıklara
  // bakmaz (bkz. `@/lib/client-info` ve backend `constants/client-info.ts`).
  // `x-device-id`den AYRI bir başlıktır — aşağıdaki nottaki deadlock kapısına
  // dokunmaz.
  await applyClientInfoHeaders((name, value) => {
    config.headers[name] = value;
  });
  // NOT: Masaüstü panel BİLEREK `x-device-id` GÖNDERMEZ. Gönderdiğinde,
  // `devicePairingRequired` (cihaz-onay kapısı) açıkken backend'in device
  // middleware'i onaysız cihaz sayıp Electron'un TÜM isteklerini 401
  // DEVICE_INACTIVE ile keser → ayarı açan admin paneline de giremez (deadlock,
  // bkz. [[device-pairing-lockout]]). Kapı yalnız saha tabletleri içindir.
  // Eski tek kullanım (for-device kantar çözümü) yerel kantar ayarına taşındı
  // (useMachineScale: config.scaleDevice → backend'e uğramaz).
  return config;
});

let lastSessionExpiredToastAt = 0;
/** Access 403 yağmurunda tek toast (401 dalındaki tekilleştirmenin ikizi). */
let lastAccessToastAt = 0;

interface ApiErrorBody {
  message?: string;
  errors?: Array<{ field: string; message: string }>;
  /** `AppError` ayrıntısı — hata KODU burada yaşar (`details.code`). */
  details?: { code?: string };
}

/**
 * YAKALANAN BİR HATADAN kullanıcıya gösterilecek mesaj — TEK KAYNAK.
 *
 * ⚠️ `response.data.message`i TEK BAŞINA okumak YETMEZ ve bu ölçüldü (d3,
 * 2026-09-23): Zod doğrulaması alan-bazlı `errors[]` döndürüyor ve gövdedeki
 * `message` yalnız "Validasyon hatası" diyor. Toast'ı basan yol bunu zaten
 * biliyordu (`buildErrorMessage`), ama hatayı KENDİ yüzeyinde gösteren ekranlar
 * ikinci bir okuma yazıp alan mesajını kaybediyordu — "türetilmiş alan / ayrışan
 * yüzey" sınıfı. Ekran bu yardımcıyı çağırır, kendi okumasını yazmaz.
 */
export function apiErrorMessage(e: unknown, yedek = "Beklenmeyen bir hata oluştu"): string {
  const body = (e as { response?: { data?: ApiErrorBody } } | undefined)?.response?.data;
  if (!body) return yedek;
  return buildErrorMessage(body) || yedek;
}

/** Backend validation errors → tek satır okunabilir mesaj. */
function buildErrorMessage(body: ApiErrorBody | undefined): string {
  const fieldErrors = body?.errors ?? [];
  if (fieldErrors.length > 0) {
    return fieldErrors.map((e) => e.message).join(" • ");
  }
  return body?.message ?? "Beklenmeyen bir hata oluştu";
}

apiClient.interceptors.response.use(
  (response) => {
    sampleFromConfig(
      response.config,
      response.status,
      (response.config as TimedConfig).__startedAt,
    );
    // Her başarılı yanıt = backend ulaşılabilir + sunucu saati (Date header).
    useServerStatusStore.getState().markReachable(readDateHeader(response.headers));
    // Sunucunun engel olmayan notu (`warnings`) her yazım yanıtında GENEL basılır —
    // servis zarfı soysa da; ekranı kendi gösteren/otomatik istek `serverWarnings` taşır.
    if (shouldToastWarnings(response.config, response.data)) showServerWarnings(response.data as { warnings?: unknown });
    return response;
  },
  async (error) => {
    if (axios.isAxiosError(error)) {
      sampleFromConfig(
        error.config,
        error.response?.status ?? (error.code === "ECONNABORTED" ? "TIMEOUT" : "ERR"),
        (error.config as TimedConfig | undefined)?.__startedAt,
      );
      // Sunucu cevap verdiyse (4xx/5xx dahil) ulaşılabilir sayılır; yanıt hiç
      // yoksa (ağ hatası/timeout) offline. Toast bastırılmış olsa da durum güncellenir.
      if (error.response) {
        useServerStatusStore.getState().markReachable(readDateHeader(error.response.headers));
      } else if (error.code !== "ECONNABORTED") {
        // O7 fix: istemci timeout'u (ECONNABORTED) ≠ sunucu kapalı — ağır rapor/
        // büyük indirme 15sn'i aşınca sidebar yanlışlıkla "offline"a düşüyordu.
        // Yalnız gerçek ağ hatasında unreachable işaretle.
        useServerStatusStore.getState().markUnreachable();
      }
      const status = error.response?.status;
      const body = error.response?.data as ApiErrorBody | undefined;
      // İstek kendi hata mesajını gösterecekse genel toast'ı atla (duplicate önle).
      const suppressToast = Boolean(error.config?.suppressErrorToast);

      // AYAR ŞİFRESİ KAPISI — toast'ı `withSettingsPassword` yönetir.
      // ⚠️ Genel 403 toast'ı ("Bu işlem için yetkiniz bulunmuyor") burada
      // YANLIŞ bir cümledir: kullanıcının yetkisi vardır, sorulan şey niyet
      // ispatıdır — ve diyalog zaten açılacaktır. 429 LOCKED'ın kalan-süre
      // cümlesi de tek yerden basılır, yoksa çift toast çıkardı.
      // Kapsam DAR: yalnız `SETTINGS_PASSWORD*` kodları; başka 403'ler
      // bugünkü davranışını korur.
      if (typeof body?.details?.code === "string" &&
          body.details.code.startsWith("SETTINGS_PASSWORD")) {
        return Promise.reject(error);
      }

      if (status === 401) {
        const isLoginRequest = error.config?.url?.includes("/api/auth/login");
        if (isLoginRequest) {
          toast.error(buildErrorMessage(body));
          return Promise.reject(error);
        }
        // Tek-uçuş guard'ı (Faz 2 §E4): 401 yağmurunda her istek ayrı IPC/disk
        // temizliği koşturuyordu; oturum zaten kapalıysa (manuel logout sonrası
        // arka plan istekleri dahil) temizliği VE toast'ı atla. setUser(null)
        // SENKRON önce → sonraki 401 handler'ları kapıyı kapalı görür.
        const hadUser = Boolean(useAuthStore.getState().user);
        if (hadUser) {
          // Auth store'u temizle → App.tsx `Root` kapısı oturum-dışı router'a geçer.
          useAuthStore.getState().setUser(null);
          try {
            await tokenStore.clear();
          } catch {
            // Bellek cache'i clear'ın ilk satırında null'landı (istekler token'ı
            // bıraktı); disk silme hatası oturum-doldu bildirimini engellemesin.
          }
          // L fix: oturum düşerken uçuştaki paralel istekler 401 yağmuru üretir —
          // 5sn tekilleştirme ile tek toast.
          if (Date.now() - lastSessionExpiredToastAt > 5000) {
            lastSessionExpiredToastAt = Date.now();
            // Sebebe göre backend NET mesaj döndürür (başka cihazdan giriş / şifre /
            // pasif); yoksa generic "süresi doldu". Yanlış bildirim vermeyelim.
            toast.error(body?.message || "Oturum süreniz doldu. Lütfen tekrar giriş yapın.");
          }
        }
        return Promise.reject(error);
      }

      if (status === 403) {
        // UZAK ERİŞİM OTURUMU (Cloudflare Access) DÜŞTÜ — yetki sorunu DEĞİL.
        //
        // ⚠️ 2026-09-04'te ölçüldü: bu 403 aşağıdaki genel dala düşüyor ve
        // **"Bu işlem için yetkiniz bulunmuyor"** basıyordu. Patronun gördüğü
        // tablo iki YANLIŞ teşhisten oluşuyordu — burada "yetkin yok", aynı anda
        // `BossPage`in sorgu hatasında "fabrika sunucusuna ulaşılamıyor" — ve
        // DOĞRU eylem (sayfayı yenile, Cloudflare girişini tekrarla) hiçbir
        // yerde yazmıyordu. Kod artık `details.code`ta geliyor
        // (`remote-access.middleware.accessDenied`).
        //
        // Oturum TEMİZLENMEZ: ERP oturumu geçerli, düşen şey KENARDAKİ Access
        // oturumudur. Çıkış yaptırmak, yeniden giriş yaptırıp aynı duvara
        // toslatırdı. Yenileme kullanıcının kararı — tam ekran bir kapı basmak
        // yarım doldurulmuş formu kaybettirir (şerit/modal ayrımı).
        if (
          typeof body?.details?.code === "string" &&
          body.details.code.startsWith("ACCESS_ASSERTION")
        ) {
          if (Date.now() - lastAccessToastAt > 5000) {
            lastAccessToastAt = Date.now();
            toast.error(buildErrorMessage(body), {
              action: { label: "Yenile", onClick: () => window.location.reload() },
            });
          }
          return Promise.reject(error);
        }
        const isLoginRequest = error.config?.url?.includes("/api/auth/login");
        if (isLoginRequest) {
          // Login-403 (ör. yalnız-mobil hesap masaüstü paneline giremez) →
          // backend'in NET mesajını göster (401 ile simetrik, suppress'e bağlı değil).
          toast.error(buildErrorMessage(body));
          return Promise.reject(error);
        }
        // KAPALI MODÜL yetki sorunu değildir (K26): kurulumun kararıdır; "yetkiniz yok" kullanıcıyı
        // rolünü aramaya yollar. Aynı modülün paralel istekleri TEK toast'ta birleşir (sonner `id`).
        if (body?.details?.code === "MODULE_DISABLED") {
          const msg = body.message || "Bu modül bu kurulumda kapalı.";
          if (!suppressToast) toast.error(msg, { id: `module-disabled:${msg}` });
          return Promise.reject(error);
        }
        if (!suppressToast) toast.error("Bu işlem için yetkiniz bulunmuyor.");
        return Promise.reject(error);
      }

      if (!suppressToast) {
        if (status && status >= 400 && status < 500) {
          toast.error(buildErrorMessage(body));
        } else if (status && status >= 500) {
          toast.error("Sunucu hatası. Lütfen daha sonra tekrar deneyin.");
        } else if (!error.response) {
          toast.error("Sunucuya ulaşılamıyor.");
        }
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
