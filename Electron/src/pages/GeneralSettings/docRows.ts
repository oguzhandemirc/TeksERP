// =============================================================================
// Belge Şablonları — TEK TABLO ayar modeli (satır üretimi + okuma/yazma)
// =============================================================================
// 2026-08-06 kullanıcı kararı: panel kendini tekrar etmesin. Öncesinde AYNI belge
// üç ayrı listede anlatılıyordu ve aynı şeyi iki farklı adla iki yerde aramak
// gerekiyordu:
//
//   Bölümler       → yalnız aç/kapa     ("Araç / sürücü satırı")
//   Alan Ayarları  → yalnız punto/kalınlık ("Araç / referans satırı")
//   Kolonlar       → yalnız aç/kapa     ("Çeki Listesi: En · Metre · Kg")
//
// Artık tek tablo: her satırda solda görünürlük kutusu, sağında punto ve kalınlık.
// İkizler TEK SATIRDA birleşir ve **bölüm adı korunur** (kullanıcının bugün açıp
// kapattığı ad) — kullanıcı kararı.
//
// ⚠️ BU DOSYA SUNUM KATMANIDIR, ŞEMA DEĞİL. Saklanan veri değişmez: görünürlük
// hâlâ `sections`/`columns`, stil hâlâ `fields`. Renderer, veritabanı ve backend
// bekçileri bu değişiklikten ETKİLENMEZ. Eşleme haritaları da bilerek burada
// (DocDef'te değil): hangi bölümün hangi alanla aynı şeyi anlattığı bir PANEL
// bilgisidir, belgenin sözleşmesi değil.
//
// ⚠️ ÜÇ SEMANTİK KORUNMAK ZORUNDA — hiçbiri kartta yoktu:
//   1. `sections` bir BLOCKLIST'tir (anahtar yoksa AÇIK), `defaultHidden` taşıyan
//      bölüm ise ALLOWLIST (`=== true` olmadıkça basılmaz).
//   2. Kolonlarda aynı üçlü durum var: normal kolon `hidden` blocklist'iyle,
//      `defaultHidden` kolon `shown` allowlist'iyle yönetilir. Karıştırmak iç
//      veriyi (çuval notu) müşteri irsaliyesine sızdırır.
//   3. Kolonların SIRASI değiştirilebilir (`columns[tablo].order`). Kartta böyle
//      bir şey yoktu; taşımayı bu panele getirmemek özelliği sessizce öldürürdü.
// =============================================================================

import {
  DOC_FIELD_GROUP_LABELS,
  type DocDef,
  type DocFieldGroup,
  type DocFieldStyle,
  type DocFieldWeight,
  type DocSectionDef,
  type DocTableDef,
  type DocumentConfig,
  type ResolvedDocConfig,
} from "@/services/documentConfig";

/**
 * İKİZ EŞLEMESİ — `{ belge: { alanKey: bölümKey } }`.
 *
 * Yalnız GERÇEKTEN aynı şeyi anlatan çiftler yazılır. Bilerek eşlenmeyenler:
 *   • `subLine` / `lnValue` — TEK alan, BİRDEN FAZLA bölümü kapsıyor
 *     (`lnValue` hem belge no hem tarih değerini basar). Birine bağlamak,
 *     kullanıcıya "tarihin puntosunu değiştirdim" dedirtip belge no'yu da
 *     değiştirirdi.
 *   • `boxLabel` / `boxRow` / `boxTitle` — aynı alan birden çok kutuya uygulanır.
 * Bu satırlar ayrı kalır ve kendi adlarıyla listelenir; yanlış birleştirmek,
 * ayrı bırakmaktan kötüdür.
 */
const MERGE: Record<string, Record<string, string>> = {
  shipmentDispatch: { vehicle: "vehicleInfo" },
  fasonSevk: {
    sayin: "subcontractorInfo",
    subLine: "workOrderInfo",
    batchNo: "batchInfo",
    vehicle: "vehicleInfo",
    fabricLine: "fabricHeader",
    note: "notes",
    // `gridCm` ↔ `gridWidth` ikizi 2026-08-06'da düştü: grid'de EN sütunu yok.
  },
  fasonDirectShip: { sayin: "subcontractorInfo", vehicle: "vehicleInfo", note: "notes" },
  kartelaCeki: { sayin: "subcontractorInfo", vehicle: "vehicleInfo", note: "notes" },
  fasonKabul: { sayin: "subcontractorInfo", vehicle: "vehicleInfo", note: "notes" },
  kaliteSertifikasi: { decl: "declaration" },
  // iadeIrsaliyesi: ikiz YOK — `reason` ("İade nedeni") ile `note` ("Not / alt
  // bilgi") farklı şeylerdir, belgede ayrı ayrı basılırlar.
};

/**
 * Eşlenmemiş bölümün hangi grupta çizileceği — yalnız İSTİSNALAR.
 * Varsayılan `header`: bölümlerin büyük çoğunluğu başlık bandındaki veri
 * noktalarıdır (belge no, tarih, vergi no, müşteri kodu…).
 */
const SECTION_GROUP: Record<string, Record<string, DocFieldGroup>> = {
  // ⚠️ `gridWidth` GRID grubunda listelenmeli. İkizi olan `gridCm` alanı
  // kaldırıldığı için (sütun artık boş kutu, punto ayarlanacak metni yok) satır
  // "eşleşmemiş bölüm" dalından geliyor ve o dalın varsayılanı `header` —
  // yazılmazsa kutu, ilgisiz biçimde başlık bandının altında çıkardı.
  // ⚠️ Talimat kutusunun iki satırı da KUTULAR grubunda listelenmeli; eşleşmemiş
  // bölüm dalının varsayılanı `header` ve yazılmazsa ayarlar ilgisiz biçimde
  // başlık bandının altında çıkardı (`gridWidth` emsali, yukarı).
  fasonSevk: {
    dyeColorLine: "boxes",
    productionProps: "boxes",
    instructionWarning: "boxes",
    dyehouseNote: "boxes",
    gridWidth: "grid",
  },
  // Kimlik şeridi tabloların thead'inde yaşıyor → satırı TABLOLAR grubunda
  // listelenmeli; eşleşmemiş bölüm dalının varsayılanı `header` ve yazılmazsa
  // ayar ilgisiz biçimde başlık bandının altında çıkardı (`gridWidth` emsali).
  shipmentDispatch: { listHeader: "table" },
  fasonDirectShip: { directShipInfo: "boxes" },
  fasonKabul: { appliedInfo: "boxes" },
  iadeIrsaliyesi: { reason: "boxes" },
};

const GROUP_ORDER: DocFieldGroup[] = ["header", "grid", "table", "totals", "boxes", "footer"];

// ─── satır tipleri ───────────────────────────────────────────────────────────

export interface DocRow {
  /** React anahtarı — kaynaklar arası çakışmasın diye önekli. */
  id: string;
  label: string;
  hint?: string;
  /** Görünürlüğü yöneten bölüm anahtarı (yoksa satır kapatılamaz). */
  section?: string;
  /** `sections` yerine ALLOWLIST semantiği (bölüm `defaultHidden` taşıyor). */
  sectionOptIn?: boolean;
  /** Punto/kalınlığı yöneten alan anahtarı (yoksa satırın stili ayarlanamaz). */
  field?: string;
  /** Kolon satırı — görünürlük + sıra, stil yok. */
  column?: { table: string; key: string; defaultHidden?: boolean };
}

export interface DocRowGroup {
  key: string;
  title: string;
  /** Grubun tamamını kapatan bölüm (tablo grupları için tablonun kendi bölümü). */
  toggleSection?: string;
  /** Kolon grubunda satır sırası değiştirilebilir. */
  reorderTable?: string;
  rows: DocRow[];
}

// ─── satır üretimi ───────────────────────────────────────────────────────────

/**
 * DocDef'ten tek tablo satırlarını üretir.
 *
 * ⚠️ TÜRETİLİR, ELLE YAZILMAZ. Yeni bir bölüm/alan/kolon eklendiğinde panelde
 * KENDİLİĞİNDEN görünür — elle tutulan bir satır listesi olsaydı, eklenen ayar
 * sessizce panelsiz kalırdı (bu projenin klasik tuzağı: özellik yazıldı, kapısı
 * açılmadı).
 */
export function buildDocRowGroups(def: DocDef): DocRowGroup[] {
  const sections = def.sections ?? [];
  const fields = def.fields ?? [];
  const tables = def.tables ?? [];
  const merge = MERGE[def.key] ?? {};
  const secGroup = SECTION_GROUP[def.key] ?? {};

  const sectionByKey = new Map<string, DocSectionDef>(sections.map((s) => [s.key, s]));
  const tableKeys = new Set(tables.map((t) => t.key));
  // Tablo bölümleri satır DEĞİL grup başlığı olur (aç/kapa oradan yapılır).
  const usedAsGroupToggle = new Set([...tableKeys].filter((k) => sectionByKey.has(k)));
  const mergedSections = new Set(Object.values(merge));

  const buckets = new Map<DocFieldGroup, DocRow[]>();
  const push = (g: DocFieldGroup, row: DocRow) => {
    const list = buckets.get(g) ?? [];
    list.push(row);
    buckets.set(g, list);
  };

  // 1) Alanlar — eşleşen bölüm varsa BÖLÜM ADIYLA ve görünürlükle birlikte.
  for (const f of fields) {
    const secKey = merge[f.key];
    const sec = secKey ? sectionByKey.get(secKey) : undefined;
    push(f.group, {
      id: `f:${f.key}`,
      label: sec ? sec.label : f.label,
      // Adlar ayrışıyorsa alanın adını ipucu yap — kullanıcı "eski adı nerede
      // gitti" diye aramasın.
      hint: sec && sec.label !== f.label ? f.label : undefined,
      ...(sec ? { section: sec.key, sectionOptIn: sec.defaultHidden === true } : {}),
      field: f.key,
    });
  }

  // 2) Eşleşmemiş bölümler — yalnız görünürlük.
  for (const s of sections) {
    if (usedAsGroupToggle.has(s.key) || mergedSections.has(s.key)) continue;
    push(secGroup[s.key] ?? "header", {
      id: `s:${s.key}`,
      label: s.label,
      section: s.key,
      sectionOptIn: s.defaultHidden === true,
    });
  }

  const groups: DocRowGroup[] = [];
  for (const g of GROUP_ORDER) {
    const rows = buckets.get(g);
    if (rows?.length) groups.push({ key: g, title: DOC_FIELD_GROUP_LABELS[g], rows });
    // 3) Kolon grupları — belgenin "Tablolar" bloğunun hemen ardına.
    if (g === "table") for (const t of tables) groups.push(columnGroup(t, sectionByKey));
  }
  return groups;
}

function columnGroup(t: DocTableDef, sectionByKey: Map<string, DocSectionDef>): DocRowGroup {
  return {
    key: `tbl:${t.key}`,
    title: `${t.label} — kolonlar`,
    // Tablo bölümü varsa grup başlığındaki kutu tablonun tamamını kapatır.
    toggleSection: sectionByKey.has(t.key) ? t.key : undefined,
    reorderTable: t.key,
    rows: t.columns.map((c) => ({
      id: `c:${t.key}:${c.key}`,
      label: c.label,
      hint: c.defaultHidden ? "Varsayılan kapalı — baskı sırasında tek seferlik de açılabilir" : undefined,
      column: { table: t.key, key: c.key, defaultHidden: c.defaultHidden },
    })),
  };
}

// ─── okuma ───────────────────────────────────────────────────────────────────

export interface DocRowValue {
  visible: boolean;
  canHide: boolean;
  canStyle: boolean;
  size?: number;
  weight?: DocFieldWeight;
  /** Kolon satırı — başlığı özelleştirilebilir (yalnız `row.column` satırlarında). */
  canLabel: boolean;
  /** Kayıtlı başlık override'ı; yoksa undefined (yerleşik başlık geçerli). */
  labelOverride?: string;
}

export function readDocRow(
  cfg: DocumentConfig | undefined,
  resolved: ResolvedDocConfig,
  row: DocRow,
): DocRowValue {
  const style: DocFieldStyle | undefined = row.field ? cfg?.fields?.[row.field] : undefined;
  const base = { size: style?.size, weight: style?.weight, canStyle: Boolean(row.field) };

  if (row.column) {
    const entry = cfg?.columns?.[row.column.table] ?? {};
    // Tri-state: opt-in kolon `shown` allowlist'iyle, normal kolon `hidden`
    // blocklist'iyle yönetilir (bkz. dosya başlığı, kural 2).
    const visible = row.column.defaultHidden
      ? (entry.shown ?? []).includes(row.column.key)
      : !(entry.hidden ?? []).includes(row.column.key);
    return {
      ...base,
      visible,
      canHide: true,
      canLabel: true,
      labelOverride: entry.labels?.[row.column.key],
    };
  }
  if (row.section) {
    const raw = resolved.sections[row.section];
    const visible = row.sectionOptIn ? raw === true : raw !== false;
    return { ...base, visible, canHide: true, canLabel: false };
  }
  return { ...base, visible: true, canHide: false, canLabel: false };
}

// ─── yazma ───────────────────────────────────────────────────────────────────

export interface DocRowPatch {
  visible?: boolean;
  /** null → puntoyu temizle (varsayılana dön). */
  size?: number | null;
  /** null → kalınlığı temizle (varsayılana dön). */
  weight?: DocFieldWeight | null;
  /** Kolon başlığı override'ı. Boş dize = anahtarı SİL (yerleşik başlığa dön) —
   *  punto kutusundaki "boş = varsayılan" sözleşmesinin birebir aynısı. */
  label?: string;
}

/**
 * Satır yamasını `Partial<DocumentConfig>`e çevirir (panelin `patch`ine verilir).
 *
 * ⚠️ BOŞ DEĞER ANAHTARI SİLER, sıfır YAZMAZ — kullanıcı punto kutusunu
 * boşaltınca niyeti "0 punto" değil "varsayılana dön"dür. Alan tamamen
 * varsayılana dönerse `fields`ten DÜŞER; backend'in "override yoksa tek bayt
 * ek CSS basılmaz" kuralının ön koşulu budur.
 */
export function writeDocRow(
  cfg: DocumentConfig | undefined,
  resolved: ResolvedDocConfig,
  row: DocRow,
  patch: DocRowPatch,
): Partial<DocumentConfig> {
  const out: Partial<DocumentConfig> = {};

  if (row.field && (patch.size !== undefined || patch.weight !== undefined)) {
    const all = { ...(cfg?.fields ?? {}) };
    const cur: DocFieldStyle = { ...(all[row.field] ?? {}) };
    if (patch.size !== undefined) {
      if (patch.size == null) delete cur.size;
      else cur.size = patch.size;
    }
    if (patch.weight !== undefined) {
      if (patch.weight == null) delete cur.weight;
      else cur.weight = patch.weight;
    }
    if (cur.size == null && cur.weight == null) delete all[row.field];
    else all[row.field] = cur;
    out.fields = all;
  }

  if (patch.visible != null) {
    if (row.column) {
      const entry = { ...(cfg?.columns?.[row.column.table] ?? {}) };
      if (row.column.defaultHidden) {
        const shown = new Set(entry.shown ?? []);
        if (patch.visible) shown.add(row.column.key);
        else shown.delete(row.column.key);
        if (shown.size) entry.shown = [...shown];
        else delete entry.shown;
      } else {
        const hidden = new Set(entry.hidden ?? []);
        if (patch.visible) hidden.delete(row.column.key);
        else hidden.add(row.column.key);
        if (hidden.size) entry.hidden = [...hidden];
        else delete entry.hidden;
      }
      out.columns = { ...cfg?.columns, [row.column.table]: entry };
    } else if (row.section) {
      out.sections = { ...resolved.sections, [row.section]: patch.visible };
    }
  }

  // Kolon başlığı override'ı — görünürlükle AYNI `columns[tablo]` girdisine yazar.
  // ⚠️ Aynı yamada ikisi de gelirse `out.columns`taki girdiyi temel al: iki dal
  // da `cfg`den okusaydı ikincisi birincisini sessizce EZERDİ.
  if (row.column && patch.label !== undefined) {
    const table = row.column.table;
    const base = (out.columns?.[table] ?? cfg?.columns?.[table] ?? {}) as {
      hidden?: string[];
      order?: string[];
      shown?: string[];
      labels?: Record<string, string>;
    };
    const entry = { ...base };
    const labels = { ...(entry.labels ?? {}) };
    const t = patch.label.trim();
    if (t) labels[row.column.key] = t;
    else delete labels[row.column.key];
    if (Object.keys(labels).length) entry.labels = labels;
    else delete entry.labels;
    out.columns = { ...cfg?.columns, ...out.columns, [table]: entry };
  }
  return out;
}

/** Grubun tamamını kapatan bölüm anahtarı için yama. */
export function writeGroupToggle(
  resolved: ResolvedDocConfig,
  sectionKey: string,
  visible: boolean,
): Partial<DocumentConfig> {
  return { sections: { ...resolved.sections, [sectionKey]: visible } };
}

/** Kolonların ekrandaki sırası — `order` verilmişse ona göre, bilinmeyenler sona. */
export function orderedColumnRows(cfg: DocumentConfig | undefined, group: DocRowGroup): DocRow[] {
  if (!group.reorderTable) return group.rows;
  const order = cfg?.columns?.[group.reorderTable]?.order ?? [];
  const pos = new Map(order.map((k, i) => [k, i]));
  return [...group.rows].sort(
    (a, b) => (pos.get(a.column?.key ?? "") ?? 999) - (pos.get(b.column?.key ?? "") ?? 999),
  );
}

/** Kolonu bir sıra yukarı/aşağı taşır. */
export function moveColumn(
  cfg: DocumentConfig | undefined,
  group: DocRowGroup,
  index: number,
  dir: -1 | 1,
): Partial<DocumentConfig> | null {
  if (!group.reorderTable) return null;
  const keys = orderedColumnRows(cfg, group).map((r) => r.column?.key ?? "");
  const j = index + dir;
  if (j < 0 || j >= keys.length) return null;
  const a = keys[index];
  const b = keys[j];
  if (a === undefined || b === undefined) return null;
  keys[index] = b;
  keys[j] = a;
  return {
    columns: {
      ...cfg?.columns,
      [group.reorderTable]: { ...cfg?.columns?.[group.reorderTable], order: keys },
    },
  };
}

/** Girilen metni geçerli punto'ya çevirir; boş/anlamsız → null (= varsayılan). */
export function parseDocSize(raw: string, min: number, max: number): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}
