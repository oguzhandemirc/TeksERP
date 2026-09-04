// =============================================================================
// Belge tablo motoru — kolon aç/kapa + sıralama destekli ORTAK tablo üretici
// =============================================================================
// DocumentConfig.columns: { [tabloKey]: { hidden: [kolonKey], order: [kolonKey] } }
// Renderer her tabloyu kolon tanımlarıyla buradan üretir; görünür kolon kümesi ve
// sırası config'ten gelir. Toplam satırı görünür kolonlara göre yeniden kurulur
// (colspan hesabı otomatik). Hücre içerikleri ÇAĞIRAN tarafından escape edilir.
// =============================================================================

/** Tek tablo için ham kolon ayarı (DocumentConfig.columns[tabloKey]). */
export interface DocColumnCfg {
  hidden?: string[];
  order?: string[];
  /**
   * OPT-IN kolonlar (`DocCol.defaultHidden`) — yalnız burada adı geçenler basılır.
   * `hidden` bir BLOCKLIST'tir: yeni bir kolon eklendiğinde mevcut config'lerde
   * `hidden` listesinde olmadığı için VARSAYILAN GÖRÜNÜR doğar. İç veri (çuval
   * yorumu gibi) taşıyan kolonlar için bu yanlış varsayılan — müşteriye giden
   * belgeye sızar. O yüzden `defaultHidden` kolonlar ters mantıkla çalışır:
   * `shown` içermiyorsa basılmaz, `hidden` onlarda YOK SAYILIR.
   */
  shown?: string[];
  /**
   * KOLON BAŞLIĞI ÖZELLEŞTİRME (2026-09-04) — `{ kolonKey: "Yeni Başlık" }`.
   *
   * Fabrika müşteriye giden belgede kendi dilini kullanabilsin diye ("STOK ADI"
   * yerine "ÜRÜN", "MÜŞTERİ STOK ADI" yerine "SİZDEKİ AD"). Verilmeyen kolon
   * yerleşik başlığını korur; **boş dize / yalnız boşluk = VARSAYILANA DÖN**
   * (silinmiş sayılır), çünkü kullanıcı kutuyu boşaltınca niyeti "başlıksız
   * kolon" değil "eski hâline dön"dür — belge kolonu başlıksız basmak, sütunun
   * ne olduğunu okunamaz kılardı.
   *
   * ⚠️ DEĞER KULLANICI GİRDİSİDİR ve yerleşik `label`ların aksine HTML olarak
   * güvenli DEĞİLDİR → `applyColumnCfg` onu kaçırır (tek nokta). Yeni bir tablo
   * motoru yazan biri bu kaçırmayı da taşımak zorunda.
   */
  labels?: Record<string, string>;
}

/** Başlık override'ı HTML'e gömülür — yerleşik etiketler sabit literal, bu DEĞİL. */
function escLabel(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface DocCol<R> {
  key: string;
  /** Başlık hücresi metni (escape edilmiş varsayılır — sabit literal). */
  label: string;
  align: "l" | "r" | "c";
  /** İsteğe bağlı sabit genişlik (style="width:..."). */
  width?: string;
  /** Ek hücre sınıfı (örn. "mono"). */
  cellClass?: string;
  /** Satır hücresi içeriği — çağıran escape eder. */
  cell: (row: R, index: number) => string;
  /** Toplam satırı hücresi (verilmezse boş; footLabel ilk boş görünür hücreye oturur). */
  foot?: string;
  /**
   * OPT-IN kolon: varsayılan BASILMAZ, yalnız `cfg.shown` içinde adı geçerse basılır.
   * İç/hassas veri taşıyan kolonlar (çuval yorumu) için — `hidden` blocklist'i
   * bu kolonlarda yok sayılır. Bkz. DocColumnCfg.shown.
   */
  defaultHidden?: boolean;
}

/** Config'e göre görünür + sıralı kolon listesi. Tümü gizlenirse tablo boş döner. */
export function applyColumnCfg<R>(cols: DocCol<R>[], cfg?: DocColumnCfg): DocCol<R>[] {
  const hidden = new Set(cfg?.hidden ?? []);
  const shown = new Set(cfg?.shown ?? []);
  let out = cols.filter((c) =>
    // OPT-IN kolon: yalnız `shown` içeriyorsa görünür (`hidden` yok sayılır).
    // Normal kolon: `hidden` içermiyorsa görünür (mevcut blocklist davranışı).
    c.defaultHidden ? shown.has(c.key) : !hidden.has(c.key),
  );
  const order = cfg?.order;
  if (order && order.length) {
    const pos = new Map(order.map((k, i) => [k, i]));
    // Bilinmeyen/eski kolon adları sona düşer (kayıt sırası korunur — stable sort).
    out = [...out].sort((a, b) => (pos.get(a.key) ?? 999) - (pos.get(b.key) ?? 999));
  }
  // Başlık override'ı EN SONDA ve YALNIZ GÖRÜNÜR kolonlara — gizli kolonun
  // başlığını hesaplamak boşuna, ve sıralamadan sonra uygulamak override'ın
  // sıralamaya karışmadığını yapısal olarak garanti eder.
  const labels = cfg?.labels;
  if (labels) {
    out = out.map((c) => {
      const raw = labels[c.key];
      const t = typeof raw === "string" ? raw.trim() : "";
      return t ? { ...c, label: escLabel(t) } : c;
    });
  }
  return out;
}

/**
 * Tam tablo HTML'i. `caption` verilirse thead'e colspan'lı başlık satırı basılır.
 * `footLabel` (örn. "TOPLAM") foot'u olmayan İLK görünür kolona yazılır; hiç foot
 * tanımlı kolon görünmüyorsa toplam satırı basılmaz.
 */
export function buildDocTable<R>(opts: {
  className: string;
  caption?: string;
  cols: DocCol<R>[];
  rows: R[];
  colCfg?: DocColumnCfg;
  footLabel?: string;
}): string {
  const cols = applyColumnCfg(opts.cols, opts.colCfg);
  if (!cols.length) return "";

  const captionRow = opts.caption
    ? `<tr><th class="caption" colspan="${cols.length}">${opts.caption}</th></tr>`
    : "";
  const headRow =
    "<tr>" +
    cols
      .map(
        (c) =>
          `<th class="${c.align}"${c.width ? ` style="width:${c.width}"` : ""}>${c.label}</th>`,
      )
      .join("") +
    "</tr>";

  const body = opts.rows
    .map(
      (r, i) =>
        "<tr>" +
        cols
          .map(
            (c) =>
              `<td class="${c.align}${c.cellClass ? ` ${c.cellClass}` : ""}">${c.cell(r, i)}</td>`,
          )
          .join("") +
        "</tr>",
    )
    .join("");

  let footRow = "";
  if (opts.footLabel && cols.some((c) => c.foot !== undefined)) {
    let labelPlaced = false;
    footRow =
      '<tr class="tot">' +
      cols
        .map((c) => {
          let content = c.foot ?? "";
          if (!content && !labelPlaced) {
            content = opts.footLabel as string;
            labelPlaced = true;
          }
          return `<td class="${c.align}">${content}</td>`;
        })
        .join("") +
      "</tr>";
  }

  return `<table class="${opts.className}"><thead>${captionRow}${headRow}</thead><tbody>${body}${footRow}</tbody></table>`;
}
