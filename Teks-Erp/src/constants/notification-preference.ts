// =============================================================================
// Bildirim tercih katmanı (F4, plan §3.3, §5) — kapalı kümeler ve JSON kolon şemaları.
// Kümeler migration `bildirim_tercih` CHECK'lerinin TS aynasıdır (`test_db_invariants` CHECK'i ölçer);
// biri genişlerse ikisi aynı commit'te. Okuyan/yazan kod N4-MOTOR'da.
// =============================================================================
import { z } from "zod";
import type { NotificationKanal } from "./notification-catalog.types";

/** `notification_preferences.channel` CHECK aynası. */
export const NOTIFICATION_CHANNELS = [
  "UYGULAMA",
  "OZET",
  "MASAUSTU",
  "TABLET_SES",
  "PATRON_PUSH",
] as const satisfies readonly NotificationKanal[];

/** Sessiz saatin susturabildiği kanallar (`notification_user_settings.quietChannels` CHECK aynası). */
export const NOTIFICATION_QUIET_CHANNELS = ["MASAUSTU", "TABLET_SES", "PATRON_PUSH"] as const satisfies readonly NotificationKanal[];

/** `notification_profile_cells.state` CHECK aynası. */
export const NOTIFICATION_PROFILE_CELL_STATES = ["ACIK", "KAPALI", "KILITLI"] as const;
export type NotificationProfileCellState = (typeof NOTIFICATION_PROFILE_CELL_STATES)[number];

/** `notification_factory_defaults.state` CHECK aynası; satır yokluğu da MIRAS demektir. */
export const NOTIFICATION_FACTORY_DEFAULT_STATES = ["MIRAS", "ACIK", "KAPALI", "KILITLI"] as const;
export type NotificationFactoryDefaultState = (typeof NOTIFICATION_FACTORY_DEFAULT_STATES)[number];

/** `record_follows.state` / `.reason` CHECK aynaları. */
export const RECORD_FOLLOW_STATES = ["TAKIP", "BIRAKTI"] as const;
export const RECORD_FOLLOW_REASONS = ["OLUSTURAN", "ELLE"] as const;

/** "HH:MM" (00:00–23:59) — `notification_user_settings` quiet CHECK'iyle aynı ifade. */
export const QUIET_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * `notification_preferences.scope` v1 — yalnız DARALTIR, tanınmayan anahtar reddedilir (§5.2).
 * `esik` türün katalog `paramSemasi`yla ayrıca doğrulanır (tür bilgisi gerektirir → N4-MOTOR).
 */
export const notificationScopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    yalnizTakip: z.literal(true).optional(),
    istasyonlar: z.union([z.literal("BENIM"), z.array(z.string().uuid()).min(1).max(500)]).optional(),
    esik: z.record(z.string().max(32), z.number()).optional(),
  })
  .strict();
export type NotificationScope = z.infer<typeof notificationScopeSchema>;

/** `notification_factory_defaults.params` zarfı; `degerler` katalog `paramSemasi`yla doğrulanır. */
export const notificationFactoryParamsSchema = z
  .object({
    schemaVersion: z.literal(1),
    degerler: z.record(z.string().max(32), z.unknown()),
  })
  .strict();
export type NotificationFactoryParams = z.infer<typeof notificationFactoryParamsSchema>;
