// =============================================================================
// AYAR ŞİFRESİ — İSTEMCİ ÇAĞIRANLARI (2026-09-23): kapılı uç ↔ sarmalayıcı, iki yönlü, keşifle
// =============================================================================
// NEDEN: backend ucu `requireSettingsPassword` taşır ama panel çağıranı `withSettingsPassword`tan
// geçmezse `apiClient` o 403'ün toast'ını bilerek bastırdığı için kullanıcı HİÇBİR ŞEY görmez — ne
// pencere ne hata; "Kaydet hiçbir şey yapmıyor" (canlı ölçüldü: numaralandırmanın üç yazma ucu).
// `test_settings_password §J` kapının BACKEND'de düşmesini ölçer; bu dosya İSTEMCİ ayağını ölçer.
//
// KEŞİF (uç listesi elle YAZILMAZ): `src/app.ts`teki `app.use("<önek>", <router>)` bağları + router
// dosyalarında `router.<metot>("<yol>", …, requireSettingsPassword, …)`. İstemci: Electron/src ve
// mobil/src'de `apiClient.<metot>(<url>, …)` çağrıları (mobil baseURL `/api` içerir).
//
// ÜÇ SONUÇ: uyumlu · ihlal · ÖLÇÜLEMEDİ (ikisi de KIRMIZI):
//   §1 kapılı uca giden panel çağrısı `withSettingsPassword(…)` içinde ve `headers`ı config'e koyuyor
//   §2 tablet kapılı uca GİTMEZ (diyaloğu yok — gitse 403 sessiz düşer)
//   §3 ölü eşleme: kapılı uç çağıransız (muaf gerekçeli) · sarmalayıcının içinde kapılı uca giden çağrı yok
//   §4 ÖLÇÜLEMEDİ: kapının router düzeyinde (`router.use`) ya da sabit-dışı yolda kullanımı · bağı
//      çözülemeyen router · kapılı öneki taşıyan ama çözülemeyen istemci URL'i
// ⛔ ÖLÇEMEDİKLERİ (basılır): başka bir sarmalayıcı (`crudService`) üzerinden, kapılı önek HİÇ geçmeden
//   kurulan URL'ler; tanınmayan HTTP istemcisi (fetch/axios doğrudan) — kapılı önek dizgesi görülürse §4.
// NEGATİF SONDALAR (2026-09-23): numaralandırma sayaç çağrısından sarmalayıcı kaldırıldı → §1 ❌ ·
//   `/source` ucundan `requireSettingsPassword` kaldırıldı → §3b (ölü sarmalayıcı) ❌ ·
//   `router.use(requireSettingsPassword)` eklendi → §4 ÖLÇÜLEMEDİ ❌.
// KOŞULLU KAPI (2026-09-23, ca D6 config-bundle apply): BEYANLI (`CONDITIONAL_GATES`) ve yapısal doğrulanan
//   yerel fonksiyon route'a takılıysa uç kapılı (koşullu) sayılır — panel çağıranı yine sarmalayıcıdan geçer
//   (sunucu içeriğe göre isteyebilir; istemezse sarmalayıcı sıfır fark). Sondalar: ara fonksiyondan çağrı
//   kaldırıldı → §3b + §3c ❌ · beyan silindi → §4 ÖLÇÜLEMEDİ + §3b ❌.
// DB'siz — yalnız dosya okur.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const BACKEND = path.resolve(__dirname, "..");
const REPO = path.resolve(BACKEND, "..");
const GATE = "requireSettingsPassword";
const WRAPPER = "withSettingsPassword";
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
/**
 * İÇERİĞE BAĞLI (koşullu) kapılar — BEYANLI: `<routes dosyası>#<yerel fonksiyon>` → gerekçe. İçeriğe bağlı
 * kapı şifreyi ATLAYAN bir yoldur (belge-only muafiyetinin `.every`→`.some` kaçağı emsali), yenisi sessiz
 * kabul edilmez. Beyan YAPISAL doğrulanır: fonksiyon o dosyada var, gövdesi `requireSettingsPassword(`
 * çağırıyor ve bir route'a middleware olarak takılı — biri tutmazsa kırmızı. Beyansız ama çağrı içeren
 * ara fonksiyon §4 ÖLÇÜLEMEDİ.
 */
const CONDITIONAL_GATES: Record<string, string> = {
  "config-bundle.routes.ts#requirePasswordForGatedKinds":
    "yapılandırma paketi yalnız şifre kapılı türü (NUMBER_SERIES) taşıyorsa şifre ister — " +
    "diğer türlerin kendi uçlarında kapı yok",
};
/** Kapılı ama panelden çağrılmayan uç — gerekçeli, iki yönlü (kullanılmayan muaf da kırmızı). */
const NO_CALLER_EXEMPT: Record<string, string> = {};

interface GatedRoute { method: string; path: string; where: string; conditional: boolean }
interface ClientCall { method: string; pattern: string[] | null; raw: string; where: string; wrapped: boolean; passesHeaders: boolean; wrapperId: number | null; mobile: boolean }

const unmeasurable: string[] = [];

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
const lineOf = (sf: ts.SourceFile, n: ts.Node) => `${path.relative(REPO, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
const joinPath = (a: string, b: string) => ("/" + [a, b].join("/")).replace(/\/+/g, "/").replace(/(.)\/$/, "$1");

/** app.ts: router import adı → dosya; `app.use("<önek>", …, <router>)` → önek. */
function mountPrefixes(): Map<string, string[]> {
  const sf = parse(path.join(BACKEND, "src/app.ts"));
  const importFile = new Map<string, string>();
  const byFile = new Map<string, string[]>();
  sf.forEachChild((n) => {
    if (ts.isImportDeclaration(n) && n.importClause?.name && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.startsWith("./routes/")) {
      importFile.set(n.importClause.name.text, path.join(BACKEND, "src", n.moduleSpecifier.text.slice(2) + ".ts"));
    }
  });
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "use" && n.expression.expression.getText(sf) === "app") {
      const [first] = n.arguments;
      const routers = n.arguments.filter((a) => ts.isIdentifier(a) && importFile.has(a.text)) as ts.Identifier[];
      for (const r of routers) {
        const file = importFile.get(r.text)!;
        if (!first || !ts.isStringLiteral(first)) unmeasurable.push(`app.use önek sabit değil: ${lineOf(sf, n)}`);
        else byFile.set(file, [...(byFile.get(file) ?? []), first.text]);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return byFile;
}

function gatedRoutes(): GatedRoute[] {
  const prefixes = mountPrefixes();
  const out: GatedRoute[] = [];
  const dir = path.join(BACKEND, "src/routes");
  const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts")).map((f) => path.join(dir, f));
  for (const file of files) {
    if (!fs.readFileSync(file, "utf8").includes(GATE)) continue;
    const sf = parse(file);
    const accounted = new Set<ts.Node>();
    const conditional = conditionalGates(sf, accounted, path.relative(path.join(BACKEND, "src/routes"), file));
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const m = n.expression.name.text;
        const gateArg = n.arguments.find((a) => ts.isIdentifier(a) && (a.text === GATE || conditional.has(a.text)));
        if (gateArg && ts.isIdentifier(gateArg)) {
          accounted.add(gateArg);
          const isConditional = gateArg.text !== GATE;
          if (isConditional) conditionalAttached.add(`${path.relative(path.join(BACKEND, "src/routes"), file)}#${gateArg.text}`);
          const [first] = n.arguments;
          const pre = prefixes.get(file);
          if (!METHODS.has(m)) unmeasurable.push(`kapı router düzeyinde (${m}): ${lineOf(sf, n)}`);
          else if (!first || !ts.isStringLiteral(first)) unmeasurable.push(`kapılı yol sabit değil: ${lineOf(sf, n)}`);
          else if (!pre?.length) unmeasurable.push(`router app.ts'te bağlı değil/çözülemedi: ${path.relative(REPO, file)}`);
          else for (const p of pre) out.push({ method: m, path: joinPath(p, first.text), where: lineOf(sf, n), conditional: isConditional });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    // Kapının başka biçimde kullanımı (dizi, sarmalayıcı, koşullu) → ölçülemez.
    const scanRefs = (n: ts.Node): void => {
      const isGateName = n.kind === ts.SyntaxKind.Identifier && ((n as ts.Identifier).text === GATE || conditional.has((n as ts.Identifier).text));
      const isDeclName = conditional.get((n as ts.Identifier).text) === n;
      if (isGateName && !accounted.has(n) && !isDeclName && !ts.isImportSpecifier(n.parent)) unmeasurable.push(`kapının tanınmayan kullanımı: ${lineOf(sf, n)}`);
      ts.forEachChild(n, scanRefs);
    };
    scanRefs(sf);
  }
  return out;
}

/**
 * İÇERİĞE BAĞLI kapı — aynı dosyada tanımlı, gövdesinde `requireSettingsPassword(` ÇAĞRISI olan yerel
 * fonksiyon (ad değil YAPI): route'a middleware olarak takılınca uç "şifre kapılı (koşullu)" sayılır.
 * Gövdedeki çağrı hesaba yazılır; fonksiyonun başka biçimde kullanımı `scanRefs`te ÖLÇÜLEMEDİ olur.
 */
const conditionalSeen = new Set<string>();
const conditionalAttached = new Set<string>();
function conditionalGates(sf: ts.SourceFile, accounted: Set<ts.Node>, relFile: string): Map<string, ts.Identifier> {
  const out = new Map<string, ts.Identifier>();
  const callsGate = (body: ts.Node): ts.Identifier[] => {
    const found: ts.Identifier[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === GATE) found.push(n.expression);
      ts.forEachChild(n, walk);
    };
    walk(body);
    return found;
  };
  const consider = (name: ts.Identifier, body: ts.Node | undefined): void => {
    if (!body) return;
    const calls = callsGate(body);
    if (calls.length === 0) return;
    const key = `${relFile}#${name.text}`;
    if (!CONDITIONAL_GATES[key]) return; // beyansız: çağrı hesaba yazılmaz → scanRefs ÖLÇÜLEMEDİ der
    conditionalSeen.add(key);
    out.set(name.text, name);
    for (const c of calls) accounted.add(c);
  };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) consider(st.name, st.body);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) consider(d.name, d.initializer.body);
      }
    }
  }
  return out;
}

/** Dosya düzeyindeki `const X = "…"` sabitleri — `BASE` kalıbındaki URL'ler çözülsün. */
function fileConstants(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer && (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer))) out.set(d.name.text, d.initializer.text);
    }
  }
  return out;
}

/** URL argümanı → yol segmentleri ('*' = dinamik); çözülemezse null. Aynı dosyadaki dizge sabitleri çözülür. */
function urlPattern(arg: ts.Expression, consts: Map<string, string>, mobile: boolean): string[] | null {
  let text: string | null = null;
  const constOf = (e: ts.Expression) => (ts.isIdentifier(e) ? consts.get(e.text) ?? null : null);
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) text = arg.text;
  else if (ts.isIdentifier(arg)) text = constOf(arg);
  else if (ts.isTemplateExpression(arg)) {
    const parts = [arg.head.text];
    for (const sp of arg.templateSpans) {
      const c = constOf(sp.expression);
      parts.push(c ?? "\u0000", sp.literal.text);
    }
    text = parts.join("");
    if (text.startsWith("\u0000")) return null; // başı dinamik: önek bilinmez
  }
  if (text == null) return null;
  let p = text.split("?")[0]!;
  if (mobile && p.startsWith("/")) p = "/api" + p;
  return p.split("/").filter(Boolean).map((seg) => (seg.includes("\u0000") ? "*" : seg));
}

function matches(route: GatedRoute, call: ClientCall): boolean {
  if (!call.pattern || route.method !== call.method) return false;
  const r = route.path.split("/").filter(Boolean);
  if (r.length !== call.pattern.length) return false;
  return r.every((seg, i) => seg.startsWith(":") || call.pattern![i] === "*" || call.pattern![i] === seg);
}

let wrapperSeq = 0;
function clientCalls(root: string, mobile: boolean, gatedPrefixes: string[]): { calls: ClientCall[]; wrappers: Map<number, string>; files: number } {
  const calls: ClientCall[] = [];
  const wrappers = new Map<number, string>();
  const dir = path.join(REPO, root);
  if (!fs.existsSync(dir)) {
    unmeasurable.push(`istemci ağacı yok: ${root}`);
    return { calls, wrappers, files: 0 };
  }
  const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f) && !/\.test\.|__tests__|\.d\.ts$/.test(f));
  for (const rel of files) {
    const sf = parse(path.join(dir, rel));
    const consts = fileConstants(sf);
    const visit = (n: ts.Node, wrapperId: number | null, headersParam: string | null): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === WRAPPER) {
        const fn = n.arguments[0];
        const id = ++wrapperSeq;
        wrappers.set(id, lineOf(sf, n));
        const param = fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.parameters[0] && ts.isIdentifier(fn.parameters[0].name) ? fn.parameters[0].name.text : null;
        ts.forEachChild(n, (c) => visit(c, id, param));
        return;
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && METHODS.has(n.expression.name.text) && /apiClient$/.test(n.expression.expression.getText(sf))) {
        const method = n.expression.name.text;
        const arg = n.arguments[0];
        const pattern = arg ? urlPattern(arg, consts, mobile) : null;
        const cfgIdx = method === "get" || method === "delete" ? 1 : 2;
        const cfg = n.arguments[cfgIdx];
        const passesHeaders = !!(headersParam && cfg && ts.isObjectLiteralExpression(cfg) && cfg.properties.some((p) =>
          (ts.isShorthandPropertyAssignment(p) && p.name.text === "headers" && headersParam === "headers") ||
          (ts.isPropertyAssignment(p) && p.name.getText(sf) === "headers" && p.initializer.getText(sf) === headersParam)));
        const raw = arg ? arg.getText(sf).slice(0, 80) : "(argümansız)";
        if (!pattern && gatedPrefixes.some((pre) => sf.text.includes(`"${pre}`) || sf.text.includes(`\`${pre}`) || sf.text.includes(`'${pre}`))) {
          unmeasurable.push(`URL çözülemedi, dosya kapılı önek taşıyor: ${lineOf(sf, n)} ${raw}`);
        }
        calls.push({ method, pattern, raw, where: lineOf(sf, n), wrapped: wrapperId != null, passesHeaders, wrapperId, mobile });
      }
      ts.forEachChild(n, (c) => visit(c, wrapperId, headersParam));
    };
    visit(sf, null, null);
  }
  return { calls, wrappers, files: files.length };
}

function main(): void {
  console.log("=== AYAR ŞİFRESİ — İSTEMCİ ÇAĞIRANLARI ===\n");
  const routes = gatedRoutes();
  const prefixes = [...new Set(routes.map((r) => "/" + r.path.split("/").filter(Boolean).slice(0, 2).join("/")))];
  const mobilePrefixes = prefixes.map((p) => p.replace(/^\/api/, ""));
  const panel = clientCalls("Electron/src", false, prefixes);
  const tablet = clientCalls("mobil/src", true, mobilePrefixes);
  const all = [...panel.calls, ...tablet.calls];

  console.log("── §0 Körlük zemini ──");
  check("§0a kapılı uç keşfedildi (≥ 5)", routes.length >= 5, routes.map((r) => `${r.method.toUpperCase()} ${r.path}${r.conditional ? " (koşullu)" : ""}`).join(" · "));
  check("§0b panel apiClient çağrısı tarandı (≥ 300)", panel.calls.length >= 300, `${panel.calls.length} çağrı / ${panel.files} dosya`);
  check("§0c tablet apiClient çağrısı tarandı (≥ 50)", tablet.calls.length >= 50, `${tablet.calls.length} çağrı / ${tablet.files} dosya`);

  console.log("\n── §1 Panel: kapılı uca giden her çağrı sarmalayıcıdan geçer ve başlığı iletir ──");
  const bad: string[] = [];
  for (const c of panel.calls) {
    const r = routes.find((x) => matches(x, c));
    if (!r) continue;
    if (!c.wrapped) bad.push(`${c.where} ${c.method.toUpperCase()} ${c.raw} → ${r.path} SARMALAYICISIZ`);
    else if (!c.passesHeaders) bad.push(`${c.where} ${c.method.toUpperCase()} ${c.raw} → ${r.path} sarmalayıcıda ama \`headers\` config'e konmuyor`);
  }
  check("§1 ⭐ sarmalayıcısız ya da başlıksız kapılı çağrı YOK", bad.length === 0, bad.join("\n     "));

  console.log("\n── §2 Tablet kapılı uca gitmez ──");
  const tabletHits = tablet.calls.filter((c) => routes.some((r) => matches(r, c))).map((c) => `${c.where} ${c.method.toUpperCase()} ${c.raw}`);
  check("§2 tablette kapılı uca giden çağrı YOK (diyaloğu yok)", tabletHits.length === 0, tabletHits.join("\n     "));

  console.log("\n── §3 Ölü eşleme (iki yönlü) ──");
  const noCaller = routes.filter((r) => !panel.calls.some((c) => matches(r, c))).map((r) => `${r.method.toUpperCase()} ${r.path}`);
  const unexempt = noCaller.filter((k) => !NO_CALLER_EXEMPT[k]);
  const staleExempt = Object.keys(NO_CALLER_EXEMPT).filter((k) => !noCaller.includes(k));
  check("§3a ⭐ her kapılı ucun en az bir panel çağıranı var (muaf gerekçeli)", unexempt.length === 0, unexempt.join(" · "));
  check("§3a' muaf listesi bayat değil", staleExempt.length === 0, staleExempt.join(" · "));
  const deadWrappers = [...panel.wrappers.entries()].filter(([id]) => !panel.calls.some((c) => c.wrapperId === id && routes.some((r) => matches(r, c)))).map(([, w]) => w);
  check("§3b ⭐ her sarmalayıcı kapılı bir uca gidiyor (ölü sarmalayıcı yok)", deadWrappers.length === 0, deadWrappers.join(" · "));

  const declared = Object.keys(CONDITIONAL_GATES);
  const notFound = declared.filter((k) => !conditionalSeen.has(k));
  const notAttached = declared.filter((k) => conditionalSeen.has(k) && !conditionalAttached.has(k));
  check("§3c ⭐ her koşullu kapı beyanı yapısal olarak doğru (fonksiyon var + gövdesi kapıyı çağırıyor)", notFound.length === 0, notFound.join(" · "));
  check("§3c' her koşullu kapı bir route'a middleware olarak takılı (ölü beyan yok)", notAttached.length === 0, notAttached.join(" · "));

  console.log("\n── §4 ÖLÇÜLEMEDİ ──");
  check("§4 ⭐ ölçülemeyen durum YOK (varsa kırmızı — sessiz 'temiz' değil)", unmeasurable.length === 0, unmeasurable.join("\n     "));
  console.log("\nℹ️  Ölçmediği: kapılı önek hiç geçmeden başka bir sarmalayıcıyla (ör. crudService) kurulan URL · fetch/axios doğrudan çağrı.");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
