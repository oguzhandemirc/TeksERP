// Barındırılan (bulut VDS) kurulumda yedek ŞİFRELİ olmak zorundadır (denetim 2026-11-01 K2): yedek canlı veriyle
// aynı diskte durur ve makine dışına yalnız `.tkenc` çekilir. Şifrelenemeyen yedek yine alınır (yedeksiz kalmaktan
// iyidir) ama sessiz kalmaz: sağlık KRİTİK, iş kırmızı, panel kırmızı. LAN kurulumu bu yüklemden hep `null` alır.
import { isHostedInstallation } from "./install-class.helper";
import { isEncryptedBackupName } from "./backup-naming.helper";

export interface HostedBackupInput {
  hosted: boolean;
  /** Backend ortamındaki `BACKUP_KEY_DIR` (boş = şifreleme kapalı). */
  keyDir: string | undefined;
  /** En yeni gece yedeğinin adı; yoksa null (yaş hükmü ayrıca KRİTİK verir). */
  nightlyName: string | null;
}

/** Barındırılan kurulumda şifresiz yedek sebebi; LAN'da ya da sorun yokken `null`. */
export function hostedPlainBackupReason(input: HostedBackupInput): string | null {
  if (!input.hosted) return null;
  if (!input.keyDir?.trim()) {
    return "Barındırılan kurulumda yedek şifrelemesi KAPALI (BACKUP_KEY_DIR yok) — yedekler şifresiz alınıyor ve makine dışına çekilmiyor.";
  }
  if (input.nightlyName && !isEncryptedBackupName(input.nightlyName)) {
    return `Son gece yedeği ŞİFRESİZ (${input.nightlyName}) — yedek anahtar dizininde alıcı (*.tkpub) yok ya da şifreleme düştü; makine dışına çekilmiyor.`;
  }
  return null;
}

/** Çalışan sürecin sınıfıyla kısa yol (sağlık ve yedek işi bunu çağırır). */
export function currentHostedPlainBackupReason(nightlyName: string | null): string | null {
  const hosted = isHostedInstallation();
  if (!hosted) return null;
  return hostedPlainBackupReason({ hosted, keyDir: process.env.BACKUP_KEY_DIR, nightlyName });
}
