import axios from "axios";
import { toast } from "sonner";
import { tokenStore } from "@/lib/secure-token";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use(async (config) => {
  const token = await tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message =
        (error.response?.data as { message?: string } | undefined)?.message ??
        "Beklenmeyen bir hata oluştu";

      if (status === 401) {
        await tokenStore.clear();
        toast.error("Oturum süreniz doldu. Lütfen tekrar giriş yapın.");
        window.location.hash = "#/login";
        return Promise.reject(error);
      }

      if (status === 403) {
        toast.error("Bu işlem için yetkiniz bulunmuyor.");
        return Promise.reject(error);
      }

      if (status && status >= 400 && status < 500) {
        toast.error(message);
      } else if (status && status >= 500) {
        toast.error("Sunucu hatası. Lütfen daha sonra tekrar deneyin.");
      } else if (!error.response) {
        toast.error("Sunucuya ulaşılamıyor.");
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
