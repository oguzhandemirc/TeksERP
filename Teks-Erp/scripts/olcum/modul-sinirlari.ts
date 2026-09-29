// =============================================================================
// Kod koruma 2a — MODÜL SINIRLARI: satılabilir modül kodu çekirdekten ayrılabilir mi?
// =============================================================================
// Girdi: `paket-provasi.ts --varyant=dis` metafile'ı (esbuild'in src → src içe aktarma grafiği).
// Her modül M için:
//   tohum S_M  = modülün kendi kapısını (require*Enabled) taşıyan yönlendirici dosyaları
//   R_M        = S_M'den erişilen src dosyaları
//   C_M        = server.ts'ten, S_M düğümleri SİLİNMİŞ grafikte erişilenler ("M yokken çekirdek")
//   ayrılabilir E_M = R_M − C_M  (app.ts'teki bağlama satırı tembel yüklemeye çevrilince pakete girmeyen kod)
//   sızıntı    = adı M'nin alanına ait olup C_M'de kalan dosya; engel = ona doğrudan içe aktaran C_M dosyası
//   kesim E′_M = engel kenarları (çekirdek + başka modül → alan) kesilince ayrılan kod; kesilecek kenar
//                sayısı refaktör noktasıdır, "başka modül" kenarı modüller arası bağımlılıktır
// Koşum: npx tsx scripts/olcum/modul-sinirlari.ts [--metafile=<yol>] [--json=<yol>]
// DB'ye dokunmaz; yalnız metafile okur ve Markdown tablo basar.
// =============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type Kind = "static" | "dynamic";
interface Meta {
  inputs: Record<string, { bytes: number; imports: Array<{ path: string; kind: string; external?: boolean }> }>;
}

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"] as const;
  }),
);
const metaYol = args.get("metafile") ?? path.join(tmpdir(), "tekserp-kod-koruma-2a", "dis", "metafile.json");
const meta = JSON.parse(readFileSync(metaYol, "utf8")) as Meta;

const ROOT = "src/server.ts";
const R = (ad: string): string => `src/routes/${ad}.routes.ts`;

/** Tohumlar: yönlendirici düzeyinde modül kapısı taşıyan dosyalar (karma olanlar — reports.routes, subcontractor.routes — BİLEREK dışarıda: çekirdek yönlendirici içinde uç düzeyi kapı). */
interface Modul {
  anahtar: string;
  tohum: string[];
  alan: RegExp | null;
  not?: string;
}
const MODULLER: Modul[] = [
  {
    anahtar: "finance",
    tohum: ["finance-allocation", "cash-period", "cheque-reversal", "cheque", "finance", "finance-period", "cheque-delivery-note", "reconciliation-letter"]
      .map(R)
      .concat("src/routes/reports/finance.report.routes.ts"),
    alan: /\/(finance|cheque|cash|cari|payment|invoice|reconciliation|accounting-export|period-close|exchange-rate|customer-finance-bridge|shipment-auto-draft)[^/]*$/,
  },
  { anahtar: "ticaret", tohum: ["goods-receipt", "purchase-order", "item-price", "stock-count"].map(R), alan: /\/(goods-receipt|purchase-order|item-price|stock-count|receipt-qty|contract-price|supplier-party)[^/]*$/ },
  { anahtar: "iplik", tohum: [R("yarn")], alan: /\/(yarn|subcontractor-yarn)[^/]*$/ },
  { anahtar: "devere", tohum: ["warp-spec", "warp-beam-mount", "warp-beam"].map(R), alan: /\/(warp-|subcontractor-beam)[^/]*$/ },
  { anahtar: "depoMulti", tohum: [R("warehouse-transfer")], alan: /\/(warehouse-transfer)[^/]*$/ },
  {
    anahtar: "production",
    tohum: ["workorder", "station-capability", "kursun-bypass", "batch", "traveler-card", "kursun-qc", "tambur", "production-balance", "product-recipe", "route"].map(R),
    alan: /\/(workorder|work-order|tambur|kursun|traveler|production-balance|product-recipe|station-capability)[^/]*$/,
  },
  {
    anahtar: "dokuma",
    tohum: ["machine-doff", "machine-stop", "subcontractor-weaving", "machine-spec", "weaving-order", "machine-run", "machine-shift-stat"]
      .map(R)
      .concat("src/routes/reports/dokuma.report.routes.ts"),
    alan: /\/(machine-(doff|run|stop|shift|spec)|weaving|loom|subcontractor-weaving|dokuma)[^/]*$/,
  },
  { anahtar: "emanet", tohum: [], alan: /\/emanet[^/]*$/, not: "yönlendirici yok; kapı çekirdek servis içinde (inventory.service → emanet-owner.helper)" },
  { anahtar: "tezgah", tohum: [], alan: null, not: "yer tutucu — arkasında yüzey yok (system-setting TEZGAH_ENABLED)" },
  { anahtar: "kumasTeknik", tohum: [], alan: null, not: "yer tutucu — arkasında yüzey yok" },
];

/** Grup: birlikte satılan/paketlenen modüller — tek başına ayrılamayanın grup içinde ayrılıp ayrılmadığını ölçer. */
const GRUPLAR: Array<[string, string[]]> = [
  ["grup:finance+ticaret+iplik", ["finance", "ticaret", "iplik"]],
  ["grup:devere+dokuma", ["devere", "dokuma"]],
  ["grup:devere+dokuma+iplik", ["devere", "dokuma", "iplik"]],
];
for (const [ad, uyeler] of GRUPLAR) {
  const ms = uyeler.map((u) => MODULLER.find((m) => m.anahtar === u)!);
  MODULLER.push({
    anahtar: ad,
    tohum: ms.flatMap((m) => m.tohum),
    alan: new RegExp(ms.map((m) => `(?:${m.alan!.source})`).join("|")),
  });
}

// src → src kenarları (dış paketler ve JSON dışı)
const kenar = new Map<string, Array<{ to: string; kind: Kind }>>();
for (const [dosya, girdi] of Object.entries(meta.inputs)) {
  if (!dosya.startsWith("src/")) continue;
  kenar.set(
    dosya,
    girdi.imports
      .filter((i) => !i.external && i.path.startsWith("src/"))
      .map((i) => ({ to: i.path, kind: i.kind === "dynamic-import" ? "dynamic" : "static" })),
  );
}
const bayt = (f: string): number => meta.inputs[f]?.bytes ?? 0;

function eris(baslar: string[], yasak: ReadonlySet<string> = new Set(), kesik: ReadonlySet<string> = new Set()): Set<string> {
  const gorulen = new Set<string>();
  const yigin = baslar.filter((b) => !yasak.has(b));
  while (yigin.length) {
    const f = yigin.pop()!;
    if (gorulen.has(f)) continue;
    gorulen.add(f);
    for (const e of kenar.get(f) ?? []) if (!yasak.has(e.to) && !gorulen.has(e.to) && !kesik.has(`${f}>${e.to}`)) yigin.push(e.to);
  }
  return gorulen;
}

const tumSrc = [...kenar.keys()];
const alanSahibi = (f: string): string | null => MODULLER.find((m) => m.alan?.test(f))?.anahtar ?? null;
const KB = (n: number): string => `${(n / 1024).toFixed(0)} KB`;

const satirlar: string[] = [];
const json: Record<string, unknown> = {};
satirlar.push("| Modül | Tohum | Erişilen (R) | Ayrılabilir (E) | E / R bayt | Alan dosyası çekirdekte (sızıntı) | Engel kenarı (çekirdek + modül) | Kesimle ayrılan E′ (+ çekirdek yüzeyi) | Karar |");
satirlar.push("|---|---|---|---|---|---|---|---|---|");
for (const m of MODULLER) {
  const eksik = m.tohum.filter((t) => !kenar.has(t));
  if (eksik.length) throw new Error(`${m.anahtar}: tohum metafile'da yok: ${eksik.join(", ")}`);
  const alanDosyalari = m.alan ? tumSrc.filter((f) => m.alan!.test(f)) : [];
  if (m.tohum.length === 0) {
    const C = eris([ROOT]);
    const sizan = alanDosyalari.filter((f) => C.has(f));
    const importers = sizan.flatMap((s) => tumSrc.filter((f) => C.has(f) && !m.alan!.test(f) && (kenar.get(f) ?? []).some((e) => e.to === s)).map((f) => `${f} → ${s}`));
    satirlar.push(`| ${m.anahtar} | — | — | — | — | ${sizan.length}/${alanDosyalari.length} | ${importers.length} | — | ${m.not} |`);
    json[m.anahtar] = { not: m.not, alanDosyalari, sizan, engeller: importers };
    continue;
  }
  const tohum = new Set(m.tohum);
  const Rm = eris(m.tohum);
  const Cm = eris([ROOT], tohum);
  const Em = [...Rm].filter((f) => !Cm.has(f));
  const rB = [...Rm].reduce((s, f) => s + bayt(f), 0);
  const eB = Em.reduce((s, f) => s + bayt(f), 0);
  const sizan = alanDosyalari.filter((f) => Cm.has(f));
  const engeller: Array<{ from: string; to: string; kind: Kind; fromSahip: string }> = [];
  for (const s of sizan) {
    for (const f of Cm) {
      if (m.alan!.test(f)) continue;
      for (const e of kenar.get(f) ?? []) if (e.to === s) engeller.push({ from: f, to: s, kind: e.kind, fromSahip: alanSahibi(f) ?? "çekirdek" });
    }
  }
  const karar = sizan.length === 0 ? "AYRILABİLİR" : `ayrılamaz — ${sizan.length} alan dosyası çekirdekten erişiliyor`;
  const kesik = new Set(engeller.map((e) => `${e.from}>${e.to}`));
  const Ck = eris([ROOT], tohum, kesik);
  const Ek = [...Rm].filter((f) => !Ck.has(f));
  const ekB = Ek.reduce((s, f) => s + bayt(f), 0);
  const cekirdekKenar = engeller.filter((e) => e.fromSahip === "çekirdek").length;
  const modulKenar = engeller.length - cekirdekKenar;
  const bagimli = [...new Set(engeller.filter((e) => e.fromSahip !== "çekirdek").map((e) => e.fromSahip))].sort();
  // Ayrılan kodun çekirdekten DOĞRUDAN içe aktardığı dosyalar: şifreli modül paketinin çekirdeğe açılan kapı yüzeyi (2d).
  const EkSet = new Set(Ek);
  const yuzey = [...new Set(Ek.flatMap((f) => (kenar.get(f) ?? []).map((e) => e.to).filter((t) => !EkSet.has(t))))].sort();
  satirlar.push(
    `| ${m.anahtar} | ${m.tohum.length} | ${Rm.size} | ${Em.length} | ${KB(eB)} / ${KB(rB)} | ${sizan.length}/${alanDosyalari.length} | ${engeller.length} (${cekirdekKenar} + ${modulKenar}${bagimli.length ? ": " + bagimli.join(", ") : ""}) | ${Ek.length} dosya · ${KB(ekB)} · yüzey ${yuzey.length} | ${karar} |`,
  );
  json[m.anahtar] = {
    tohum: m.tohum,
    erisilen: Rm.size,
    ayrilabilir: Em.sort(),
    ayrilabilirBayt: eB,
    erisilenBayt: rB,
    alanDosyalari: alanDosyalari.length,
    sizan: sizan.sort(),
    engeller: engeller.sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from)),
    kesimle: { dosya: Ek.length, bayt: ekB, cekirdekKenar, modulKenar, modulBagimliligi: bagimli, cekirdekYuzeyi: yuzey },
  };
}

const toplamBayt = tumSrc.reduce((s, f) => s + bayt(f), 0);
process.stdout.write(`src dosyası: ${tumSrc.length} · toplam ${KB(toplamBayt)} (kaynak bayt, metafile)\n\n`);
process.stdout.write(satirlar.join("\n") + "\n");
const jsonYol = args.get("json");
if (jsonYol) writeFileSync(jsonYol, JSON.stringify({ srcDosya: tumSrc.length, toplamBayt, moduller: json }, null, 2));
