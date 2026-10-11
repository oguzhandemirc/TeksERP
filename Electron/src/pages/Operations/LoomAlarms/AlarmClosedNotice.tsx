// =============================================================================
// "ALARM KAPALI" BİLDİRİMİ — liste ve alarm sayfası ortak
// =============================================================================
// Yol tarifi elle yazılmaz: ayar ekranları bölünüp adı değiştiğinde eski cümle kullanıcıyı
// olmayan bir menüye ("Genel Ayarlar") gönderiyordu. Yol ve bağlantı ayar kataloğundan türer.
// =============================================================================
import { Link } from "react-router-dom";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import {
  SETTINGS_ADMIN_PERMISSION,
  SETTINGS_CATEGORIES,
  settingsCategoryPath,
  settingsCategoryTrail,
  type SettingsCategory,
} from "@/pages/GeneralSettings/settings-config";
import { errorCodeOf } from "./alarm-access";

const ALARM_CATEGORY_ID = "tezgah";
const MODULES_CATEGORY_ID = "modules";

/** Kapalılığı çözen ayar kategorisi: bayrak → "Tezgah izleme" sekmesi, modül → Modüller. */
export function alarmClosedCategory(error: unknown): SettingsCategory | undefined {
  const id = errorCodeOf(error) === "MODULE_DISABLED" ? MODULES_CATEGORY_ID : ALARM_CATEGORY_ID;
  return SETTINGS_CATEGORIES.find((c) => c.id === id);
}

export function alarmClosedText(error: unknown): string {
  const cat = alarmClosedCategory(error);
  if (errorCodeOf(error) === "MODULE_DISABLED") {
    return `Tezgah izleme modülü bu kurulumda kapalı.${cat ? ` ${settingsCategoryTrail(cat)} ekranından açılır.` : ""}`;
  }
  return `Tezgah alarmı bu kurulumda kapalı.${cat ? ` ${settingsCategoryTrail(cat)} sekmesindeki "Tezgah alarmı" ayarından açılır.` : ""}`;
}

export function AlarmClosedNotice({ error }: { error: unknown }) {
  const { hasAnyPermission } = useRoleAccess();
  const cat = alarmClosedCategory(error);
  const canOpen = !!cat && hasAnyPermission(cat.permissionAny ?? [SETTINGS_ADMIN_PERMISSION]);
  return (
    <div className="space-y-3 py-16 text-center text-muted-foreground">
      <p>{alarmClosedText(error)}</p>
      {canOpen && cat ? (
        <Link to={settingsCategoryPath(cat)} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Ayarı aç
        </Link>
      ) : null}
    </div>
  );
}
