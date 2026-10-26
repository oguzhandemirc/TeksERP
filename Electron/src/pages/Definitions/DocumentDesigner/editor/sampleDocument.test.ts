import { describe, expect, it } from "vitest";
import { loadFixture } from "../binding/testContract";
import { buildSampleDocument, sampleColumns, sampleTable } from "./sampleDocument";

describe("örnek belge — sözleşmeden", () => {
  const { contract, settings } = loadFixture();

  it("satırlar data-each ile örnek veriden; sabit satır yok", () => {
    const { html } = buildSampleDocument(contract, settings, []);
    const t = sampleTable(contract)!;
    expect(t.anahtar).not.toBe("antet_ek");
    expect(html).toContain(`data-tablo="${t.anahtar}"`);
    expect(html).toMatch(/<tr data-each="/);
    expect(html).not.toContain("Penye kumaş");
  });

  it("toplam kolonu tfoot'ta toplamlar.<k> alanına bağlı", () => {
    const { html } = buildSampleDocument(contract, settings, []);
    const t = sampleTable(contract)!;
    const totals = t.kolonlar.filter((k) => k.toplam);
    expect(totals.length).toBeGreaterThan(0);
    for (const k of totals) expect(html).toContain(`data-alan="toplamlar.${k.toplam}"`);
    for (const k of totals) expect(sampleColumns(t, [])).toContain(k.yol);
  });

  it("başlık alanları sözleşmede varsa bağlı, CSS blok stillerini taşır", () => {
    const { html, css } = buildSampleDocument(contract, settings, []);
    expect(html).toContain('data-alan="belge.no"');
    expect(html).toContain("imza-alani");
    expect(css).toContain("kalem-tablosu");
  });

  it("sözleşme yoksa yönlendirme", () => {
    expect(buildSampleDocument(null, {}, []).html).toContain("Önce belge türü seçin");
  });
});
