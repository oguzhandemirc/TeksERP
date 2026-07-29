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
}

/** Config'e göre görünür + sıralı kolon listesi. Tümü gizlenirse tablo boş döner. */
export function applyColumnCfg<R>(cols: DocCol<R>[], cfg?: DocColumnCfg): DocCol<R>[] {
  const hidden = new Set(cfg?.hidden ?? []);
  let out = cols.filter((c) => !hidden.has(c.key));
  const order = cfg?.order;
  if (order && order.length) {
    const pos = new Map(order.map((k, i) => [k, i]));
    // Bilinmeyen/eski kolon adları sona düşer (kayıt sırası korunur — stable sort).
    out = [...out].sort((a, b) => (pos.get(a.key) ?? 999) - (pos.get(b.key) ?? 999));
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
