// =============================================================================
// PATRON RAPOR DOSYASI ↔ PANEL EŞİTLİĞİ (iki kopya kararı 2026-11-13)
// =============================================================================
// Backend `services/patron-rapor/disa-aktar/` panelin `buildExportSpec` + `toSheets` + `buildReportHtml` v2 yolunun
// kopyasıdır. Bu test PANELİN çıktısını, backend bekçisi (`test_patron_rapor_disa_aktar` §2) BACKEND'in çıktısını
// AYNI altın dosyaya karşı ölçer: hangi taraf saparsa o taraf kırmızı. Altın yenileme (bilinçli değişiklikte):
// `PATRON_ALTIN_YAZ=1 npx vitest run src/pages/Reports/_v2/patronDisaAktarAltin.test.ts` → backend bekçisini de koş.
// =============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportHtml, toSheets } from "@/pages/Reports/_components/reportExport";
import { buildExportSpec } from "./export-spec";
import type { RaporSunumu } from "./sunum";

const DIR = resolve(__dirname, "../../../../../Teks-Erp/scripts/fixtures/patron-rapor-disa-aktar");
const read = (f: string) => readFileSync(resolve(DIR, f), "utf8");
/** Backend `dosya.service` ile aynı ek: oluşturulma satırı + sabit basım anı (fabrika dilimi 10:30). */
const EK = { meta: ["Oluşturuldu: 13.11.2026 10:15"], basimAni: new Date("2026-11-13T07:30:00.000Z") };

describe("patron rapor dosyası altını (panel tarafı)", () => {
  const sunum = JSON.parse(read("sunum.json")) as RaporSunumu;
  const spec = { ...buildExportSpec(sunum), ...EK };
  const sheets = JSON.stringify(toSheets(spec), null, 2) + "\n";
  const html = buildReportHtml(spec);
  if (process.env.PATRON_ALTIN_YAZ === "1") {
    writeFileSync(resolve(DIR, "sheets.golden.json"), sheets);
    writeFileSync(resolve(DIR, "html.golden.html"), html);
  }

  it("Excel sayfaları altına eşit", () => {
    expect(sheets).toBe(read("sheets.golden.json"));
  });

  it("PDF HTML'i altına bayt bayt eşit", () => {
    expect(html).toBe(read("html.golden.html"));
  });
});
