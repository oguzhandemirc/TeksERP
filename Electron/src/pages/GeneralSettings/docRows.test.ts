// =============================================================================
// TEST: Belge Şablonları TEK TABLO ayar modeli
// =============================================================================
// Panel sunum katmanıdır ama ARKASINDA ÜÇ FARKLI SEMANTİK var ve üçü de sessizce
// bozulabilir:
//
//   1. `sections` BLOCKLIST'tir (anahtar yoksa AÇIK); `defaultHidden` taşıyan
//      bölüm ise ALLOWLIST (`=== true` olmadıkça basılmaz).
//   2. Kolonlarda aynı üçlü durum: normal kolon `hidden`, opt-in kolon `shown`.
//      Karıştırmak iç veriyi (çuval notu) müşteri irsaliyesine SIZDIRIR.
//   3. Kolon SIRASI (`order`) — eski panelde vardı; taşımada düşerse özellik
//      hata vermeden ölür.
//
// Ayrıca kilitlenen: satırlar TÜRETİLİR (elle liste tutulmaz), ikiz eşlemesi
// bölüm adını korur, boş punto anahtarı siler.
//
// NEGATİF SONDA — "kırmızı verebiliyor mu" KANITLANDI (2026-08-06, 4 sonda; her
// sondadan sonra dosya `diff` ile birebir geri yüklendiği doğrulandı):
//   ① opt-in kolon blocklist'e yazıldı (iç veri sızması) → 2 düştü
//   ② kolon taşıma devre dışı bırakıldı                  → 1 düştü
//   ③ ikiz eşleme haritası boşaltıldı                    → 3 düştü
//   ④ alanlar satır üretiminden düşürüldü                → 12 düştü
// Bu dosyayı değiştirirsen aynı dördünü TEKRARLA — kırmızı verdiği kanıtlanmamış
// bekçi, bekçi değil süstür.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  buildDocRowGroups,
  moveColumn,
  orderedColumnRows,
  parseDocSize,
  readDocRow,
  writeDocRow,
  type DocRow,
} from "./docRows";
import {
  DOC_DEFS,
  DOC_DEF_MAP,
  resolveDocConfig,
  type DocumentConfig,
} from "@/services/documentConfig";

const FASON = DOC_DEF_MAP.fasonSevk!;
const SEVK = DOC_DEF_MAP.shipmentDispatch!;
/** Satırı config ile birlikte okumak için kısayol (panelin yaptığının aynısı). */
const read = (defKey: string, cfg: DocumentConfig, row: DocRow) =>
  readDocRow(cfg, resolveDocConfig({ [defKey]: cfg }, defKey), row);
const write = (defKey: string, cfg: DocumentConfig, row: DocRow, patch: Parameters<typeof writeDocRow>[3]) =>
  writeDocRow(cfg, resolveDocConfig({ [defKey]: cfg }, defKey), row, patch);

const allRows = (def: typeof FASON) => buildDocRowGroups(def).flatMap((g) => g.rows);
const rowById = (def: typeof FASON, id: string): DocRow => {
  const r = allRows(def).find((x) => x.id === id);
  if (!r) throw new Error(`satır yok: ${id}`);
  return r;
};

describe("satır üretimi", () => {
  it("yedi belgenin hepsi satır üretiyor", () => {
    for (const def of DOC_DEFS) {
      expect(buildDocRowGroups(def).length, def.key).toBeGreaterThan(0);
    }
  });

  it("satır id'leri her belgede benzersiz", () => {
    for (const def of DOC_DEFS) {
      const ids = allRows(def).map((r) => r.id);
      expect(new Set(ids).size, def.key).toBe(ids.length);
    }
  });

  it("hiçbir bölüm/alan/kolon DÜŞMÜYOR — ayar var, kapısı yok olmasın", () => {
    for (const def of DOC_DEFS) {
      const groups = buildDocRowGroups(def);
      const rows = groups.flatMap((g) => g.rows);
      const toggles = new Set(groups.map((g) => g.toggleSection).filter(Boolean));

      const coveredSections = new Set([
        ...rows.map((r) => r.section).filter(Boolean),
        ...toggles,
      ]);
      for (const s of def.sections ?? []) expect(coveredSections, `${def.key}/${s.key}`).toContain(s.key);

      const coveredFields = new Set(rows.map((r) => r.field).filter(Boolean));
      for (const f of def.fields ?? []) expect(coveredFields, `${def.key}/${f.key}`).toContain(f.key);

      const coveredCols = new Set(rows.filter((r) => r.column).map((r) => `${r.column!.table}:${r.column!.key}`));
      for (const t of def.tables ?? [])
        for (const c of t.columns) expect(coveredCols, `${def.key}/${t.key}.${c.key}`).toContain(`${t.key}:${c.key}`);
    }
  });

  it("ikiz eşlemesinde BÖLÜM adı korunur, alan adı ipucuna düşer", () => {
    // "Araç / referans satırı" (alan) ↔ "Sevk / araç bilgisi" (bölüm)
    const row = rowById(FASON, "f:vehicle");
    expect(row.section).toBe("vehicleInfo");
    expect(row.label).toBe("Sevk / araç bilgisi");
    expect(row.hint).toBe("Plaka / şoför satırı");
    // Eşleşen bölüm ayrı bir satır olarak TEKRAR ETMEZ — şikayetin ta kendisi.
    expect(allRows(FASON).filter((r) => r.section === "vehicleInfo")).toHaveLength(1);
  });

  it("aynı adı taşıyan ikizde ipucu basılmaz (gürültü yok)", () => {
    const row = rowById(FASON, "f:batchNo"); // ikisi de "Parti no"
    expect(row.label).toBe("Parti no");
    expect(row.hint).toBeUndefined();
  });

  it("tablo bölümü satır değil GRUP BAŞLIĞI olur", () => {
    const groups = buildDocRowGroups(SEVK);
    const ceki = groups.find((g) => g.key === "tbl:ceki");
    expect(ceki?.toggleSection).toBe("ceki");
    expect(allRows(SEVK).some((r) => r.section === "ceki")).toBe(false);
  });

  it("körlük zemini — fason çeki en az 30 satır taşıyor", () => {
    expect(allRows(FASON).length).toBeGreaterThanOrEqual(30);
  });
});

describe("görünürlük — bölüm (blocklist)", () => {
  it("kayıt yoksa AÇIK sayılır", () => {
    expect(read("fasonSevk", {}, rowById(FASON, "f:vehicle")).visible).toBe(true);
  });
  it("kapatınca sections'a false yazılır", () => {
    const out = write("fasonSevk", {}, rowById(FASON, "f:vehicle"), { visible: false });
    expect(out.sections?.vehicleInfo).toBe(false);
  });
  it("kapalı bölüm geri okunuyor", () => {
    const cfg: DocumentConfig = { sections: { vehicleInfo: false } };
    expect(read("fasonSevk", cfg, rowById(FASON, "f:vehicle")).visible).toBe(false);
  });
});

describe("görünürlük — kolon (blocklist ↔ allowlist)", () => {
  const noteCol = () => {
    const r = allRows(SEVK).find((x) => x.column?.table === "cuval" && x.column.defaultHidden);
    if (!r) throw new Error("opt-in kolon bulunamadı — fixture bayat");
    return r;
  };
  const plainCol = () => {
    const r = allRows(SEVK).find((x) => x.column?.table === "cuval" && !x.column.defaultHidden);
    if (!r) throw new Error("normal kolon bulunamadı");
    return r;
  };

  it("normal kolon varsayılan AÇIK, kapatınca hidden'a yazılır", () => {
    const row = plainCol();
    expect(read("shipmentDispatch", {}, row).visible).toBe(true);
    const out = write("shipmentDispatch", {}, row, { visible: false });
    expect(out.columns?.cuval?.hidden).toContain(row.column!.key);
    expect(out.columns?.cuval?.shown).toBeUndefined();
  });

  it("İÇ VERİ kolonu varsayılan KAPALI ve `shown` ile açılır (hidden'a DEĞİL)", () => {
    const row = noteCol();
    expect(read("shipmentDispatch", {}, row).visible).toBe(false);
    const out = write("shipmentDispatch", {}, row, { visible: true });
    expect(out.columns?.cuval?.shown).toContain(row.column!.key);
    expect(out.columns?.cuval?.hidden).toBeUndefined();
  });

  it("opt-in kolon kapatılınca `shown` listesinden düşer, boşalınca anahtar silinir", () => {
    const row = noteCol();
    const cfg: DocumentConfig = { columns: { cuval: { shown: [row.column!.key] } } };
    expect(read("shipmentDispatch", cfg, row).visible).toBe(true);
    const out = write("shipmentDispatch", cfg, row, { visible: false });
    expect(out.columns?.cuval?.shown).toBeUndefined();
  });
});

describe("kolon sırası", () => {
  const group = () => buildDocRowGroups(SEVK).find((g) => g.key === "tbl:ceki")!;

  it("order yoksa kayıt sırası korunur", () => {
    const g = group();
    expect(orderedColumnRows({}, g).map((r) => r.column!.key)).toEqual(
      g.rows.map((r) => r.column!.key),
    );
  });

  it("aşağı taşıma order dizisini yazar", () => {
    const g = group();
    const keys = g.rows.map((r) => r.column!.key);
    const out = moveColumn({}, g, 0, 1);
    expect(out?.columns?.ceki?.order?.[0]).toBe(keys[1]);
    expect(out?.columns?.ceki?.order?.[1]).toBe(keys[0]);
  });

  it("sınırın dışına taşıma yok sayılır", () => {
    const g = group();
    expect(moveColumn({}, g, 0, -1)).toBeNull();
    expect(moveColumn({}, g, g.rows.length - 1, 1)).toBeNull();
  });

  it("yazılan sıra geri okunur", () => {
    const g = group();
    const keys = g.rows.map((r) => r.column!.key);
    const reversed = [...keys].reverse();
    const cfg: DocumentConfig = { columns: { ceki: { order: reversed } } };
    expect(orderedColumnRows(cfg, g).map((r) => r.column!.key)).toEqual(reversed);
  });
});

describe("punto ve kalınlık", () => {
  const row = () => rowById(FASON, "f:gridMetre");

  it("punto fields'a yazılır", () => {
    expect(write("fasonSevk", {}, row(), { size: 14 }).fields?.gridMetre).toEqual({ size: 14 });
  });
  it("boş punto anahtarı SİLER, 0 yazmaz", () => {
    const cfg: DocumentConfig = { fields: { gridMetre: { size: 14 } } };
    expect(write("fasonSevk", cfg, row(), { size: null }).fields?.gridMetre).toBeUndefined();
  });
  it("kalınlık puntoyu korur", () => {
    const cfg: DocumentConfig = { fields: { gridMetre: { size: 14 } } };
    const out = write("fasonSevk", cfg, row(), { weight: "bold" });
    expect(out.fields?.gridMetre).toEqual({ size: 14, weight: "bold" });
  });
  it("komşu alana dokunmaz — metre ↔ cm ayrı kalır", () => {
    const out = write("fasonSevk", {}, row(), { size: 14 });
    expect(out.fields?.gridCm).toBeUndefined();
  });
  it("stil taşımayan satırda punto girdisi çizilmez", () => {
    const secOnly = allRows(FASON).find((r) => r.section && !r.field);
    expect(secOnly).toBeDefined();
    expect(read("fasonSevk", {}, secOnly!).canStyle).toBe(false);
  });
  it("kaynağı MUTATE etmez (React state güvenliği)", () => {
    const cfg: DocumentConfig = { fields: { gridMetre: { size: 14 } } };
    write("fasonSevk", cfg, row(), { size: 20 });
    expect(cfg.fields?.gridMetre).toEqual({ size: 14 });
  });
});

describe("parseDocSize", () => {
  it("boş/anlamsız → null", () => {
    expect(parseDocSize("", 5, 48)).toBeNull();
    expect(parseDocSize("abc", 5, 48)).toBeNull();
  });
  it("sınırlara kırpar, virgüllü ondalık kabul eder", () => {
    expect(parseDocSize("999", 5, 48)).toBe(48);
    expect(parseDocSize("1", 5, 48)).toBe(5);
    expect(parseDocSize("10,5", 5, 48)).toBe(10.5);
  });
});
