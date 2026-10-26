// =============================================================================
// Test: Peripheral.identifyPattern ReDoS kapısı (denetim G4-B2) — DB'siz.
// Çalıştır: npx tsx scripts/test_peripheral_pattern_safety.ts
// Üstel geri izleme sınıfları (iç içe niceleyici, tekrarlanan seçenek, geri referans,
// uzunluk tavanı) reddedilir; sahadaki gerçek desen biçimleri kabul edilir. Kayıt yolu
// (servis) kaynak sondasıyla bağlanır.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PATTERN_MAX_LENGTH, unsafePatternReason } from "../src/utils/regex-safety";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const UNSAFE = [
  "(a+)+$", "(a*)*b", "(a|a)*", "^(.|.|.)*X$", "(\\d+)+", "((ab)+)+", "(?:a+){2,}",
  "(a{1,5})+", "(x(kg|g))+", "(?<v>a+)+", "(a)\\1", "(?<v>a)\\k<v>",
  "(?:[a-z]+\\s?)*$", "(a+)+?", "(a|b){1,30}",
];
const SAFE = [
  "", "ST,GS,([+-]?\\d+\\.\\d+)", "([0-9]+\\.[0-9]+)\\s*kg", "^M=(\\d+(?:\\.\\d+)?)$",
  "LEN\\s+(\\d+\\.\\d+)\\s+m", "(kg|g)?", "[(+)*]+", "(\\d{1,6})", "(a){3}", "\\(\\d+\\)+",
  "(?=\\d)(\\d+)", "(\\d+)?", "[|]*",
];

for (const p of UNSAFE) check(`red: ${JSON.stringify(p)}`, unsafePatternReason(p) !== null, unsafePatternReason(p) ?? "kabul edildi");
for (const p of SAFE) check(`kabul: ${JSON.stringify(p)}`, unsafePatternReason(p) === null, unsafePatternReason(p) ?? "");
check("derlenemeyen desen reddedilir", unsafePatternReason("([0-9]") === "Veri deseni (regex) geçersiz");
check(`uzunluk tavanı ${PATTERN_MAX_LENGTH}`, unsafePatternReason("a".repeat(PATTERN_MAX_LENGTH)) === null && unsafePatternReason("a".repeat(PATTERN_MAX_LENGTH + 1)) !== null);
check("red mesajları Türkçe", UNSAFE.every((p) => /Veri deseni/.test(unsafePatternReason(p) ?? "")));

// Kabul edilen her desen kötü niyetli girdide bile hızlı biter (ölçü: < 50 ms).
const evil = "a".repeat(40) + "!";
const slow = SAFE.filter((p) => p).map((p) => { const t = performance.now(); new RegExp(p).test(evil); return [p, performance.now() - t] as const; }).filter(([, ms]) => ms > 50);
check("kabul edilen desenler 41 karakterlik girdide < 50 ms", slow.length === 0, JSON.stringify(slow));

// Kayıt yolu: servis doğrulaması yardımcıyı çağırır (create + update ortak validateRefs).
const svc = readFileSync(join(__dirname, "../src/services/peripheral.service.ts"), "utf8");
const validate = svc.slice(svc.indexOf("private async validateRefs"), svc.indexOf("async create("));
check("validateRefs identifyPattern'i unsafePatternReason'dan geçirir", /unsafePatternReason\(data\.identifyPattern\)/.test(validate));
check("create ve update validateRefs çağırır", (svc.match(/await this\.validateRefs\(data/g) ?? []).length >= 2);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail ? 1 : 0;
