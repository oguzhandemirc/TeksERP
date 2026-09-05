// =============================================================================
// Test: Advisory kilit uzayı sözleşmesi (İ-10, 2026-09-05)
// Çalıştır: npx tsx scripts/run-all-tests.ts advisory_lock_namespaces
// =============================================================================
// KORUNAN INVARIANT: `pg_advisory_xact_lock(UZAY, anahtar)` uzaylarının her
// birinin TEK sahibi vardır ve envanter tek bir yerde — `period-guard.helper.ts`
// başlığında — yaşar.
//
// NEDEN BEKÇİ GEREKTİ: iki uzay (8026 ve 8027) yıllarca ÇİFT sahipliydi
// (kod-tekilliği ↔ cari dönem, alış siparişi ↔ master-data birleştirme). Zarar
// yanlış veri değil GECİKMEdir: `hashtext` çakışmasında iki alakasız alt sistem
// birbirini sessizce serileştirir ve gecikmenin kaynağı bulunamaz. Hata yok,
// log yok — yani yalnız bir bekçi görebilir.
//
// Envanter YORUMDUR ve yorum bayatlar: 2026-09-05 ölçümünde envanter 8023'ü hiç
// almamış, 8026/8027'yi tek sahibe atfetmişti. Bu yüzden karşılaştırma İKİ
// YÖNLÜdür — kodda olup envanterde olmayan da, envanterde olup kodda olmayan da
// KIRMIZI verir.
//
// BÖLÜMLER: §1 envanter ayrıştırma + körlük zemini · §2 kodda sabit taraması ·
// §3 tek sahiplik · §4 envanter ↔ kod birebir (iki yönlü) · §5 çağrıda çıplak
// sayı yasağı + `: number` anotasyonu · §6 kopya envanter listesi seddi.
// =============================================================================
import { readFileSync, readdirSync } from "fs";
import { join, relative, sep } from "path";

const SRC = join(__dirname, "../src");
const ENVANTER_DOSYA = "services/helpers/period-guard.helper.ts";

/** Körlük zemini — bu sayıların altına düşmek "hiç bakılmadı" demektir. */
const EN_AZ_UZAY = 8;
const EN_AZ_CAGRI = 12;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** src'ye göreli, her platformda `/` ayraçlı yol — envanterdeki yazımla aynı. */
function rel(p: string): string {
  return relative(SRC, p).split(sep).join("/");
}

/** Yorum satırı mı (blok/satır) — envanter ve prose taramalarında ayırt edilir. */
function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

interface Uzay {
  ns: number;
  sabit: string;
  dosya: string;
  amac: string;
}

// Envanter satırı: `//   <numara>  <SABİT>  <src-göreli dosya>  <amaç>`
const ENVANTER_RE = /^\/\/ {3}(\d{4}) {2,}([A-Z0-9_]+_LOCK_NS) {2,}(\S+) {2,}(.+?)\s*$/;
// Kod tanımı: `export const X_LOCK_NS: number = 80NN;`
const SABIT_RE = /^\s*(?:export\s+)?const\s+([A-Z0-9_]+_LOCK_NS)\s*(:\s*number\s*)?=\s*(\d+)\s*;/;
// Çağrı: ilk argüman `${SABIT}::int` olmalı — çıplak sayı yasak.
const CAGRI_RE = /pg_advisory_xact_lock(?:_shared)?\(([^,)]*)/g;

function main(): void {
  console.log("=== Advisory kilit uzayı sözleşmesi ===\n");

  // ── 1) ENVANTER — tek kaynak ayrıştırılıyor mu ───────────────────────────
  console.log("[1] Envanter ayrıştırma (tek kaynak: " + ENVANTER_DOSYA + ")");
  const envanterSrc = readFileSync(join(SRC, ENVANTER_DOSYA), "utf8");
  const envanter: Uzay[] = [];
  for (const line of envanterSrc.split("\n")) {
    const m = ENVANTER_RE.exec(line);
    if (m) envanter.push({ ns: Number(m[1]), sabit: m[2], dosya: m[3], amac: m[4] });
  }
  check(
    `envanter satırı ayrıştırıldı (körlük zemini ≥${EN_AZ_UZAY})`,
    envanter.length >= EN_AZ_UZAY,
    `${envanter.length} satır`,
  );
  check(
    "envanter başlığı 'TEK KAYNAK' olduğunu söylüyor",
    /ADVISORY KİLİT UZAYI ENVANTERİ — TEK KAYNAK/.test(envanterSrc),
  );
  for (const u of envanter) console.log(`     ${u.ns}  ${u.sabit}  ${u.dosya}  ${u.amac}`);

  // ── 2) KOD — `*_LOCK_NS` sabitleri ───────────────────────────────────────
  console.log("\n[2] Koddaki uzay sabitleri");
  const dosyalar = tsFiles(SRC);
  const kod: (Uzay & { anotasyonlu: boolean })[] = [];
  for (const p of dosyalar) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = SABIT_RE.exec(line);
      if (m) kod.push({ ns: Number(m[3]), sabit: m[1], dosya: rel(p), amac: "", anotasyonlu: !!m[2] });
    }
  }
  check(
    `src'de uzay sabiti bulundu (körlük zemini ≥${EN_AZ_UZAY})`,
    kod.length >= EN_AZ_UZAY,
    `${kod.length} sabit`,
  );

  // ── 3) TEK SAHİPLİK — bir numara, bir alt sistem ─────────────────────────
  console.log("\n[3] Tek sahiplik (aynı uzayı paylaşmak sessiz serileşmedir)");
  const sahipler = new Map<number, string[]>();
  for (const k of kod) sahipler.set(k.ns, [...(sahipler.get(k.ns) ?? []), `${k.sabit} (${k.dosya})`]);
  const cakisan = [...sahipler.entries()].filter(([, v]) => v.length > 1);
  check(
    "her uzayın TEK sahibi var",
    cakisan.length === 0,
    cakisan.map(([ns, v]) => `${ns}: ${v.join(" ↔ ")}`).join(" | "),
  );
  const sabitAdlari = new Set(kod.map((k) => k.sabit));
  check("sabit adları tekil", sabitAdlari.size === kod.length);

  // ── 4) ENVANTER ↔ KOD — İKİ YÖNLÜ ────────────────────────────────────────
  console.log("\n[4] Envanter ↔ kod birebir (iki yönlü)");
  const kodAnahtar = new Map(kod.map((k) => [k.sabit, k]));
  const envAnahtar = new Map(envanter.map((e) => [e.sabit, e]));

  const kodda_yok = envanter.filter((e) => !kodAnahtar.has(e.sabit)).map((e) => e.sabit);
  check("envanterdeki her satırın kodda karşılığı var", kodda_yok.length === 0, kodda_yok.join(", "));

  const envanterde_yok = kod.filter((k) => !envAnahtar.has(k.sabit)).map((k) => `${k.sabit} (${k.dosya})`);
  check(
    "koddaki her uzay envanterde yazılı",
    envanterde_yok.length === 0,
    envanterde_yok.join(", "),
  );

  const numaraSapmasi = envanter
    .filter((e) => kodAnahtar.has(e.sabit) && kodAnahtar.get(e.sabit)!.ns !== e.ns)
    .map((e) => `${e.sabit}: envanter ${e.ns} ≠ kod ${kodAnahtar.get(e.sabit)!.ns}`);
  check("numaralar birebir", numaraSapmasi.length === 0, numaraSapmasi.join(", "));

  const dosyaSapmasi = envanter
    .filter((e) => kodAnahtar.has(e.sabit) && kodAnahtar.get(e.sabit)!.dosya !== e.dosya)
    .map((e) => `${e.sabit}: envanter ${e.dosya} ≠ kod ${kodAnahtar.get(e.sabit)!.dosya}`);
  check("sahip dosyalar birebir", dosyaSapmasi.length === 0, dosyaSapmasi.join(", "));

  const amacsiz = envanter.filter((e) => e.amac.trim().length < 4).map((e) => e.sabit);
  check("her envanter satırı bir AMAÇ taşıyor", amacsiz.length === 0, amacsiz.join(", "));

  // ── 5) ÇAĞRI — çıplak sayı yasak, sabit `: number` tiplenmiş ─────────────
  console.log("\n[5] Çağrı biçimi ve sabit anotasyonu");
  const ciplak: string[] = [];
  let cagriSayisi = 0;
  for (const p of dosyalar) {
    const satirlar = readFileSync(p, "utf8").split("\n");
    for (let i = 0; i < satirlar.length; i++) {
      const line = satirlar[i] as string;
      if (isCommentLine(line)) continue;
      CAGRI_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CAGRI_RE.exec(line)) !== null) {
        cagriSayisi++;
        const arg = (m[1] ?? "").trim();
        if (!/^\$\{[A-Z0-9_]+_LOCK_NS\}::int$/.test(arg)) {
          ciplak.push(`${rel(p)}:${i + 1} → "${arg}"`);
        }
      }
    }
  }
  check(
    `advisory çağrısı bulundu (körlük zemini ≥${EN_AZ_CAGRI})`,
    cagriSayisi >= EN_AZ_CAGRI,
    `${cagriSayisi} çağrı`,
  );
  check(
    "hiçbir çağrı ÇIPLAK sayı ile uzay almıyor (hepsi adlandırılmış sabit)",
    ciplak.length === 0,
    ciplak.join(" | "),
  );
  const anotasyonsuz = kod.filter((k) => !k.anotasyonlu).map((k) => `${k.sabit} (${k.dosya})`);
  check(
    "her uzay sabiti `: number` tiplenmiş (literal tip TS2367 üretir)",
    anotasyonsuz.length === 0,
    anotasyonsuz.join(", "),
  );

  // ── 6) KOPYA ENVANTER SEDDİ ──────────────────────────────────────────────
  // Envanter kopyaları sessizce bayatlar (2026-09-05 ölçümü: 7 dosyada 7 farklı
  // ve üçü YANLIŞ liste). Tek kaynak dışında uzay listesi TUTULMAZ.
  console.log("\n[6] Kopya envanter seddi");
  const kopya: string[] = [];
  for (const p of dosyalar) {
    if (rel(p) === ENVANTER_DOSYA) continue;
    const satirlar = readFileSync(p, "utf8").split("\n");
    for (let i = 0; i < satirlar.length; i++) {
      const line = satirlar[i] as string;
      if (!isCommentLine(line)) continue;
      const uzaylar = new Set((line.match(/\b80[23]\d\b/g) ?? []).map((x) => x));
      if (uzaylar.size >= 3) kopya.push(`${rel(p)}:${i + 1}`);
    }
  }
  check(
    "tek kaynak dışında uzay LİSTESİ yok (kopya bayatlar)",
    kopya.length === 0,
    kopya.join(", "),
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
