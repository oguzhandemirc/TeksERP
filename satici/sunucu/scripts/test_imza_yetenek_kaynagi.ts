// =============================================================================
// İMZA YETENEK KAYNAĞI (AST, DB'siz) — HAK imza planının yeteneği TEK kaynaktan okunur ve beklenen küme teslime sızmaz.
// Hiç etkinleşmemiş kurulumun imza planı beklenen `hak-ara` ile ara imzacıya gider (`signingCapabilities`); teslim, kira,
// parmak izi ve P modeli kayıtlı kümeyi (`installationCapabilities`) ya da gövdeyi okur. src/ (lisans-protokol hariç):
//   §1 `planEntitlementSigner(…)`ın ÜÇÜNCÜ argümanı yalnız `signingCapabilities(…)`, `<açık geçersiz kılma> ??
//      signingCapabilities(…)` ya da aynı fonksiyonda bu biçimle başlatılmış bir `const` olabilir (çıplak
//      `installationCapabilities(…)` ya da literal KIRMIZI)
//   §2 imza kaynağı adları (`signingCapabilities` · `signingCapabilitySource` · `FIRST_ENTITLEMENT_EXPECTED`) yalnız izinli
//      FONKSİYONLARDA anılır: politika dosyası (tanım) · issue/önizleme/toplu basım · `prepareChange`; teslim
//      (`deliverableEntitlement`), kira, parmak izi, P görünümü, filo, tarama, kapanış, etkinleştirme İÇİNDE anılırsa KIRMIZI
//   §3 tarayıcı kör değil: plan çağrısı ≥ 4 yerde görüldü, yasak dosyalar var, sentetik sondalar ısırır
// ⭐ KALICI SONDA ✓K (her koşumda): §3b sentetik kaynakta çıplak `installationCapabilities` plan argümanı ve teslim
//    dosyasında `signingCapabilities` KIRMIZI; izinli biçimler YEŞİL.
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı; 2026-10-10): entitlement-version.service.ts `prepareChange`
//   plan argümanı `installationCapabilities(hak.kurulum)` → §1a ❌ · lease.service.ts `findEntitlementForDelivery`
//   teslim yeteneği `signingCapabilities(installation)` → §2a ❌ · `deliverableEntitlement` içine `signingCapabilities` → §2a ❌ ·
//   toplu basım varsayılanı eski `installationCapabilities` → §1a ❌ (+ test_iptal_belgesi §8c · §8d ❌).
// Koşum: npx tsx scripts/test_imza_yetenek_kaynagi.ts   (DB'ye dokunmaz)
// =============================================================================
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { kontrol, sonuc } from "./lib/test-ortam";

const SRC = path.resolve(__dirname, "..", "src");
const PLAN = "planEntitlementSigner";
const KAYNAK = "signingCapabilities";
const KAYNAK_ADLARI = new Set([KAYNAK, "signingCapabilitySource", "FIRST_ENTITLEMENT_EXPECTED"]);
/** İmza kaynağının anılabildiği yerler: dosya → izinli fonksiyonlar (`*` = dosyanın tamamı, tanım yeri). */
const IZINLI: Readonly<Record<string, readonly string[]>> = {
  "services/entitlement-policy.ts": ["*"],
  "services/entitlement-issue.service.ts": ["issueEntitlementVersion", "previewEntitlementSigner", "prepareIntermediateReissue"],
  "services/entitlement-version.service.ts": ["prepareChange"],
};
/** Teslim/kira/parmak izi/P yolları: varlıkları ölçülür (liste bayatlarsa tarayıcı kör kalmasın). */
const TESLIM_DOSYALARI = [
  "services/lease.service.ts",
  "services/lease-binding.ts",
  "services/lease-chain.ts",
  "services/fingerprint-policy.ts",
  "services/closing-lease.ts",
  "services/activation.service.ts",
  "portal/paid-through-view.ts",
  "portal/fleet.ts",
  "notifications/scanner.ts",
];

function tsDosyalari(dizin: string): string[] {
  return readdirSync(dizin).flatMap((ad) => {
    const tam = path.join(dizin, ad);
    if (statSync(tam).isDirectory()) return ad === "lisans-protokol" ? [] : tsDosyalari(tam);
    return ad.endsWith(".ts") ? [tam] : [];
  });
}

/** Düğümün içinde bulunduğu adlı fonksiyon (bildirim · `const f = () =>` · yöntem); yoksa null. */
function fonksiyonAdi(n: ts.Node): string | null {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text;
  }
  return null;
}

function kaynakCagrisi(e: ts.Expression): boolean {
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === KAYNAK;
}

/** Aynı fonksiyon gövdesinde `const <ad> = …` başlatıcısı (yoksa null). */
function constBaslatici(kimlik: ts.Identifier): ts.Expression | null {
  let govde: ts.Node | undefined = kimlik.parent;
  while (govde && !ts.isFunctionLike(govde) && !ts.isSourceFile(govde)) govde = govde.parent;
  let bulunan: ts.Expression | null = null;
  const ara = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === kimlik.text && n.initializer && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const) !== 0) {
      bulunan = n.initializer;
    }
    ts.forEachChild(n, ara);
  };
  if (govde) ara(govde);
  return bulunan;
}

/** Plan argümanı imza kaynağından mı: kaynak çağrısı · `x ?? kaynak(…)` · böyle başlatılmış const. */
function izinliArguman(e: ts.Expression, derinlik = 0): boolean {
  if (ts.isParenthesizedExpression(e)) return izinliArguman(e.expression, derinlik);
  if (kaynakCagrisi(e)) return true;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return kaynakCagrisi(e.right);
  if (ts.isIdentifier(e) && derinlik === 0) {
    const ilk = constBaslatici(e);
    return ilk !== null && izinliArguman(ilk, 1);
  }
  return false;
}

interface Bulgu {
  readonly planCagrilari: string[];
  readonly planIhlalleri: string[];
  readonly kaynakIhlalleri: string[];
}

/** Tek kaynağı tarar; `goreli` src'ye göre yol (izin tablosu anahtarı). */
function tara(goreli: string, metin: string): Bulgu {
  const sf = ts.createSourceFile(goreli, metin, ts.ScriptTarget.Latest, true);
  const yer = (n: ts.Node) => `${goreli}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const out: Bulgu = { planCagrilari: [], planIhlalleri: [], kaynakIhlalleri: [] };
  const izin = IZINLI[goreli];
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === PLAN) {
      out.planCagrilari.push(yer(n));
      const arg = n.arguments[2];
      if (!arg || !izinliArguman(arg)) out.planIhlalleri.push(`${yer(n)} → ${arg ? arg.getText(sf).slice(0, 80) : "(argüman yok)"}`);
    }
    if (ts.isIdentifier(n) && KAYNAK_ADLARI.has(n.text)) {
      const ithal = ts.isImportSpecifier(n.parent);
      const fn = fonksiyonAdi(n);
      const serbest = izin !== undefined && (izin.includes("*") || ithal || (fn !== null && izin.includes(fn)));
      if (!serbest) out.kaynakIhlalleri.push(`${yer(n)} ${n.text}${fn ? ` (${fn} içinde)` : ""}`);
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

function main(): void {
  console.log("\n§1–§2 src taraması");
  const dosyalar = tsDosyalari(SRC);
  const toplam: Bulgu = { planCagrilari: [], planIhlalleri: [], kaynakIhlalleri: [] };
  for (const d of dosyalar) {
    const b = tara(path.relative(SRC, d).split(path.sep).join("/"), readFileSync(d, "utf8"));
    toplam.planCagrilari.push(...b.planCagrilari);
    toplam.planIhlalleri.push(...b.planIhlalleri);
    toplam.kaynakIhlalleri.push(...b.kaynakIhlalleri);
  }
  kontrol("§1a planEntitlementSigner'ın yetenek argümanı yalnız signingCapabilities'ten (çıplak installationCapabilities/literal yok)", toplam.planIhlalleri.length === 0, toplam.planIhlalleri.join(" | "));
  kontrol("§2a imza kaynağı adları yalnız izinli fonksiyonlarda (teslim/kira/parmak izi/P/filo/tarama/etkinleştirme anmaz)", toplam.kaynakIhlalleri.length === 0, toplam.kaynakIhlalleri.join(" | "));

  console.log("\n§3 tarayıcı kör değil");
  const planDosyalari = [...new Set(toplam.planCagrilari.map((y) => y.split(":")[0]))].sort();
  kontrol("§3a plan çağrısı ≥ 4 yerde görüldü (issue · önizleme · toplu basım · prepareChange) ve izinli dosyalar var",
    toplam.planCagrilari.length >= 4 && JSON.stringify(planDosyalari) === JSON.stringify(["services/entitlement-issue.service.ts", "services/entitlement-version.service.ts"]) &&
      Object.keys(IZINLI).every((f) => existsSync(path.join(SRC, f))),
    `${toplam.planCagrilari.length} çağrı: ${planDosyalari.join(", ")}`);
  const eksik = TESLIM_DOSYALARI.filter((f) => !existsSync(path.join(SRC, f)));
  kontrol("§3a' teslim/kira yolu dosyaları yerinde (yasak listesi bayat değil)", eksik.length === 0, eksik.join(", "));
  const sonda = (goreli: string, kod: string) => tara(goreli, kod);
  const ciplak = sonda("services/entitlement-version.service.ts", `function prepareChange() { return planEntitlementSigner(k, s, g.capabilities ?? installationCapabilities(h.kurulum), n); }`);
  const literal = sonda("services/entitlement-issue.service.ts", `function previewEntitlementSigner() { return planEntitlementSigner(k, s, ["hak-ara"], n); }`);
  const teslim = sonda("services/lease.service.ts", `function findEntitlementForDelivery(i) { return deliverableEntitlement(db, e, signingCapabilities(i)); }`);
  const teslimIssue = sonda("services/entitlement-issue.service.ts", `function deliverableEntitlement(db, e, c) { const x = signingCapabilities(e); return x; }`);
  const izinliBicimler = sonda(
    "services/entitlement-issue.service.ts",
    `import { signingCapabilities } from "./entitlement-policy";
     function issueEntitlementVersion() { return planEntitlementSigner(k, s, g.capabilities ?? signingCapabilities(h.kurulum), n); }
     function prepareIntermediateReissue() { const caps = g.capabilitiesOf?.(h.kurulum) ?? signingCapabilities(h.kurulum); return planEntitlementSigner(k, s, caps, n); }
     function previewEntitlementSigner() { return planEntitlementSigner(k, s, signingCapabilities(h.kurulum), n); }`,
  );
  kontrol("§3b ✓K sondalar: çıplak installationCapabilities ve literal plan argümanı KIRMIZI · teslim dosyasında ve deliverableEntitlement içinde signingCapabilities KIRMIZI · izinli biçimler YEŞİL",
    ciplak.planIhlalleri.length === 1 && literal.planIhlalleri.length === 1 && teslim.kaynakIhlalleri.length === 1 && teslimIssue.kaynakIhlalleri.length === 1 &&
      izinliBicimler.planIhlalleri.length === 0 && izinliBicimler.kaynakIhlalleri.length === 0 && izinliBicimler.planCagrilari.length === 3,
    `${ciplak.planIhlalleri.length}/${literal.planIhlalleri.length}/${teslim.kaynakIhlalleri.length}/${teslimIssue.kaynakIhlalleri.length} · izinli ${izinliBicimler.planIhlalleri.length + izinliBicimler.kaynakIhlalleri.length}`);
  sonuc();
}

main();
