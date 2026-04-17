import axios from "axios";
import { toast } from "sonner";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message =
        error.response?.data?.message ?? "Beklenmeyen bir hata oluştu";

      if (status === 401) {
        localStorage.removeItem("token");
        toast.error("Oturum süreniz doldu. Lütfen tekrar giriş yapın.");
        window.location.href = "/login";
        return Promise.reject(error);
      }

      if (status === 403) {
        toast.error("Bu işlem için yetkiniz bulunmuyor.");
        return Promise.reject(error);
      }

      if (status && status >= 400 && status < 500) {
        toast.error(message);
      }

      if (status && status >= 500) {
        toast.error("Sunucu hatası. Lütfen daha sonra tekrar deneyin.");
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
