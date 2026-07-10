// =============================================================================
// Çuval kodu şablonu (SACK_CODE_TEMPLATE) birim testleri — DB gerekmez.
// Koşum: npx tsx scripts/test_sack_code_template.ts
// =============================================================================

import {
  DEFAULT_SACK_CODE_TEMPLATE,
  normalizeSackCodeTemplate,
  resolveSackCodePrefix,
} from "../src/utils/sack-code-template";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean) {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}`);
  }
}

function throws(fn: () => unknown, msgPart?: string): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return msgPart ? e instanceof Error && e.message.includes(msgPart) : true;
  }
}

// --- normalize: geçerli şablonlar -------------------------------------------
check("default şablon geçerli", normalizeSackCodeTemplate(DEFAULT_SACK_CODE_TEMPLATE) === "AMB{SIRA:5}");
check("boş şablon → default", normalizeSackCodeTemplate("  ") === DEFAULT_SACK_CODE_TEMPLATE);
check("küçük harf kanonikleşir", normalizeSackCodeTemplate("amb{sira:5}") === "AMB{SIRA:5}");
check("hane parametresiz {SIRA} kabul", normalizeSackCodeTemplate("P{SIRA}") === "P{SIRA}");
check(
  "tarih + müşteri token'lı şablon kabul",
  normalizeSackCodeTemplate("{MUSTERI:3}{YYMMDD}{SIRA:3}") === "{MUSTERI:3}{YYMMDD}{SIRA:3}"
);

// --- normalize: geçersiz şablonlar ------------------------------------------
check("SIRA'sız şablon reddedilir", throws(() => normalizeSackCodeTemplate("AMB123"), "{SIRA"));
check("iki SIRA reddedilir", throws(() => normalizeSackCodeTemplate("{SIRA:3}A{SIRA:3}"), "BİR"));
check("SIRA sonda değilse reddedilir", throws(() => normalizeSackCodeTemplate("{SIRA:3}AMB"), "SONUNDA"));
check("tire reddedilir (tarayıcı kuralı)", throws(() => normalizeSackCodeTemplate("AMB-{SIRA:5}"), "A-Z"));
check("boşluk reddedilir", throws(() => normalizeSackCodeTemplate("AMB {SIRA:5}"), "A-Z"));
check("Türkçe karakter reddedilir", throws(() => normalizeSackCodeTemplate("ÇUV{SIRA:5}"), "A-Z"));
check("SIRA hane 3–6 dışı reddedilir (2)", throws(() => normalizeSackCodeTemplate("A{SIRA:2}"), "3–6"));
check("SIRA hane 3–6 dışı reddedilir (7)", throws(() => normalizeSackCodeTemplate("A{SIRA:7}"), "3–6"));
check("bilinmeyen token reddedilir", throws(() => normalizeSackCodeTemplate("A{FOO}{SIRA:5}"), "Bilinmeyen token"));
check("bozuk süslü parantez reddedilir", throws(() => normalizeSackCodeTemplate("A{SIRA:5"), "sözdizimi"));
check("41 karakter reddedilir", throws(() => normalizeSackCodeTemplate("A".repeat(33) + "{SIRA:5}"), "40"));
check("{YYMMDD:2} parametre reddedilir", throws(() => normalizeSackCodeTemplate("{YYMMDD:2}{SIRA:5}"), "parametre"));
check("{MUSTERI:9} reddedilir", throws(() => normalizeSackCodeTemplate("{MUSTERI:9}{SIRA:5}"), "1–6"));

// Rezerve tarayıcı prefix'leri (top/refakat/kartela/çuval/belge/sevk no)
for (const rp of ["TEKS", "RK", "SW", "CV", "SD", "SR", "KD", "KR", "SVK"]) {
  check(`rezerve prefix ${rp} reddedilir`, throws(() => normalizeSackCodeTemplate(`${rp}X{SIRA:5}`), rp));
}
check("AMB rezerve DEĞİL (default çalışır)", !throws(() => normalizeSackCodeTemplate("AMB{SIRA:5}")));

// --- resolve: prefix + hane çözümü ------------------------------------------
const now = new Date(2026, 6, 10); // 10 Temmuz 2026 → "260710"

const d1 = resolveSackCodePrefix("AMB{SIRA:5}", { now, customerCode: null });
check("default → prefix AMB, 5 hane", d1.prefix === "AMB" && d1.digits === 5);

const d2 = resolveSackCodePrefix("{YYMMDD}{SIRA:3}", { now, customerCode: null });
check("tarih token'ı çözülür (260710)", d2.prefix === "260710" && d2.digits === 3);

const d3 = resolveSackCodePrefix("{MUSTERI:3}{YYMMDD}{SIRA:3}", { now, customerCode: "acme-01" });
check("müşteri kodu ayıklanıp kırpılır (ACM)", d3.prefix === "ACM260710" && d3.digits === 3);

const d4 = resolveSackCodePrefix("{MUSTERI:4}{SIRA:4}", { now, customerCode: null });
check("müşteri kodu yoksa token boş düşer", d4.prefix === "" && d4.digits === 4);

const d5 = resolveSackCodePrefix("P{SIRA}", { now, customerCode: null });
check("{SIRA} hane default 5", d5.prefix === "P" && d5.digits === 5);

// Üretim simülasyonu: prefix + zero-pad — AMB%05d eski davranışla birebir mi
const gen = (prefix: string, digits: number, n: number) => `${prefix}${String(n).padStart(digits, "0")}`;
check("AMB üretimi eski davranışla birebir (AMB00001)", gen(d1.prefix, d1.digits, 1) === "AMB00001");
check("tarihli üretim örneği (260710001)", gen(d2.prefix, d2.digits, 1) === "260710001");

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
