// =============================================================================
// K5 KİLİT EKRANININ PANEL ÇAĞRILARI — statik çıkarım (`test_lisans_kapisi` §12)
// =============================================================================
// Soru: panelin DURDURULMUŞ (K5) kilit ekranı hangi backend uçlarını çağırıyor? Kapının K5 izin
// listesi bu kümeyi KAPSAMALI; aksi hâlde "verilerimi al" ekranı kendi kapımıza takılır.
// Liste elle YAZILMAZ: tohum fonksiyonlardan (K5 "verilerimi al" sayfası,
// oturum kimliği) başlayıp Electron kaynağında SÖZDİZİMSEL çağrı grafiği gezilir — adlı yerel
// fonksiyonlar, içe aktarılan bileşen/kanca/servis üyeleri (`licenseService.status` gibi değer
// olarak geçenler dahil), dinamik `await import(...)` bağları — ve `apiClient.<fiil>(url)`
// çağrıları toplanır. URL sabit + şablondan çözülür (`${BASE}/durum` → `/api/license/durum`,
// değişken segment → `{x}`); çözülemeyen URL ve tanınmayan HTTP istemcisi (`fetch`, `axios.`)
// ÖLÇÜLEMEDİ olarak döner — sessiz geçmez. DB'siz; yalnız dosya okur. `test_` öneki yok.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";

export const ELECTRON_SRC = path.join(__dirname, "..", "..", "..", "Electron", "src");
const ELECTRON_SHARED = path.join(ELECTRON_SRC, "..", "shared");

/** Tohumlar: `<Electron/src'e göreli dosya>#<ad>` → neden. Ad üst düzey bildirim ya da nesne üyesidir. */
export const K5_TOHUMLARI: Readonly<Record<string, string>> = {
  "pages/LicenseSuspended/LicenseSuspendedPage.tsx#LicenseSuspendedPage": "K5 'verilerimi al' sayfası (F3: oturum-dışı router, kabuk bağlanmaz)",
  "store/auth.ts#refreshSystemAccount": "oturum kimliği (yetki aynası) — kilit ekranı izinleri buradan çözer",
};

export interface PanelCagrisi {
  /** Büyük harf HTTP yöntemi. */
  readonly method: string;
  /** Sorgusuz yol; değişken segment `{x}`. */
  readonly path: string;
  /** `<dosya>:<satır>`. */
  readonly kaynak: string;
}

export interface K5Cikarimi {
  readonly cagrilar: PanelCagrisi[];
  /** Çözülemeyen URL ya da tanınmayan HTTP istemcisi (ÖLÇÜLEMEDİ). */
  readonly olculemedi: string[];
  /** Bulunamayan tohum (ölü beyan). */
  readonly oluTohum: string[];
  readonly ziyaretEdilenDosya: number;
}

type Okuyucu = (abs: string) => string | null;

interface Bag {
  readonly mod: string | null;
  /** İçe aktarılan ad: `default`, `*` ya da adlı dışa aktarım. */
  readonly ad: string;
}

interface Modul {
  readonly sf: ts.SourceFile;
  readonly rel: string;
  readonly baglar: Map<string, Bag>;
  readonly ustDuzey: Map<string, ts.Node>;
  readonly uyeler: Map<string, ts.Node[]>;
  readonly sabitler: Map<string, string>;
  varsayilan: ts.Node | null;
}

const FIILLER = new Set(["get", "post", "put", "patch", "delete", "head"]);

function coz(kimden: string, belirtec: string, oku: Okuyucu): string | null {
  let taban: string;
  if (belirtec.startsWith("@/")) taban = path.join(ELECTRON_SRC, belirtec.slice(2));
  else if (belirtec.startsWith("@shared/")) taban = path.join(ELECTRON_SHARED, belirtec.slice(8));
  else if (belirtec.startsWith(".")) taban = path.resolve(path.dirname(kimden), belirtec);
  else return null;
  for (const aday of [taban, `${taban}.ts`, `${taban}.tsx`, path.join(taban, "index.ts"), path.join(taban, "index.tsx")]) {
    if (/\.tsx?$/.test(aday) && oku(aday) !== null) return aday;
  }
  return null;
}

function ifadeMetni(n: ts.Node, sf: ts.SourceFile): string {
  return n.getText(sf).replace(/\s+/g, " ");
}

function modulKur(abs: string, oku: Okuyucu): Modul | null {
  const metin = oku(abs);
  if (metin === null) return null;
  const sf = ts.createSourceFile(abs, metin, ts.ScriptTarget.Latest, true, abs.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const m: Modul = { sf, rel: path.relative(ELECTRON_SRC, abs), baglar: new Map(), ustDuzey: new Map(), uyeler: new Map(), sabitler: new Map(), varsayilan: null };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause && !st.importClause.isTypeOnly) {
      const mod = coz(abs, st.moduleSpecifier.text, oku);
      const ic = st.importClause;
      if (ic.name) m.baglar.set(ic.name.text, { mod, ad: "default" });
      const nb = ic.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) m.baglar.set(nb.name.text, { mod, ad: "*" });
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) if (!el.isTypeOnly) m.baglar.set(el.name.text, { mod, ad: (el.propertyName ?? el.name).text });
      }
    }
    if (ts.isFunctionDeclaration(st) && st.name) m.ustDuzey.set(st.name.text, st);
    if (ts.isFunctionDeclaration(st) && st.modifiers?.some((x) => x.kind === ts.SyntaxKind.DefaultKeyword)) m.varsayilan = st;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        m.ustDuzey.set(d.name.text, d.initializer);
        if (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer)) m.sabitler.set(d.name.text, d.initializer.text);
      }
    }
    if (ts.isExportAssignment(st)) m.varsayilan = st.expression;
  }
  const gez = (n: ts.Node): void => {
    if ((ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n)) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
      const ad = n.name.text;
      const liste = m.uyeler.get(ad) ?? [];
      liste.push(ts.isPropertyAssignment(n) ? n.initializer : n);
      m.uyeler.set(ad, liste);
    }
    // Dinamik içe aktarım: `const { authService } = await import("@/services/authService")`.
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isObjectBindingPattern(n.name)) {
      const ic = ifadeMetni(n.initializer, sf);
      const hedef = /import\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(ic)?.[1];
      if (hedef) {
        const mod = coz(abs, hedef, oku);
        for (const el of n.name.elements) {
          if (ts.isIdentifier(el.name)) m.baglar.set(el.name.text, { mod, ad: el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text });
        }
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return m;
}

/** Tohumlardan çağrı grafiğini gezer. `oku` verilirse dosyalar ondan okunur (sonda için). */
export function k5PanelCagrilari(oku: Okuyucu = (abs) => (fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null)): K5Cikarimi {
  const moduller = new Map<string, Modul | null>();
  const modul = (abs: string): Modul | null => {
    if (!moduller.has(abs)) moduller.set(abs, modulKur(abs, oku));
    return moduller.get(abs) ?? null;
  };
  const kuyruk: Array<[Modul, ts.Node]> = [];
  const gorulen = new Set<string>();
  const ekle = (m: Modul, n: ts.Node): void => {
    const k = `${m.rel}#${n.pos}`;
    if (gorulen.has(k)) return;
    gorulen.add(k);
    kuyruk.push([m, n]);
  };
  const cagrilar: PanelCagrisi[] = [];
  const olculemedi: string[] = [];
  const oluTohum: string[] = [];

  for (const tohum of Object.keys(K5_TOHUMLARI)) {
    const [rel, ad] = tohum.split("#");
    const m = modul(path.join(ELECTRON_SRC, rel!));
    const dugumler = m ? [...(m.ustDuzey.has(ad!) ? [m.ustDuzey.get(ad!)!] : []), ...(m.uyeler.get(ad!) ?? [])] : [];
    if (!m || dugumler.length === 0) oluTohum.push(tohum);
    else for (const d of dugumler) ekle(m, d);
  }

  const bagiIzle = (bag: Bag, uye: string | null): void => {
    if (!bag.mod) return;
    const hedef = modul(bag.mod);
    if (!hedef) return;
    if (uye !== null) {
      for (const d of hedef.uyeler.get(uye) ?? []) ekle(hedef, d);
      const ust = hedef.ustDuzey.get(uye);
      if (ust && bag.ad === "*") ekle(hedef, ust);
      return;
    }
    if (bag.ad === "default") {
      if (hedef.varsayilan) {
        if (ts.isIdentifier(hedef.varsayilan)) {
          const ust = hedef.ustDuzey.get(hedef.varsayilan.text);
          if (ust) ekle(hedef, ust);
        } else ekle(hedef, hedef.varsayilan);
      }
      return;
    }
    const ust = hedef.ustDuzey.get(bag.ad);
    if (ust) ekle(hedef, ust);
    else if (hedef.baglar.has(bag.ad)) bagiIzle(hedef.baglar.get(bag.ad)!, null); // yeniden dışa aktarım
  };

  const urlCoz = (m: Modul, n: ts.Expression): string | null => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) {
      let s = n.head.text;
      for (const span of n.templateSpans) {
        const e = span.expression;
        s += ts.isIdentifier(e) && m.sabitler.has(e.text) ? m.sabitler.get(e.text)! : "{x}";
        s += span.literal.text;
      }
      return s;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const a = urlCoz(m, n.left);
      const b = urlCoz(m, n.right);
      return a !== null && b !== null ? a + b : null;
    }
    if (ts.isIdentifier(n) && m.sabitler.has(n.text)) return m.sabitler.get(n.text)!;
    return null;
  };

  const apiIstemcisiMi = (m: Modul, ad: string): boolean => {
    const bag = m.baglar.get(ad);
    return bag !== undefined && bag.mod !== null && /services[/\\]apiClient\.tsx?$/.test(bag.mod);
  };

  while (kuyruk.length > 0) {
    const [m, kok] = kuyruk.shift()!;
    const gez = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const c = n.expression;
        if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && apiIstemcisiMi(m, c.expression.text) && FIILLER.has(c.name.text)) {
          const satir = m.sf.getLineAndCharacterOfPosition(n.getStart(m.sf)).line + 1;
          const url = n.arguments[0] ? urlCoz(m, n.arguments[0]) : null;
          if (url === null) olculemedi.push(`${m.rel}:${satir} çözülemeyen URL: ${n.arguments[0] ? ifadeMetni(n.arguments[0], m.sf) : "(yok)"}`);
          else cagrilar.push({ method: c.name.text.toUpperCase(), path: url.split("?")[0]!, kaynak: `${m.rel}:${satir}` });
        }
        const metin = ifadeMetni(c, m.sf);
        if (metin === "fetch" || /^axios(\.(get|post|put|patch|delete|head|request))?$/.test(metin)) {
          olculemedi.push(`${m.rel}:${m.sf.getLineAndCharacterOfPosition(n.getStart(m.sf)).line + 1} tanınmayan HTTP istemcisi: ${metin}`);
        }
      }
      if (ts.isPropertyAccessExpression(n)) {
        let kok2: ts.Expression = n.expression;
        while (ts.isPropertyAccessExpression(kok2) || ts.isCallExpression(kok2) || ts.isNonNullExpression(kok2) || ts.isParenthesizedExpression(kok2)) {
          kok2 = ts.isCallExpression(kok2) ? kok2.expression : ts.isPropertyAccessExpression(kok2) ? kok2.expression : kok2.expression;
        }
        if (ts.isIdentifier(kok2) && !apiIstemcisiMi(m, kok2.text)) {
          const bag = m.baglar.get(kok2.text);
          if (bag) bagiIzle(bag, n.name.text);
          else if (m.ustDuzey.has(kok2.text)) for (const d of m.uyeler.get(n.name.text) ?? []) ekle(m, d);
        }
      }
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        // `X.uye` biçiminde kök ad üye izlemesine bırakılır: nesnenin TAMAMI gezilirse çağrılmayan uçlar da sayılırdı.
        const adKonumu =
          ts.isPropertyAccessExpression(p) ||
          ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)) && p.name === n);
        // `apiClient` uçtur: içine inilmez (kesiciler iş çağrısı yapmaz; çağrı yukarıda sayıldı).
        if (!adKonumu && !apiIstemcisiMi(m, n.text)) {
          const bag = m.baglar.get(n.text);
          if (bag) bagiIzle(bag, null);
          else {
            const ust = m.ustDuzey.get(n.text);
            if (ust && ust !== kok) ekle(m, ust);
          }
        }
      }
      ts.forEachChild(n, gez);
    };
    gez(kok);
  }
  const tekil = new Map(cagrilar.map((c) => [`${c.method} ${c.path}`, c] as const));
  return {
    cagrilar: [...tekil.values()].sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`)),
    olculemedi,
    oluTohum,
    ziyaretEdilenDosya: [...moduller.values()].filter(Boolean).length,
  };
}
