import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContractView } from "./contract";
import { parseCondition, validateCondition } from "./directives";
import { pageSettingsIssues } from "./pageSettings";
import { buildFixtureClientPart, INVALID_CONDITIONS, PAGE_SETTINGS_CASES } from "./roundtripFixture";

// Paylaşılan fikstür: backend `scripts/test_belge_tasarimci_gidis_donus.ts` aynı dosyayı
// T1A derleyicisinden ve önizleme hattından geçirir. Sözleşme yarısını backend `--yaz`,
// istemci yarısını bu test `TASARIMCI_FIKSTUR_YAZ=1` ile tazeler.
const FIXTURE = resolve(__dirname, "../../../../../../Teks-Erp/scripts/lib/belge-tasarimci-gidis-donus.json");

describe("gidiş-dönüş fikstürü", () => {
  const fx = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown> & { contract: ContractView; settings: Record<string, unknown> };
  const client = buildFixtureClientPart(fx.contract, fx.settings);

  it("istemci yarısı fikstürle eşit (bloklar/kurucu değişince fikstür tazelenir)", () => {
    if (process.env.TASARIMCI_FIKSTUR_YAZ === "1") {
      writeFileSync(FIXTURE, JSON.stringify({ ...fx, ...client }, null, 2) + "\n");
    }
    const now = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
    for (const k of Object.keys(client) as Array<keyof typeof client>) {
      expect(now[k], k).toEqual(JSON.parse(JSON.stringify(client[k])));
    }
  });

  it("pilot ve kalem tabloları yönergeleri taşır", () => {
    const pilot = client.samples.find((s) => s.ad === "pilot-sevk-irsaliyesi")!.html;
    expect(pilot).toMatch(/<tr data-if="satir\.metre > 0" data-each="satir in tablolar\.urun">/);
    expect(pilot).toContain('data-bag-src="firma.logo"');
    expect(client.samples.filter((s) => s.ad.startsWith("kalem-tablosu"))).toHaveLength(fx.contract.tablolar.length);
  });

  it("reddedilen koşullar istemcide de reddedilir (dilbilgisi aynası)", () => {
    for (const c of INVALID_CONDITIONS) expect(validateCondition(c), c).not.toBeNull();
    for (const c of client.conditions.valid) expect(parseCondition(c), c).not.toBeNull();
  });

  it("çakışan sayfa ayarları istemcide de işaretlenir", () => {
    for (const p of PAGE_SETTINGS_CASES.conflicting) expect(pageSettingsIssues(p)).not.toHaveLength(0);
    for (const p of PAGE_SETTINGS_CASES.valid) expect(pageSettingsIssues(p)).toHaveLength(0);
  });
});
