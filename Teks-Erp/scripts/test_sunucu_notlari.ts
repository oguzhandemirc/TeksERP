// =============================================================================
// BEKÇİ — panelde SUNUCU NOTLARI yutulmaz (S1b + SINIR, 2026-09-25)
// Çalıştır: npx tsx scripts/run-all-tests.ts sunucu_notlari
// =============================================================================
// Sınıf: sunucunun engel olmayan notu (`ApiResponse.warnings`) ya da kendi sonuç
// cümlesi (`message`) yutuluyordu. Ölçüldü 2026-09-25 (TS tip denetleyicisi,
// tsconfig.web): 312 useMutation'ın 242'si zarf döndürüyor, 230'u `warnings`i okumuyordu;
// ayrıca 20 servis fonksiyonu zarfı soyuyordu. Sınıf EN ALT katta kapatıldı: apiClient'ın
// yanıt interceptor'ı her başarılı YAZIM yanıtının (POST/PUT/PATCH/DELETE) uyarısını ortak
// yardımcıdan (Electron/src/lib/serverNotes.ts) basar — servis zarfı soysa da, istek
// mutation dışında gitse de. TEK mekanizma: MutationCache'te ikinci basım yok.
//   §1 interceptor bağlı ∧ ikinci basım yolu (MutationCache → showServerWarnings) YOK
//   §2 TEK KAYNAK: `toast.warning` ile uyarı döngüsü yalnız serverNotes.ts'te
//   §3 zarf uyarısını sayfa İÇİNDE gösteren her yer beyanlı ve isteği `serverWarnings:
//      "handled"` taşıyor (çift gösterim yok)
//   §4 sunucu mesajını yutan uçların sitesi yardımcıyı çağırıyor (beyan listesi)
//   §5 OTOMATİK YAZIM ENVANTERİ: kullanıcı eylemi olmadan (queryFn · useEffect · timer)
//      giden yazım beyanlı; beyansız doğan kırmızı; zarfa uyarı basan `serverWarnings` taşır
//
// NEGATİF SONDA ✓K7 (§6, her koşumda) + ✓B4 (koşuldu 2026-09-25, geri alındı):
//   B1 interceptor satırı silindi → §1 ❌ · B2 App'e MutationCache basımı geri kondu → §1 ❌ ·
//   B3 yeni bir queryFn'e yazım çağrısı eklendi → §5a ❌ · B4 createShipment'tan bayrak
//   kaldırıldı → §3 ❌.
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

/**
 * `.warnings` okuyan ama ZARF değil ALAN verisi okuyan yer (servis zarfı soyar; interceptor
 * zarfı ayrıca basar, çift gösterim olmaz). Yeni satır gerekçesiyle.
 */
const ALAN_VERISI: readonly { dosya: string; gerekce: string }[] = [
  { dosya: "Electron/src/pages/System/Backups/OffsiteBackupCard.tsx",
    gerekce: "sweepOffsiteNow `data.offsite`i döndürür; okunan `warnings` süpürme sonucunun alanıdır, başarısızlıkta hata olarak gösterilir" },
];

/** Zarf uyarısını sayfa içinde gösteren yer → isteği yapan servis fonksiyonu (`handled` taşımalı). */
const SAYFA_ICI: readonly { dosya: string; servis: string; gerekce: string }[] = [
  { dosya: "Electron/src/pages/Operations/SackContentEdit/CreateShipmentDialog.tsx", servis: "sackHubService.createShipment",
    gerekce: "\"bu sevkiyat hiçbir siparişe yazılmadı\" bir düzeltme çağrısı — tost 4 sn'de kaybolur, liste okunur" },
  { dosya: "Electron/src/pages/GeneralSettings/Numbering/useNumberingDraft.ts", servis: "numberingService.preview",
    gerekce: "yazarken çağrılan önizleme: \"etikete SIĞMIYOR\" önizlemenin altında satır içi, her tuşta tost olmaz" },
];

type Sinif = "PREVIEW_ON_TYPING" | "PREVIEW_ON_OPEN" | "AUTOSAVE" | "BOOT" | "TIMER";
/**
 * Kullanıcı eylemi olmadan giden yazımlar (alt ajan envanteri 2026-09-25, 316 yazım çağrısının 19'u).
 * `zarfUyarisi`: yanıt zarfına üst düzey `warnings` basıyor mu (backend ölçüldü) — basan
 * `serverWarnings` bayrağı taşımalı, yoksa kullanıcı yazarken tost yağar.
 */
const OTOMATIK_YAZIMLAR: readonly { yer: string; sinif: Sinif; zarfUyarisi: boolean }[] = [
  { yer: "Electron/src/components/merge/MergeDialog.tsx::mergeService.preview", sinif: "PREVIEW_ON_OPEN", zarfUyarisi: false },
  { yer: "Electron/src/hooks/useDeviceAnnounce.ts::apiClient", sinif: "BOOT", zarfUyarisi: false },
  { yer: "Electron/src/pages/Definitions/DocumentTemplates/DocumentPreview.tsx::printedDocumentService.getSampleHtml", sinif: "PREVIEW_ON_TYPING", zarfUyarisi: false },
  { yer: "Electron/src/pages/Definitions/DocumentTemplates/TravelerCardPreview.tsx::workOrderService.getTravelerCardSampleHtml", sinif: "PREVIEW_ON_TYPING", zarfUyarisi: false },
  { yer: "Electron/src/pages/Definitions/TravelerCardStudio/RawHtmlEditor.tsx::travelerTemplateService.inspect", sinif: "PREVIEW_ON_TYPING", zarfUyarisi: false },
  { yer: "Electron/src/pages/GeneralSettings/Numbering/useNumberingDraft.ts::numberingService.preview", sinif: "PREVIEW_ON_TYPING", zarfUyarisi: true },
  { yer: "Electron/src/pages/LabelTemplates/RawCodePanel.tsx::labelTemplateService.previewRaw", sinif: "PREVIEW_ON_TYPING", zarfUyarisi: false },
  { yer: "Electron/src/pages/LabelTemplates/TemplatePrintPreview.tsx::labelTemplateService.canvasPreview", sinif: "PREVIEW_ON_OPEN", zarfUyarisi: false },
  { yer: "Electron/src/pages/LabelTemplates/editor/CanvasPreview.tsx::labelTemplateService.canvasPreview", sinif: "PREVIEW_ON_TYPING", zarfUyarisi: false },
  { yer: "Electron/src/pages/Operations/SackContentEdit/BulkDistributeSacksDialog.tsx::sackHubService.previewDistributeSacks", sinif: "PREVIEW_ON_OPEN", zarfUyarisi: false },
  { yer: "Electron/src/pages/Operations/SackContentEdit/ContentMismatchBanner.tsx::apiClient", sinif: "PREVIEW_ON_OPEN", zarfUyarisi: false },
  { yer: "Electron/src/pages/Operations/SackContentEdit/CreateShipmentDialog.tsx::sackHubService.previewShipment", sinif: "PREVIEW_ON_OPEN", zarfUyarisi: false },
  { yer: "Electron/src/pages/Operations/WorkOrders/CoveragePanel.tsx::workOrderService.getCoverage", sinif: "PREVIEW_ON_OPEN", zarfUyarisi: false },
  { yer: "Electron/src/pages/Operations/WorkOrders/ManualMoveModal.tsx::workOrderService.getManualMovePreview", sinif: "PREVIEW_ON_OPEN", zarfUyarisi: false },
  { yer: "Electron/src/providers/PreferencesProvider.tsx::savePreferences", sinif: "AUTOSAVE", zarfUyarisi: false },
];
/** Dedektörün GÖRMEDİĞİ (store/mutation/olay dolaylaması) ama elle izlenmiş otomatik yazımlar. */
const ELLE_IZLENEN: readonly { servis: string; sinif: Sinif; nerede: string; zarfUyarisi: boolean }[] = [
  { servis: "authService.logout", sinif: "TIMER", nerede: "store/auth.ts ← useIdleLogout · useExpiryAutoLogout", zarfUyarisi: false },
  { servis: "sackHubService.pickList", sinif: "PREVIEW_ON_OPEN", nerede: "PickListPrintDialog useEffect → fetchMut.mutate", zarfUyarisi: false },
  { servis: "markStockCountLine", sinif: "AUTOSAVE", nerede: "StockCountLines onBlur (sınırda: odak kaybı)", zarfUyarisi: false },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", "__tests__"].includes(e.name)) walk(abs, out); }
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(abs);
  }
  return out;
}
const kaynak = (s: string) => ts.createSourceFile("x.tsx", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const YAZIM = /\bapiClient\s*\.\s*(post|put|patch|delete)\b/;
const zarfUyarisiOkumasi = (n: ts.Node): boolean =>
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

/** Yazım yapan fonksiyonların anahtarı (`nesne.metot` · `fonksiyon`) → gövde metni. SAF. */
export function yazanFonksiyonlar(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const gez = (n: ts.Node, obj: string | null): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      if (ts.isObjectLiteralExpression(n.initializer)) { ts.forEachChild(n.initializer, (c) => gez(c, n.name.getText())); return; }
      if ((ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && YAZIM.test(n.initializer.getText())) out.set(n.name.getText(), n.initializer.getText());
    }
    if (ts.isFunctionDeclaration(n) && n.name && YAZIM.test(n.getText())) out.set(n.name.text, n.getText());
    if (obj && (ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n)) && n.name && YAZIM.test(n.getText())) out.set(`${obj}.${n.name.getText()}`, n.getText());
    ts.forEachChild(n, (c) => gez(c, obj && ts.isObjectLiteralExpression(n) ? obj : null));
  };
  gez(kaynak(src), null);
  return out;
}

/** §5 — otomatik bağlamda (queryFn · useEffect · timer) yazım çağrıları: `apiClient` ya da yazan anahtar. SAF. */
export function otomatikYazimlar(src: string, yazanlar: ReadonlySet<string>): string[] {
  const baglamlar: ts.Node[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const ad = n.expression.getText();
      if (/^(useQuery|useInfiniteQuery|useSuspenseQuery)$/.test(ad) && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
        const q = n.arguments[0].properties.find((p) => p.name?.getText() === "queryFn");
        if (q) baglamlar.push(q);
      }
      if (/^(useEffect|useLayoutEffect|setTimeout|setInterval|window\.setTimeout|window\.setInterval)$/.test(ad) && n.arguments[0]) baglamlar.push(n.arguments[0]);
    }
    ts.forEachChild(n, gez);
  };
  gez(kaynak(src));
  const out = new Set<string>();
  for (const b of baglamlar) {
    const tara = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const ad = n.expression.getText().replace(/\s+/g, "");
        if (/^apiClient\.(post|put|patch|delete)$/.test(ad)) out.add("apiClient");
        else if (yazanlar.has(ad)) out.add(ad);
      }
      ts.forEachChild(n, tara);
    };
    tara(b);
  }
  return [...out];
}

/** §3 — useMutation seçeneklerinde ya da yazım çağrısının `.then`inde zarf `.warnings` okuması var mı. SAF. */
export function sayfaIciOkuma(src: string, yazanlar: ReadonlySet<string>): boolean {
  let var_ = false;
  const tara = (y: ts.Node): void => {
    if (zarfUyarisiOkumasi(y)) {
      const ust = y.parent;
      if (!(ts.isCallExpression(ust) && ust.expression.getText() === "showServerWarnings")) var_ = true;
    }
    ts.forEachChild(y, tara);
  };
  const gez = (x: ts.Node): void => {
    if (ts.isCallExpression(x)) {
      const ad = x.expression.getText().replace(/\s+/g, "");
      if (ad === "useMutation" && x.arguments[0] && ts.isObjectLiteralExpression(x.arguments[0])) {
        for (const p of x.arguments[0].properties) if (p.name?.getText() !== "mutationFn") tara(p);
      }
      if (ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "then" && ts.isCallExpression(x.expression.expression) &&
        yazanlar.has(x.expression.expression.expression.getText().replace(/\s+/g, ""))) x.arguments.forEach(tara);
    }
    ts.forEachChild(x, gez);
  };
  gez(kaynak(src));
  return var_;
}

function main(): void {
  console.log("=== SUNUCU NOTLARI (panel) ===\n");
  const dosyalar = walk(ELECTRON_SRC);
  const rel = (f: string) => relative(DEPO, f);
  const metin = new Map(dosyalar.map((f) => [rel(f), readFileSync(f, "utf8")]));
  const govdeler = new Map<string, string>();
  for (const s of metin.values()) for (const [k, g] of yazanFonksiyonlar(s)) govdeler.set(k, g);
  const yazanlar = new Set(govdeler.keys());
  check("§0 körlük zemini: Electron taraması dolu", dosyalar.length > 500 && yazanlar.size > 200,
    `${dosyalar.length} dosya · ${yazanlar.size} yazım fonksiyonu`);

  // §1 — tek mekanizma, iki yönlü
  const api = metin.get("Electron/src/services/apiClient.ts") ?? "";
  const yard = metin.get(YARDIMCI) ?? "";
  const interceptorBagli = /shouldToastWarnings\(\s*response\.config\s*,\s*response\.data\s*\)\s*\)\s*showServerWarnings\(\s*response\.data/.test(api) &&
    /export function shouldToastWarnings\(/.test(yard) && /export function showServerWarnings\(/.test(yard);
  const yorumsuz = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const ikinciYol = [...metin].filter(([f, s]) => f !== YARDIMCI && /\bMutationCache\b/.test(yorumsuz(s)) && /showServerWarnings|serverNotes/.test(s)).map(([f]) => f);
  check("§1 ⭐ interceptor bağlı (shouldToastWarnings → showServerWarnings) ∧ ikinci basım yolu (MutationCache) YOK",
    interceptorBagli && ikinciYol.length === 0 && !/MutationCache/.test(yard),
    [!interceptorBagli ? "interceptor BAĞLI DEĞİL" : "", ...ikinciYol.map((f) => `ikinci yol: ${f}`)].filter(Boolean).join(" · "));

  // §2
  const donguler = [...metin].filter(([f]) => f !== YARDIMCI).map(([f, s]) => [f, uyariDongusu(s)] as const).filter(([, n]) => n > 0);
  check("§2 ⭐ uyarı döngüsü (toast.warning) yalnız serverNotes.ts'te — tek kaynak", donguler.length === 0,
    donguler.map(([f, n]) => `${f} (${n})`).join(" · "));

  // §3
  const okuyanlar = [...metin].filter(([, s]) => sayfaIciOkuma(s, yazanlar)).map(([f]) => f).sort();
  const beyanDosya = new Set(SAYFA_ICI.map((x) => x.dosya));
  const alanDosya = new Set(ALAN_VERISI.map((x) => x.dosya));
  const beyansizSayfa = okuyanlar.filter((f) => !beyanDosya.has(f) && !alanDosya.has(f));
  const oluAlan = ALAN_VERISI.filter((x) => !okuyanlar.includes(x.dosya)).map((x) => x.dosya);
  const bayraksiz = SAYFA_ICI.filter((x) => !/serverWarnings:\s*"handled"/.test(govdeler.get(x.servis) ?? "")).map((x) => x.servis);
  const oluSayfa = SAYFA_ICI.filter((x) => !okuyanlar.includes(x.dosya)).map((x) => x.dosya);
  check("§3 ⭐ zarf uyarısını sayfa içinde gösteren her yer beyanlı ve isteği `serverWarnings: \"handled\"` taşıyor",
    beyansizSayfa.length === 0 && bayraksiz.length === 0 && oluSayfa.length === 0 && oluAlan.length === 0,
    [...beyansizSayfa.map((f) => `beyansız: ${f}`), ...bayraksiz.map((s) => `bayraksız: ${s}`), ...[...oluSayfa, ...oluAlan].map((f) => `ölü: ${f}`)].join(" · ")
      || `${SAYFA_ICI.length} sayfa içi · ${ALAN_VERISI.length} alan verisi`);

  // §4
  const olu = MESAJ_SITELERI.filter((f) => !metin.has(f));
  const yardimcisiz = MESAJ_SITELERI.filter((f) => metin.has(f) && !YARDIMCI_CAGRISI.test(metin.get(f)!));
  check("§4 ⭐ sunucu mesajını yutan uçların sitesi yardımcıyı çağırıyor (ölü satır yok)", olu.length === 0 && yardimcisiz.length === 0,
    [...olu.map((f) => `YOK: ${f}`), ...yardimcisiz.map((f) => `yardımcısız: ${f}`)].join(" · ") || `${MESAJ_SITELERI.length} dosya`);

  // §5 — otomatik yazım envanteri
  const bulunan = new Set<string>();
  for (const [f, s] of metin) for (const k of otomatikYazimlar(s, yazanlar)) bulunan.add(`${f}::${k}`);
  const beyanYer = new Set(OTOMATIK_YAZIMLAR.map((x) => x.yer));
  const beyansizOto = [...bulunan].filter((y) => !beyanYer.has(y)).sort();
  const oluOto = [...beyanYer].filter((y) => !bulunan.has(y));
  check("§5a ⭐ kullanıcı eylemi olmadan giden her yazım BEYANLI (yeni otomatik POST beyansız doğamaz)", beyansizOto.length === 0,
    beyansizOto.length ? `BEYANSIZ: ${beyansizOto.join(" · ")}` : `${bulunan.size} otomatik yazım`);
  check("§5b otomatik yazım beyanında ölü satır yok", oluOto.length === 0, oluOto.join(" · "));
  const elleOlu = ELLE_IZLENEN.filter((x) => !yazanlar.has(x.servis)).map((x) => x.servis);
  check("§5c elle izlenen otomatik yazımların servisleri var", elleOlu.length === 0, elleOlu.join(" · ") || `${ELLE_IZLENEN.length} satır`);
  const servisOf = (yer: string) => yer.split("::")[1] ?? "";
  const uyariBayraksiz = [
    ...OTOMATIK_YAZIMLAR.filter((x) => x.zarfUyarisi).map((x) => servisOf(x.yer)),
    ...ELLE_IZLENEN.filter((x) => x.zarfUyarisi).map((x) => x.servis),
  ].filter((k) => !/serverWarnings:\s*"(handled|silent)"/.test(govdeler.get(k) ?? ""));
  check("§5d ⭐ zarfa uyarı basan otomatik yazım `serverWarnings` taşıyor (yazarken tost yağmaz)", uyariBayraksiz.length === 0,
    uyariBayraksiz.join(" · ") || `${OTOMATIK_YAZIMLAR.filter((x) => x.zarfUyarisi).length} uyarılı istek bayraklı`);

  // §6 sondalar
  console.log("\n=== §6 SONDALAR (saf yüklem) ===");
  const yz = new Set(["svc.preview"]);
  check("§6a ⭐ for-of + toast.warning döngüsü sayılır", uyariDongusu("for (const w of res.warnings ?? []) toast.warning(w);") === 1);
  check("§6b ⭐ .warnings.forEach(toast.warning) sayılır", uyariDongusu("r.data.warnings.forEach((w) => toast.warning(w));") === 1);
  check("§6c ⭐ yazım fonksiyonu anahtarı nesne.metot ve düz fonksiyon olarak çıkar",
    [...yazanFonksiyonlar("export const svc = { preview: () => apiClient.post('/x'), list: () => apiClient.get('/y') };\nexport async function kaydet() { return apiClient.put('/z'); }").keys()].sort().join() === "kaydet,svc.preview");
  check("§6d ⭐ queryFn · useEffect · setTimeout içindeki yazım otomatik sayılır, düğme işleyicisi sayılmaz",
    otomatikYazimlar("useQuery({ queryKey: [], queryFn: () => svc.preview(1) }); useEffect(() => { void apiClient.post('/a'); }, []); setTimeout(() => svc.preview(2), 5);", yz).sort().join() === "apiClient,svc.preview" &&
      otomatikYazimlar("const onClick = () => svc.preview(1);", yz).length === 0);
  check("§6e ⭐ sayfa içi zarf okuması: onSuccess ve yazım `.then`i sayılır; `.data.warnings` ve yardımcıya geçiş sayılmaz",
    sayfaIciOkuma("useMutation({ mutationFn: f, onSuccess: (r) => setW(r.warnings) })", yz) &&
      sayfaIciOkuma("svc.preview(1).then((p) => setW(p.warnings))", yz) &&
      !sayfaIciOkuma("useMutation({ mutationFn: f, onSuccess: (r) => g(r.data.warnings) })", yz) &&
      !sayfaIciOkuma("useMutation({ mutationFn: f, onSuccess: (r) => showServerWarnings(r.warnings) })", yz));
  check("§6f GET okuması otomatik yazım sayılmaz", otomatikYazimlar("useQuery({ queryKey: [], queryFn: () => apiClient.get('/x') });", yz).length === 0);
  check("§6g yorumdaki çağrı sayılmaz", otomatikYazimlar("useEffect(() => { /* apiClient.post('/a') */ }, []);", yz).length === 0);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
