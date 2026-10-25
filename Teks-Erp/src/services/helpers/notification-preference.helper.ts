// =============================================================================
// BİLDİRİM TERCİH KATMANI — "bu kişi bu türü bu kanaldan alır mı"nın TEK cevabı (plan §5.1)
// =============================================================================
// Sıra: görme süzgeci (GIZLI) → katalog varsayılanı → fabrika varsayılanı → profiller (birleşim) →
// nöbet kilidi → kullanıcı sapması. Kilit yalnız UYGULAMA kanalını zorlar. Dağıtıcı, tercih ekranı ve
// önizleme AYNI `resolvePreference`'ı çağırır; katmanlar tur/istek başına bir kez okunur (`loadPreferenceLayers`).
// Hiç katman yokken sonuç F1 dağıtımıyla bayt-eşittir (varsayılan = bugünkü davranış; bekçi ölçer).
// =============================================================================
import type { Prisma } from "@prisma/client";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_KINDS,
  type NotificationCatalogEntry,
  type NotificationKanal,
  type NotificationKind,
} from "../../constants/notification-catalog";
import {
  notificationScopeSchema,
  type NotificationFactoryDefaultState,
  type NotificationProfileCellState,
  type NotificationScope,
} from "../../constants/notification-preference";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { canSeeNotificationType, type NotificationViewer, type NotificationVisibilityEnv } from "./notification-visibility.helper";

type Db = Pick<Prisma.TransactionClient, "notificationFactoryDefault" | "notificationProfileMember" | "notificationPreference">;

export type PreferenceState = "ACIK" | "KAPALI" | "GIZLI";
/** `katalog` · `fabrika` · `profil:<ad>` · `kullanici`. */
export type PreferenceSource = string;

export interface PreferenceResolution {
  durum: PreferenceState;
  kilit: boolean;
  kaynak: PreferenceSource;
  /** Kişisel kapsam (UYGULAMA satırından); lockedCell türde uygulanmaz → null. */
  kapsam: NotificationScope | null;
}

export interface PreferenceRowView {
  enabled: boolean;
  scope: NotificationScope | null;
}

export interface FactoryDefaultView {
  state: NotificationFactoryDefaultState;
  extraRecipientIds: readonly string[];
}

/** Bir tur/isteğin katman fotoğrafı. `prefs` anahtarı `kind|channel`. */
export interface PreferenceLayers {
  factory: ReadonlyMap<string, FactoryDefaultView>;
  profiles: ReadonlyMap<string, ReadonlyArray<{ name: string; cells: ReadonlyMap<string, NotificationProfileCellState> }>>;
  prefs: ReadonlyMap<string, ReadonlyMap<string, PreferenceRowView>>;
}

export const EMPTY_LAYERS: PreferenceLayers = { factory: new Map(), profiles: new Map(), prefs: new Map() };

export const prefKey = (kind: string, channel: NotificationKanal): string => `${kind}|${channel}`;

function entryOf(kind: string): NotificationCatalogEntry | undefined {
  return (NOTIFICATION_CATALOG as Record<string, NotificationCatalogEntry>)[kind];
}

/** Kaydedilmiş kapsam bozuksa (sürüm düşüşü) süzgeç YOK sayılmaz: "hiçbir şey iletme" değil, satır yok sayılır. */
function readScope(raw: unknown): NotificationScope | null {
  if (raw === null || raw === undefined) return null;
  const r = notificationScopeSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Katmanları tek seferde okur (dağıtıcı turu için N+1 yok). Arşivli profil katılmaz. */
export async function loadPreferenceLayers(db: Db, userIds: readonly string[]): Promise<PreferenceLayers> {
  const kinds = [...NOTIFICATION_KINDS];
  const factoryRows = await db.notificationFactoryDefault.findMany({
    where: { kind: { in: kinds } },
    select: { kind: true, state: true, extraRecipientIds: true },
  });
  const factory = new Map<string, FactoryDefaultView>();
  for (const r of factoryRows) factory.set(r.kind, { state: r.state as NotificationFactoryDefaultState, extraRecipientIds: r.extraRecipientIds });
  if (userIds.length === 0) return { factory, profiles: new Map(), prefs: new Map() };
  const ids = [...new Set(userIds)];
  const members = await db.notificationProfileMember.findMany({
    where: { userId: { in: ids }, profile: { archivedAt: null } },
    select: { userId: true, profile: { select: { name: true, cells: { select: { kind: true, state: true } } } } },
    orderBy: [{ profile: { name: "asc" } }, { id: "asc" }],
  });
  const profiles = new Map<string, Array<{ name: string; cells: Map<string, NotificationProfileCellState> }>>();
  for (const m of members) {
    const list = profiles.get(m.userId) ?? [];
    list.push({ name: m.profile.name, cells: new Map(m.profile.cells.map((c) => [c.kind, c.state as NotificationProfileCellState])) });
    profiles.set(m.userId, list);
  }
  const prefRows = await db.notificationPreference.findMany({
    where: { userId: { in: ids }, kind: { in: kinds } },
    select: { userId: true, kind: true, channel: true, enabled: true, scope: true },
  });
  const prefs = new Map<string, Map<string, PreferenceRowView>>();
  for (const p of prefRows) {
    const m = prefs.get(p.userId) ?? new Map<string, PreferenceRowView>();
    m.set(prefKey(p.kind, p.channel as NotificationKanal), { enabled: p.enabled, scope: readScope(p.scope) });
    prefs.set(p.userId, m);
  }
  return { factory, profiles, prefs };
}

export interface PreferenceSubject extends NotificationViewer {
  userId: string;
}

export interface ResolveOptions {
  layers: PreferenceLayers;
  /** Alıcı nöbette mi (Karar Y2: `NOBETTE` kilidi yalnız ona). */
  nobette?: boolean;
  /** Önizleme/PUT doğrulaması: kaydedilmiş sapma yerine bu taslak okunur (`null` = sapma yok). */
  taslak?: ReadonlyMap<string, PreferenceRowView | null>;
}

function userPref(subject: PreferenceSubject, kind: string, channel: NotificationKanal, o: ResolveOptions): PreferenceRowView | undefined {
  const k = prefKey(kind, channel);
  if (o.taslak) return o.taslak.get(k) ?? undefined;
  return o.layers.prefs.get(subject.userId)?.get(k);
}

/** UYGULAMA kanalı — plan §5.1 sözde kodu birebir. */
function resolveInApp(subject: PreferenceSubject, kind: NotificationKind, entry: NotificationCatalogEntry, o: ResolveOptions): PreferenceResolution {
  const { layers } = o;
  const v = entry.varsayilan;
  const covered = v === "HERKES" || (v !== "KAPALI" && v.some((c) => matchesPermission([...subject.permissions], c)));
  let state: PreferenceState = covered ? "ACIK" : "KAPALI";
  let locked = entry.kilit === "HER_ZAMAN";
  let source: PreferenceSource = "katalog";
  const fd = layers.factory.get(kind)?.state ?? "MIRAS";
  if (fd === "ACIK") { state = "ACIK"; source = "fabrika"; }
  if (fd === "KAPALI" && !locked) { state = "KAPALI"; source = "fabrika"; }
  if (fd === "KILITLI") { state = "ACIK"; locked = true; source = "fabrika"; }
  const cells = (layers.profiles.get(subject.userId) ?? []).flatMap((p) => {
    const s = p.cells.get(kind);
    return s ? [{ name: p.name, s }] : [];
  });
  const lockedCell = cells.find((h) => h.s === "KILITLI");
  const openCell = cells.find((h) => h.s === "ACIK");
  if (lockedCell) { state = "ACIK"; locked = true; source = `profil:${lockedCell.name}`; }
  else if (openCell) { state = "ACIK"; source = `profil:${openCell.name}`; }
  else if (cells.length > 0 && !locked) { state = "KAPALI"; source = `profil:${cells[0].name}`; }
  if (entry.kilit === "NOBETTE" && o.nobette) { state = "ACIK"; locked = true; }
  const p = userPref(subject, kind, "UYGULAMA", o);
  if (p && !locked) { state = p.enabled ? "ACIK" : "KAPALI"; source = "kullanici"; }
  return { durum: state, kilit: locked, kaynak: source, kapsam: locked ? null : (p?.scope ?? null) };
}

/** Kanalın kendi açıklığı (UYGULAMA/OZET kapısı UYGULANMADAN): katalog varsayılan kanalı ⊕ kullanıcı sapması. */
export function channelEnabled(subject: PreferenceSubject, kind: NotificationKind, channel: Exclude<NotificationKanal, "UYGULAMA">, o: ResolveOptions): { acik: boolean; kaynak: PreferenceSource } {
  const entry = entryOf(kind);
  if (!entry || !entry.kanallar.includes(channel)) return { acik: false, kaynak: "katalog" };
  const p = userPref(subject, kind, channel, o);
  if (p) return { acik: p.enabled, kaynak: "kullanici" };
  return { acik: entry.varsayilanKanallar.includes(channel), kaynak: "katalog" };
}

/**
 * TEK çözücü. İlk adım görme süzgecidir (tek kaynak, `test_bildirim_tek_kaynak` §4d ölçer).
 * UYGULAMA dışı kanal, tür ne uygulama içinde ne gün özetinde etkin değilse kapalıdır.
 */
export function resolvePreference(subject: PreferenceSubject, kind: NotificationKind, channel: NotificationKanal, o: ResolveOptions & { env: NotificationVisibilityEnv }): PreferenceResolution {
  if (!canSeeNotificationType(subject, kind, o.env)) return { durum: "GIZLI", kilit: false, kaynak: "katalog", kapsam: null };
  const entry = entryOf(kind)!;
  const inApp = resolveInApp(subject, kind, entry, o);
  if (channel === "UYGULAMA") return inApp;
  if (!entry.kanallar.includes(channel)) return { durum: "KAPALI", kilit: false, kaynak: "katalog", kapsam: null };
  const own = channelEnabled(subject, kind, channel, o);
  const digestOn = channel === "OZET" ? own.acik : channelEnabled(subject, kind, "OZET", o).acik;
  let state: PreferenceState = own.acik ? "ACIK" : "KAPALI";
  if (channel !== "OZET" && !(inApp.durum === "ACIK" || digestOn)) state = "KAPALI";
  return { durum: state, kilit: inApp.kilit, kaynak: own.kaynak, kapsam: null };
}

/** Toplu sürüm (ekran/önizleme): görülebilir her tür × kanal. */
export function resolveAllPreferences(
  subject: PreferenceSubject,
  o: ResolveOptions & { env: NotificationVisibilityEnv },
): Array<{ kind: NotificationKind; kanallar: Array<{ kanal: NotificationKanal } & PreferenceResolution> }> {
  const out: Array<{ kind: NotificationKind; kanallar: Array<{ kanal: NotificationKanal } & PreferenceResolution> }> = [];
  for (const kind of NOTIFICATION_KINDS) {
    const entry = entryOf(kind)!;
    const inApp = resolvePreference(subject, kind, "UYGULAMA", o);
    if (inApp.durum === "GIZLI") continue;
    out.push({
      kind,
      kanallar: entry.kanallar.map((ch) => ({ kanal: ch, ...(ch === "UYGULAMA" ? inApp : resolvePreference(subject, kind, ch, o)) })),
    });
  }
  return out;
}
