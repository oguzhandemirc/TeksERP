// =============================================================================
// Test: Belge tasarımcısı GİDİŞ-DÖNÜŞ — editörün ürettiği yönergeli HTML backend
// derleyicisinden hatasız geçer, yönergeler korunur, önizleme her senaryoda render olur (T3)
// Çalıştır: npx tsx scripts/test_belge_tasarimci_gidis_donus.ts   (DB'siz — sorgu atmaz)
//           --yaz  → fikstürün `contract`/`settings` alanlarını sözleşmeden tazeler
// =============================================================================
// İDDİA: Electron tasarımcısının blokları/kalem tablosu/koşul kurucusu
// (`Electron/.../DocumentDesigner/binding/*`) paylaşılan fikstüre (`scripts/lib/
// belge-tasarimci-gidis-donus.json`) yazdığı HTML, T1A derleyicisinden (VISUAL) hatasız
// geçer, her yönerge Liquid'e dönüşür (sayılar eşit) ve sevk irsaliyesi senaryolarının
// HEPSİNDE `POST /preview` hattıyla (previewTemplate) render olur. İstemci dilbilgisi
// aynası iki yönde ölçülür: kurucunun ürettiği her koşul geçer, reddettiği her girdi
// backend'de de düşer; istemci filtre listesi izin listesinin alt kümesidir.
//   §1 fikstür sözleşmesi güncel · §2 derleme + yönerge sayıları · §3 önizleme (7 senaryo)
//   §4 koşul aynası · §5 filtre aynası · §6 sayfa ayarı aynası · §7 GrapesJS getHtml çıktısı (e2e BT12 ölçümü)
// GEREKLİ Mİ: evet — editör ile derleyici iki ayrı projede; kopuşu yalnız bu ölçer.
// =============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { freezeSystemSettings, getContractView } from "../src/services/document-template/contract-view.service";
import { ALLOWED_FILTER_NAMES } from "../src/services/document-template/motor/filtreler";
import { normalizePageSettings, PageSettingsError } from "../src/services/document-template/motor/sayfa";
import { compileCondition, compileDirectives, compileFilterChain } from "../src/services/document-template/motor/yonerge";
import { previewTemplate } from "../src/services/document-template/preview.service";
import { getContract } from "../src/services/document-template/sozlesme/kayit";

const FIXTURE = resolve(__dirname, "lib/belge-tasarimci-gidis-donus.json");
const DOC = "SHIPMENT_DISPATCH";

interface Fixture {
  contract: unknown;
  settings: Record<string, unknown>;
  internalFields: string[];
  samples: Array<{ ad: string; html: string; css: string; internalFields?: string[] }>;
  conditions: { valid: string[]; invalid: string[] };
  filters: { names: string[]; suggestions: string[] };
  pageSettings: { valid: unknown[]; conflicting: unknown[] };
  grapesHtml?: Array<{ ad: string; html: string }>;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

async function main(): Promise<void> {
  const fx = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;
  const contract = getContract(DOC);
  const view = getContractView(DOC);
  const frozen = freezeSystemSettings(contract, {});

  if (process.argv.includes("--yaz")) {
    fx.contract = view;
    fx.settings = frozen.settings;
    fx.internalFields = frozen.internalFields;
    writeFileSync(FIXTURE, JSON.stringify(fx, null, 2) + "\n");
    console.log("fikstür sözleşmesi yazıldı — Electron tarafında TASARIMCI_FIKSTUR_YAZ=1 ile örnekleri tazele");
    return;
  }

  console.log("\n§1 — fikstür sözleşmesi güncel");
  check("contract = getContractView(SHIPMENT_DISPATCH)", JSON.stringify(fx.contract) === JSON.stringify(view));
  check("settings = dondurulmuş etkin ayar (varsayılan)", JSON.stringify(fx.settings) === JSON.stringify(frozen.settings));
  check("en az 12 örnek", fx.samples.length >= 12, String(fx.samples.length));

  console.log("\n§2 — derleme hatasız, yönergeler korunur");
  for (const s of fx.samples) {
    const r = compileDirectives(s.html, "VISUAL");
    const each = count(s.html, /\sdata-each="/g);
    const ifs = count(s.html, /\sdata-if="/g);
    const fields = count(s.html, /\sdata-alan="/g) + count(s.html, /\sdata-bag-src="/g);
    // Her kalem tablosu satır döngüsünü taşımalı: yönerge üretimde/normalizasyonda düşerse burada yakalanır.
    const tables = count(s.html, /\sdata-tablo="[^"]+"/g);
    const ok =
      each >= tables &&
      r.errors.length === 0 &&
      r.suggestion === null &&
      count(r.liquid, /\{% for /g) === each &&
      count(r.liquid, /\{% if /g) === ifs &&
      count(r.liquid, /\{\{ /g) === fields &&
      !/data-(each|if|alan|filtre|bag-src)=/.test(r.liquid);
    check(`${s.ad}: ${tables} tablo · ${each} döngü · ${ifs} koşul · ${fields} alan`, ok, r.errors.map((e) => `${e.satir}:${e.sutun} ${e.mesaj}`).join("; "));
  }

  console.log("\n§3 — önizleme (POST /preview hattı) her senaryoda hatasız");
  const scenarios = contract.senaryolar().map((s) => s.ad);
  const preview = (s: Fixture["samples"][number], key: string, internalFields: string[]) =>
    previewTemplate({
      docType: DOC,
      source: { editMode: "VISUAL", sourceHtml: s.html, css: s.css, pageSettings: {}, settings: fx.settings, internalFields },
      sample: { kind: "senaryo", key },
    });
  for (const s of fx.samples) {
    const bad: string[] = [];
    for (const key of scenarios) {
      const out = await preview(s, key, s.internalFields ?? fx.internalFields);
      if (out.hatalar.length || !out.html) bad.push(`${key}: ${out.hatalar.map((h) => h.mesaj).join(", ")}`);
    }
    check(`${s.ad} × ${scenarios.length} senaryo`, bad.length === 0, bad.slice(0, 2).join(" | "));
  }
  // İç alan kilidi: opt-in'siz aynı tasarım render'da düşer (editördeki kilidin karşılığı).
  const internal = fx.samples.find((s) => s.internalFields?.length);
  check("iç kolon örneği var", !!internal);
  if (internal) {
    const out = await preview(internal, scenarios[0]!, fx.internalFields);
    check("iç kolon opt-in'siz → render hatası", out.hatalar.length > 0, out.hatalar[0]?.mesaj ?? "hata yok");
  }

  console.log("\n§4 — data-if kurucusu ↔ dilbilgisi (iki yön)");
  for (const c of fx.conditions.valid) check(`geçerli: ${c}`, "liquid" in compileCondition(c));
  for (const c of fx.conditions.invalid) check(`reddedilen: ${JSON.stringify(c)}`, "error" in compileCondition(c));

  console.log("\n§5 — filtre aynası");
  const extra = fx.filters.names.filter((n) => !ALLOWED_FILTER_NAMES.has(n));
  check("istemci filtre adları ⊆ izin listesi", extra.length === 0, extra.join(", "));
  for (const f of fx.filters.suggestions) check(`öneri derlenir: ${f}`, "liquid" in compileFilterChain(f));

  console.log("\n§6 — sayfa ayarı aynası");
  const accepts = (p: unknown): boolean => {
    try {
      normalizePageSettings(p);
      return true;
    } catch (e) {
      if (e instanceof PageSettingsError) return false;
      throw e;
    }
  };
  fx.pageSettings.valid.forEach((p, i) => check(`geçerli sayfa ayarı #${i + 1}`, accepts(p)));
  fx.pageSettings.conflicting.forEach((p, i) => check(`çakışan sayfa ayarı #${i + 1} reddedilir`, !accepts(p)));

  console.log("\n§7 — GrapesJS getHtml çıktısı (e2e ölçümü)");
  const directiveCounts = (h: string): string =>
    ["data-each", "data-if", "data-alan", "data-filtre", "data-tablo", "data-kolon", "data-bag-src"].map((d) => count(h, new RegExp(`\\s${d}=`, "g"))).join(",");
  for (const g of fx.grapesHtml ?? []) {
    const r = compileDirectives(g.html, "VISUAL");
    check(`${g.ad}: derlenir, tr[data-each] korunmuş`, r.errors.length === 0 && /<tr[^>]*data-each=/.test(g.html), r.errors.map((e) => e.mesaj).join("; "));
    const src = fx.samples.find((x) => x.ad === g.ad);
    check(`${g.ad}: yönerge sayıları kaynakla eşit`, !!src && directiveCounts(src.html) === directiveCounts(g.html), `${src ? directiveCounts(src.html) : "kaynak yok"} → ${directiveCounts(g.html)}`);
  }
  if (!fx.grapesHtml?.length) console.log("(ölçüm yok — e2e BT12 yazar: TASARIMCI_GRAPES_YAZ=1)");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  // Önizleme hattı Prisma havuzunu açık tutar; çıkış açıkça verilmezse süreç asılı kalır.
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
