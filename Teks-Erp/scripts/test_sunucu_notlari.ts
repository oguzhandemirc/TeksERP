// =============================================================================
// BEKÇİ — panelde SUNUCU NOTLARI yutulmaz (S1b, 2026-09-25)
// Çalıştır: npx tsx scripts/run-all-tests.ts sunucu_notlari
// =============================================================================
// Sınıf: sunucunun engel olmayan notu (`ApiResponse.warnings`) ya da kendi sonuç
// cümlesi (`message`) mutation'ın onSuccess'inde yutuluyordu; kullanıcı etkiyi hiçbir
// ekranda görmüyordu. Ölçüldü 2026-09-25 (TS tip denetleyicisi, tsconfig.web): 312 useMutation'ın 242'si zarf döndürüyor, 230'u
// `warnings`i okumuyordu. Çözüm site site değil SINIF düzeyinde: `App.tsx` →
// `MutationCache.onSuccess` her zarfın uyarısını ortak yardımcıdan basar
// (Electron/src/lib/serverNotes.ts).
//   §1 genel basım bağlı (App QueryClient `mutationCache: createServerNotesMutationCache()` → `showMutationWarnings`)
//   §2 TEK KAYNAK: `toast.warning` ile uyarı döngüsü yalnız serverNotes.ts'te
//   §3 uyarıyı sayfa içinde gösteren mutation `meta: SERVER_WARNINGS_HANDLED` taşır
//      (zarfın `.warnings`ini okuyan onSuccess; `.data.warnings` alan verisidir, sayılmaz)
//   §4 sunucu mesajını yutan 13 uç (beyan) yardımcıyı çağırıyor — ölü satır da kırmızı
//   ⓘ SINIR: zarfı servis katmanında soyan (`.data.data` döndüren) yazma fonksiyonları
//      uyarıyı genel basıma hiç ulaştırmaz — sayı ve adlar basılır (ayrı iş).
//
// NEGATİF SONDA ✓K5 (§5, her koşumda) + ✓B3 (koşuldu 2026-09-25, geri alındı):
//   B1 App.tsx'ten `mutationCache` silindi → §1 ❌ · B2 bir onSuccess'e meta'sız
//   `res.warnings` okuması → §3 ❌ · B3 bir dosyaya `for (w of res.warnings) toast.warning(w)` → §2 ❌.
//
// DB GEREKTİRMEZ: TypeScript AST (yorum sayılmaz).
// =============================================================================
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const DEPO = join(__dirname, "..", "..");
const ELECTRON_SRC = join(DEPO, "Electron", "src");
const YARDIMCI = "Electron/src/lib/serverNotes.ts";
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

/** Sunucu mesajını yutan uçların sitesi (1e listesi, 2026-09-25) — yardımcıyı çağırmalı. */
const MESAJ_SITELERI = [
  "Electron/src/pages/Operations/GoodsReceipts/GoodsReceiptDetailSheet.tsx",
  "Electron/src/pages/Finance/InvoiceReceiptsSection.tsx",
  "Electron/src/pages/Operations/PurchaseOrders/PurchaseOrderDetailSheet.tsx",
  "Electron/src/pages/Operations/SackContentEdit/WeighSackDialog.tsx",
  "Electron/src/pages/Operations/SackContentEdit/useSackWeighAction.ts",
  "Electron/src/pages/Operations/Rolls/QuickShipDialog.tsx",
  "Electron/src/pages/Operations/AccountingDispatch/InvoiceDialog.tsx",
  "Electron/src/pages/Operations/WorkOrders/WorkOrderFormPage.tsx",
  "Electron/src/pages/Operations/Rolls/ReworkRollsDialog.tsx",
  "Electron/src/pages/Operations/SackStore/DispatchConfirmDialog.tsx",
  "Electron/src/pages/Operations/SackContentEdit/CreateShipmentDialog.tsx",
  "Electron/src/pages/Operations/WorkOrders/LinkOrderDialog.tsx",
];
const YARDIMCI_CAGRISI = /\b(toastServerSuccess|serverSuccessText|showServerWarnings)\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", "__tests__"].includes(e.name)) walk(abs, out); }
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(abs);
  }
  return out;
}

const kaynak = (s: string) => ts.createSourceFile("x.tsx", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const zarfUyarisi = (n: ts.Node): boolean =>
  ts.isPropertyAccessExpression(n) && n.name.text === "warnings" &&
  !(ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "data");

/** §2 — `toast.warning` çağıran, uyarı listesi üzerinde dönen döngü sayısı. SAF. */
export function uyariDongusu(src: string): number {
  let n = 0;
  const icindeToastWarning = (x: ts.Node): boolean => {
    let v = false;
    const g = (y: ts.Node): void => {
      if (ts.isCallExpression(y) && y.expression.getText() === "toast.warning") v = true;
      ts.forEachChild(y, g);
    };
    g(x);
    return v;
  };
  const gez = (x: ts.Node): void => {
    if (ts.isForOfStatement(x) && /\bwarnings\b|[Ww]arnings\(/.test(x.expression.getText()) && icindeToastWarning(x.statement)) n++;
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && ["forEach", "map"].includes(x.expression.name.text) &&
      /\bwarnings\b/.test(x.expression.expression.getText()) && x.arguments.some(icindeToastWarning)) n++;
    ts.forEachChild(x, gez);
  };
  gez(kaynak(src));
  return n;
}

/** §3 — useMutation seçenek nesnesinde meta'sız zarf `.warnings` okuması sayısı. SAF. */
export function metasizOkuma(src: string): number {
  let n = 0;
  const gez = (x: ts.Node): void => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "useMutation") {
      const obj = x.arguments[0];
      if (obj && ts.isObjectLiteralExpression(obj)) {
        const meta = obj.properties.find((p) => p.name?.getText() === "meta");
        const isaretli = !!meta && /SERVER_WARNINGS_HANDLED|serverWarnings/.test(meta.getText());
        let okuma = false;
        const tara = (y: ts.Node): void => {
          if (zarfUyarisi(y)) {
            const ust = y.parent;
            const yardimciya = ts.isCallExpression(ust) && ust.expression.getText() === "showServerWarnings";
            if (!yardimciya) okuma = true;
          }
          ts.forEachChild(y, tara);
        };
        for (const p of obj.properties) if (p.name?.getText() !== "mutationFn") tara(p);
        if (okuma && !isaretli) n++;
      }
    }
    ts.forEachChild(x, gez);
  };
  gez(kaynak(src));
  return n;
}

/** ⓘ — zarfı soyan yazma fonksiyonu: apiClient.post/put/patch/delete + `.data.data` dönüşü. SAF. */
export function zarfSoyanlar(src: string): string[] {
  const out: string[] = [];
  const gez = (x: ts.Node, ad: string | null): void => {
    let yeniAd = ad;
    if ((ts.isFunctionDeclaration(x) || ts.isMethodDeclaration(x)) && x.name) yeniAd = x.name.getText();
    if ((ts.isPropertyAssignment(x) || ts.isVariableDeclaration(x)) && x.initializer &&
      (ts.isArrowFunction(x.initializer) || ts.isFunctionExpression(x.initializer))) yeniAd = x.name.getText();
    if ((ts.isArrowFunction(x) || ts.isFunctionDeclaration(x) || ts.isMethodDeclaration(x) || ts.isFunctionExpression(x)) && yeniAd) {
      const govde = x.getText();
      if (/apiClient\s*\.\s*(post|put|patch|delete)\b/.test(govde) && /\bdata\??\.data\b/.test(govde) && !out.includes(yeniAd)) out.push(yeniAd);
      return;
    }
    ts.forEachChild(x, (y) => gez(y, yeniAd));
  };
  gez(kaynak(src), null);
  return out;
}

function main(): void {
  console.log("=== SUNUCU NOTLARI (panel) ===\n");
  const dosyalar = walk(ELECTRON_SRC);
  const rel = (f: string) => relative(DEPO, f);
  check("§0 körlük zemini: Electron taraması dolu", dosyalar.length > 500, `${dosyalar.length} dosya`);

  // §1
  const app = readFileSync(join(ELECTRON_SRC, "App.tsx"), "utf8");
  const yard = existsSync(join(DEPO, YARDIMCI)) ? readFileSync(join(DEPO, YARDIMCI), "utf8") : "";
  check("§1 ⭐ QueryClient genel basıma bağlı (createServerNotesMutationCache → showMutationWarnings)",
    /mutationCache:\s*createServerNotesMutationCache\(\)/.test(app) && /new MutationCache\(/.test(yard) &&
      /showMutationWarnings\(\s*data\s*,\s*mutation\.meta\s*\)/.test(yard) &&
      /export function showMutationWarnings\(/.test(yard) && /export const SERVER_WARNINGS_HANDLED/.test(yard));

  // §2 · §3 · ⓘ
  const donguler: string[] = [];
  const metasiz: string[] = [];
  const soyanlar: string[] = [];
  for (const f of dosyalar) {
    const s = readFileSync(f, "utf8");
    if (rel(f) !== YARDIMCI) { const d = uyariDongusu(s); if (d) donguler.push(`${rel(f)} (${d})`); }
    const m = metasizOkuma(s); if (m) metasiz.push(`${rel(f)} (${m})`);
    if (/service/i.test(f)) for (const z of zarfSoyanlar(s)) soyanlar.push(`${rel(f).replace("Electron/src/", "")}#${z}`);
  }
  check("§2 ⭐ uyarı döngüsü (toast.warning) yalnız serverNotes.ts'te — tek kaynak", donguler.length === 0, donguler.join(" · "));
  check("§3 ⭐ zarf uyarısını kendi okuyan her mutation `meta: SERVER_WARNINGS_HANDLED` taşır (çift gösterim yok)",
    metasiz.length === 0, metasiz.join(" · "));

  // §4
  const olu = MESAJ_SITELERI.filter((f) => !existsSync(join(DEPO, f)));
  const yardimcisiz = MESAJ_SITELERI.filter((f) => existsSync(join(DEPO, f)) && !YARDIMCI_CAGRISI.test(readFileSync(join(DEPO, f), "utf8")));
  check("§4 ⭐ sunucu mesajını yutan 13 uç yardımcıyı çağırıyor (ölü satır yok)", olu.length === 0 && yardimcisiz.length === 0,
    [...olu.map((f) => `YOK: ${f}`), ...yardimcisiz.map((f) => `yardımcısız: ${f}`)].join(" · ") || `${MESAJ_SITELERI.length} dosya`);

  console.log(`   ⓘ SINIR — POST/PUT/PATCH/DELETE çağırıp \`data.data\` döndüren servis fonksiyonu (önizleme POST'ları dahil): ${soyanlar.length} — uyarıları genel basıma ulaşmaz; ayrı iş`);
  for (const z of soyanlar) console.log(`      · ${z}`);

  // §5 sondalar
  console.log("\n=== §5 SONDALAR (saf yüklem) ===");
  check("§5a ⭐ for-of + toast.warning döngüsü sayılır", uyariDongusu("for (const w of res.warnings ?? []) toast.warning(w);") === 1);
  check("§5b ⭐ .warnings.forEach(toast.warning) sayılır", uyariDongusu("r.data.warnings.forEach((w) => toast.warning(w));") === 1);
  check("§5c ⭐ meta'sız zarf okuması sayılır, meta'lı ve `.data.warnings` sayılmaz",
    metasizOkuma("useMutation({ mutationFn: f, onSuccess: (r) => setW(r.warnings) })") === 1 &&
      metasizOkuma("useMutation({ meta: SERVER_WARNINGS_HANDLED, mutationFn: f, onSuccess: (r) => setW(r.warnings) })") === 0 &&
      metasizOkuma("useMutation({ mutationFn: f, onSuccess: (r) => g(r.data.warnings) })") === 0);
  check("§5d showServerWarnings(r.warnings) meta gerektirmez (WeakSet tek basım)",
    metasizOkuma("useMutation({ mutationFn: f, onSuccess: (r) => showServerWarnings(r.warnings) })") === 0);
  check("§5e zarf soyan tanınır, soymayan tanınmaz",
    zarfSoyanlar("export async function a() { const { data } = await apiClient.post('/x'); return data.data.y; }").join() === "a" &&
      zarfSoyanlar("export async function b() { const r = await apiClient.post('/x'); return r.data; }").length === 0);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
