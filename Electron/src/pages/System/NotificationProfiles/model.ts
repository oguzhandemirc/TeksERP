// Bildirim profilleri ekranının saf modeli (React'siz; testler aynı kodu koşar).
import { NOTIFICATION_GROUP_ORDER } from "@/pages/Notifications/group-order";
import type { NotificationGroup } from "@/lib/bildirim/types";
import type { FactoryDefaultInput, FactoryDefaultKind, ProfileCell, ProfileCellState } from "@/services/bildirimProfilService";

/** Taslak matris: tür → durum; anahtarı olmayan tür profilde YOK (katmana katılmaz). */
export type CellDraft = Readonly<Record<string, ProfileCellState>>;

export function draftFromCells(cells: readonly ProfileCell[]): CellDraft {
  return Object.fromEntries(cells.map((c) => [c.tur, c.durum]));
}

/** PUT gövdesi — tür sırasıyla belirlenimli (aynı taslak aynı gövde). */
export function cellsFromDraft(draft: CellDraft): ProfileCell[] {
  return Object.keys(draft).sort().map((tur) => ({ tur, durum: draft[tur]! }));
}

export function draftEquals(a: CellDraft, b: CellDraft): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** Kilit önizlemesi yalnız taslakta KILITLI hücre ve üye varsa anlamlıdır. */
export function needsLockPreview(draft: CellDraft, memberCount: number): boolean {
  return memberCount > 0 && Object.values(draft).some((s) => s === "KILITLI");
}

/** Önizlemede SEÇİLMEYEN kişiler profilden çıkar; kalan üye listesi. */
export function membersAfterLockChoice(members: readonly string[], affected: readonly string[], kept: ReadonlySet<string>): string[] {
  const drop = new Set(affected.filter((u) => !kept.has(u)));
  return members.filter((u) => !drop.has(u));
}

export interface KindGroup<T> {
  grup: NotificationGroup;
  items: T[];
}

export function groupKinds<T extends { grup: NotificationGroup; ad: string }>(kinds: readonly T[]): KindGroup<T>[] {
  return NOTIFICATION_GROUP_ORDER.map((grup) => ({
    grup,
    items: kinds.filter((k) => k.grup === grup).sort((a, b) => a.ad.localeCompare(b.ad, "tr")),
  })).filter((g) => g.items.length > 0);
}

/** Her zaman kilitli katalog türünde KAPALI anlamsızdır (motor yok sayar) — seçenek sunulmaz. */
export function allowsOff(kilit: FactoryDefaultKind["kilit"]): boolean {
  return kilit !== "HER_ZAMAN";
}

/** tr-TR sayı girişi ("1.250,5" → 1250.5); boş/bozuk → null. */
export function parseTrNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function formatTrNumber(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("tr-TR", { maximumFractionDigits: 3 }) : "";
}

export interface FactoryDraftRow {
  durum: FactoryDefaultKind["durum"];
  /** Eşik alanlarının ham metni (kullanıcının yazdığı tr-TR biçim). */
  esikMetin: Record<string, string>;
  ekAlicilar: string[];
}

export function factoryDraftFrom(kinds: readonly FactoryDefaultKind[]): Record<string, FactoryDraftRow> {
  return Object.fromEntries(
    kinds.map((k) => [
      k.tur,
      { durum: k.durum, esikMetin: Object.fromEntries(Object.entries(k.esikler).map(([f, v]) => [f, formatTrNumber(v)])), ekAlicilar: [...k.ekAlicilar] },
    ]),
  );
}

function sameRow(a: FactoryDraftRow, b: FactoryDraftRow): boolean {
  const keys = new Set([...Object.keys(a.esikMetin), ...Object.keys(b.esikMetin)]);
  return a.durum === b.durum
    && [...keys].every((f) => parseTrNumber(a.esikMetin[f] ?? "") === parseTrNumber(b.esikMetin[f] ?? ""))
    && a.ekAlicilar.length === b.ekAlicilar.length && a.ekAlicilar.every((u, i) => u === b.ekAlicilar[i]);
}

/** Yalnız DEĞİŞEN türler gönderilir; bozuk eşik metni `errors`a düşer (gönderim yapılmaz). */
export function factoryChanges(
  kinds: readonly FactoryDefaultKind[],
  base: Record<string, FactoryDraftRow>,
  draft: Record<string, FactoryDraftRow>,
): { turler: FactoryDefaultInput[]; errors: string[] } {
  const turler: FactoryDefaultInput[] = [];
  const errors: string[] = [];
  for (const k of kinds) {
    const d = draft[k.tur];
    const b = base[k.tur];
    if (!d || !b || sameRow(d, b)) continue;
    const row: FactoryDefaultInput = { tur: k.tur, durum: d.durum, ekAlicilar: d.ekAlicilar };
    if (k.esikVar) {
      const esikler: Record<string, number> = {};
      for (const [f, txt] of Object.entries(d.esikMetin)) {
        const n = parseTrNumber(txt);
        if (n === null) errors.push(`${k.ad}: "${f}" sayı olmalı.`);
        else esikler[f] = n;
      }
      row.esikler = esikler;
    }
    turler.push(row);
  }
  return { turler, errors };
}

export const CELL_LABEL: Record<ProfileCellState, string> = { ACIK: "Açık", KAPALI: "Kapalı", KILITLI: "Kilitli" };
export const FACTORY_LABEL: Record<FactoryDefaultKind["durum"], string> = { MIRAS: "Miras", ...CELL_LABEL };
