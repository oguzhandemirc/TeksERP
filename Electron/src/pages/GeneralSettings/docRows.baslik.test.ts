// =============================================================================
// Panel testi: KOLON BAŞLIĞI — metin override, "başlık basma", opt-in parti kodu
// =============================================================================
// `docRows.test.ts`ten AYRILDI (dosya boyutu tavanı). Bölme ekseni SORU: orada
// satır üretimi ve genel yazma sözleşmesi, burada yalnız BAŞLIK kararı.
//
// ⚠️ Korunan sözleşme: başlık kutusunda BOŞ DİZE "VARSAYILANA DÖN" demektir.
// "Başlığı hiç basma" AYRI bir karardır (`blankLabels`), çünkü aynı kutu iki
// niyeti birden anlatamaz — kullanıcı kutuyu boşaltınca eski hâline dönmek
// ister, başlıksız kolon değil.
// =============================================================================

import { describe, expect, it } from "vitest";
import { type DocRow } from "./docRows";
import { type DocumentConfig } from "@/services/documentConfig";
import { SEVK, allRows, read, rowById, write } from "./docRows.testkit";

// KOLON BAŞLIĞI ÖZELLEŞTİRME (2026-09-04) — `columns[tablo].labels`
// =============================================================================
// Fabrika müşteriye giden belgede kendi dilini kullanabilsin diye ("STOK ADI"
// yerine "ÜRÜN"). Panel tarafındaki iki tuzak:
//   1. Boş kutu = "varsayılana dön" (anahtar SİLİNİR) — punto kutusuyla AYNI
//      sözleşme. Boş dize saklanırsa belge BAŞLIKSIZ kolon basar.
//   2. Görünürlük ve başlık AYNI `columns[tablo]` girdisine yazar → aynı yamada
//      ikisi de gelirse ikincisi birincisini EZMEMELİ.
describe("kolon başlığı override", () => {
  const nameRow = (): DocRow => rowById(SEVK, "c:urun:name");

  it("kolon satırında başlık düzenlenebilir, bölüm satırında DEĞİL", () => {
    expect(read("shipmentDispatch", {}, nameRow()).canLabel).toBe(true);
    const secOnly = allRows(SEVK).find((r) => r.section && !r.column);
    expect(secOnly).toBeDefined();
    expect(read("shipmentDispatch", {}, secOnly!).canLabel).toBe(false);
  });

  it("kayıtlı başlık okunur; yoksa undefined (yerleşik başlık geçerli)", () => {
    const cfg: DocumentConfig = { columns: { urun: { labels: { name: "ÜRÜN" } } } };
    expect(read("shipmentDispatch", cfg, nameRow()).labelOverride).toBe("ÜRÜN");
    expect(read("shipmentDispatch", {}, nameRow()).labelOverride).toBeUndefined();
  });

  it("başlık yazılır (trim'li)", () => {
    const out = write("shipmentDispatch", {}, nameRow(), { label: "  ÜRÜN  " });
    expect(out.columns?.urun?.labels).toEqual({ name: "ÜRÜN" });
  });

  it("⭐ BOŞ kutu anahtarı SİLER (varsayılana dön), boş dize saklamaz", () => {
    const cfg: DocumentConfig = { columns: { urun: { labels: { name: "ÜRÜN" } } } };
    const out = write("shipmentDispatch", cfg, nameRow(), { label: "   " });
    expect(out.columns?.urun?.labels).toBeUndefined();
  });

  it("başlık yazmak GÖRÜNÜRLÜK ayarını ezmez", () => {
    const cfg: DocumentConfig = { columns: { urun: { hidden: ["rollCount"] } } };
    const out = write("shipmentDispatch", cfg, nameRow(), { label: "ÜRÜN" });
    expect(out.columns?.urun?.hidden).toEqual(["rollCount"]);
    expect(out.columns?.urun?.labels).toEqual({ name: "ÜRÜN" });
  });

  it("⭐ aynı yamada görünürlük + başlık birlikte gelirse İKİSİ de yazılır", () => {
    const out = write("shipmentDispatch", {}, nameRow(), { visible: false, label: "ÜRÜN" });
    expect(out.columns?.urun?.hidden).toEqual(["name"]);
    expect(out.columns?.urun?.labels).toEqual({ name: "ÜRÜN" });
  });

  it("başka tablonun başlıklarına dokunmaz", () => {
    const cfg: DocumentConfig = { columns: { ceki: { labels: { desen: "MOTİF" } } } };
    const out = write("shipmentDispatch", cfg, nameRow(), { label: "ÜRÜN" });
    expect(out.columns?.ceki?.labels).toEqual({ desen: "MOTİF" });
  });

  it("kaynağı MUTATE etmez (React state güvenliği)", () => {
    const cfg: DocumentConfig = { columns: { urun: { labels: { name: "ÜRÜN" } } } };
    write("shipmentDispatch", cfg, nameRow(), { label: "KOD" });
    expect(cfg.columns?.urun?.labels).toEqual({ name: "ÜRÜN" });
  });

  it("müşteri adı kolonları panelde satır olarak GÖRÜNÜR (başlık yazılabilsin)", () => {
    const ids = allRows(SEVK).map((r) => r.id);
    expect(ids).toContain("c:urun:customerName");
    expect(ids).toContain("c:ceki:customerDesen");
    expect(ids).toContain("c:ceki:customerVaryant");
  });
});

describe("kolon başlığı — başlık basma + opt-in parti kodu", () => {
  const nameRow = (): DocRow => rowById(SEVK, "c:urun:name");

  // ── BAŞLIK BASMA (`blankLabels`, 2026-09-23) ───────────────────────────────
  // ⚠️ `labels`te boş dize "VARSAYILANA DÖN" demek; "başlık basma" AYRI bir
  // karardır ve AYRI listede durur. Üç hâl ayrı ayrı ölçülür.
  it("başlık basma: okunur (kayıtlı değilse false)", () => {
    const cfg: DocumentConfig = { columns: { urun: { blankLabels: ["name"] } } };
    expect(read("shipmentDispatch", cfg, nameRow()).blankLabel).toBe(true);
    expect(read("shipmentDispatch", {}, nameRow()).blankLabel).toBe(false);
  });

  it("⭐ başlık basma: yazılır ve KALDIRILIR (liste boşalınca anahtar düşer)", () => {
    const acik = write("shipmentDispatch", {}, nameRow(), { blankLabel: true });
    expect(acik.columns?.urun?.blankLabels).toEqual(["name"]);
    const cfg: DocumentConfig = { columns: { urun: { blankLabels: ["name"] } } };
    const kapali = write("shipmentDispatch", cfg, nameRow(), { blankLabel: false });
    expect(kapali.columns?.urun?.blankLabels).toBeUndefined();
  });

  it("⭐ başlık basma, METİN override'ıyla AYNI girdide yaşar (biri ötekini silmez)", () => {
    const cfg: DocumentConfig = { columns: { urun: { labels: { name: "ÜRÜN" } } } };
    const out = write("shipmentDispatch", cfg, nameRow(), { blankLabel: true });
    expect(out.columns?.urun?.labels).toEqual({ name: "ÜRÜN" });
    expect(out.columns?.urun?.blankLabels).toEqual(["name"]);
  });

  it("başlık basma kaynağı MUTATE etmez (React state güvenliği)", () => {
    const cfg: DocumentConfig = { columns: { urun: { blankLabels: ["name"] } } };
    write("shipmentDispatch", cfg, nameRow(), { blankLabel: false });
    expect(cfg.columns?.urun?.blankLabels).toEqual(["name"]);
  });

  it("⭐ parti kodu kolonu panelde OPT-IN satır olarak var (iki tabloda da)", () => {
    const ids = allRows(SEVK).map((r) => r.id);
    expect(ids).toContain("c:cuval:packingGroupCode");
    expect(ids).toContain("c:ceki:packingGroupCode");
  });
});
