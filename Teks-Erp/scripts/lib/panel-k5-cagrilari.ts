// =============================================================================
// PANEL K5 ÇAĞRI TARAMASI — lisans DURDURULMUŞ iken panelin çağırabildiği uçlar (AST + tip denetleyicisi)
// =============================================================================
// Okuyucu: `test_lisans_kapisi` §10. Soru: K5'te panelin çizdiği yüzeyler (App kökü, oturum-dışı
// router, "verilerimi al" sayfası) hangi backend uçlarını çağırabilir? Cevap koddan ÇIKARILIR,
// elle liste tutulmaz: giriş bileşeninden başlayıp başvurulan her bildirime (fonksiyon, bileşen,
// servis nesnesinin özelliği, store eylemi) iner ve `apiClient.<yöntem>(yol)` / `axios.<yöntem>`
// çağrılarının yolunu toplar. Modül düzeyindeki yan etkili ifadeler (interceptor kaydı) de
// taranır: modülü içe aktarmak onları çalıştırır.
//
// ⚠️ TUTUCU (üst yaklaşım): bir fonksiyona BAŞVURULMASI yeter, çağrılıp çağrılmadığı ölçülmez;
// K5'te bağlanmayan dal ancak BEYANLI dışlamayla düşer ve her dışlama kendi kanıtını taşır
// (bekçi kanıt desenini kaynakta arar). Nesne değerli değişken (servis nesnesi, zustand store'u)
// bütünüyle taranmaz, yalnız ERİŞİLEN özellik taranır — yoksa `importService` bütün içe aktarım
// yazmalarını, `useTabsStore` bütün sekme yönlendiricilerini (= bütün uygulamayı) K5'e taşırdı.
// Arayüz üyesine (`AuthState.logout`, context değeri) başvuru, aynı dosyadaki nesne değişmezi
// uygulamasına (store eylemi / `useMemo` değeri) bağlanır.
//
// Çözümleme yalnız `Electron/src` + `Electron/shared` + ES lib'i içindedir (node_modules
// yüklenmez, `zustand` için küçük bir tip taslağı verilir): yerelde ve CI'da aynı sonuç.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

export const REPO = path.resolve(__dirname, "../../..");
const ELECTRON = path.join(REPO, "Electron");
const KOKLER = [path.join(ELECTRON, "src"), path.join(ELECTRON, "shared")];
const UZANTILAR = [".tsx", ".ts", "/index.tsx", "/index.ts"];
const HTTP_YONTEMLERI = new Set(["get", "post", "put", "patch", "delete", "head"]);

/** Store eylemleri tipten çözülsün diye `zustand`ın kullandığımız yüzeyi (sanal bildirim dosyası). */
const TASLAK_DIZINI = path.join(ELECTRON, "__k5_taslak__");
const TASLAKLAR: Record<string, string> = {
  zustand: [
    "export type StoreApi<T> = { getState(): T; setState(p: Partial<T> | ((s: T) => Partial<T>), replace?: boolean): void; subscribe(l: (s: T, p: T) => void): () => void };",
    "export type UseBoundStore<T> = { (): T; <U>(selector: (s: T) => U): U } & StoreApi<T>;",
    "export type StateCreator<T> = (set: StoreApi<T>['setState'], get: () => T, api: StoreApi<T>) => T;",
    "export declare function create<T>(): (init: StateCreator<T>) => UseBoundStore<T>;",
    "export declare function create<T>(init: StateCreator<T>): UseBoundStore<T>;",
  ].join("\n"),
  "zustand/middleware": [
    "import type { StateCreator } from 'zustand';",
    "export declare function persist<T>(init: StateCreator<T>, opts?: unknown): StateCreator<T>;",
    "export declare function createJSONStorage(f: () => unknown): unknown;",
  ].join("\n"),
};
const taslakYolu = (ad: string): string => path.join(TASLAK_DIZINI, `${ad.replace(/\//g, "__")}.d.ts`);

export interface PanelCagrisi {
  /** Büyük harf yöntem (`GET`, `POST` …). */
  yontem: string;
  /** `/api/...` deseni; çözülemeyen parça `:p`. Sorgu dizgisi atılır. */
  yol: string;
  /** Çağrının yeri: `Electron/src/…:satır`. */
  yer: string;
}

export interface K5Giris {
  /** Repo köküne göre dosya. */
  dosya: string;
  /** Dosyadaki üst düzey bildirim adı. */
  ad: string;
}

export interface K5Dislama extends K5Giris {
  /** Neden K5'te bağlanmaz / susar. */
  gerekce: string;
  /** Kanıt: bu desen kanıt dosyasında GEÇMELİ (bekçi arar). */
  kanit: { dosya: string; desen: RegExp };
}

export interface K5Taramasi {
  cagrilar: PanelCagrisi[];
  /** Yolu hiç çıkarılamayan HTTP çağrıları — sessiz kalamaz, bekçi kırmızı sayar. */
  cozulemeyen: string[];
  /** `/api` dışı çağrılar (ör. `${adres}/health`) — lisans kapısının kapsamı dışında, yalnız basılır. */
  kapiDisi: string[];
  /** Bulunamayan giriş/dışlama adları. */
  bulunamayan: string[];
  /** Taranan düğüm sayısı (körlük zemini). */
  taranan: number;
  /** Programa yüklenen Electron dosyası sayısı. */
  dosyaSayisi: number;
}

function varMi(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function icerde(p: string): boolean {
  return KOKLER.some((k) => p.startsWith(k + path.sep));
}

function modulCoz(ad: string, kaynakDosya: string): string | undefined {
  if (TASLAKLAR[ad] !== undefined) return taslakYolu(ad);
  let taban: string | null = null;
  if (ad.startsWith("@/")) taban = path.join(ELECTRON, "src", ad.slice(2));
  else if (ad.startsWith("@shared/")) taban = path.join(ELECTRON, "shared", ad.slice(8));
  else if (ad.startsWith(".")) taban = path.resolve(path.dirname(kaynakDosya), ad);
  if (!taban) return undefined;
  if (varMi(taban) && /\.tsx?$/.test(taban)) return taban;
  for (const u of UZANTILAR) if (varMi(taban + u)) return taban + u;
  return undefined;
}

function programKur(girisler: string[]): ts.Program {
  const secenekler: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts"],
    noEmit: true,
    types: [],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(secenekler, true);
  // ES lib'i yüklenir (Promise tipi: `await import(...)` bağları çözülsün); başka dış dosya yok.
  const libDizini = path.dirname(host.getDefaultLibFileName(secenekler));
  const taslaklar = new Map(Object.keys(TASLAKLAR).map((ad) => [taslakYolu(ad), TASLAKLAR[ad]] as const));
  const onbellek = new Map<string, ts.SourceFile | undefined>();
  host.getSourceFile = (dosya, dil) => {
    if (onbellek.has(dosya)) return onbellek.get(dosya);
    let metin: string | undefined = taslaklar.get(dosya);
    if (metin === undefined && (icerde(dosya) || path.dirname(dosya) === libDizini) && varMi(dosya)) metin = fs.readFileSync(dosya, "utf8");
    const sf = metin === undefined ? undefined : ts.createSourceFile(dosya, metin, dil, true);
    onbellek.set(dosya, sf);
    return sf;
  };
  host.fileExists = (f) => taslaklar.has(f) || varMi(f);
  host.resolveModuleNameLiterals = (literaller, kaynakDosya) =>
    literaller.map((l) => {
      const coz = modulCoz(l.text, kaynakDosya);
      const ext = !coz ? ts.Extension.Ts : coz.endsWith(".d.ts") ? ts.Extension.Dts : coz.endsWith(".tsx") ? ts.Extension.Tsx : ts.Extension.Ts;
      return { resolvedModule: coz ? { resolvedFileName: coz, extension: ext, isExternalLibraryImport: false } : undefined };
    });
  return ts.createProgram(girisler, secenekler, host);
}

function ustDuzeyBildirim(sf: ts.SourceFile, ad: string): ts.Node | null {
  for (const st of sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === ad) return st;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === ad) return d;
    }
  }
  return null;
}

const rel = (p: string): string => path.relative(REPO, p).split(path.sep).join("/");
const sarmaliAc = (e: ts.Expression): ts.Expression =>
  ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e) ? sarmaliAc(e.expression) : e;

/** Yol ifadesini desene çevirir; çözülemeyen parça `:p`. null → hiç çözülemedi. */
function yolDeseni(e: ts.Expression, ck: ts.TypeChecker, derinlik = 0): string | null {
  if (derinlik > 6) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) return yolDeseni(e.expression, ck, derinlik + 1);
  if (ts.isTemplateExpression(e)) {
    let s = e.head.text;
    for (const sp of e.templateSpans) s += (sabitMetin(sp.expression, ck, derinlik + 1) ?? ":p") + sp.literal.text;
    return s;
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return (yolDeseni(e.left, ck, derinlik + 1) ?? ":p") + (yolDeseni(e.right, ck, derinlik + 1) ?? ":p");
  }
  return sabitMetin(e, ck, derinlik + 1);
}

/** `const BASE = "/api/x"` gibi sabit metne çözülen tanımlayıcı; değilse null. */
function sabitMetin(e: ts.Expression, ck: ts.TypeChecker, derinlik: number): string | null {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) return yolDeseni(e, ck, derinlik);
  if (!ts.isIdentifier(e)) return null;
  let sym = ck.getSymbolAtLocation(e);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = ck.getAliasedSymbol(sym);
  const d = sym?.valueDeclaration;
  if (!d || !ts.isVariableDeclaration(d) || !d.initializer) return null;
  if (!(ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const)) return null;
  return yolDeseni(d.initializer, ck, derinlik + 1);
}

/** Çağrılan nesne `apiClient` (services/apiClient.ts) ya da `axios` modülü mü? */
function httpIstemcisiMi(nesne: ts.Expression, ck: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(nesne)) return false;
  const yerel = ck.getSymbolAtLocation(nesne);
  if (!yerel) return false;
  for (const d of yerel.declarations ?? []) {
    const imp = ts.findAncestor(d, ts.isImportDeclaration);
    if (imp && ts.isStringLiteral(imp.moduleSpecifier) && imp.moduleSpecifier.text === "axios") return true;
  }
  const hedef = yerel.flags & ts.SymbolFlags.Alias ? ck.getAliasedSymbol(yerel) : yerel;
  return (hedef.declarations ?? []).some((d) => d.getSourceFile().fileName.endsWith(path.join("src", "services", "apiClient.ts")));
}

/** Başlatıcı bütünüyle taranmayan (yalnız erişilen özelliği izlenen) değer: nesne değişmezi ya da zustand store'u. */
function nesneDegerliBaslatici(init: ts.Expression): boolean {
  const ic = sarmaliAc(init);
  if (ts.isObjectLiteralExpression(ic)) return true;
  // `create<T>()(...)` / `create<T>(...)` — en içteki çağrılan `create` (zustand).
  let c: ts.Expression = ic;
  while (ts.isCallExpression(c)) c = c.expression;
  return ts.isIdentifier(c) && c.text === "create";
}

/** Arayüz üyesinin aynı dosyadaki uygulamaları: fonksiyona geçirilen nesne değişmezindeki aynı adlı özellik. */
function uyeUygulamalari(uye: ts.PropertySignature | ts.MethodSignature): ts.Node[] {
  const ad = ts.isIdentifier(uye.name) || ts.isStringLiteral(uye.name) ? uye.name.text : null;
  if (!ad) return [];
  const out: ts.Node[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n) && ts.findAncestor(n.parent, (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a))) {
      for (const p of n.properties) {
        if (!p.name || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) || p.name.text !== ad) continue;
        if (ts.isPropertyAssignment(p)) out.push(p.initializer);
        else if (ts.isMethodDeclaration(p) || ts.isShorthandPropertyAssignment(p)) out.push(p);
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(uye.getSourceFile());
  return out;
}

/** Başvurunun izlenecek gövdeleri. */
function izlenecekDugumler(d: ts.Declaration): ts.Node[] {
  if (!icerde(d.getSourceFile().fileName)) return [];
  if (ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d) || ts.isClassDeclaration(d)) return [d];
  if (ts.isGetAccessor(d) || ts.isSetAccessor(d)) return [d];
  if (ts.isVariableDeclaration(d)) return d.initializer && !nesneDegerliBaslatici(d.initializer) ? [d.initializer] : [];
  if (ts.isPropertyAssignment(d)) return [d.initializer];
  if (ts.isShorthandPropertyAssignment(d)) return [d];
  if (ts.isPropertySignature(d) || ts.isMethodSignature(d)) return uyeUygulamalari(d);
  return [];
}

export function k5CagrilariniTara(girisler: K5Giris[], dislanan: K5Dislama[]): K5Taramasi {
  const program = programKur([...new Set(girisler.map((g) => path.join(REPO, g.dosya)))]);
  const ck = program.getTypeChecker();
  const bulunamayan: string[] = [];
  const dislananDugum = new Set<ts.Node>();
  for (const x of dislanan) {
    const sf = program.getSourceFile(path.join(REPO, x.dosya));
    const n = sf ? ustDuzeyBildirim(sf, x.ad) : null;
    if (n) {
      dislananDugum.add(n);
      if (ts.isVariableDeclaration(n) && n.initializer) dislananDugum.add(n.initializer);
    } else bulunamayan.push(`dışlama ${x.dosya}#${x.ad}`);
  }
  const kuyruk: ts.Node[] = [];
  const gorulen = new Set<ts.Node>();
  const ekle = (n: ts.Node | null): void => {
    if (!n || gorulen.has(n) || dislananDugum.has(n)) return;
    gorulen.add(n);
    kuyruk.push(n);
  };
  for (const g of girisler) {
    const sf = program.getSourceFile(path.join(REPO, g.dosya));
    const n = sf ? ustDuzeyBildirim(sf, g.ad) : null;
    if (n) ekle(n);
    else bulunamayan.push(`giriş ${g.dosya}#${g.ad}`);
  }
  // Modül değerlendirmesi: içe aktarılan her dosyanın üst düzey yan etkili ifadeleri koşar.
  const dosyalar = program.getSourceFiles().filter((sf) => icerde(sf.fileName));
  for (const sf of dosyalar) for (const st of sf.statements) if (ts.isExpressionStatement(st)) ekle(st);

  const cagrilar: PanelCagrisi[] = [];
  const cozulemeyen: string[] = [];
  const kapiDisi: string[] = [];
  const sembolIzle = (sym: ts.Symbol | undefined): void => {
    if (!sym) return;
    const hedef = sym.flags & ts.SymbolFlags.Alias ? ck.getAliasedSymbol(sym) : sym;
    for (const d of hedef.declarations ?? []) if (!dislananDugum.has(d)) for (const n of izlenecekDugumler(d)) ekle(n);
  };
  const nesneDegerliMi = (id: ts.Identifier): boolean => {
    let sym = ck.getSymbolAtLocation(id);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = ck.getAliasedSymbol(sym);
    const d = sym?.valueDeclaration;
    return !!d && ts.isVariableDeclaration(d) && !!d.initializer && nesneDegerliBaslatici(d.initializer);
  };
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const yontem = n.expression.name.text;
      if (HTTP_YONTEMLERI.has(yontem) && httpIstemcisiMi(n.expression.expression, ck)) {
        const sf = n.getSourceFile();
        const yer = `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
        const arg = n.arguments[0];
        const desen = arg ? yolDeseni(arg, ck) : null;
        const i = desen ? desen.indexOf("/api/") : -1;
        if (desen && i >= 0) cagrilar.push({ yontem: yontem.toUpperCase(), yol: desen.slice(i).split(/[?#]/)[0].replace(/\/+$/, ""), yer });
        else if (desen && /[a-z]/i.test(desen.replace(/:p/g, ""))) kapiDisi.push(`${yontem.toUpperCase()} ${desen} @ ${yer}`);
        else cozulemeyen.push(`${yontem.toUpperCase()} ${arg ? arg.getText().replace(/\s+/g, " ") : "?"} @ ${yer}`);
      }
    }
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      // Nesnenin kendisi değil erişilen özelliği izlenir (`licenseService.status` → yalnız `status`).
      const ozellikNesnesi = !!p && ts.isPropertyAccessExpression(p) && p.expression === n;
      if (!ozellikNesnesi || !nesneDegerliMi(n)) sembolIzle(ck.getSymbolAtLocation(n));
      if (p && ts.isShorthandPropertyAssignment(p) && p.name === n) sembolIzle(ck.getShorthandAssignmentValueSymbol(p));
    }
    ts.forEachChild(n, gez);
  };
  while (kuyruk.length) gez(kuyruk.pop()!);
  return { cagrilar, cozulemeyen, kapiDisi, bulunamayan, taranan: gorulen.size, dosyaSayisi: dosyalar.length };
}
