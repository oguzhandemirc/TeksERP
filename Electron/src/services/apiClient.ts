import axios from "axios";
import { toast } from "sonner";
import { tokenStore } from "@/lib/secure-token";
import { getOrCreateDeviceId } from "@/lib/deviceId";
import { useAuthStore } from "@/store/auth";
import { useServerStatusStore } from "@/store/serverStatus";

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
  const token = await tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Bu PC'yi backend'e tanıt: Device → Machine çözümü (sevkiyat kantarı vb.).
  // Atanmamışsa backend normal çalışır (atıf null) — header zararsız.
  try {
    const deviceId = await getOrCreateDeviceId();
    if (deviceId) config.headers["x-device-id"] = deviceId;
  } catch {
    /* header yoksa backend etkilenmez */
  }
  return config;
});

let lastSessionExpiredToastAt = 0;

interface ApiErrorBody {
  message?: string;
  errors?: Array<{ field: string; message: string }>;
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
    // Her başarılı yanıt = backend ulaşılabilir + sunucu saati (Date header).
    useServerStatusStore.getState().markReachable(readDateHeader(response.headers));
    return response;
  },
  async (error) => {
    if (axios.isAxiosError(error)) {
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

      if (status === 401) {
        const isLoginRequest = error.config?.url?.includes("/api/auth/login");
        if (isLoginRequest) {
          toast.error(buildErrorMessage(body));
          return Promise.reject(error);
        }
        await tokenStore.clear();
        // Auth store'u temizle → App.tsx `Root` kapısı oturum-dışı router'a geçer.
        useAuthStore.getState().setUser(null);
        // L fix: oturum düşerken uçuştaki paralel istekler 401 yağmuru üretir —
        // 5sn tekilleştirme ile tek toast.
        if (Date.now() - lastSessionExpiredToastAt > 5000) {
          lastSessionExpiredToastAt = Date.now();
          // Sebebe göre backend NET mesaj döndürür (başka cihazdan giriş / şifre /
          // pasif); yoksa generic "süresi doldu". Yanlış bildirim vermeyelim.
          toast.error(body?.message || "Oturum süreniz doldu. Lütfen tekrar giriş yapın.");
        }
        return Promise.reject(error);
      }

      if (status === 403) {
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
