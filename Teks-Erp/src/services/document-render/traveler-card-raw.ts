// =============================================================================
// Refakat Kartı — UZMAN MODU (RAW_HTML) motoru + sanitizasyon
// =============================================================================
// Üç kademeli şablon modelinin en üst kademesi: admin kartın tüm HTML'ini
// kendisi yazar, veriyi {{alan}} ve {{#liste}}…{{/liste}} ile çağırır. Yerleşik
// CSS hiç yüklenmez — sayfa tamamen onundur.
//
// NEDEN KENDİ MOTORU: Allowed Packages listesinde handlebars/mustache yok ve
// olmamalı — bu motorun TEK işi metin ikamesi; ifade/koşul/JS değerlendirmesi
// KASITLI olarak yoktur. Şablon dili büyüdükçe (helper, koşul, kapsam) sunucuda
// kullanıcı-yazımı mantık çalıştırmaya doğru kayar. İhtiyaç doğarsa çözüm yeni
// bir sözdizimi değil, katalogda YENİ ALAN'dır (değer üretimi bizde kalır).
//
// GÜVENLİK İKİ KATMANLI, ikisi de gerekli:
//   1) `sanitizeTemplateHtml` — ŞABLONUN kendisinden aktif içerik ayıklanır
//      (script/on*/javascript:/dış kaynak). Kayıtta ve render'da koşar.
//   2) `escapeHtml` — VERİ değerleri gömülürken kaçırılır. Yalnız katalogda
//      `raw: true` işaretli (sunucu-üretimi SVG) hariç.
// Birincisi olmadan admin XSS yazabilirdi; ikincisi olmadan ürün adındaki bir
// "<" düzeni bozardı. Sanitizasyon ŞABLONA uygulanır, çıktının tamamına DEĞİL —
// aksi halde kendi ürettiğimiz QR SVG'si de ayıklanırdı.
// =============================================================================

import type { TravelerCardSnapshot, TravelerCardMeta, TravelerBatchLine } from "./traveler-card.html";
import {
  TRAVELER_RAW_KEYS,
  TRAVELER_FIELD_KEYS,
  TRAVELER_LOOP_KEYS,
  TRAVELER_LOOPS,
} from "../../config/traveler-card-fields";

/** Tüm döngülerin satır alanları (düzleştirilmiş) — bilinmeyen-anahtar taramasında kabul edilir. */
const LOOP_ROW_KEYS = new Set(TRAVELER_LOOPS.flatMap((l) => l.fields.map((f) => f.key)));

const TYPE_LABELS: Record<string, string> = {
  ORDER_PRODUCTION: "Siparişe Özel",
  STOCK_PRODUCTION: "Stok",
};

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Motorun çözebildiği tekil değerler + tekrar blokları için satır listeleri. */
export interface RawContext {
  fields: Record<string, string>;
  loops: Record<string, Record<string, string>[]>;
}

/** Snapshot + meta → ikame bağlamı. Katalog (`traveler-card-fields`) ile eşleşmeli. */
export function buildRawContext(
  snapshot: TravelerCardSnapshot,
  meta: TravelerCardMeta,
): RawContext {
  const cfg: Partial<NonNullable<TravelerCardSnapshot["config"]>> = snapshot.config ?? {};
  const steps = [...(snapshot.steps ?? [])].sort((a, b) => a.stepSequence - b.stepSequence);
  const orderLinks = snapshot.orderLinks ?? [];
  const batches: TravelerBatchLine[] = meta.batches ?? [];
  const orderQtyTotal = orderLinks.reduce((s, l) => s + (l.orderLine?.quantity ?? 0), 0);

  return {
    fields: {
      cardNumber: meta.cardNumber,
      barcode: meta.barcode,
      workOrderNumber: snapshot.workOrderNumber ?? "",
      version: String(meta.version),
      printedAt: fmtDateTime(meta.printedAt),
      companyName: cfg.companyName?.trim() || "Adnan Şahin Tekstil",
      addressLine: cfg.addressLine?.trim() ?? "",
      phone: cfg.phone?.trim() ?? "",
      footerNote: cfg.footerNote?.trim() ?? "",
      qrSvg: meta.qrSvg ?? "",

      itemCode: snapshot.targetItem?.code ?? "",
      itemName: snapshot.targetItem?.name ?? "",
      colorName: snapshot.targetColor?.name ?? "",
      width: snapshot.width == null ? "" : String(snapshot.width),
      foldType: snapshot.foldType ?? "",
      properties: (snapshot.targetProperties ?? []).map((p) => p.property.name).join(", "),

      typeText:
        (TYPE_LABELS[snapshot.type] ?? snapshot.type) +
        (snapshot.routeTemplate ? ` · Rota: ${snapshot.routeTemplate.name}` : ""),
      routeName: snapshot.routeTemplate?.name ?? "",
      targetQuantity: fmtNum(snapshot.targetQuantity),
      targetWeight: fmtNum(snapshot.targetWeight),
      startDate: fmtDate(snapshot.plannedStartDate),
      endDate: fmtDate(snapshot.plannedEndDate),

      batchCount: String(batches.length),
      batchRollTotal: String(batches.reduce((s, b) => s + b.rollCount, 0)),
      batchQtyTotal: fmtNum(batches.reduce((s, b) => s + (b.quantity ?? 0), 0)),
      orderCount: String(orderLinks.length),
      orderQtyTotal: fmtNum(orderQtyTotal),
    },
    loops: {
      steps: steps.map((st, i) => ({
        seq: String(i + 1),
        stationName: st.station?.name ?? "",
        subcontractorName: st.plannedSubcontractor?.name ?? "",
        notes: st.notes ?? "",
      })),
      batches: batches.map((b, i) => ({
        seq: String(i + 1),
        batchNumber: b.batchNumber,
        rollCount: String(b.rollCount),
        quantity: fmtNum(b.quantity),
        dispatchNo: b.dispatch?.dispatchNo ?? "",
        subcontractorName: b.dispatch?.subcontractorName ?? "",
      })),
      orders: orderLinks.map((l, i) => ({
        seq: String(i + 1),
        orderNumber: l.orderLine?.order?.orderNumber ?? "",
        customerName: l.orderLine?.order?.customer?.name ?? "",
        itemName: l.orderLine?.item?.name ?? "",
        colorName: l.orderLine?.color?.name ?? "",
        quantity: fmtNum(l.orderLine?.quantity ?? null),
      })),
    },
  };
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Tek geçişte {{alan}} ikamesi (kaçırmalı; `raw` anahtarlar ham). */
function fillFields(tpl: string, values: Record<string, string>): string {
  return tpl.replace(PLACEHOLDER_RE, (_m, key: string) => {
    const v = values[key];
    if (v === undefined) return ""; // bilinmeyen anahtar → boş (baskı durmaz)
    return TRAVELER_RAW_KEYS.has(key) ? v : escapeHtml(v);
  });
}

/**
 * {{#liste}} … {{/liste}} bloklarını satır satır açar, sonra tekil alanları
 * doldurur. İç içe döngü DESTEKLENMEZ (veri modelinde ihtiyaç yok) ve blok
 * içindeki satır alanları dış alanları GÖLGELER — örn. `steps` içindeki
 * `{{notes}}` adımın notudur.
 */
export function renderRawTemplate(templateHtml: string, ctx: RawContext): string {
  const safe = sanitizeTemplateHtml(templateHtml);
  const withLoops = safe.replace(
    /\{\{#\s*([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g,
    (_m, key: string, body: string) => {
      const rows = ctx.loops[key];
      if (!rows) return ""; // bilinmeyen liste → blok tamamen düşer
      return rows.map((row) => fillFields(body, { ...ctx.fields, ...row })).join("");
    },
  );
  return fillFields(withLoops, ctx.fields);
}

// =============================================================================
// Sanitizasyon — ŞABLON metninden aktif içeriği ayıklar
// =============================================================================
// Allowlist değil blocklist olmasının sebebi: bu bir sayfa, alan değil — admin
// istediği etiketi/CSS'i kullanabilmeli. Kesilen şey "kod çalıştıran" ve "dışarı
// çıkan" yüzeylerdir. Bunlar TEK TEK gerekçelidir; birini kaldırmadan önce
// hangi saldırıyı açtığını yaz.
//
// AŞIRI KESME GÜVENLİ YÖNDÜR: kapanışsız bir `<script src=…>`, metindeki bir
// sonraki `</script>`e kadar (yoksa sonuna kadar) her şeyi yutar. Meşru bir
// şablonda `<script` zaten bulunmaz — yani bedeli yalnız saldırgan/hatalı
// şablon öder. Ters tercih (dar eşleşme) kapanışsız etiketle atlatılabilirdi.
//
// BİLİNÇLİ OLARAK KESİLMEYEN: dış `<img src="http…">` ve `<a href="http…">`.
// Kart bir BELGEDİR, kum havuzu değil — fabrika kendi sunucusundaki logoyu
// gömebilmeli. Script yürütmesi zaten ayrı bir katmanda kapalı (önizleme ve
// baskı iframe'lerinde `allow-scripts` YOK), o yüzden dış kaynak en fazla
// "yüklenemedi" olur. Bunu kapatmak istersen kararı burada gerekçelendir.
const STRIP_RULES: { re: RegExp; what: string }[] = [
  // <script>…</script> ve kapanışsız hâli
  { re: /<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, what: "script etiketi" },
  // <iframe>/<object>/<embed> — gömülü tarayıcı bağlamı
  { re: /<\/?(?:iframe|object|embed|applet)\b[^>]*>/gi, what: "gömülü içerik etiketi" },
  // <link rel=…> / <meta http-equiv=…> — dış kaynak + yönlendirme
  { re: /<(?:link|meta)\b[^>]*>/gi, what: "link/meta etiketi" },
  // on* olay öznitelikleri (tırnaklı ve tırnaksız)
  { re: /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, what: "olay özniteliği" },
  // javascript: / vbscript: / data:text/html şemaları
  { re: /(?:javascript|vbscript)\s*:/gi, what: "script şeması" },
  { re: /data\s*:\s*text\/html/gi, what: "data:text/html şeması" },
];

/**
 * Şablon HTML'inden aktif/dış içeriği ayıklar. Kayıtta VE render'da koşar —
 * ikisi de gerekli: kayıt kullanıcıya ne kesildiğini söyler, render ise
 * kayıt kapısını atlayan yollara (elle DB düzenlemesi, eski satır, geri
 * yükleme) karşı son savunmadır.
 */
export function sanitizeTemplateHtml(html: string): string {
  let out = html;
  for (const r of STRIP_RULES) out = out.replace(r.re, "");
  return out;
}

/** Kayıt kapısı için: neyin kesileceğini SÖYLER (kesmez). Stüdyo bunu uyarı olarak basar. */
export function describeSanitization(html: string): string[] {
  const found: string[] = [];
  for (const r of STRIP_RULES) {
    // `g` bayraklı regex'lerde lastIndex taşımasın diye her seferinde yeniden kur.
    if (new RegExp(r.re.source, r.re.flags.replace("g", "")).test(html)) found.push(r.what);
  }
  return found;
}

/**
 * Uzman şablonunu BASKIYA HAZIR tam belgeye sarar.
 *
 * Sarmalayıcının verdiği TEK şey `@page` (sayfa boyutu + kenar payları) ve
 * ekran önizlemesinde sayfayı fiziksel ölçüsünde çizen kabuktur. Yerleşik kart
 * CSS'i (yazı boyları, tablolar, grid) BİLEREK yüklenmez — uzman modunun sözü
 * "sayfa tamamen senin"dir; yarı-yüklü bir stil, kullanıcının kendi kurallarıyla
 * öngörülemez biçimde çarpışırdı.
 *
 * `@page` kuralımız EN BAŞTA durur → uzman kendi `@page`ini yazarsa sonraki
 * kural kazanır ve onu da devralabilir. Yani varsayılan veriyoruz, dayatmıyoruz.
 */
export function wrapRawDocument(
  bodyHtml: string,
  opts: { pageSize: "A4" | "A5"; margins: { top: number; right: number; bottom: number; left: number } },
): string {
  const { pageSize, margins: m } = opts;
  const dim = pageSize === "A5" ? { w: 148, h: 210 } : { w: 210, h: 297 };
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<style>
  @page { size: ${pageSize}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #000; }
  /* Ekran önizlemesi: @page yalnız BASKI'da geçerli → sayfayı gerçek ölçüsünde
     çiz + payları padding yap (yerleşik kartla aynı kabuk). */
  @media screen {
    body { background: #94a3b8; padding: 14px 0; }
    .sheet { width: ${dim.w}mm; min-height: ${dim.h}mm; margin: 0 auto;
             padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
             background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.28); }
  }
</style></head>
<body>
  <div class="sheet">
${bodyHtml}
  </div>
</body></html>`;
}

/**
 * Şablonda katalogda OLMAYAN anahtarları bulur (stüdyo uyarısı). Hata değildir:
 * bilinmeyen anahtar boş basar, baskı durmaz — ama sessiz de kalmaz.
 */
export function findUnknownKeys(html: string): string[] {
  const unknown = new Set<string>();
  for (const m of html.matchAll(/\{\{\s*[#/]?\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    const key = m[1];
    if (!key) continue;
    const isLoopMarker = /\{\{\s*[#/]/.test(m[0]);
    if (isLoopMarker) {
      if (!TRAVELER_LOOP_KEYS.has(key)) unknown.add(key);
      continue;
    }
    // Döngü İÇİ satır alanları (batchNumber, stationName…) tekil katalogda yok →
    // her döngünün alanlarını da kabul et.
    if (TRAVELER_FIELD_KEYS.has(key) || LOOP_ROW_KEYS.has(key)) continue;
    unknown.add(key);
  }
  return [...unknown];
}
