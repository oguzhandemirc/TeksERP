// Bildirim profilleri ekranının saf modeli (React'siz; testler aynı kodu koşar).
import { NOTIFICATION_GROUP_ORDER } from "@/pages/Notifications/group-order";
import type { NotificationGroup } from "@/lib/bildirim/types";
import type { FactoryDefaultInput, FactoryDefaultKind, ProfileCell, ProfileCellState } from "@/services/bildirimProfilService";
import { formatQty } from "@/lib/format";
import { foldSearchText } from "@/lib/search-fold";

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

/** Arama: her kelime ad · tür kodu · grup adında geçmeli (Türkçe katlamalı). Tam katalog zaten yüklü (~100
 *  satır) → istemcide süzülür; katalogda ayrı açıklama alanı yok. */
export function filterKinds<T extends { tur: string; grup: string; ad: string }>(kinds: readonly T[], query: string): T[] {
  const tokens = foldSearchText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [...kinds];
  return kinds.filter((k) => {
    const hay = foldSearchText(`${k.ad} ${k.tur} ${k.grup}`);
    return tokens.every((t) => hay.includes(t));
  });
}

/** Grup başlığı özeti — yalnız sıfır olmayan durumlar, sabit sırada ("3 açık · 1 kapalı"). */
export function stateSummary(states: readonly string[], order: readonly string[], labels: Readonly<Record<string, string>>): string {
  return order
    .map((s) => [s, states.filter((x) => x === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${labels[s]}`)
    .join(" · ");
}

/** Grup toplu aç/kapa (fabrika): yalnız verilen (görünen) türler; her zaman kilitli tür KAPALI'ya düşmez. */
export function factoryBulk(
  draft: Record<string, FactoryDraftRow>,
  items: readonly FactoryDefaultKind[],
  to: "ACIK" | "KAPALI",
): Record<string, FactoryDraftRow> {
  const next = { ...draft };
  for (const k of items) {
    const row = next[k.tur];
    if (!row || (to === "KAPALI" && !allowsOff(k.kilit))) continue;
    next[k.tur] = { ...row, durum: to };
  }
  return next;
}

/** Grup toplu aç/kapa (profil matrisi): aynı kural, hücre taslağında. */
export function matrixBulk(draft: CellDraft, items: readonly FactoryDefaultKind[], to: "ACIK" | "KAPALI"): CellDraft {
  const next: Record<string, ProfileCellState> = { ...draft };
  for (const k of items) if (to === "ACIK" || allowsOff(k.kilit)) next[k.tur] = to;
  return next;
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
  return typeof v === "number" && Number.isFinite(v) ? formatQty(v, 3) : "";
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
/** Grup özeti sözcükleri; matriste profilde olmayan tür (anahtarsız) "tanımsız" sayılır. */
export const SUMMARY_LABEL: Readonly<Record<string, string>> = { MIRAS: "miras", ACIK: "açık", KAPALI: "kapalı", KILITLI: "kilitli", BOS: "tanımsız" };

// Katalog `paramSemasi` alan adı → görünen ad. Bilinmeyen alan adıyla görünür (sessizce kaybolmaz); yeni
// alan eklenince buraya da yazılır (bekçi: model.test.ts — katalogda bilinen her alanın etiketi var).
const ESIK_LABEL: Readonly<Record<string, string>> = {
  gun: "Eşik (gün)",
  kalanGun: "Kalan gün eşiği",
  dakika: "Eşik (dakika)",
  saat: "Eşik (saat)",
  oranYuzde: "Oran eşiği (%)",
  minMetre: "En az metre",
  tolerans: "Gecikme payı (gün)",
};
// "Yaklaşıyor" türlerinde `gun` bir öne-bakış penceresidir; "Eşik (gün)" yaş eşiği gibi okunuyordu.
const ESIK_LABEL_TUR: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "siparis.termin-yaklasti": { gun: "Kaç gün kala" },
  "kalite.sertifika-suresi-doluyor": { gun: "Kaç gün kala" },
  "finans.vade-yaklasti": { gun: "Kaç gün kala" },
  "finans.cek-senet-vade": { gun: "Kaç gün kala" },
};

export function esikEtiketi(tur: string, alan: string): string {
  return ESIK_LABEL_TUR[tur]?.[alan] ?? ESIK_LABEL[alan] ?? alan;
}
