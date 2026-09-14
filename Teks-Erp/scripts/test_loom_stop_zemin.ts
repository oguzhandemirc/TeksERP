// =============================================================================
// TEZGAH DURUŞ SEBEBİ ZEMİNİ — tablet gömülü listesi ↔ sunucu kataloğu BİREBİR
// =============================================================================
// NEDEN: `dokuma.md` § Tablet gömülü zemini ZORUNLU sayar — sunucusuzken katalog
// boş dönerse sebep zorunlu karar kaydedilemez ve tezgah ekranda kilitlenir.
// `test_reason_preset_kind_parity` yalnız KIND kümesini ölçer; zeminin İÇERİĞİ
// (kod · etiket · sıra) sunucudan sessizce ayrışabilir ve kod rapor anahtarıdır
// (uydurma kod `MachineStopEvent.reasonCode`u çöpe çevirir). Bu bekçi iki dosyayı
// metinden ayrıştırır ve eşitliği ölçer; DB'siz.
//
// Bölümler: §1 körlük zemini (iki liste de ≥ 10 satır) · §2 kod kümesi + SIRA
// eşit · §3 etiket eşit · §4 hook dalı zemini gerçekten okuyor · §5 negatif
// sonda (bellek içi: eksik kod · sıra bozuk · etiket farklı → ayrıştırıcı kırmızı).
//
// NEGATİF SONDA (2026-09-14): `loomStopReasons.ts`ten `MOLA` satırı silindi → §2
// kırmızı; iki satır yer değiştirdi → §2 sıra kırmızı; bir etiket değişti → §3
// kırmızı. Üçü de `git checkout --` ile geri alındı. §5 aynı üç bozmayı bellek
// içinde her koşumda tekrarlar.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const SUNUCU = path.join(ROOT, "Teks-Erp/src/constants/reason-presets.ts");
const TABLET = path.join(ROOT, "mobil/src/constants/loomStopReasons.ts");
const HOOK = path.join(ROOT, "mobil/src/hooks/useReasonPresets.ts");
const EN_AZ = 10;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

interface Satir {
  code: string;
  label: string;
}

/** `export const <AD>… = [` bloğunu alır; `{ code: "X", label: "Y" … }` satırlarını sırayla döker. */
function ayristir(kaynak: string, dizi: string): Satir[] {
  const basla = kaynak.indexOf(`export const ${dizi}`);
  if (basla < 0) return [];
  const bitis = kaynak.indexOf("];", basla);
  const blok = kaynak.slice(basla, bitis < 0 ? undefined : bitis);
  const out: Satir[] = [];
  const re = /\{\s*code:\s*["']([A-Z0-9_]+)["'],\s*label:\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blok)) !== null) out.push({ code: m[1], label: m[2] });
  return out;
}

function karsilastir(sunucu: Satir[], tablet: Satir[]): { kodlar: boolean; sira: boolean; etiket: boolean; fark: string } {
  const s = sunucu.map((x) => x.code);
  const t = tablet.map((x) => x.code);
  const eksik = s.filter((c) => !t.includes(c));
  const fazla = t.filter((c) => !s.includes(c));
  const kodlar = eksik.length === 0 && fazla.length === 0;
  const sira = kodlar && s.join(",") === t.join(",");
  const etiketFark = sunucu.filter((x) => tablet.find((y) => y.code === x.code)?.label !== x.label).map((x) => x.code);
  const fark = [eksik.length ? `eksik: ${eksik.join(",")}` : "", fazla.length ? `fazla: ${fazla.join(",")}` : "", etiketFark.length ? `etiket: ${etiketFark.join(",")}` : ""].filter(Boolean).join(" · ");
  return { kodlar, sira, etiket: etiketFark.length === 0, fark };
}

function main(): void {
  const sunucuMetin = readFileSync(SUNUCU, "utf8");
  const tabletMetin = readFileSync(TABLET, "utf8");
  const sunucu = ayristir(sunucuMetin, "MACHINE_STOP_REASONS");
  const tablet = ayristir(tabletMetin, "LOOM_STOP_REASONS");

  console.log("\n── §1 Körlük zemini ──");
  check(`§1a sunucu MACHINE_STOP_REASONS ≥ ${EN_AZ}`, sunucu.length >= EN_AZ, `${sunucu.length}`);
  check(`§1b tablet LOOM_STOP_REASONS ≥ ${EN_AZ}`, tablet.length >= EN_AZ, `${tablet.length}`);

  console.log("\n── §2–§3 Birebir ──");
  const k = karsilastir(sunucu, tablet);
  check("§2a kod kümesi eşit (eksik/fazla yok)", k.kodlar, k.fark);
  check("§2b SIRA eşit (dizi sırası sortOrder olur)", k.sira, k.sira ? "" : "sıra farklı");
  check("§3 etiketler eşit", k.etiket, k.fark);

  console.log("\n── §4 Hook zemini okuyor ──");
  const hook = readFileSync(HOOK, "utf8");
  const dal = hook.slice(hook.indexOf("case 'MACHINE_STOP':"), hook.indexOf("case 'MACHINE_STOP':") + 400);
  check("§4a useReasonPresets MACHINE_STOP dalı LOOM_STOP_REASONS'u map'liyor", /LOOM_STOP_REASONS\.map\(/.test(dal), dal ? "" : "dal yok");
  check("§4b dal artık `return []` DEĞİL", !/return \[\]/.test(dal));
  check("§4c import var", /from '\.\.\/constants\/loomStopReasons'/.test(hook));

  console.log("\n── §5 Negatif sonda (bellek içi) ──");
  const eksik = tabletMetin.replace(/\s*\{ code: 'MOLA', label: 'Mola' \},/, "");
  check("§5a eksik kod → §2a kırmızı", !karsilastir(sunucu, ayristir(eksik, "LOOM_STOP_REASONS")).kodlar);
  const yer = tabletMetin.replace("{ code: 'TAHAR', label: 'Tahar' },\n  { code: 'TARAK_DEGISIMI', label: 'Tarak değişimi' },", "{ code: 'TARAK_DEGISIMI', label: 'Tarak değişimi' },\n  { code: 'TAHAR', label: 'Tahar' },");
  check("§5b sıra bozuk → §2b kırmızı (kod kümesi yeşil)", yer !== tabletMetin && karsilastir(sunucu, ayristir(yer, "LOOM_STOP_REASONS")).kodlar && !karsilastir(sunucu, ayristir(yer, "LOOM_STOP_REASONS")).sira);
  const etiket = tabletMetin.replace("label: 'Mola'", "label: 'Ara'");
  check("§5c etiket farklı → §3 kırmızı", !karsilastir(sunucu, ayristir(etiket, "LOOM_STOP_REASONS")).etiket);
  check("§5d boş metin → körlük zemini kırmızı", ayristir("", "LOOM_STOP_REASONS").length < EN_AZ);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
