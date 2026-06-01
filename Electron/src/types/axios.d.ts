import "axios";

// Bir isteğe özel: response interceptor'ın genel hata toast'ını bastır.
// Çağıran kendi (daha anlamlı) mesajını göstermek istediğinde kullanılır —
// örn. tercih kaydı: "Tercihlerin kaydedilemedi" gibi tek, bağlama özel toast.
declare module "axios" {
  export interface AxiosRequestConfig {
    suppressErrorToast?: boolean;
  }
}
