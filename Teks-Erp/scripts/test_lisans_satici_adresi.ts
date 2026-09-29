// =============================================================================
// BEKÇİ — LİSANS SATICI ADRESİ: `LICENSE_SERVER_URL` TEK yerde çözülür (`vendor-url.ts`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_satici_adresi   (DB'SİZ)
//
// NE ÖLÇER:
//   §1 çözüm tablosu: verilmezse/boşsa ÜRETİM satıcısı (https://lisans.etkiliyazilim.com) ·
//      hazırlık adresi aynen · `kapali` → dışarı çıkış yok · yalnız köken (şema + host[:port]);
//      yol/sorgu/kimlik bilgisi/düz HTTP (döngü adresi hariç)/şemasız değer → null (fail-closed)
//   §2 varsayılan kendiyle tutarlı (HTTPS köken) ve hazırlık adresinden AYRI host
//   §3 ⭐ gerçek modül açılışı: ayrı süreçte ortam verilmeden / hazırlık adresiyle / `kapali` ile
//      motorun `getLicenseConfig().vendorUrl`i beklenen değeri taşır (çözüm yolu gerçekten bu fonksiyon)
//   §4 ⭐ tek kaynak: `src/` altında `LICENSE_SERVER_URL` ortam okuması ve satıcı alan adı
//      literali YALNIZ `lib/license/vendor-url.ts`te (ikinci okuyucu = ayrışan adres)
// Etkinleşmemiş kurulumun varsayılan adresle bile dışarı çıkmadığı `test_lisans_motoru §2b`de.
//
// NEGATİF SONDA — dosya DIŞI mutasyon zinciri (bir kezlik, ✓B; cp + shasum ile birebir geri alındı):
//   B1  http-egress döngü dışı düz HTTP'ye izin verir      → 1 ❌ (§1 http)
//   B2  motor ham ortamı okur (eski readVendorUrl)        → 3 ❌ (§3a verilmezse · §3c kapali · §4a)
//   B3  src'de ikinci `process.env.LICENSE_SERVER_URL`      → 1 ❌ (§4a)
// =============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_LICENSE_SERVER_URL, LICENSE_SERVER_DISABLED, resolveVendorUrl } from "../src/lib/license/vendor-url";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const HAZIRLIK = "https://lisans-test.etkiliyazilim.com";
const KOK = path.resolve(__dirname, "..");

function cozumTablosu(): void {
  console.log("\n§1 — çözüm tablosu");
  const vakalar: ReadonlyArray<[string, string | undefined, string | null, string]> = [
    ["verilmezse üretim satıcısı", undefined, DEFAULT_LICENSE_SERVER_URL, "varsayilan"],
    ["boş dizge üretim satıcısı", "", DEFAULT_LICENSE_SERVER_URL, "varsayilan"],
    ["yalnız boşluk üretim satıcısı", "   ", DEFAULT_LICENSE_SERVER_URL, "varsayilan"],
    ["hazırlık adresi aynen", HAZIRLIK, HAZIRLIK, "ortam"],
    ["sondaki eğik çizgi kökene iner", `${HAZIRLIK}/`, HAZIRLIK, "ortam"],
    ["açık port korunur", "https://lisans-test.etkiliyazilim.com:8443", "https://lisans-test.etkiliyazilim.com:8443", "ortam"],
    ["kapali → dışarı çıkış yok", LICENSE_SERVER_DISABLED, null, "kapali"],
    ["KAPALI (büyük harf) → dışarı çıkış yok", "KAPALI", null, "kapali"],
    ["döngü adresine düz HTTP (geliştirme) kabul", "http://127.0.0.1:4610", "http://127.0.0.1:4610", "ortam"],
    ["http (döngü dışı) RED", "http://lisans-test.etkiliyazilim.com", null, "gecersiz"],
    ["yol taşıyan adres RED", `${HAZIRLIK}/v1`, null, "gecersiz"],
    ["sorgu taşıyan adres RED", `${HAZIRLIK}/?x=1`, null, "gecersiz"],
    ["kimlik bilgili adres RED", "https://kullanici:parola@lisans-test.etkiliyazilim.com", null, "gecersiz"],
    ["şemasız alan adı RED", "lisans-test.etkiliyazilim.com", null, "gecersiz"],
    ["başka şema RED", "ftp://lisans-test.etkiliyazilim.com", null, "gecersiz"],
  ];
  for (const [ad, girdi, url, kaynak] of vakalar) {
    const r = resolveVendorUrl(girdi);
    check(`§1 ${ad}`, r.url === url && r.source === kaynak, `${JSON.stringify(girdi)} → ${r.url} (${r.source})`);
  }
}

function varsayilanTutarli(): void {
  console.log("\n§2 — varsayılan adres");
  const r = resolveVendorUrl(DEFAULT_LICENSE_SERVER_URL);
  check("§2a varsayılan HTTPS köken ve kendiyle tutarlı", r.url === DEFAULT_LICENSE_SERVER_URL && DEFAULT_LICENSE_SERVER_URL.startsWith("https://"), DEFAULT_LICENSE_SERVER_URL);
  check("§2b hazırlık satıcısı üretimden AYRI host", new URL(HAZIRLIK).host !== new URL(DEFAULT_LICENSE_SERVER_URL).host);
}

function acilis(): void {
  console.log("\n§3 — gerçek modül açılışı (ayrı süreç)");
  const tsx = path.join(KOK, "node_modules", ".bin", "tsx");
  const kod = `const r=require("./src/lib/license/runtime"),v=require("./src/lib/license/vendor-url");process.stdout.write(JSON.stringify({u:r.getLicenseConfig().vendorUrl,s:v.STARTUP_VENDOR.source}))`;
  const kos = (deger: string | undefined): { u: string | null; s: string } | null => {
    const env = { ...process.env };
    delete env.LICENSE_SERVER_URL;
    if (deger !== undefined) env.LICENSE_SERVER_URL = deger;
    const p = spawnSync(tsx, ["-e", kod], { cwd: KOK, env, encoding: "utf8", timeout: 60_000 });
    try {
      return JSON.parse(p.stdout) as { u: string | null; s: string };
    } catch {
      return null;
    }
  };
  const yok = kos(undefined);
  check("§3a ⭐ ortam verilmezse açılışta üretim satıcısı", yok?.u === DEFAULT_LICENSE_SERVER_URL && yok?.s === "varsayilan", JSON.stringify(yok));
  const hz = kos(HAZIRLIK);
  check("§3b hazırlık adresiyle açılış hazırlık satıcısını gösterir", hz?.u === HAZIRLIK && hz?.s === "ortam", JSON.stringify(hz));
  const kapali = kos("kapali");
  check("§3c ⭐ `kapali` ile açılışta satıcı adresi YOK", kapali !== null && kapali.u === null && kapali.s === "kapali", JSON.stringify(kapali));
}

function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(dizin)) {
    const p = path.join(dizin, ad);
    if (statSync(p).isDirectory()) out.push(...tsDosyalari(p));
    else if (ad.endsWith(".ts")) out.push(p);
  }
  return out;
}

function tekKaynak(): void {
  console.log("\n§4 — tek kaynak");
  const src = path.join(KOK, "src");
  const dosyalar = tsDosyalari(src);
  check("§4 körlük zemini: src tarandı", dosyalar.length >= 300, `${dosyalar.length} dosya`);
  const okuyan: string[] = [];
  const literal: string[] = [];
  for (const d of dosyalar) {
    const metin = readFileSync(d, "utf8");
    const goreli = path.relative(src, d);
    const okuma = metin.match(/env(?:\.LICENSE_SERVER_URL|\[\s*["']LICENSE_SERVER_URL["']\s*\])/g)?.length ?? 0;
    if (okuma > 0) okuyan.push(`${goreli}×${okuma}`);
    if (/lisans(?:-test)?\.etkiliyazilim\.com/.test(metin)) literal.push(goreli);
  }
  const TEK = path.join("lib", "license", "vendor-url.ts");
  check("§4a ⭐ LICENSE_SERVER_URL ortam okuması yalnız vendor-url.ts'te ve bir kez", okuyan.length === 1 && okuyan[0] === `${TEK}×1`, okuyan.join(", ") || "HİÇ YOK");
  check("§4b satıcı alan adı literali yalnız vendor-url.ts'te", literal.length === 1 && literal[0] === TEK, literal.join(", ") || "HİÇ YOK");
}

cozumTablosu();
varsayilanTutarli();
acilis();
tekKaynak();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
