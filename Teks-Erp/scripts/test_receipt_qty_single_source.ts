// =============================================================================
// BEKÇİ — KABUL-ANI METRAJININ TEK KAYNAĞI (AST/metin, DB'siz) — 2026-09-13
// =============================================================================
// Kural: alış faturası taslağı ve alış siparişi karşılaması topun kabul-anı
// metrajını YALNIZ `helpers/receipt-qty.helper.ts`ten okur; o iki dosyada çıplak
// `initialQty` okuması YASAK (hüküm §10.6 → §11 B). Neden mekanik: süzgeci atlayan
// bir okuyucu hata vermez — yalnız tambur geri alması sonrası fatura/karşılama
// rakamı sessizce büyür (1c ölçtü). `test_order_line_scope_single_source`
// deseninin ikizi: körlük zemini + helper gerçekten kullanılıyor + ihlal yok.
// Yüklem token bazlıdır ve üç biçimi de görür (§3 kendi sondası): property
// erişimi `r.initialQty` · `select: { initialQty: true }` · destructure.
//
// NEGATİF SONDA (2026-09-13): `purchase-order.service.ts`e `_sum: { initialQty }`
// geri konuldu → §2 kırmızı (1 ❌); helper importu silindi → §1 kırmızı; geri
// alındı (cp + sha256). POZİTİF: düzeltilmiş ağaçta 0 ❌.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const SRC = path.resolve(__dirname, "..", "src");
const HELPER_REL = path.join("services", "helpers", "receipt-qty.helper.ts");
/** Kabul-anı metrajı okuyan iki para yüzeyi — kural bu ikisinde SERT. */
const OKUYUCULAR = ["services/invoice.service.ts", "services/purchase-order.service.ts"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Yorumlar düşürülür: kural KOD hakkındadır, şerh `initialQty` diyebilir. */
function yorumsuz(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** SAF YÜKLEM — yorumsuz kodda `initialQty` tokenı geçen satır numaraları. */
function ciplakOkuma(kod: string): number[] {
  return kod
    .split("\n")
    .map((l, i) => ({ l, n: i + 1 }))
    .filter((x) => /\binitialQty\b/.test(x.l))
    .map((x) => x.n);
}

const FILES = walk(SRC);

console.log("=== 0) Körlük zemini ===");
check("kaynak ağacı tarandı (>200 dosya)", FILES.length > 200, `${FILES.length}`);
const helperPath = path.join(SRC, HELPER_REL);
check("tek kaynak dosyası duruyor", fs.existsSync(helperPath));
const helperSrc = fs.existsSync(helperPath) ? fs.readFileSync(helperPath, "utf8") : "";
check(
  "helper üç ihracı da taşıyor (receiptQtyByRollTx + receiptQtyOf + receiptQtyWarning)",
  /export async function receiptQtyByRollTx\b/.test(helperSrc) &&
    /export function receiptQtyOf\b/.test(helperSrc) &&
    /export function receiptQtyWarning\b/.test(helperSrc),
);
check(
  "helper defteri TEK LİSTEDEN okuyor (RECEIPT_QTY_REASONS ∋ ENTRY_RECEIPT; initialQty yalnız ufuk-öncesi yedek)",
  /export const RECEIPT_QTY_REASONS\b/.test(helperSrc) &&
    /RECEIPT_QTY_REASONS[^\n]*ENTRY_RECEIPT/.test(yorumsuz(helperSrc)) &&
    /reasonCode: \{ in: \[\.\.\.RECEIPT_QTY_REASONS\] \}/.test(yorumsuz(helperSrc)) &&
    /ledgerHorizonStart\(\)/.test(yorumsuz(helperSrc)),
);

console.log("\n=== 1) Helper gerçekten kullanılıyor ===");
const importers = FILES.filter(
  (f) => f !== helperPath && /from "[^"]*receipt-qty\.helper"/.test(fs.readFileSync(f, "utf8")),
).map((f) => path.relative(SRC, f));
for (const okuyucu of OKUYUCULAR) {
  check(`${okuyucu} helper'ı import ediyor`, importers.includes(okuyucu), `importers=${importers.join(",")}`);
}

console.log("\n=== 2) İki okuyucuda çıplak initialQty okuması yok ===");
for (const okuyucu of OKUYUCULAR) {
  const p = path.join(SRC, okuyucu);
  const kod = fs.existsSync(p) ? yorumsuz(fs.readFileSync(p, "utf8")) : "";
  const vuruslar = ciplakOkuma(kod);
  check(
    `${okuyucu}: kodda 'initialQty' geçmiyor`,
    kod.length > 0 && vuruslar.length === 0,
    vuruslar.map((v) => `:${v}`).join(" ") || (kod.length === 0 ? "dosya okunamadı" : ""),
  );
}

console.log("\n=== 3) Yüklemin kendi sondası — üç biçim de yakalanır, şerh yakalanmaz ===");
check("§3a property erişimi", ciplakOkuma("const q = D(r.initialQty);").length === 1);
check("§3b select biçimi", ciplakOkuma("select: { id: true, initialQty: true },").length === 1);
check("§3c destructure biçimi", ciplakOkuma("const { initialQty, itemId } = roll;").length === 1);
check("§3d _sum biçimi", ciplakOkuma("_sum: { initialQty: true },").length === 1);
check("§3e satır yorumu YAKALANMAZ", ciplakOkuma(yorumsuz("// initialQty burada şerh\nconst a = 1;")).length === 0);
check("§3f blok yorumu YAKALANMAZ", ciplakOkuma(yorumsuz("/* initialQty şerh */ const a = 1;")).length === 0);
check("§3g benzer ad YAKALANMAZ (initialQtyMeters)", ciplakOkuma("const x = r.initialQtyMeters;").length === 0);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
