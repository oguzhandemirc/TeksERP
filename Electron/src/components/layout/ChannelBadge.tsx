import { CHANNEL_LABEL, CHANNEL_NAME } from "@shared/channel";
import { GROUP_FLOW } from "@shared/update-feed";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import type { LicenseClass } from "@/types/license";

/**
 * Deneme kurulumunun görünür işareti — pencerenin kendi başlığında (`Topbar` · `LoginPage`), pencere
 * düğmelerinin yanında.
 *
 * ⚠️ NEDEN VAR: deneme kurulumunun ekranları fabrikayla birebir aynıdır; işaret olmadan kullanıcı hangi
 * programda olduğunu ayırt edemez ve gerçek işi denemeye girer. Etiket GÖSTERİMDİR, davranış değildir.
 *
 * Kaynak: eski kanal paketinde derleme anında kanal kaydı (`deploy/kanallar.json` → `gorunurEtiket`; üretim
 * kanalında `null` → bugünkü görünüm birebir). Tek ortak pakette paket kimseyi tanımaz: işaret LİSANS
 * SINIFINDAN gelir (oturum açılınca; giriş ekranında lisans özeti yok → çizilmez).
 */
const SINIF_ETIKETI: Partial<Record<LicenseClass, string>> = { TEST: "TEST", DEMO: "DEMO" };

/** Lisans sınıfının görünür işareti; üretim ve diğer sınıflar → null. */
export function licenseClassLabel(sinif: LicenseClass | null | undefined): string | null {
  return (sinif && SINIF_ETIKETI[sinif]) || null;
}

export function ChannelBadge() {
  const sinif = useLicenseStatus()?.sinif;
  const label = CHANNEL_LABEL ?? (GROUP_FLOW ? licenseClassLabel(sinif) : null);
  if (!label) return null;
  const title = CHANNEL_LABEL
    ? `${CHANNEL_NAME} — deneme kanalı. Burada gerçek iş girilmez.`
    : `Bu kurulumun lisansı ${label} sınıfında — deneme kurulumu. Burada gerçek iş girilmez.`;
  return (
    <span
      data-channel-badge=""
      title={title}
      className="flex items-center rounded-md border border-rose-500/60 bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400"
    >
      {label}
    </span>
  );
}
