// =============================================================================
// MENÜ DÜZENİ servisi (K19) — iki fabrika ayarı, tek yazar `PUT /api/menu-layout`
// =============================================================================
// Okuma süzgeçli: katalogda olmayan eski anahtar (silinmiş/adı değişmiş ekran) ve gizlenemez anahtar sessizce
// düşer. Yazma fail-closed: bilinmeyen anahtar 400 `MENU_SCREEN_UNKNOWN`, gizlenemez 400 `MENU_SCREEN_LOCKED`.
// Audit `systemSettingService.set()` içinde (ayar ayak izi). Kimlik ve güvenlik değil, yalnız menü sadeliği.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { SCREEN_CATALOG } from "../constants/screen-catalog";
import {
  MENU_ADVANCED_SCREENS,
  MENU_PRESETS,
  MENU_UNHIDEABLE_KEYS,
  MENU_UNHIDEABLE_SCREENS,
  isCatalogScreenKey,
  sanitizeHiddenScreens,
} from "../constants/menu-layout";
import { SETTING_KEYS, systemSettingService } from "./system-setting.service";

type SettingClient = Pick<typeof prisma, "systemSetting">;

export interface MenuLayout {
  hiddenScreens: string[];
  advancedGroup: boolean;
}

export interface MenuLayoutView extends MenuLayout {
  unhideable: Array<{ key: string; reason: string }>;
  advancedScreens: string[];
  presets: Array<{
    id: string;
    label: string;
    description: string;
    screens: Array<{ key: string; app: "desktop" | "mobile"; title: string; reason: string }>;
  }>;
}

/** Kayıt yok → bugünkü menü (hiçbiri gizli değil, Gelişmiş kapalı). */
export async function readMenuLayout(client: SettingClient = prisma): Promise<MenuLayout> {
  const rows = await client.systemSetting.findMany({
    where: { key: { in: [SETTING_KEYS.UI_MENU_HIDDEN_SCREENS, SETTING_KEYS.UI_MENU_ADVANCED_GROUP] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const adv = byKey.get(SETTING_KEYS.UI_MENU_ADVANCED_GROUP);
  return {
    hiddenScreens: sanitizeHiddenScreens(byKey.get(SETTING_KEYS.UI_MENU_HIDDEN_SCREENS)),
    advancedGroup: adv === true || adv === "true",
  };
}

const TITLE_BY_KEY = new Map(SCREEN_CATALOG.map((s) => [s.key, { title: s.title, app: s.app }]));

/** Panel + tablet okuması: ayar + gizlenemez küme + Gelişmiş listesi + hazır setler (önizleme için başlıklı). */
export async function getMenuLayoutView(): Promise<MenuLayoutView> {
  const layout = await readMenuLayout();
  return {
    ...layout,
    unhideable: MENU_UNHIDEABLE_SCREENS.map((s) => ({ ...s })),
    advancedScreens: [...MENU_ADVANCED_SCREENS],
    presets: MENU_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      screens: p.screens.map((s) => {
        const meta = TITLE_BY_KEY.get(s.key);
        return { key: s.key, app: meta?.app ?? "desktop", title: meta?.title ?? s.key, reason: s.reason };
      }),
    })),
  };
}

export interface MenuLayoutInput {
  hiddenScreens?: string[];
  advancedGroup?: boolean;
}

/** Yazım doğrulaması (saf): bilinmeyen ve gizlenemez anahtarlar ayrı listelenir. */
export function validateHiddenScreens(keys: readonly string[]): { unknown: string[]; locked: string[] } {
  return {
    unknown: keys.filter((k) => !isCatalogScreenKey(k)),
    locked: keys.filter((k) => MENU_UNHIDEABLE_KEYS.has(k)),
  };
}

export async function updateMenuLayout(input: MenuLayoutInput, userId: string): Promise<MenuLayoutView> {
  if (input.hiddenScreens !== undefined) {
    const { unknown, locked } = validateHiddenScreens(input.hiddenScreens);
    if (unknown.length > 0) {
      throw AppError.badRequest(`Tanınmayan ekran: ${unknown.join(", ")}`, { code: "MENU_SCREEN_UNKNOWN", keys: unknown });
    }
    if (locked.length > 0) {
      throw AppError.badRequest(`Bu ekranlar menüden gizlenemez: ${locked.join(", ")}`, { code: "MENU_SCREEN_LOCKED", keys: locked });
    }
    const unique = [...new Set(input.hiddenScreens)];
    await systemSettingService.set(
      SETTING_KEYS.UI_MENU_HIDDEN_SCREENS,
      unique as Prisma.InputJsonValue,
      "Menü düzeni: menüden gizlenen ekranlar (doğrudan bağlantı açılır; izin ayrı)",
      userId,
    );
  }
  if (input.advancedGroup !== undefined) {
    await systemSettingService.set(
      SETTING_KEYS.UI_MENU_ADVANCED_GROUP,
      input.advancedGroup,
      "Menü düzeni: teknik ekranlar kenar menüde kapalı duran Gelişmiş grubunda",
      userId,
    );
  }
  return getMenuLayoutView();
}
