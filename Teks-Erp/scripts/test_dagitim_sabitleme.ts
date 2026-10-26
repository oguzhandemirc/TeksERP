// =============================================================================
// DAĞITIM ZİNCİRİ SABİTLEMESİ (güvenlik denetimi Bölge 5 · B7) — DURAĞAN, DB'siz.
//   §1 Teslim imajlarının Dockerfile'larında her dış `FROM` `@sha256:<64 hex>` taşır
//      (`${ARG}` ise ARG varsayılanı ölçülür); `scratch` ve önceki aşama adı serbest.
//   §2 `.github/workflows/*.yml` her `uses:` tam 40-hex commit SHA'ya sabitli
//      (yerel `./` eylem ve `docker://…@sha256:` serbest).
//   §3 Hiçbir iş akışının ÜST DÜZEY `permissions:` bloğu `write` vermez (yazma iş düzeyinde).
// Etiket yeniden işaretlenince imzalı teslimin tabanı/derleme ortamı sessizce değişir.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const KOK = join(__dirname, "..", "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}
const oku = (yol: string): string => readFileSync(join(KOK, yol), "utf8");

const DOCKERFILELAR = [
  "Teks-Erp/docker/korumali/Dockerfile",
  "deploy/satici/Dockerfile",
  "deploy/patron/Dockerfile",
] as const;
const IS_AKISI_DIZINI = ".github/workflows";
const OZET = /@sha256:[0-9a-f]{64}$/;

/** Sabitlenmemiş dış `FROM` başvuruları (boşsa temiz). */
export function fromIhlalleri(dockerfile: string): string[] {
  const argler = new Map<string, string>();
  const asamalar = new Set<string>();
  const ihlal: string[] = [];
  for (const ham of dockerfile.split("\n")) {
    const satir = ham.trim();
    const a = /^ARG\s+([A-Za-z_][A-Za-z0-9_]*)=(\S+)/.exec(satir);
    if (a) { argler.set(a[1]!, a[2]!); continue; }
    const m = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(satir);
    if (!m) continue;
    let ref = m[1]!;
    const d = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(ref);
    if (d) ref = argler.get(d[1]!) ?? `<${d[1]} varsayılansız>`;
    if (ref !== "scratch" && !asamalar.has(ref) && !OZET.test(ref)) ihlal.push(ref);
    if (m[2]) asamalar.add(m[2]);
  }
  return ihlal;
}

/** Commit SHA'ya sabitlenmemiş `uses:` başvuruları. */
export function usesIhlalleri(yaml: string): string[] {
  const ihlal: string[] = [];
  for (const m of yaml.matchAll(/^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)/gm)) {
    const ref = m[1]!;
    if (ref.startsWith("./")) continue;
    if (ref.startsWith("docker://")) { if (!OZET.test(ref)) ihlal.push(ref); continue; }
    if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(ref)) ihlal.push(ref);
  }
  return ihlal;
}

/** Üst düzey (sütun 0) `permissions:` bloğundaki yazma izinleri. */
export function ustIzinIhlalleri(yaml: string): string[] {
  const satirlar = yaml.split("\n");
  const ihlal: string[] = [];
  const i = satirlar.findIndex((l) => /^permissions:/.test(l));
  if (i < 0) return ihlal;
  if (/^permissions:\s*write-all/.test(satirlar[i]!)) return ["write-all"];
  for (let j = i + 1; j < satirlar.length && /^(\s+|$)/.test(satirlar[j]!); j++) {
    const m = /^\s+([\w-]+):\s*write\b/.exec(satirlar[j]!);
    if (m) ihlal.push(`${m[1]}: write`);
  }
  return ihlal;
}

console.log("=== §1 Dockerfile FROM özet sabitlemesi ===\n");
for (const yol of DOCKERFILELAR) {
  const icerik = oku(yol);
  const froms = icerik.split("\n").filter((l) => /^FROM\s/i.test(l.trim())).length;
  check(`§1 körlük zemini: ${yol} FROM bulundu`, froms > 0, `${froms}`);
  const ih = fromIhlalleri(icerik);
  check(`§1 ⭐ ${yol}: her dış FROM @sha256 ile sabit`, ih.length === 0, ih.join(", ") || "temiz");
}

console.log("\n=== §2–§3 iş akışları: uses SHA · üst düzey izin ===\n");
const akislar = readdirSync(join(KOK, IS_AKISI_DIZINI)).filter((f) => /\.ya?ml$/.test(f));
check("§2 körlük zemini: iş akışı bulundu", akislar.length > 0, `${akislar.length}`);
let usesSayisi = 0;
for (const f of akislar) {
  const y = oku(`${IS_AKISI_DIZINI}/${f}`);
  usesSayisi += [...y.matchAll(/^\s*(?:-\s+)?uses:/gm)].length;
  const ih = usesIhlalleri(y);
  check(`§2 ⭐ ${f}: her uses tam commit SHA`, ih.length === 0, ih.join(", ") || "temiz");
  const iz = ustIzinIhlalleri(y);
  check(`§3 ⭐ ${f}: üst düzey permissions yazma vermez`, iz.length === 0, iz.join(", ") || "temiz");
}
check("§2 körlük zemini: uses satırı sayıldı", usesSayisi > 0, `${usesSayisi}`);

console.log("\n=== Negatif sondalar (mutasyon → kırmızı) ===\n");
{
  const kor = oku(DOCKERFILELAR[0]);
  const satici = oku(DOCKERFILELAR[1]);
  const ci = oku(`${IS_AKISI_DIZINI}/ci.yml`);
  const sondalar: Array<[string, string, string, (s: string) => string[]]> = [
    ["FROM özeti söküldü", kor, kor.replace(/(FROM --platform=\S+ debian:bookworm-slim)@sha256:[0-9a-f]{64}/, "$1"), fromIhlalleri],
    ["ARG varsayılanı etikete döndü", satici, satici.replace(/(ARG NODE_IMAGE=node:24-bookworm-slim)@sha256:[0-9a-f]{64}/, "$1"), fromIhlalleri],
    ["uses etikete döndü", ci, ci.replace(/(uses: actions\/checkout)@[0-9a-f]{40}/, "$1@v4"), usesIhlalleri],
    ["uses kısa SHA", ci, ci.replace(/(uses: actions\/checkout@[0-9a-f]{7})[0-9a-f]{33}/, "$1"), usesIhlalleri],
    ["üst düzeye yazma izni", ci, ci.replace(/^permissions:\n  contents: read\n/m, "permissions:\n  contents: read\n  pull-requests: write\n"), ustIzinIhlalleri],
  ];
  for (const [ad, once, sonra, olc] of sondalar) {
    const uygulandi = once !== sonra;
    check(`sonda: ${ad} → kırmızı`, uygulandi && olc(sonra).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail ? 1 : 0;
