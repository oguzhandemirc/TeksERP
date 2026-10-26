// Maliyet modülünün ayar satırı kayıttan bulunur (`lib/flag-setting-path` tek yardımcısı); elle yol yazılmaz.
import { flagSettingPath, flagSettingTrail } from "@/lib/flag-setting-path";

const MALIYET_FLAG_FIELD = "maliyetEnabled";

export function maliyetSettingPath(): string {
  return flagSettingPath(MALIYET_FLAG_FIELD);
}

export function maliyetSettingTrail(): string {
  return flagSettingTrail(MALIYET_FLAG_FIELD);
}

export const MALIYET_CLOSED_TITLE = "Maliyet & Teklif modülü kapalı";
