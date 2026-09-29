// Modül okuyucusu AST taraması — `test_lisans_modul_tavani`nin statik ayağı. Her
// `readXEnabled` / `readXEnabledRaw` çağrısını (ve çağrı DIŞI her anılışını) bulunduğu dosya +
// fonksiyonla eşler; hangi varyantın nerede meşru olduğu bekçide beyanlıdır. `test_` öneki yok.
import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { walkTs } from "./ts-tarama";

export const SRC_KOKU = path.join(__dirname, "..", "..", "src");
export const SERVIS = path.join(SRC_KOKU, "services", "system-setting.service.ts");

export interface OkuyucuCifti {
  /** Enforcement okuyucusu (`readFinanceEnabled`). */
  readonly ad: string;
  /** `SETTING_KEYS` sabit adı (`FINANCE_ENABLED`). */
  readonly sabit: string;
  /** Ham gövde bu sabiti okuyor mu, enforcement gövdesi tavandan aynı sabitle mi geçiriyor? */
  readonly hamOkur: boolean;
  readonly tavanAyniSabit: boolean;
  readonly hamdanGecer: boolean;
  readonly hamTavansiz: boolean;
}

export interface Anilis {
  /** `src`e göreli dosya. */
  readonly dosya: string;
  /** En yakın adlı fonksiyon/metot (`getFeatureFlags`) ya da `(dosya düzeyi)`. */
  readonly fonksiyon: string;
  readonly ad: string;
  readonly cagri: boolean;
}

function kaynak(dosya: string): ts.SourceFile {
  return ts.createSourceFile(dosya, fs.readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true);
}

function fonksiyonGovdesi(sf: ts.SourceFile, ad: string): string {
  let govde = "";
  const gez = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === ad && n.body) govde = n.body.getText(sf);
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return govde;
}

/** Servisteki `readXEnabledRaw` ↔ `readXEnabled` çiftleri. */
export function okuyucuCiftleri(): OkuyucuCifti[] {
  const sf = kaynak(SERVIS);
  const hamlar: string[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && /^read[A-Z]\w*EnabledRaw$/.test(st.name.text)) hamlar.push(st.name.text);
  }
  return hamlar.map((ham) => {
    const ad = ham.replace(/Raw$/, "");
    const hamGovde = fonksiyonGovdesi(sf, ham);
    const tavanGovde = fonksiyonGovdesi(sf, ad);
    const sabit = /SETTING_KEYS\.([A-Z0-9_]+)/.exec(hamGovde)?.[1] ?? "";
    return {
      ad,
      sabit,
      hamOkur: sabit !== "",
      tavanAyniSabit: tavanGovde.includes(`applyModuleCeiling(SETTING_KEYS.${sabit},`),
      hamdanGecer: tavanGovde.includes(`await ${ham}(tx)`),
      hamTavansiz: !hamGovde.includes("applyModuleCeiling"),
    };
  });
}

function enYakinFonksiyon(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent) {
      const ata = p.parent;
      if ((ts.isVariableDeclaration(ata) || ts.isPropertyDeclaration(ata) || ts.isPropertyAssignment(ata)) && ata.name) return ata.name.getText();
    }
  }
  return "(dosya düzeyi)";
}

/** `src/**` içinde verilen adların her anılışı (import/export bildirimleri ve tanımın kendisi hariç). */
export function anilislar(adlar: ReadonlySet<string>): Anilis[] {
  const out: Anilis[] = [];
  for (const dosya of walkTs(SRC_KOKU)) {
    const sf = kaynak(dosya);
    const gez = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && adlar.has(n.text)) {
        const p = n.parent;
        const bildirim = ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || (ts.isFunctionDeclaration(p) && p.name === n);
        if (!bildirim) {
          const cagri = ts.isCallExpression(p) && p.expression === n;
          out.push({ dosya: path.relative(SRC_KOKU, dosya), fonksiyon: enYakinFonksiyon(n), ad: n.text, cagri });
        }
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  return out;
}

/** Adlı kapı gövdesindeki `licenseModuleError(SETTING_KEYS.X` sabitleri ve okunan okuyucular. */
export function kapiGovdesi(dosya: string, fonksiyon: string): { okuyucular: string[]; lisansSabitleri: string[] } {
  const govde = fonksiyonGovdesi(kaynak(dosya), fonksiyon);
  return {
    okuyucular: [...govde.matchAll(/\b(read[A-Z]\w*Enabled)\(/g)].map((m) => m[1]!),
    lisansSabitleri: [...govde.matchAll(/licenseModuleError\(SETTING_KEYS\.([A-Z0-9_]+)/g)].map((m) => m[1]!),
  };
}

export interface LisansModulUreticisi {
  /** `src`e göreli dosya · en yakın fonksiyon. */
  readonly yer: string;
  /** `licenseModuleError`in ilk argümanı: `SETTING_KEYS.X` ise `X`, değilse ham metin. */
  readonly sabit: string | null;
  readonly argMetni: string;
}

export interface ModulKapaliSitesi {
  readonly yer: string;
  /** `MODULE_DISABLED` reddi `licenseModuleError(SETTING_KEYS.K, …) ?? …` sağ kolunda mı (doğrudan ya da yardımcı üzerinden)? */
  readonly lisansOnde: boolean;
  /** Sol koldaki `K` (yardımcı üzerinden ise her çağrı yerinin K'leri). */
  readonly lisansSabitleri: string[];
  /** Reddi saran `if` koşulunda okunan enforcement okuyucuları (`readDokumaEnabled`…). */
  readonly kosulOkuyuculari: string[];
}

function ifadeMetni(n: ts.Node): string {
  return n.getText().replace(/\s+/g, " ");
}

function modulKapaliMi(n: ts.Node): boolean {
  return (
    ts.isCallExpression(n) &&
    /AppError\s*\.\s*forbidden$/.test(ifadeMetni(n.expression)) &&
    n.arguments.some((a) => ts.isObjectLiteralExpression(a) && /code\s*:\s*"MODULE_DISABLED"/.test(ifadeMetni(a)))
  );
}

/** `licenseModuleError(SETTING_KEYS.K, …) ?? <sağ>` — `sag` bu ifadenin sağ kolunun (ya da kendisinin) içinde mi? */
function lisansSolKolu(n: ts.Node): string | null {
  for (let p: ts.Node | undefined = n.parent; p && !ts.isStatement(p); p = p.parent) {
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && p.right.pos <= n.pos && n.end <= p.right.end) {
      const sol = p.left;
      if (ts.isCallExpression(sol) && ts.isIdentifier(sol.expression) && sol.expression.text === "licenseModuleError") {
        return /^SETTING_KEYS\.([A-Z0-9_]+)$/.exec(ifadeMetni(sol.arguments[0] ?? sol))?.[1] ?? "?";
      }
    }
  }
  return null;
}

function kosulOkuyuculari(n: ts.Node): string[] {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isIfStatement(p)) return [...ifadeMetni(p.expression).matchAll(/\b(read[A-Z]\w*Enabled)\(/g)].map((m) => m[1]!);
    if (ts.isFunctionLike(p)) break;
  }
  return [];
}

/**
 * `src/**`te LICENSE_MODULE üretimi: (1) `"LICENSE_MODULE"` dizge literalinin geçtiği dosyalar
 * (yorum sayılmaz) · (2) her `licenseModuleError(` çağrısı · (3) her `MODULE_DISABLED` reddi ve
 * önünde lisans sorusunun olup olmadığı. Yardımcı fonksiyon (`modulKapali`) içindeki red, o
 * yardımcının her çağrı yeri lisans sorusunun sağ kolundaysa "lisans önde" sayılır.
 */
export function lisansModulTaramasi(): { literalDosyalari: string[]; ureticiler: LisansModulUreticisi[]; kapaliSiteleri: ModulKapaliSitesi[] } {
  const literalDosyalari = new Set<string>();
  const ureticiler: LisansModulUreticisi[] = [];
  const kapaliSiteleri: ModulKapaliSitesi[] = [];
  for (const dosya of walkTs(SRC_KOKU)) {
    const sf = kaynak(dosya);
    const rel = path.relative(SRC_KOKU, dosya);
    const yardimciCagrilari = new Map<string, ts.CallExpression[]>();
    const kapalilar: ts.CallExpression[] = [];
    const gez = (n: ts.Node): void => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === "LICENSE_MODULE") literalDosyalari.add(rel);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const ad = n.expression.text;
        if (ad === "licenseModuleError") {
          const arg = n.arguments[0];
          const metin = arg ? ifadeMetni(arg) : "";
          ureticiler.push({ yer: `${rel}#${enYakinFonksiyon(n)}`, sabit: /^SETTING_KEYS\.([A-Z0-9_]+)$/.exec(metin)?.[1] ?? null, argMetni: metin });
        }
        const liste = yardimciCagrilari.get(ad) ?? [];
        liste.push(n);
        yardimciCagrilari.set(ad, liste);
      }
      if (modulKapaliMi(n)) kapalilar.push(n as ts.CallExpression);
      ts.forEachChild(n, gez);
    };
    gez(sf);
    for (const k of kapalilar) {
      const dogrudan = lisansSolKolu(k);
      let lisansOnde = dogrudan !== null;
      let sabitler = dogrudan !== null ? [dogrudan] : [];
      if (!lisansOnde) {
        const kap = ((): ts.FunctionDeclaration | undefined => {
          for (let p: ts.Node | undefined = k.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p)) return p;
          return undefined;
        })();
        const cagrilar = kap?.name ? (yardimciCagrilari.get(kap.name.text) ?? []) : [];
        const kollar = cagrilar.map((c) => lisansSolKolu(c));
        if (cagrilar.length > 0 && kollar.every((s) => s !== null)) {
          lisansOnde = true;
          sabitler = kollar as string[];
        }
      }
      kapaliSiteleri.push({ yer: `${rel}#${enYakinFonksiyon(k)}`, lisansOnde, lisansSabitleri: sabitler, kosulOkuyuculari: kosulOkuyuculari(k) });
    }
  }
  return { literalDosyalari: [...literalDosyalari].sort(), ureticiler, kapaliSiteleri };
}
