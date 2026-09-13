// =============================================================================
// BEKÇİ — Audit ekranlarının TÜRKÇE sözlüğü eksiksiz mi? (2026-08-25)
// =============================================================================
// Saha bulgusu: "auditi kontrol ediyordum, Türkçe olmayan bir çok ifade gördüm."
// Ölçüldü (canlı kopya, ~10.400 kayıt): 7 modül adı, 16 sistem olayı ve 295
// alan adının 244'ü ham İngilizce basılıyordu. Sebep tek tek unutkanlık değil
// YAPISALDI — aynı bilgiyi tutan ÜÇ ayrı harita vardı ve hiçbirinin kapsamını
// ölçen bir bekçi yoktu:
//
//   • alan adı  → backend `constants/audit-field-labels.ts` (81 anahtar)
//                 + Electron aynası (57'de donmuş)
//                 + Electron `audit-labels.ts` içindeki İKİNCİ harita (94)
//   • olay adı  → `System/Events/labels.ts` (11) + `Reports/_components` (5)
//
// ─────────────────────────────────────────────────────────────────────────────
// 2026-09-13 — YÜKLEM VARLIKTAN ANLAMA ÇIKTI (çakışma beyanı)
//
// Eski yüklem: "her enum DEĞERİNİN bir Türkçesi var mı". Ama `ENUM_LABELS` düz
// `değer → Türkçe`dir ve bir değeri BİRDEN ÇOK enum paylaşabilir; harita ilk
// göreni tutar ⇒ paylaşılan değerde TEK cevap verilir ve o cevap paylaşanlardan
// biri için yanlış olabilir. Eski yüklem bunu GÖREMEZDİ: cevap VARDI, yanlıştı.
// ⚠️ Bekçinin kendi `enumValues` haritası da aynı körlüğü taşıyordu
// (`if (!has) set(...)` = ilk göreni tut) — ölçtüğü kusurun aynısı bekçinin
// içindeydi.
//
// Ölçüm (2026-09-13): 239 enum değerinin 25'i paylaşımlı; `CANCELLED` tek
// başına 14 enum'da. Kapı doğduğu gün İKİ GERÇEK KUSUR yakaladı:
//   ChequeEventType.RETURN → "İade girişi"    (WarehouseEventType'ın anlamı)
//   ChequeEventType.CANCEL → "Kayıttan düşme" (WarehouseEventType'ın anlamı)
// İkisi de `cheque.service.ts:1598/:1840` audit yüküne yazılıp ekranda
// basılıyordu. Aynı sınıf `PriceKind.PURCHASE`te bir kez ELLE yakalanmış,
// override yazılmış ama BEKÇİSİ YAZILMAMIŞTI — mekanizma vardı, tekrarlanabilir
// değildi.
//
// Yeni yüklem üç soru sorar: (1) her değerin karşılığı var mı · (2) şemadaki
// her ÇAKIŞMA beyan edilmiş mi (`SHARED_ENUM_VALUES`) · (3) beyan listesi
// listesi ölü satır taşıyor mu (İKİ YÖNLÜ).
// ⚠️ Paylaşım KUSUR DEĞİLDİR; beyansızlık kusurdur. 25 satır 25 borç değil,
// 25 onaylanmış ortaklıktır.
//
// NEGATİF SONDA — üçü de KOŞTURULDU (2026-09-13), her biri `cp`+sha256 ile
// birebir geri alındı (şema ve etiket dosyası ikisi de "BİREBİR ✓"):
//   S1 iki enum'a aynı yeni değer (`DOKUMA_SONDA`) → ⭐ çakışma KIRMIZI (21/1)
//   S2 beyan satırı eklendi                        → YEŞİL (22/0)
//   S3 şemadan kaldırıldı, beyan bırakıldı         → ölü satır KIRMIZI (21/1)
// İki yönlü olması pazarlık dışıydı: tek yönlü beyan listeleri şişer ve şişmiş
// bir liste kapının kendisi olur.
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ NE KIRMIZI, NE DEĞİL — bilinçli ayrım:
//   KIRMIZI  → SONLU ve KOD TARAFINDAN belirlenen kümeler: backend'in bastığı
//              her `tableName`, her sistem olayı, her Prisma enum değeri ve
//              aynanın birebirliği. Bunlar bir satır ekleyerek kapanır.
//   FAIL-OPEN→ `newData` içindeki serbest alan adları. Şemaya/yüke eklenen her
//              yeni anahtar testi kırsaydı ekip kırmızıyı görmezden gelmeyi
//              öğrenirdi (audit-field-labels.ts başlığındaki karar). Etiketi
//              olmayan alan HAM ADIYLA basılır; ekran asla boş kalmaz.
//
// Koşum: npx tsx scripts/test_audit_labels.ts
// =============================================================================

import fs from "fs";
import path from "path";

import { AUDIT_FIELD_LABELS } from "../src/constants/audit-field-labels";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const BACKEND_SRC = path.resolve(__dirname, "../src");
const ELECTRON_LIB = path.resolve(__dirname, "../../Electron/src/lib");

/** `X: "Türkçe",` satırlarını okur. Bloğu ADIYLA bulur, sonuna kadar tarar. */
function readMap(file: string, constName: string): Record<string, string> | null {
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, "utf8");
  // ⚠️ `indexOf(constName)` YETMEZ: aynı ad dosyanın başındaki açıklamada da
  // geçer ve o durumda YORUM bloğundan sonraki ilk `{` okunur — yani harita
  // BOŞ döner ve "hepsi eksik" gibi görünür. Tanımı ara.
  const decl = new RegExp(`const\\s+${constName}\\b`).exec(src);
  if (!decl) return null;
  const start = decl.index;
  const open = src.indexOf("{", start);
  const close = src.indexOf("\n};", open);
  if (open === -1 || close === -1) return null;
  const body = src.slice(open, close);
  const out: Record<string, string> = {};
  const re = /^\s{2}(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*)):\s*"((?:[^"\\]|\\.)*)"/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out[(m[1] ?? m[2])!] = m[3]!;
  return out;
}

/** `src/` altındaki tüm .ts dosyaları. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const backendFiles = walk(BACKEND_SRC);
const backendText = backendFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

// =============================================================================
// 1) AYNA — backend alan sözlüğü ≡ Electron aynası
// =============================================================================
console.log("\n=== 1) Alan sözlüğü aynası (backend ↔ Electron) ===");

const mirror = readMap(path.join(ELECTRON_LIB, "audit-field-labels.ts"), "AUDIT_FIELD_LABELS");
check("Electron aynası okunabildi", mirror !== null, path.join(ELECTRON_LIB, "audit-field-labels.ts"));

if (mirror) {
  const beKeys = Object.keys(AUDIT_FIELD_LABELS);
  // Körlük zemini: regex bozulursa "fark yok" ile "hiçbir şey okunmadı" aynı
  // yeşile çıkardı.
  check("körlük zemini: sözlük dolu", beKeys.length >= 250, `${beKeys.length} anahtar`);

  const missing = beKeys.filter((k) => !(k in mirror));
  const extra = Object.keys(mirror).filter((k) => !(k in AUDIT_FIELD_LABELS));
  const diverged = beKeys.filter((k) => k in mirror && mirror[k] !== AUDIT_FIELD_LABELS[k]);

  check("aynada eksik anahtar yok", missing.length === 0, missing.slice(0, 12).join(", "));
  check("aynada fazladan anahtar yok", extra.length === 0, extra.slice(0, 12).join(", "));
  check(
    "aynı anahtar aynı Türkçe karşılığı taşıyor",
    diverged.length === 0,
    diverged.slice(0, 8).map((k) => `${k}: "${AUDIT_FIELD_LABELS[k]}" ≠ "${mirror[k]}"`).join(" | "),
  );
}

// =============================================================================
// 2) MODÜL ADI — backend'in bastığı her `tableName` çevrilmiş mi?
// =============================================================================
console.log("\n=== 2) Modül adı kapsamı (tableName) ===");

// İki yazım biçimi de sayılır: çağrı yerinde düz literal, ve dosya başında
// `const TABLE = "X"` sabiti (servislerin yarısı böyle yazıyor — yalnız
// `tableName:` aransaydı 20 modül "kodda geçmiyor" sanılırdı).
const tableLiterals = new Set([
  ...[...backendText.matchAll(/tableName:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]!),
  ...[...backendText.matchAll(/const\s+[A-Z][A-Z0-9_]*TABLE[A-Z0-9_]*\s*=\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]!),
  ...[...backendText.matchAll(/const\s+TABLE(?:_[A-Z0-9_]+)?\s*=\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]!),
]);
// Bekçinin kendi sonda kayıtları kapsam dışı (test_audit_depth `BEKCI_B3` yazar).
for (const probe of ["BEKCI_B3"]) tableLiterals.delete(probe);

const tableLabels = readMap(path.join(ELECTRON_LIB, "audit-labels.ts"), "TABLE_LABELS");
check("TABLE_LABELS okunabildi", tableLabels !== null);
check("körlük zemini: kodda tableName literali bulundu", tableLiterals.size >= 40, `${tableLiterals.size} tablo`);

if (tableLabels) {
  const missingTables = [...tableLiterals].filter((t) => !(t in tableLabels)).sort();
  check(
    "backend'in bastığı her modül adının Türkçesi var",
    missingTables.length === 0,
    missingTables.join(", "),
  );

  // Ölü etiket UYARIDIR, kırmızı değil: eski kayıtlar hâlâ o tableName'i taşıyor
  // olabilir (audit geriye dönük okunur — etiketi silmek geçmişi bozar).
  const dead = Object.keys(tableLabels).filter((t) => !tableLiterals.has(t)).sort();
  if (dead.length) console.log(`⚠️  kodda geçmeyen ${dead.length} etiket (eski kayıtlar için tutuluyor): ${dead.join(", ")}`);
}

// =============================================================================
// 3) SİSTEM OLAYI — `logEvent` action'larının hepsi çevrilmiş mi?
// =============================================================================
console.log("\n=== 3) Sistem olayı kapsamı (logEvent action) ===");

// `logEvent({ … action: "X" })` ve `action: ok ? "A" : "B"` biçimlerini birlikte
// yakalamak için: logEvent çağrısından sonraki pencerede action ifadesini ara.
const eventActions = new Set<string>();
for (const m of backendText.matchAll(/logEvent\(\s*\{[\s\S]{0,400}?\}/g)) {
  for (const a of m[0].matchAll(/action:\s*(?:[^,\n]*?\?\s*)?"([A-Z][A-Z0-9_]*)"(?:\s*:\s*"([A-Z][A-Z0-9_]*)")?/g)) {
    eventActions.add(a[1]!);
    if (a[2]) eventActions.add(a[2]);
  }
}

const eventLabels = readMap(path.join(ELECTRON_LIB, "audit-labels.ts"), "EVENT_ACTION_LABELS");
check("EVENT_ACTION_LABELS okunabildi", eventLabels !== null);
check("körlük zemini: kodda logEvent action'ı bulundu", eventActions.size >= 20, `${eventActions.size} olay`);

if (eventLabels) {
  const missingEvents = [...eventActions].filter((a) => !(a in eventLabels)).sort();
  check(
    "backend'in bastığı her sistem olayının Türkçesi var",
    missingEvents.length === 0,
    missingEvents.join(", "),
  );
}

// =============================================================================
// 4) DEĞER SÖZLÜĞÜ — Prisma enum değerleri çevrilmiş mi?
// =============================================================================
console.log("\n=== 4) Değer sözlüğü kapsamı (Prisma enum) ===");

// ⚠️ SATIR SONU YORUMLARI ÖNCE SİLİNİR. Şemadaki enum üyelerinin çoğu
// `TOP // Rulo (…)` diye yazılmış; yorum kırpılmazsa `^\s*DEĞER\s*$` deseni
// onları HİÇ görmez ve bekçi "hepsi çevrilmiş" diye YEŞİL kalır. İlk sürümde
// tam bu oldu: `RollForm.TOP`/`ACIK` ve onlarca üye kapsam dışıydı.
const schema = fs
  .readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8")
  .replace(/\/\/[^\n]*/g, "");
// ⚠️ DEĞER → PAYLAŞAN ENUM'LARIN HEPSİ (2026-09-13).
// Eskiden bu harita `if (!has) set(...)` ile İLK GÖRENİ tutuyordu — yani
// bekçinin kendisi, ölçtüğü kusurun (düz haritanın ilk göreni tutması) aynısını
// taşıyordu ve çakışmaları göremiyordu. Ölçüldü: 239 değerin 25'i paylaşımlı.
const enumOwners = new Map<string, string[]>();
for (const m of schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
  for (const v of m[2]!.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*$/gm)) {
    const k = v[1]!;
    const liste = enumOwners.get(k);
    if (liste) liste.push(m[1]!);
    else enumOwners.set(k, [m[1]!]);
  }
}
const enumValues = new Map<string, string>([...enumOwners].map(([v, e]) => [v, e[0]!]));

const enumLabels = readMap(path.join(ELECTRON_LIB, "audit-labels.ts"), "ENUM_LABELS");
check("ENUM_LABELS okunabildi", enumLabels !== null);
// Zemin ölçüme göre: 2026-08-25'te 140 üye. Yorum kırpması düşerse ~60'a
// iner ve bekçi sessizce kör kalırdı — bu satır tam onu yakalar.
check("körlük zemini: şemada enum değeri bulundu", enumValues.size >= 120, `${enumValues.size} değer`);

if (enumLabels) {
  const missingEnums = [...enumValues.keys()].filter((v) => !(v in enumLabels)).sort();
  check(
    "her Prisma enum değerinin Türkçesi var",
    missingEnums.length === 0,
    missingEnums.map((v) => `${v} (${enumValues.get(v)})`).join(", "),
  );

  // ───────────────────────────────────────────────────────────────────────────
  // ÇAKIŞMA BEYANI — düz haritanın TEK cevabı tüm paylaşanlar için doğru mu?
  //
  // `ENUM_LABELS` düz `değer → Türkçe`dir; bir değeri birden çok enum
  // paylaştığında harita TEK cevap verir. O cevap paylaşanlardan biri için
  // yanlışsa denetim ekranı yanlış Türkçe basar ve DERLEYİCİ SUSAR. Eski yüklem
  // bunu göremezdi çünkü *varlığı* ölçüyordu, *anlamı* değil.
  //
  // ⚠️ Bu kapı doğduğu gün İKİ GERÇEK KUSUR yakaladı (2026-09-13):
  //   ChequeEventType.RETURN → "İade girişi"    (WarehouseEventType'ın anlamı)
  //   ChequeEventType.CANCEL → "Kayıttan düşme" (WarehouseEventType'ın anlamı)
  // İkisi de `cheque.service` audit yüküne yazılıyor (`event: "RETURN"|"CANCEL"`)
  // ve ekranda basılıyordu. Aynı sınıf `PriceKind.PURCHASE`te bir kez ELLE
  // yakalanmış, bekçisi yazılmamıştı.
  // ───────────────────────────────────────────────────────────────────────────
  const cakisanlar = [...enumOwners.entries()].filter(([, e]) => e.length > 1);
  check(
    "körlük zemini: şemada ÇAKIŞAN enum değeri bulundu",
    cakisanlar.length >= 15,
    `${cakisanlar.length} çakışma / ${enumOwners.size} değer`,
  );

  const beyan = readMap(path.join(ELECTRON_LIB, "audit-labels.ts"), "SHARED_ENUM_VALUES");
  check("SHARED_ENUM_VALUES okunabildi", beyan !== null);

  if (beyan) {
    const beyansiz = cakisanlar
      .filter(([v]) => !(v in beyan))
      .map(([v, e]) => `${v} (${e.join("+")})`)
      .sort();
    check(
      "⭐ şemadaki HER çakışma BEYAN EDİLMİŞ (ortak Türkçe onaylanmış ya da override yazılmış)",
      beyansiz.length === 0,
      beyansiz.join(", ") ||
        `${cakisanlar.length} çakışmanın hepsi beyanlı — paylaşım kusur DEĞİL, beyansızlık kusur`,
    );

    // İKİ YÖNLÜ: şemadan düşmüş bir çakışma beyanda kalırsa liste şişer ve
    // şişmiş bir beyan listesi kapının kendisi olur.
    const cakisanKume = new Set(cakisanlar.map(([v]) => v));
    const oluBeyan = Object.keys(beyan).filter((v) => !cakisanKume.has(v)).sort();
    check(
      "beyan listesi ÖLÜ satır taşımıyor (iki yönlü)",
      oluBeyan.length === 0,
      oluBeyan.join(", ") || `${Object.keys(beyan).length} beyan, hepsi canlı`,
    );

    check(
      "her beyanın gerekçesi yazılı",
      Object.values(beyan).every((g) => g.length > 20),
      `${Object.keys(beyan).length} beyan`,
    );
  }
}

// =============================================================================
// 5) TEK SÖZLÜK — alan adı için ikinci bir harita geri gelmesin
// =============================================================================
console.log("\n=== 5) Tek sözlük (ikinci alan haritası yok) ===");

const auditLabelsSrc = fs.readFileSync(path.join(ELECTRON_LIB, "audit-labels.ts"), "utf8");
check(
  "audit-labels.ts kendi FIELD_LABELS haritasını TANIMLAMIYOR",
  !/^export const FIELD_LABELS/m.test(auditLabelsSrc),
  "alan adı sözlüğü yalnız audit-field-labels.ts'te yaşamalı",
);
check(
  "audit-labels.ts alan etiketini aynadan RE-EXPORT ediyor",
  /export \{[^}]*auditFieldLabel[^}]*\} from "\.\/audit-field-labels"/.test(auditLabelsSrc),
);

// Değer biçimlendiricileri enum sözlüğünü GERÇEKTEN kullanmalı: eskiden diff
// satırı `String(v)` diyordu ve ham blok "Depoda" derken satır "WAREHOUSE" idi.
check(
  "diff satırı da enum sözlüğünden geçiyor",
  /export function auditValueText[\s\S]{0,400}formatAuditValue\(/.test(auditLabelsSrc),
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
