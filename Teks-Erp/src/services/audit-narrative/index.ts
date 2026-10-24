// =============================================================================
// AUDIT ANLATICI — audit satırını OKUMA ANINDA Türkçe cümleye çevirir (izlenebilirlik B2)
// -----------------------------------------------------------------------------
// Tasarım: docs/design/IZLENEBILIRLIK-CIHAZ-PLAN.md §4.2 · kural: docs/kurallar/defter.md (audit).
// Anlatı YALNIZ GÖRÜNTÜDÜR: hiçbir yere yazılmaz, ondan sayı/karar türetilmez; şablon
// değişirse geçmiş satır yeni cümleyle okunur. Sır alanının değeri cümleye girmez.
// Toplu çözüm: sayfanın tüm kayıt numaraları ve UUID değerleri tablo başına tek sorguda.
// =============================================================================

import { enumValueLabel } from "../../constants/audit-enum-etiketleri";
import { tableLabel } from "../../constants/audit-tablo-etiketleri";
import { auditFieldLabel } from "../../constants/audit-field-labels";
import { auditIsmi, kayitCekimi } from "../../constants/audit-isimler";
import { factoryDateTimeTr } from "../../constants/time";
import { eventActionLabel } from "../../constants/audit-tablo-etiketleri";
import { isSecretAuditKey } from "../helpers/audit-diff.helper";
import { resolveChangeValues } from "../helpers/audit-value-resolver";
import { recordKey, resolveRecordNumbers } from "../helpers/audit-record-resolver.helper";
import { type Anlati, type NarrativeRow, type Baglam, type Degisim, type Parca, sablonBul } from "./sablonlar";
import { fallbackNarrative } from "./yedek";

export type { Anlati, NarrativeRow, Parca } from "./sablonlar";

/** Toplu çözümün sonucu: kayıt numaraları + diff'teki UUID değerlerinin adları. */
export interface Cozulmus {
  numaralar: Map<string, string>;
  degerler: Map<string, string>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const SAYI = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });

/** "Ahmet Yılmaz" → "Ahmet Y."; ad yoksa kullanıcı adı; kullanıcı yoksa "Sistem". */
export function kisaAd(user: NarrativeRow["user"]): string {
  const ad = user?.fullName?.trim();
  if (!ad) return user?.username?.trim() || "Sistem";
  const p = ad.split(/\s+/);
  return p.length < 2 ? ad : `${p.slice(0, -1).join(" ")} ${p[p.length - 1]!.charAt(0)}.`;
}

export function kisaKimlik(id: string): string {
  return `#${id.slice(0, 8)}`;
}

/** Tek değerin görüntüsü. Takvim günü (UTC gece yarısı) saatsiz, an fabrika saatinde. */
export function valueText(v: unknown, alan: string, tableName: string, degerler: Map<string, string>): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  if (typeof v === "number") return SAYI.format(v);
  if (typeof v !== "string") return "(içerik)";
  if (UUID_RE.test(v)) return degerler.get(v) ?? kisaKimlik(v);
  if (ISO_RE.test(v)) {
    const t = new Date(v);
    if (!Number.isNaN(t.getTime())) {
      if (/T00:00:00(\.0+)?Z$/.test(v)) return `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}`;
      return factoryDateTimeTr(t);
    }
  }
  if (/^[A-Z][A-Z0-9_]+$/.test(v)) return enumValueLabel(v, { tableName, field: alan });
  return v.length > 60 ? `${v.slice(0, 60)}…` : v;
}

function degisimler(s: NarrativeRow, degerler: Map<string, string>): Degisim[] {
  if (!Array.isArray(s.changes)) return [];
  const out: Degisim[] = [];
  for (const c of s.changes as Array<{ field?: unknown; old?: unknown; new?: unknown }>) {
    if (!c || typeof c.field !== "string") continue;
    const gizli = isSecretAuditKey(c.field);
    out.push({
      alan: auditFieldLabel(c.field),
      eski: gizli ? "" : valueText(c.old, c.field, s.tableName, degerler),
      yeni: gizli ? "" : valueText(c.new, c.field, s.tableName, degerler),
      gizli,
    });
  }
  return out;
}

export function metneCevir(parcalar: Parca[]): Anlati {
  return { parcalar, metin: parcalar.map((p) => p.text).join("") };
}

/** SAF: tek satırın anlatısı (çözüm önceden yapılmış). */
export function narrateRow(s: NarrativeRow, coz: Cozulmus): Anlati {
  const modul = tableLabel(s.tableName);
  const numara = s.recordId ? coz.numaralar.get(recordKey(s.tableName, s.recordId)) : undefined;
  const recordText = s.recordId ? (numara ?? kisaKimlik(s.recordId)) : "";
  const bulunan = sablonBul(s);
  const b: Baglam = {
    kisi: { t: "kisi", text: kisaAd(s.user) },
    kayit: { t: "kayit", text: recordText, ...(s.recordId ? { ref: { table: s.tableName, id: s.recordId } } : {}) },
    isim: auditIsmi(s.tableName) ?? kayitCekimi(modul),
    modul,
    degisimler: degisimler(s, coz.degerler),
    olay: s.event && !bulunan?.olayKarsilandi ? eventActionLabel(s.event) : null,
  };
  return metneCevir(bulunan ? bulunan.sablon(s, b) : fallbackNarrative(s, b));
}

/** Satırların çözümünü toplu yapar: numara (tablo başına tek sorgu) + diff UUID adları. */
export async function anlatimCoz(rows: readonly NarrativeRow[]): Promise<Cozulmus> {
  const [numaralar, degerler] = [
    await resolveRecordNumbers(rows.filter((r) => r.recordId).map((r) => ({ tableName: r.tableName, recordId: r.recordId }))),
    await resolveChangeValues(rows.map((r) => (Array.isArray(r.changes) ? r.changes : null)) as never),
  ];
  return { numaralar, degerler };
}

/** Satırlara `anlati` ekler (yanıtta EK alan; eski istemci yok sayar). */
export async function narrateRows<T extends NarrativeRow>(rows: readonly T[]): Promise<Array<T & { anlati: Anlati }>> {
  if (rows.length === 0) return [];
  const coz = await anlatimCoz(rows);
  return rows.map((r) => ({ ...r, anlati: narrateRow(r, coz) }));
}
