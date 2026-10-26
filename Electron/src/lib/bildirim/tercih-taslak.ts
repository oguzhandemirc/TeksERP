// =============================================================================
// Kişisel bildirim tercihi TASLAĞI (N4-PANEL, plan §6.4) — saf fonksiyonlar.
// =============================================================================
// Taslak yalnız SUNUCUNUN çözdüğü hücrelerden kurulur (`GET /tercihler`.hucreler); istemci görünürlük ya da
// katman hesabı yapmaz. Kaydet = tam gövde PUT (her türün her kanalı), sunucu seyrek yazar; form CEVAPTAN
// yeniden kurulur. Kilit yalnız uygulama içi kanalı zorlar (§5.1): kilitli türde "Özet"/"Kapalı" yok.
// =============================================================================
import { foldedIncludes } from "@/lib/search-fold";
import type {
  NotificationCatalogKind,
  NotificationChannel,
  NotificationPreferenceCell,
  NotificationPreferenceInput,
  NotificationScopeValue,
} from "./types";

/** Uygulama içi üç durum (§5.1): Anlık = UYGULAMA açık · Özet = yalnız gün özeti · Kapalı. */
export type InAppMode = "ANLIK" | "OZET" | "KAPALI";

export interface KindDraft {
  kod: string;
  mod: InAppMode;
  /** Kanal türde yoksa `undefined` (satırda "–"). */
  kanal: Partial<Record<Exclude<NotificationChannel, "UYGULAMA" | "OZET">, boolean>>;
  /** Türde OZET kanalı var mı ("Özet" seçeneği yalnız o zaman). */
  ozetVar: boolean;
  kapsam: NotificationScopeValue | null;
  kilit: boolean;
  kaynak: string;
}

export type PreferenceDraft = Record<string, KindDraft>;

const SIDE_CHANNELS = ["MASAUSTU", "TABLET_SES", "PATRON_PUSH"] as const;

function scopeOf(raw: unknown): NotificationScopeValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rest = { ...(raw as Record<string, unknown>) };
  delete rest.schemaVersion;
  return Object.keys(rest).length ? (rest as NotificationScopeValue) : null;
}

export function draftFromCells(hucreler: readonly NotificationPreferenceCell[]): PreferenceDraft {
  const out: PreferenceDraft = {};
  for (const h of hucreler) {
    const by = new Map(h.kanallar.map((k) => [k.kanal, k]));
    const app = by.get("UYGULAMA");
    if (!app || app.durum === "GIZLI") continue;
    const digestCell = by.get("OZET");
    const mod: InAppMode = app.durum === "ACIK" ? "ANLIK" : digestCell?.durum === "ACIK" ? "OZET" : "KAPALI";
    const kanal: KindDraft["kanal"] = {};
    for (const ch of SIDE_CHANNELS) {
      const c = by.get(ch);
      if (c) kanal[ch] = c.durum === "ACIK";
    }
    out[h.kind] = { kod: h.kind, mod, kanal, ozetVar: !!digestCell, kapsam: app.kilit ? null : scopeOf(app.kapsam), kilit: app.kilit, kaynak: app.kaynak };
  }
  return out;
}

/** Tam gövde: türün sunucuda beyanlı her kanalı tek satır (kilitli türde UYGULAMA hep açık, kapsamsız). */
export function draftToBody(d: PreferenceDraft): NotificationPreferenceInput[] {
  const out: NotificationPreferenceInput[] = [];
  for (const k of Object.values(d).sort((a, b) => a.kod.localeCompare(b.kod))) {
    const app: NotificationPreferenceInput = { tur: k.kod, kanal: "UYGULAMA", acik: k.kilit || k.mod === "ANLIK" };
    if (!k.kilit && k.kapsam) app.kapsam = k.kapsam;
    out.push(app);
    if (k.ozetVar) out.push({ tur: k.kod, kanal: "OZET", acik: !k.kilit && k.mod === "OZET" });
    for (const ch of SIDE_CHANNELS) {
      const v = k.kanal[ch];
      if (v !== undefined) out.push({ tur: k.kod, kanal: ch, acik: v });
    }
  }
  return out;
}

export function setMode(d: PreferenceDraft, kod: string, mod: InAppMode): PreferenceDraft {
  const k = d[kod];
  if (!k || k.kilit || k.mod === mod || (mod === "OZET" && !k.ozetVar)) return d;
  return { ...d, [kod]: { ...k, mod } };
}

export function setChannel(d: PreferenceDraft, kod: string, ch: (typeof SIDE_CHANNELS)[number], acik: boolean): PreferenceDraft {
  const k = d[kod];
  if (!k || k.kanal[ch] === undefined || k.kanal[ch] === acik) return d;
  return { ...d, [kod]: { ...k, kanal: { ...k.kanal, [ch]: acik } } };
}

export function setScope(d: PreferenceDraft, kod: string, kapsam: NotificationScopeValue | null): PreferenceDraft {
  const k = d[kod];
  if (!k || k.kilit) return d;
  return { ...d, [kod]: { ...k, kapsam } };
}

/** Grup toplu aç/kapa — kilitli satırlar ATLANIR; değişen satır sayısı tosta gider. */
export function setGroupMode(d: PreferenceDraft, kodlar: readonly string[], acik: boolean): { taslak: PreferenceDraft; degisen: number } {
  let taslak = d;
  let degisen = 0;
  for (const kod of kodlar) {
    const next = setMode(taslak, kod, acik ? "ANLIK" : "KAPALI");
    if (next !== taslak) degisen += 1;
    taslak = next;
  }
  return { taslak, degisen };
}

export function draftsEqual(a: PreferenceDraft, b: PreferenceDraft): boolean {
  return JSON.stringify(draftToBody(a)) === JSON.stringify(draftToBody(b));
}

/** Arama tr-katlamalı (ı/I/İ/i, ş/s… — `search-fold`): ad, grup, kod. */
export function matchesKind(k: Pick<NotificationCatalogKind, "kod" | "ad" | "grup">, q: string): boolean {
  if (!q.trim()) return true;
  return foldedIncludes(`${k.ad} ${k.grup} ${k.kod}`, q);
}

/** "Neden alırsınız" — sunucu çözümünün kaynağı (katalog / fabrika / profil:<ad> / kullanici). */
export function sourceLabel(kaynak: string): string {
  if (kaynak.startsWith("profil:")) return `"${kaynak.slice(7)}" bildirim profili`;
  if (kaynak === "fabrika") return "Fabrika varsayılanı";
  if (kaynak === "kullanici") return "Sizin seçiminiz";
  return "Görevinizin (izinlerinizin) varsayılanı";
}

/** "Neden kilitli?" — kilidin kaynağı metinle (renk tek başına anlam taşımaz). */
export function lockReason(k: Pick<KindDraft, "kaynak">, katalog?: Pick<NotificationCatalogKind, "kilit" | "kilitGerekcesi">): string {
  if (k.kaynak.startsWith("profil:")) return `"${k.kaynak.slice(7)}" bildirim profili bu türü kilitledi.`;
  if (k.kaynak === "fabrika") return "Fabrika varsayılanı bu türü kilitledi.";
  if (katalog?.kilit === "NOBETTE") return katalog.kilitGerekcesi ?? "Nöbetteyken kapatılamaz.";
  return katalog?.kilitGerekcesi ?? "Bu tür her zaman uygulama içinde gösterilir.";
}

export const SCOPE_KEYS = ["yalnizTakip", "istasyonlar", "esik"] as const;

export function scopeLabel(s: NotificationScopeValue | null): string {
  if (!s) return "Tümü";
  const parts: string[] = [];
  if (s.yalnizTakip) parts.push("Takip ettiklerim");
  if (s.istasyonlar === "BENIM") parts.push("İstasyonlarım");
  else if (Array.isArray(s.istasyonlar)) parts.push(`${s.istasyonlar.length} istasyon`);
  for (const [k, v] of Object.entries(s.esik ?? {})) parts.push(`${ESIK_LABEL[k] ?? k} ${v}`);
  return parts.length ? parts.join(" · ") : "Tümü";
}

export const ESIK_LABEL: Record<string, string> = { gun: "En az gün", kalanGun: "Kalan gün ≤" };
