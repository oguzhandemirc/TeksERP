// =============================================================================
// PROFİL TERCİH KİLİDİ — kişinin kendi yazımında "uygulama içi" seçimin donması (2026-11-19)
// =============================================================================
// Kilit çözümü DEĞİŞTİRMEZ; yalnız kişinin KENDİ yazımını kapatır. Kilitli mi sorusu tek yüklemde
// (`preferenceLockProfiles`, fail-closed birleşim); bu dosya istemci görünümü + değişmezlik denetimini taşır.
// =============================================================================
import { AppError } from "../../utils/app-error";
import { getNotificationEntry, NOTIFICATION_KINDS, type NotificationKanal, type NotificationKind } from "../../constants/notification-catalog";
import { NOTIFICATION_PREFS_LOCKED_CHANNELS, notificationScopeSchema } from "../../constants/notification-preference";
import { canSeeNotificationType, type NotificationVisibilityEnv } from "./notification-visibility.helper";
import {
  channelEnabled,
  preferenceLockProfiles,
  prefKey,
  resolvePreference,
  type PreferenceLayers,
  type PreferenceSubject,
} from "./notification-preference.helper";

const isKind = (k: string): k is NotificationKind => (NOTIFICATION_KINDS as readonly string[]).includes(k);

/** İstemcinin salt-okunur kararı: `kilitli` + kilitleyen profiller + donan kanallar (eski istemci alanı yok sayar). */
export function lockView(layers: PreferenceLayers, userId: string) {
  const profiller = preferenceLockProfiles(layers, userId);
  return { kilitli: profiller.length > 0, profiller, kanallar: profiller.length > 0 ? [...NOTIFICATION_PREFS_LOCKED_CHANNELS] : [] };
}

export const isFrozenChannel = (ch: string): boolean => (NOTIFICATION_PREFS_LOCKED_CHANNELS as readonly string[]).includes(ch);

/** Anahtar sırasından bağımsız karşılaştırma (kaydedilmiş kapsam ↔ gövdedeki kapsam). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

function scopeKey(raw: unknown): string {
  if (raw === undefined || raw === null) return "null";
  const r = notificationScopeSchema.safeParse({ schemaVersion: 1, ...(raw as object) });
  return r.success ? canonical(r.data) : `bozuk:${canonical(raw)}`;
}

export interface LockCheckItem {
  tur: string;
  kanal: string;
  acik: boolean;
  kapsam?: unknown;
}

/**
 * Profil tercih kilidi açıkken gövdedeki "uygulama içi" seçimi (UYGULAMA + kapsam; UYGULAMA kapalıyken OZET) şimdiki
 * ÇÖZÜMLE aynı olmalı; değişen her öğe 409. Tam gövdeli eski istemci yalnız yan kanalı değiştiriyorsa geçer.
 */
export function assertInAppUnchanged(
  ctx: { subject: PreferenceSubject; env: NotificationVisibilityEnv; layers: PreferenceLayers },
  items: LockCheckItem[],
  profiller: string[],
): void {
  const { subject, env, layers } = ctx;
  const o = { env, layers };
  const byKey = new Map(items.map((it) => [prefKey(it.tur, it.kanal as NotificationKanal), it]));
  for (const it of items) {
    if (!isFrozenChannel(it.kanal) || !isKind(it.tur) || !canSeeNotificationType(subject, it.tur, env)) continue;
    const kind = it.tur;
    const inApp = resolvePreference(subject, kind, "UYGULAMA", o);
    let same: boolean;
    if (it.kanal === "UYGULAMA") {
      same = it.acik === (inApp.durum === "ACIK") && scopeKey(it.kapsam) === scopeKey(inApp.kapsam);
    } else {
      const appItem = byKey.get(prefKey(kind, "UYGULAMA"));
      const appOn = appItem ? appItem.acik : inApp.durum === "ACIK";
      same = appOn || !getNotificationEntry(kind).kanallar.includes("OZET") || it.acik === channelEnabled(subject, kind, "OZET", o).acik;
    }
    if (!same) {
      throw AppError.conflict("Bildirim tercihlerin yöneticin tarafından kilitlendi; uygulama içi seçim değiştirilemez.", {
        code: "NOTIFICATION_PREFS_LOCKED", tur: kind, kanal: it.kanal, profiller,
      });
    }
  }
}
