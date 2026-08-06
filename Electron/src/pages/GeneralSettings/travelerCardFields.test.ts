// =============================================================================
// TEST: Refakat kartı TEK TABLO ayar modeli — okuma/yazma sözleşmesi
// =============================================================================
// Panelin tek tablosu arkada İKİ AYRI DEPOYA yazıyor (`config.fields` ve
// `config.specFields/orderFields/batchFields/*Total`). Kullanıcı ayrımı görmez;
// bu testin işi ayrımın DOĞRU yere yazdığını ve iki depoda da "varsayılana dön"
// davranışının aynı olduğunu kilitlemek.
//
// Kritik sözleşme: backend'in "override yoksa tek bayt CSS basılmaz" garantisi
// PANELİN boş değerde anahtar yazmamasına dayanır. Ayara dokunup vazgeçen
// kullanıcı, kartın çıktısını sessizce değiştiren ölü bir `{}` kaydı bırakmamalı.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  FIELD_GROUPS,
  parseSize,
  readRow,
  writeRow,
  type RowSource,
} from "./travelerCardFields";
import {
  DEFAULT_TRAVELER_CARD_CONFIG,
  type TravelerCardConfig,
} from "@/services/featureFlagService";

const base = (): TravelerCardConfig => structuredClone(DEFAULT_TRAVELER_CARD_CONFIG);
const FIELD: RowSource = { kind: "field", key: "company" };
const CELL: RowSource = { kind: "cell", bucket: "specFields", key: "color" };
const TOTAL: RowSource = { kind: "total", key: "orderTotal" };

describe("parseSize", () => {
  it("boş/anlamsız girdi → null (varsayılana dön)", () => {
    expect(parseSize("")).toBeNull();
    expect(parseSize("   ")).toBeNull();
    expect(parseSize("abc")).toBeNull();
  });
  it("sınırlara kırpar", () => {
    expect(parseSize("999")).toBe(48);
    expect(parseSize("1")).toBe(5);
    expect(parseSize("12.5")).toBe(12.5);
  });
  it("virgüllü ondalık kabul eder (TR klavye)", () => {
    expect(parseSize("10,5")).toBe(10.5);
  });
});

describe("field deposu (config.fields)", () => {
  it("varsayılanda görünür ve override taşımaz", () => {
    expect(readRow(base(), FIELD)).toEqual({ visible: true, size: undefined, weight: undefined });
  });
  it("punto yazar", () => {
    const cfg = writeRow(base(), FIELD, { size: 20 });
    expect(cfg.fields).toEqual({ company: { size: 20 } });
    expect(readRow(cfg, FIELD).size).toBe(20);
  });
  it("gizleme yazar; `hidden:false` YAZILMAZ", () => {
    const hidden = writeRow(base(), FIELD, { visible: false });
    expect(hidden.fields).toEqual({ company: { hidden: true } });
    const shown = writeRow(hidden, FIELD, { visible: true });
    // Alan tamamen varsayılana döndü → anahtar düşer, harita boşalınca undefined.
    expect(shown.fields).toBeUndefined();
  });
  it("punto temizlenince 0 YAZMAZ, alan düşer", () => {
    const cfg = writeRow(writeRow(base(), FIELD, { size: 20 }), FIELD, { size: null });
    expect(cfg.fields).toBeUndefined();
  });
  it("gizli alanın puntosu KORUNUR (kutu yeniden açılınca geri gelsin)", () => {
    const cfg = writeRow(writeRow(base(), FIELD, { size: 20 }), FIELD, { visible: false });
    expect(cfg.fields?.company).toEqual({ size: 20, hidden: true });
  });
  it("iki alandan biri temizlenince diğeri kalır", () => {
    let cfg = writeRow(base(), FIELD, { size: 20 });
    cfg = writeRow(cfg, { kind: "field", key: "woNo" }, { size: 30 });
    cfg = writeRow(cfg, FIELD, { size: null });
    expect(cfg.fields).toEqual({ woNo: { size: 30 } });
  });
  it("kaynağı MUTATE etmez (React state güvenliği)", () => {
    const src = base();
    writeRow(src, FIELD, { size: 30 });
    expect(src.fields).toBeUndefined();
  });
});

describe("hücre deposu (specFields / orderFields / *Total)", () => {
  it("punto `px`e yazılır, `size` kademesine DEĞİL", () => {
    const cfg = writeRow(base(), CELL, { size: 16 });
    expect(cfg.specFields.color.px).toBe(16);
    // Eski kademe alanına dokunulmaz — donmuş snapshot'lar onu okuyor.
    expect(cfg.specFields.color.size).toBe("md");
  });
  it("punto temizlenince `px` düşer", () => {
    const cfg = writeRow(writeRow(base(), CELL, { size: 16 }), CELL, { size: null });
    expect(cfg.specFields.color.px).toBeUndefined();
  });
  it('"Varsayılan" kalınlık `normal` yazar (inline basılmaz demek)', () => {
    const bold = writeRow(base(), CELL, { weight: "bold" });
    expect(bold.specFields.color.weight).toBe("bold");
    expect(readRow(bold, CELL).weight).toBe("bold");
    const back = writeRow(bold, CELL, { weight: null });
    expect(back.specFields.color.weight).toBe("normal");
    // Panelde "normal" bir seçenek DEĞİL → okuma undefined döner ("Varsayılan").
    expect(readRow(back, CELL).weight).toBeUndefined();
  });
  it("görünürlük `show`a yazılır", () => {
    const cfg = writeRow(base(), CELL, { visible: false });
    expect(cfg.specFields.color.show).toBe(false);
    expect(readRow(cfg, CELL).visible).toBe(false);
  });
  it("komşu hücreye dokunmaz", () => {
    const cfg = writeRow(base(), CELL, { size: 16 });
    expect(cfg.specFields.width.px).toBeUndefined();
  });
  it("toplam satırı kendi anahtarına yazar", () => {
    const cfg = writeRow(base(), TOTAL, { size: 13 });
    expect(cfg.orderTotal.px).toBe(13);
    expect(cfg.batchTotal.px).toBeUndefined();
  });
  it("kaynağı MUTATE etmez", () => {
    const src = base();
    writeRow(src, CELL, { size: 16 });
    expect(src.specFields.color.px).toBeUndefined();
  });
});

describe("satır kataloğu", () => {
  const rows = FIELD_GROUPS.flatMap((g) => g.rows);
  it("satır id'leri benzersiz (React anahtarı + depolar arası çakışma)", () => {
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("her satır okunabiliyor — okunamayan satır panelde ÇÖKER", () => {
    const cfg = base();
    for (const r of rows) expect(() => readRow(cfg, r.source)).not.toThrow();
  });
  it("her satır yazılabiliyor ve yazdığını geri okuyor", () => {
    for (const r of rows) {
      const cfg = writeRow(base(), r.source, { size: 17 });
      expect(readRow(cfg, r.source).size).toBe(17);
    }
  });
  it("her satır gizlenebiliyor ve geri okunuyor", () => {
    for (const r of rows) {
      const cfg = writeRow(base(), r.source, { visible: false });
      expect(readRow(cfg, r.source).visible).toBe(false);
    }
  });
  it("körlük zemini — katalog en az 25 satır taşıyor", () => {
    expect(rows.length).toBeGreaterThanOrEqual(25);
  });
  it("bölüm anahtarları config'te gerçekten var — yoksa kutu hiçbir şey yapmaz", () => {
    const cfg = base() as unknown as Record<string, unknown>;
    for (const g of FIELD_GROUPS) {
      if (g.toggle) expect(typeof cfg[g.toggle]).toBe("boolean");
    }
  });
});
