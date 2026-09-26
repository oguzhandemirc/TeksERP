// =============================================================================
// İSTEMCİ TOKEN ÜRETİMİ TARAMASI — panel + tablet kaynağında her token üretim yeri ve biçimi (AST)
// =============================================================================
// Okuyucu: `test_istemci_token_uretimi`. Beyan: `istemci-token-beyan.ts`. Kural: kk1.md "İstemci token'ı".
// Üretim = `*.randomUUID()` çağrısı ya da `generateClientUuid` (çağrı ya da değer olarak geçirilmesi).
// Biçim, üretimin sözdizimsel yerinden okunur — adı değil yeri ölçülür ki yeniden adlandırma taramayı körleştirmesin.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { walkKaynak } from "./ts-tarama";

export const REPO = path.resolve(__dirname, "../../..");
export const ISTEMCI_KOKLERI = ["Electron/src", "mobil/src"] as const;

/**
 * TUTUCU      `useState(() => üret())` / `useRef(üret())` — deneme token'ının tutulduğu yer
 * TEMBEL      `x.current ??= üret()` ya da `if (!x.current) x.current = üret()` — ilk gönderimde doğar, sonra tutulur
 * YENILEME    `setX(üret())` / `x.current = üret()` — tutulan token'ın yenilenmesi
 * ENJEKSIYON  üretici fonksiyon olarak geçirilir (varsayılan parametre, politika çağrısına argüman)
 * SATIR_ANAHTARI  `key:` / `id:` — arayüz/yerel kimlik, sunucuya idempotency anahtarı olarak gitmez
 * DONUS       `return üret()` — politika fonksiyonu ya da beyanlı muaf
 * SATIR_ICI   `clientToken: üret()` — gönderim anında üretim (her tıklamada yeni token)
 * SINIFLANAMADI  yukarıdakilerin hiçbiri (ör. `const t = üret()`)
 */
export type Bicim = "TUTUCU" | "TEMBEL" | "YENILEME" | "ENJEKSIYON" | "SATIR_ANAHTARI" | "DONUS" | "SATIR_ICI" | "SINIFLANAMADI";

export interface Uretim {
  dosya: string;
  satir: number;
  /** En dıştaki adlı fonksiyon (bileşen / hook / modül fonksiyonu). */
  birim: string;
  bicim: Bicim;
  /** Üretim `mutationFn` gövdesinde mi, gönderim tetikleyen bir JSX olayında mı? */
  olay: "mutationFn" | "gonderim" | null;
  metin: string;
}

export interface Birim {
  anahtar: string;
  dugum: ts.Node;
  adlar: Set<string>;
}

const TUTUCU_KANCALAR = new Set(["useState", "useRef"]);
const SATIR_ANAHTARLARI = new Set(["key", "id"]);
const GONDERIM_OLAYLARI = /^on(Click|Press|Submit|Confirm)$/;

const testMi = (rel: string) => /\.test\.tsx?$/.test(rel) || rel.includes("/__tests__/") || rel.includes("/src/test/") || rel.includes("/__mocks__/");

export function istemciDosyalari(): string[] {
  return ISTEMCI_KOKLERI.flatMap((k) => walkKaynak(path.join(REPO, k), [".ts", ".tsx"]))
    .map((abs) => path.relative(REPO, abs).split(path.sep).join("/"))
    .filter((rel) => !testMi(rel) && !rel.endsWith(".d.ts"));
}

function kaynak(rel: string): ts.SourceFile {
  const abs = path.join(REPO, rel);
  return ts.createSourceFile(abs, fs.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

const fonksiyonMu = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n);

function adi(n: ts.Node): string | null {
  if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
  if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
  return null;
}

/** En dıştaki adlı fonksiyon — bileşen/hook gövdesindeki iç geri çağrılar ona aittir. */
function disBirim(n: ts.Node): ts.Node | null {
  let bulunan: ts.Node | null = null;
  for (let p: ts.Node | undefined = n; p; p = p.parent) if (fonksiyonMu(p) && adi(p)) bulunan = p;
  return bulunan;
}

function uretimCagrisiMi(n: ts.Node): boolean {
  if (!ts.isCallExpression(n)) return false;
  const c = n.expression;
  return (ts.isPropertyAccessExpression(c) && c.name.text === "randomUUID") || (ts.isIdentifier(c) && c.text === "generateClientUuid");
}

/** `generateClientUuid` DEĞER olarak (çağrılmadan) geçiriliyor mu — içe aktarma ve tanım hariç. */
function ureticiDegeriMi(n: ts.Node): boolean {
  if (!ts.isIdentifier(n) || n.text !== "generateClientUuid") return false;
  const p = n.parent;
  if (ts.isCallExpression(p) && p.expression === n) return false;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isFunctionDeclaration(p) || ts.isImportClause(p)) return false;
  return true;
}

const cagriAdi = (c: ts.CallExpression) =>
  ts.isIdentifier(c.expression) ? c.expression.text : ts.isPropertyAccessExpression(c.expression) ? c.expression.name.text : "";

/** `if (!x) x = …` korumalı atama mı (tembel doğum)? */
function tembelKorumaMi(atama: ts.BinaryExpression): boolean {
  const sol = atama.left.getText();
  for (let p: ts.Node = atama.parent; p && !fonksiyonMu(p); p = p.parent) {
    if (ts.isIfStatement(p)) {
      const k = p.expression;
      return ts.isPrefixUnaryExpression(k) && k.operator === ts.SyntaxKind.ExclamationToken && k.operand.getText() === sol;
    }
  }
  return false;
}

function bicimi(g: ts.Node): Bicim {
  if (ts.isIdentifier(g)) {
    const p = g.parent;
    if (ts.isCallExpression(p)) return TUTUCU_KANCALAR.has(cagriAdi(p)) ? "TUTUCU" : "ENJEKSIYON";
    if (ts.isParameter(p)) return "ENJEKSIYON";
    return "SINIFLANAMADI";
  }
  const p = g.parent;
  if (ts.isArrowFunction(p) && p.body === g) {
    const pp = p.parent;
    if (ts.isParameter(pp)) return "ENJEKSIYON";
    if (ts.isCallExpression(pp)) return TUTUCU_KANCALAR.has(cagriAdi(pp)) ? "TUTUCU" : "ENJEKSIYON";
    return "SINIFLANAMADI";
  }
  if (ts.isCallExpression(p) && p.arguments.includes(g as ts.Expression)) {
    const ad = cagriAdi(p);
    if (TUTUCU_KANCALAR.has(ad)) return "TUTUCU";
    if (/^set[A-Z]/.test(ad)) return "YENILEME";
    return "SINIFLANAMADI";
  }
  if (ts.isBinaryExpression(p) && p.right === g && ts.isPropertyAccessExpression(p.left) && p.left.name.text === "current") {
    if (p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken) return "TEMBEL";
    if (p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return tembelKorumaMi(p) ? "TEMBEL" : "YENILEME";
  }
  if (ts.isPropertyAssignment(p) && p.initializer === g) {
    const ad = p.name.getText();
    if (ad === "clientToken") return "SATIR_ICI";
    if (SATIR_ANAHTARLARI.has(ad)) return "SATIR_ANAHTARI";
    const obj = p.parent;
    const atama = obj.parent;
    if (ts.isBinaryExpression(atama) && atama.right === obj && ts.isPropertyAccessExpression(atama.left) && atama.left.name.text === "current") return "YENILEME";
    return "SINIFLANAMADI";
  }
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) && p.parent.name.getText() === "clientToken") return "SATIR_ICI";
  if (ts.isReturnStatement(p)) return "DONUS";
  return "SINIFLANAMADI";
}

function olayi(g: ts.Node): Uretim["olay"] {
  for (let p: ts.Node | undefined = g.parent; p; p = p.parent) {
    if (fonksiyonMu(p)) {
      const q = p.parent;
      if (ts.isPropertyAssignment(q) && q.name.getText() === "mutationFn") return "mutationFn";
      if (ts.isJsxExpression(q) && ts.isJsxAttribute(q.parent) && GONDERIM_OLAYLARI.test(q.parent.name.getText())) return "gonderim";
    }
  }
  return null;
}

export interface Tarama {
  uretimler: Uretim[];
  /** Adlı dış birimler (dosya::ad) ve gövdelerinde geçen tanımlayıcılar — politika uyumu buradan okunur. */
  birimler: Map<string, Birim>;
  /** Dosyadan dışa açılan fonksiyonlar (ad → gövdedeki tanımlayıcılar) — politika adlarının türetimi için. */
  disaAcik: Array<{ dosya: string; ad: string; adlar: Set<string> }>;
  dosyaSayisi: number;
}

function tanimlayicilar(n: ts.Node): Set<string> {
  const out = new Set<string>();
  const gez = (k: ts.Node) => {
    if (ts.isIdentifier(k)) out.add(k.text);
    ts.forEachChild(k, gez);
  };
  gez(n);
  return out;
}

const disaAcikMi = (n: ts.Node) =>
  (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

export function tara(dosyalar: string[] = istemciDosyalari()): Tarama {
  const uretimler: Uretim[] = [];
  const birimler = new Map<string, Birim>();
  const disaAcik: Tarama["disaAcik"] = [];
  for (const rel of dosyalar) {
    const sf = kaynak(rel);
    const birimKaydi = (d: ts.Node) => {
      const anahtar = `${rel}::${adi(d)}`;
      if (!birimler.has(anahtar)) birimler.set(anahtar, { anahtar, dugum: d, adlar: tanimlayicilar(d) });
      return anahtar;
    };
    const gez = (n: ts.Node) => {
      if (fonksiyonMu(n) && adi(n) && disBirim(n) === n) birimKaydi(n);
      if (uretimCagrisiMi(n) || ureticiDegeriMi(n)) {
        const d = disBirim(n);
        uretimler.push({
          dosya: rel,
          satir: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          birim: d ? birimKaydi(d).split("::")[1] : "<modül>",
          bicim: bicimi(n),
          olay: olayi(n),
          metin: (ts.isIdentifier(n) ? n.parent : n.parent).getText().replace(/\s+/g, " ").slice(0, 90),
        });
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name && disaAcikMi(st)) disaAcik.push({ dosya: rel, ad: st.name.text, adlar: tanimlayicilar(st) });
      if (ts.isVariableStatement(st) && disaAcikMi(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
            disaAcik.push({ dosya: rel, ad: d.name.text, adlar: tanimlayicilar(d.initializer) });
          }
        }
      }
    }
  }
  return { uretimler, birimler, disaAcik, dosyaSayisi: dosyalar.length };
}

/**
 * Politika adları: kök adlar + (sabit nokta) gövdesinde bir politika adı geçen dışa açık yardımcılar. Böylece
 * `onReceiveFailed`/`slotAfterFailure` gibi modül yardımcıları adla listelenmeden tanınır. Bileşenler (BüyükHarf) ve
 * hook'lar (`useX`) türetilmez: token tutan birimin KENDİSİDİR, politika değil — onları çağıran uyumlu sayılmaz.
 */
export function politikaAdlari(t: Tarama, kokler: readonly string[]): Set<string> {
  const ad = new Set(kokler);
  for (let degisti = true; degisti; ) {
    degisti = false;
    for (const f of t.disaAcik) {
      if (ad.has(f.ad) || /^[A-Z]/.test(f.ad) || /^use[A-Z]/.test(f.ad)) continue;
      if ([...f.adlar].some((x) => x !== f.ad && ad.has(x))) {
        ad.add(f.ad);
        degisti = true;
      }
    }
  }
  return ad;
}
