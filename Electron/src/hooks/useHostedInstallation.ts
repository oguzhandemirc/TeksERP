import { useLicenseStatus } from "./useLicenseStatus";

/**
 * Barındırılan (bulut VDS) kurulum mu — lisans sınıfından. Panel yalnız sınıf kilidini GÖSTERİR;
 * kilidi sunucu uygular (409 HOSTED_CLASS_FORCED), ölçülemeyen durumda bugünkü (kilitsiz) görünüm.
 */
export function useHostedInstallation(): boolean {
  return useLicenseStatus()?.sinif === "BARINDIRILAN";
}

/** Oturum ayarındaki sınıf kilidi notu (sunucu: autoLogout kilitli açık, masaüstü/tarayıcı ≤ 24 sa). */
export const HOSTED_SESSION_LOCK_NOTE =
  "Bulut kurulumu: otomatik çıkış kapatılamaz; bilgisayar ve tarayıcı oturumu en çok 24 saat sürer.";
