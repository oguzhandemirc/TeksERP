// Anlık okuyucular (saf): fabrikanın tel şekli (`Teks-Erp/src/cloud-sync/snapshots.ts`) savunmalı okunur — eksik alan
// "—" olur, ekran çökmez. Uygulama ARİTMETİK YAPMAZ: toplam/yüzde fabrikadan gelir; burada yalnız seçme, sıralama
// ve "sıfırdan büyük mü" karşılaştırması var.
import { formatAgo, formatMoney, formatNumber, syncIsLate } from "../../lib/format";
import { CHEQUE_BUCKET, CHEQUE_KIND, CHEQUE_KIND_SHORT, PERIOD_LABEL, UNIT, type PeriodKey } from "../../lib/labels/uretim";
import { lookup } from "../../lib/labels";
import type { StatusKind } from "../tokens";

export type Obj = Readonly<Record<string, unknown>>;

export function obj(v: unknown): Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

export function arr(v: unknown): readonly Obj[] {
  return Array.isArray(v) ? v.map(obj) : [];
}

export function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Sayı biçimi: tam sayı ya da binin üstü ondalıksız, değilse bir hane (metre). */
export function qty(v: unknown): string {
  const n = num(v);
  if (n === null) return "—";
  // Binin üstünde ondalık okunmaz (61.240,5 → 61.241); küçük metrajda bir hane kalır.
  return formatNumber(n, Number.isInteger(n) || Math.abs(n) >= 1000 ? 0 : 1);
}

export function pct(v: unknown): string {
  const n = num(v);
  return n === null ? "—" : `%${formatNumber(n, 1)}`;
}

/** Dönemli bölümden tek dönem (`ozet.sevkiyat` / `ozet.fason`). */
export function period(section: unknown, key: PeriodKey): Obj {
  return obj(obj(section)[key]);
}

/** Akış kolonu (`kolonlar[]`): etiket fabrikadan. */
export function column(data: unknown, key: string): { label: string; count: number | null } | null {
  const c = arr(obj(data).kolonlar).find((k) => k.anahtar === key);
  return c ? { label: str(c.etiket) ?? key, count: num(c.adet) } : null;
}

// ---------------------------------------------------------------- çek vadesi (ozet-finans.cekVade)

export interface DueRow {
  readonly bucket: string;
  readonly kind: string;
  readonly currency: string;
  readonly count: number | null;
  readonly amount: string;
}

const CURRENCY_ORDER = ["TRY", "USD", "EUR"];
const KIND_ORDER = ["RECEIVED", "ISSUED"];
const rank = (list: readonly string[], v: string) => (list.includes(v) ? list.indexOf(v) : list.length);

/** Kova(lar)daki adetli satırlar — TL önce, alınan önce; toplanmaz (döviz ve yön ayrı kalır). */
export function dueRows(finance: unknown, buckets: readonly string[]): DueRow[] {
  return arr(obj(finance).cekVade)
    .filter((r) => buckets.includes(String(r.kova)) && (num(r.adet) ?? 0) > 0)
    .map((r) => ({ bucket: String(r.kova), kind: String(r.tur), currency: String(r.doviz), count: num(r.adet), amount: String(r.tutar) }))
    .sort((a, b) => rank(CURRENCY_ORDER, a.currency) - rank(CURRENCY_ORDER, b.currency) || rank(KIND_ORDER, a.kind) - rank(KIND_ORDER, b.kind));
}

export function dueLabel(r: DueRow): string {
  return `${lookup(CHEQUE_KIND, r.kind)} · ${qty(r.count)} ${UNIT.adet}`;
}

/** Dar kutu için kısa biçim: "Alınan · 4 adet". */
export function dueShort(r: DueRow): string {
  return `${lookup(CHEQUE_KIND_SHORT, r.kind)} · ${qty(r.count)} ${UNIT.adet}`;
}

export function dueAmount(r: DueRow): string {
  return formatMoney(r.amount, r.currency);
}

// ---------------------------------------------------------------- Dikkat şeridi

export interface AttentionItem {
  readonly key: string;
  readonly tone: StatusKind;
  readonly title: string;
  readonly detail: string;
  /** Dokununca gidilecek bölüm; yoksa `action` (ör. eşitlemeyi yenile) ya da dokunulmaz. */
  readonly route?: string;
  readonly action?: "esitle";
}

export interface AttentionInput {
  readonly health?: unknown;
  readonly orders?: unknown;
  readonly finance?: unknown;
  /** Fabrika veri anı (`esitleme.ufuk`); `null` = hiç gelmedi. `undefined` = tesis bilgisi yok (madde çıkmaz). */
  readonly lastSync?: string | null;
  readonly nowMs?: number;
}

/** Dikkat maddeleri — en ağır ton önce. Her madde fabrikanın verdiği bir sinyalden gelir. */
export function attentionItems(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  const backup = obj(obj(i.health).yedek);
  if (backup.hukum === "kritik" || backup.hukum === "uyari") {
    const age = num(backup.yasSaat);
    out.push({
      key: "yedek",
      tone: backup.hukum === "kritik" ? "kritik" : "uyari",
      title: backup.hukum === "kritik" ? "Gece yedeği alınamadı" : "Gece yedeği gecikti",
      detail: age === null ? "Fabrikada gece yedeği bulunamadı — sistem sorumlusuna haber verin" : `Son gece yedeği ${qty(age)} saat önce — sistem sorumlusuna haber verin`,
    });
  }
  const late = num(obj(i.orders).gecikenKalem);
  if (late !== null && late > 0) {
    out.push({ key: "geciken", tone: "kritik", title: `${qty(late)} sipariş kalemi gecikti`, detail: `Termini geçmiş, karşılanmamış ${qty(obj(i.orders).gecikenMiktar)} ${UNIT.metre}`, route: "/siparisler" });
  }
  const overdue = dueRows(i.finance, ["OVERDUE"]);
  if (overdue.length > 0) {
    out.push({ key: "cek-gecmis", tone: "kritik", title: `Vadesi geçmiş çek/senet`, detail: overdue.slice(0, 2).map((r) => `${dueLabel(r)} · ${dueAmount(r)}`).join("\n"), route: "/finans" });
  }
  const soon = dueRows(i.finance, ["SOON"]);
  if (soon.length > 0) {
    out.push({ key: "cek-yakin", tone: "uyari", title: `7 gün içinde vadesi gelen çek/senet`, detail: soon.slice(0, 2).map((r) => `${dueLabel(r)} · ${dueAmount(r)}`).join("\n"), route: "/finans" });
  }
  if (i.lastSync !== undefined && syncIsLate(i.lastSync, i.nowMs)) {
    out.push({
      key: "esitleme",
      tone: "uyari",
      title: "Fabrikadan veri gecikti",
      detail: i.lastSync ? `Son eşitleme ${formatAgo(i.lastSync, i.nowMs)} · dokun, yeniden dene` : "Fabrikadan henüz veri gelmedi",
      action: "esitle",
    });
  }
  const weight: Readonly<Record<StatusKind, number>> = { kritik: 0, uyari: 1, bilgi: 2, iyi: 3 };
  return out.sort((a, b) => weight[a.tone] - weight[b.tone]);
}

// ---------------------------------------------------------------- alan kartı özetleri (tek satır)

/** Pano alan satırının alt metni: projeksiyon başına en çok iki fabrika sayısı. */
export function areaSummary(projection: string, data: unknown): string {
  const d = obj(data);
  switch (projection) {
    case "ozet.siparis":
      return `${qty(d.acikKalem)} açık kalem · ${pct(d.karsilanmaYuzde)} karşılandı`;
    case "ozet.sevkiyat": {
      const m = period(d, "buAy");
      return `${PERIOD_LABEL.buAy} ${qty(m.sevkMiktari)} ${UNIT.metre} · ${pct(m.zamanindaYuzde)} zamanında`;
    }
    case "ozet.uretim":
      return `Bugün ${qty(d.bugunTamamlananToplam)} ${UNIT.top} tamamlandı`;
    case "ozet.stok":
      return `Bitmiş ${qty(d.bitmisMiktar)} ${UNIT.metre} · ölü ${qty(d.oluMiktar)} ${UNIT.metre}`;
    case "ozet.fason": {
      const m = period(d, "buAy");
      return `Açıkta ${qty(m.acikMiktar)} ${UNIT.metre} · fire ${pct(m.fireYuzde)}`;
    }
    case "ozet-finans": {
      const rows = arr(d.yaslandirma);
      const first = rows[0];
      if (!first) return "Açık alacak yok";
      const cur = String(first.doviz);
      const more = rows.length > 1 ? " · diğer dövizler Finans'ta" : "";
      return `Açık alacak ${formatMoney(first.acikToplam, cur)} · gecikmiş ${formatMoney(first.gecikmis, cur)}${more}`;
    }
    default:
      return "";
  }
}

/** Kova etiketi (rozet için). */
export function bucketEntry(bucket: string) {
  return CHEQUE_BUCKET[bucket] ?? { label: bucket, tone: "bilgi" as const };
}
