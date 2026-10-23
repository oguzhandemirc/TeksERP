// Gelen kutusu mesajının okunur özeti (saf): gövdenin KENDİ alanlarından — ek sunucu araması yok. Sipariş gövdesi
// kimlik taşır (cari/ürün adı yok); ad yalnız gövdede varsa (`musteriUrunAdi`, cari `ad`) gösterilir, kimlik asla.
import type { CustomerMessageBody, InboxItem, OrderMessageBody } from "../../api/wire";
import { formatDate, formatMoney, formatNumber } from "../../lib/format";

/** Bekleyen mesaj bu kadar süredir işlenmediyse uyarı rengiyle çizilir. */
export const INBOX_OVERDUE_MS = 24 * 3_600_000;

/** Fabrikanın henüz kesinleştirmediği durumlar (ekran kısa yoklama yapar). */
export function inboxPending(durum: unknown): boolean {
  return durum === "BEKLIYOR" || durum === "ISLENIYOR";
}

export function inboxOverdue(m: Pick<InboxItem, "durum" | "olusturulma">, nowMs: number = Date.now()): boolean {
  const t = Date.parse(m.olusturulma);
  return m.durum === "BEKLIYOR" && Number.isFinite(t) && nowMs - t > INBOX_OVERDUE_MS;
}

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

function orderLines(govde: unknown): OrderMessageBody["kalemler"] {
  const k = obj(govde)?.kalemler;
  return Array.isArray(k) ? (k.filter((x) => obj(x) !== null) as OrderMessageBody["kalemler"]) : [];
}

/** Kalemlerin toplam miktarı; birimler karışıksa birimsiz toplam verilmez (yanıltır). */
export function orderTotal(govde: unknown): { readonly miktar: string; readonly birim: string | null } | null {
  const lines = orderLines(govde);
  if (lines.length === 0) return null;
  const units = new Set(lines.map((l) => str(l.birim) ?? ""));
  if (units.size > 1) return null;
  const sum = lines.reduce((a, l) => a + (Number(l.miktar) || 0), 0);
  const unit = [...units][0] ?? "";
  return { miktar: formatNumber(sum), birim: unit === "" ? null : unit.toLowerCase() };
}

/** Liste satırının tek satırlık özeti. */
export function inboxSummary(m: Pick<InboxItem, "tur" | "govde">): string {
  const g = obj(m.govde);
  if (!g) return "İçerik okunamadı";
  if (m.tur === "CARI") {
    const c = g as Partial<CustomerMessageBody>;
    const roles = [c.roller?.musteri ? "Müşteri" : null, c.roller?.tedarikci ? "Tedarikçi" : null].filter(Boolean).join(" + ");
    return [str(c.ad) ?? "Adsız cari", roles || null, str(c.il)].filter(Boolean).join(" · ");
  }
  const lines = orderLines(g);
  const total = orderTotal(g);
  const parts = [`${lines.length} kalem`];
  if (total) parts.push(`${total.miktar}${total.birim ? ` ${total.birim}` : ""}`);
  const termin = str(g.termin);
  if (termin) parts.push(`termin ${formatDate(termin)}`);
  return parts.join(" · ");
}

export interface BodyRow {
  readonly label: string;
  readonly value: string;
}

export interface OrderLineView {
  readonly title: string;
  readonly detail: string;
  readonly amount: string;
}

/** Ayrıntı ekranı: gövde → etiketli satırlar (+ sipariş kalemleri). Bilinmeyen biçim `null` (çağıran jenerik çizer). */
export function inboxBody(m: Pick<InboxItem, "tur" | "govde">): { readonly rows: readonly BodyRow[]; readonly lines: readonly OrderLineView[] } | null {
  const g = obj(m.govde);
  if (!g) return null;
  const rows: BodyRow[] = [];
  const add = (label: string, v: unknown) => {
    const s = str(v);
    if (s) rows.push({ label, value: s });
  };
  if (m.tur === "CARI") {
    const c = g as Partial<CustomerMessageBody>;
    add("Ad", c.ad);
    const roles = [c.roller?.musteri ? "Müşteri" : null, c.roller?.tedarikci ? "Tedarikçi" : null].filter(Boolean).join(" + ");
    add("Rol", roles);
    add("Konum", [str(c.ilce), str(c.il), str(c.ulke)].filter(Boolean).join(", "));
    add("Adres", c.adres);
    add("Vergi no", c.vergiNo);
    add("Vergi dairesi", c.vergiDairesi);
    add("Yetkili", c.yetkili);
    add("Telefon", c.telefon);
    add("E-posta", c.eposta);
    return { rows, lines: [] };
  }
  if (m.tur === "SIPARIS") {
    const termin = str(g.termin);
    if (termin) rows.push({ label: "Termin", value: formatDate(termin) });
    add("Döviz", g.doviz);
    add("Açıklama", g.aciklama);
    const doviz = str(g.doviz) ?? "TRY";
    const lines = orderLines(g).map((l, i): OrderLineView => {
      const unit = str(l.birim)?.toLowerCase();
      const detail = [
        str(l.musteriRenkAdi) ? `Renk: ${str(l.musteriRenkAdi)}` : null,
        str(l.en) ? `En: ${formatNumber(l.en)} cm` : null,
        str(l.birimFiyat) ? `Birim fiyat: ${formatMoney(l.birimFiyat, doviz)}` : null,
      ].filter(Boolean).join(" · ");
      return { title: str(l.musteriUrunAdi) ?? `${i + 1}. kalem`, detail, amount: `${formatNumber(l.miktar)}${unit ? ` ${unit}` : ""}` };
    });
    return { rows, lines };
  }
  return null;
}
