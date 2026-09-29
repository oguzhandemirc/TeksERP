import { useEffect } from "react";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";

/**
 * PDF FİLİGRANI (lisans Faz 2e): lisans sahibi + lisans numarasını main sürece bildirir; panelin
 * ürettiği her PDF'in meta verisine yazılır (`electron/ipc/pdf-metadata.ts`). Lisanssız kurulumda
 * ya da web kabuğunda (window.api yok) sessizce geçer.
 */
export function usePdfLicenseWatermark(): void {
  const status = useLicenseStatus();
  const owner = status?.lisansSahibi ?? null;
  const sahibi = owner ? `${owner.musteri} · ${owner.tesis}` : null;
  const no = status?.lisansNo ?? null;
  useEffect(() => {
    const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
    if (!pdfApi?.setLicenseMeta) return;
    void pdfApi.setLicenseMeta(sahibi && no ? { lisansSahibi: sahibi, lisansNo: no } : null).catch(() => undefined);
  }, [sahibi, no]);
}
