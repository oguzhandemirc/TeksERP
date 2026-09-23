// =============================================================================
// BEKÇİ AYAR HİJYENİ — global ayar yazan bekçinin geri alması `finally`de mi (AST)
// =============================================================================
// Global ayar = bütün paketin paylaştığı durum: sistem ayarı / modül bayrağı (`system_settings`,
// `systemSettingService.set|setFeatureFlags`, `/api/feature-flags`, `/api/admin/settings`) ve numara
// serisi biçimi (`number_series`, `number_series_lines`, `/api/number-series`, seri servisi yazıcıları).
// Fikstür satırı DEĞİL: onu bekçinin kendi teardown'u siler ve başkasını etkilemez; ayar ise düşen
// bekçiden sonraki HER bekçiye sızar ve suç başkasına kalır (ölçüldü 2026-09-24: `depo.multiEnabled`
// yanlışta kaldı → `test_module_grandfathering §2d` kırmızı).
//
// KURAL (kodu ölçer, anlatımı değil):
//   YAZMA OLAYI = doğrudan yazım ya da dosyada yazım yapan bir fonksiyona çağrı.
//   Her olay RESTORE ya da SET sınıflanır: bir `finally` bloğunun (ya da söz zincirinin `.finally(…)`
//   geri çağrısının) içindeyse ya da yalnız RESTORE
//   bağlamlarından çağrılan bir fonksiyonun içindeyse RESTORE; aksi SET.
//   Bir dosya bir sınıfta (AYAR / SERI) SET olayı taşıyorsa, o sınıfta en az bir RESTORE olayı
//   taşımak ZORUNDADIR. Yoksa geri alma `finally` dışında (ya da hiç) yapılıyordur → ihlal.
// =============================================================================
import ts from "typescript";

export type AyarSinifi = "AYAR" | "SERI";
/** `anahtarlar`: yazılan ayar anahtarları (kaynak metni); `null` = anahtar çözülemedi (genel yazım, ör. döngü). */
export interface YazmaOlayi { satir: number; sinif: AyarSinifi; baglam: "SET" | "RESTORE"; metin: string; anahtarlar: string[] | null }
export interface DosyaSonucu { dosya: string; olaylar: YazmaOlayi[]; ihlal: AyarSinifi[]; ortusmeyen: string[] }

const AYAR_MODEL = new Set(["systemSetting"]);
const SERI_MODEL = new Set(["numberSeries", "numberSeriesLine"]);
const YAZAN_METOD = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const AYAR_SERVIS_METOD = new Set(["set", "setFeatureFlags", "setMany", "setJson"]);
const SERI_SERVIS_FN = new Set(["updateSeriesFormat", "updateSeriesCounter", "updateSeriesSource", "cancelPendingSeriesFormat", "setSeriesCounter", "setSeriesSource"]);
const SQL_YAZIM = /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"?(system_settings|number_series_lines|number_series)"?/i;
const AYAR_UC = /\/api\/(feature-flags|admin\/settings)(?![\w-])/;
const SERI_UC = /\/api\/number-series(?![\w-])/;
const YAZAN_HTTP = /^(PATCH|PUT|POST|DELETE)$/;

function metinOf(n: ts.Node, sf: ts.SourceFile): string {
  return n.getText(sf).replace(/\s+/g, " ").slice(0, 90);
}

/** Doğrudan yazım mı; öyleyse sınıfı. */
function dogrudanYazim(n: ts.Node, sf: ts.SourceFile): AyarSinifi | null {
  if (ts.isCallExpression(n)) {
    const e = n.expression;
    if (ts.isPropertyAccessExpression(e)) {
      const metod = e.name.text;
      const ic = e.expression;
      // prisma.systemSetting.upsert(...) / tx.numberSeries.update(...)
      if (YAZAN_METOD.has(metod) && ts.isPropertyAccessExpression(ic)) {
        if (AYAR_MODEL.has(ic.name.text)) return "AYAR";
        if (SERI_MODEL.has(ic.name.text)) return "SERI";
      }
      // systemSettingService.set(...) / .setFeatureFlags(...)
      if (AYAR_SERVIS_METOD.has(metod) && ts.isIdentifier(ic) && /systemSetting/i.test(ic.text)) return "AYAR";
      // prisma.$executeRaw(`UPDATE system_settings …`) çağrı biçimi
      if ((metod === "$executeRawUnsafe" || metod === "$executeRaw" || metod === "query") && n.arguments[0] && SQL_YAZIM.test(n.arguments[0].getText(sf))) {
        return /number_series/i.test(n.arguments[0].getText(sf)) ? "SERI" : "AYAR";
      }
    }
    if (ts.isIdentifier(e) && SERI_SERVIS_FN.has(e.text)) return "SERI";
    // HTTP: bir argümanda uç yolu + yöntem (argüman ya da { method }) yazan
    const argMetin = n.arguments.map((a) => a.getText(sf)).join(" ");
    const uc = AYAR_UC.test(argMetin) ? "AYAR" : SERI_UC.test(argMetin) ? "SERI" : null;
    if (uc) {
      const yontem = n.arguments.some((a) => ts.isStringLiteral(a) && YAZAN_HTTP.test(a.text)) ||
        n.arguments.some((a) => ts.isObjectLiteralExpression(a) && a.properties.some((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "method" && ts.isStringLiteral(p.initializer) && YAZAN_HTTP.test(p.initializer.text)));
      if (yontem) return uc;
    }
  }
  // prisma.$executeRaw`UPDATE system_settings …`
  if (ts.isTaggedTemplateExpression(n) && /\$executeRaw/.test(n.tag.getText(sf)) && SQL_YAZIM.test(n.template.getText(sf))) {
    return /number_series/i.test(n.template.getText(sf)) ? "SERI" : "AYAR";
  }
  return null;
}

/** Anahtar metni "bilinen" mi: string literali ya da BÜYÜK_HARF sabit. Değişken (döngü `key`i) bilinmez. */
function bilinenAnahtar(e: ts.Expression | undefined, sf: ts.SourceFile): string | null {
  if (!e) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isIdentifier(e) && /^[A-Z][A-Z0-9_]*$/.test(e.text)) return e.text;
  if (ts.isPropertyAccessExpression(e) && /^[A-Z][A-Z0-9_]*$/.test(e.expression.getText(sf))) return e.getText(sf);
  return null;
}
function nesneAlani(o: ts.Expression | undefined, ad: string): ts.Expression | undefined {
  if (!o || !ts.isObjectLiteralExpression(o)) return undefined;
  for (const p of o.properties) if (ts.isPropertyAssignment(p) && p.name.getText(ts.getOriginalNode(p).getSourceFile()) === ad) return p.initializer;
  return undefined;
}
/** Doğrudan yazımın anahtarları (çözülemezse null). */
function dogrudanAnahtarlar(n: ts.Node, sf: ts.SourceFile): string[] | null {
  if (!ts.isCallExpression(n)) return null;
  const e = n.expression;
  const a0 = n.arguments[0];
  if (ts.isPropertyAccessExpression(e)) {
    const metod = e.name.text;
    if (metod === "setFeatureFlags" && a0 && ts.isObjectLiteralExpression(a0)) {
      const k = a0.properties.filter(ts.isPropertyAssignment).map((p) => p.name.getText(sf));
      return k.length ? k : null;
    }
    if (metod === "set" && a0) { const k = bilinenAnahtar(a0, sf); return k ? [k] : null; }
    // prisma.<model>.<metod>({ where: { key|seriesKey }, create: { key } })
    const where = nesneAlani(a0, "where");
    const k = bilinenAnahtar(nesneAlani(where, "key") ?? nesneAlani(where, "seriesKey") ?? nesneAlani(nesneAlani(a0, "create"), "key"), sf);
    if (k) return [k];
  }
  // HTTP `/api/admin/settings/<ANAHTAR>`: anahtar YOLDA (gövde `{ value }` anahtar değildir)
  for (const arg of n.arguments) {
    if (ts.isTemplateExpression(arg)) {
      // `${BASE}/api/admin/settings/${ANAHTAR}` — yoldan hemen sonraki yer tutucu anahtardır
      for (let i = 0; i < arg.templateSpans.length; i++) {
        const onceki = i === 0 ? arg.head.text : arg.templateSpans[i - 1]!.literal.text;
        if (/\/api\/admin\/settings\/$/.test(onceki)) return [arg.templateSpans[i]!.expression.getText(sf)];
      }
    }
    if ((ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) && /\/api\/admin\/settings\/([^/?]+)/.test(arg.text)) return [/\/api\/admin\/settings\/([^/?]+)/.exec(arg.text)![1]!];
  }
  // HTTP gövdesi: JSON.stringify({ a: …, b: … })
  for (const arg of n.arguments) {
    const govde = ts.isObjectLiteralExpression(arg) ? nesneAlani(arg, "body") : undefined;
    if (govde && ts.isCallExpression(govde) && govde.expression.getText(sf) === "JSON.stringify" && govde.arguments[0] && ts.isObjectLiteralExpression(govde.arguments[0])) {
      const k = govde.arguments[0].properties.filter(ts.isPropertyAssignment).map((p) => p.name.getText(sf));
      if (k.length) return k;
    }
  }
  return null;
}

/** Düğümün bağlı olduğu adlı fonksiyon (bildirim ya da `const x = () => …`). */
function fonksiyonAdi(fn: ts.Node): string | null {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
  return null;
}

/** Anahtar metnini ortak ada (DB anahtarı) çevirir; verilmezse metin olduğu gibi. */
export type AnahtarCozucu = (metin: string) => string;

export function dosyaTara(dosya: string, metin: string, cozucu: AnahtarCozucu = (x) => x): DosyaSonucu {
  const sf = ts.createSourceFile(dosya, metin, ts.ScriptTarget.Latest, true);
  // Dosya içi sabitler: `const BAYRAK = "x.y"` → "x.y" (anahtar karşılaştırması DB adıyla yapılsın)
  const yerelSabit = new Map<string, string>();
  const topla0 = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))) yerelSabit.set(n.name.text, n.initializer.text);
    ts.forEachChild(n, topla0);
  };
  topla0(sf);
  // Çözücü "" dönerse anahtar BİLİNMEZ sayılır (ör. ayar değil seri kaynağına yazan bayrak alanı).
  const coz = (k: string[] | null): string[] | null => {
    if (!k) return null;
    const r = k.map((x) => cozucu(yerelSabit.get(x) ?? x));
    return r.some((x) => x === "") ? null : r;
  };
  const satir = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // 1) fonksiyonlar ve doğrudan yazımlar
  const fonksiyonlar = new Map<string, ts.Node>();
  const dogrudan: Array<{ n: ts.Node; sinif: AyarSinifi }> = [];
  const gez1 = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) { const ad = fonksiyonAdi(n); if (ad) fonksiyonlar.set(ad, n); }
    const s = dogrudanYazim(n, sf);
    if (s) dogrudan.push({ n, sinif: s });
    ts.forEachChild(n, gez1);
  };
  gez1(sf);

  /** Düğümü kapsayan en yakın ADLI fonksiyon. */
  const kapsayanFn = (n: ts.Node): string | null => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isFunctionLike(p)) { const ad = fonksiyonAdi(p); if (ad) return ad; }
    }
    return null;
  };
  /** Düğüm bir `finally` bloğunun içinde mi (kapsayan fonksiyon sınırına kadar). */
  const finallyIcinde = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n; p && p.parent; p = p.parent) {
      if (ts.isFunctionLike(p.parent) && fonksiyonAdi(p.parent)) return false;
      if (ts.isTryStatement(p.parent) && p.parent.finallyBlock === p) return true;
      // `main().finally(async () => { … })` — söz zincirinin finally'si de her koşulda koşar
      if (ts.isCallExpression(p.parent) && p.parent.arguments.includes(p as ts.Expression) &&
        ts.isPropertyAccessExpression(p.parent.expression) && p.parent.expression.name.text === "finally") return true;
    }
    return false;
  };

  // 2) yazan fonksiyonlar (sabit nokta) + sınıfları
  const yazanSinif = new Map<string, Set<AyarSinifi>>();
  for (const d of dogrudan) {
    const f = kapsayanFn(d.n);
    if (f) { const k = yazanSinif.get(f) ?? new Set(); k.add(d.sinif); yazanSinif.set(f, k); }
  }
  const cagrilar: Array<{ n: ts.CallExpression; hedef: string }> = [];
  const gez2 = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && fonksiyonlar.has(n.expression.text)) cagrilar.push({ n, hedef: n.expression.text });
    ts.forEachChild(n, gez2);
  };
  gez2(sf);
  for (let degisti = true; degisti;) {
    degisti = false;
    for (const c of cagrilar) {
      const hedef = yazanSinif.get(c.hedef);
      const f = kapsayanFn(c.n);
      if (!hedef || !f || f === c.hedef) continue;
      const k = yazanSinif.get(f) ?? new Set<AyarSinifi>();
      for (const s of hedef) if (!k.has(s)) { k.add(s); degisti = true; }
      yazanSinif.set(f, k);
    }
  }

  // 3) bağlam: RESTORE ⇔ finally içinde ya da kapsayan fonksiyonun BÜTÜN çağrıları RESTORE
  const fnBaglam = new Map<string, "SET" | "RESTORE">();
  const baglamOf = (n: ts.Node, iz: Set<string>): "SET" | "RESTORE" => {
    if (finallyIcinde(n)) return "RESTORE";
    const f = kapsayanFn(n);
    if (!f) return "SET";
    if (fnBaglam.has(f)) return fnBaglam.get(f)!;
    if (iz.has(f)) return "SET";
    iz.add(f);
    const cagiranlar = cagrilar.filter((c) => c.hedef === f);
    const sonuc = cagiranlar.length > 0 && cagiranlar.every((c) => baglamOf(c.n, iz) === "RESTORE") ? "RESTORE" : "SET";
    fnBaglam.set(f, sonuc);
    return sonuc;
  };

  const olaylar: YazmaOlayi[] = [];
  // Fonksiyonun SABİT anahtarı: içindeki doğrudan yazımlar tek bilinen anahtar taşıyorsa (ör. `setFlag(on)`
  // içinde `SETTING_KEY`). Parametreli yardımcıda çağrının ilk argümanı anahtardır.
  const fnSabit = new Map<string, string[] | null>();
  for (const d of dogrudan) {
    const f = kapsayanFn(d.n);
    if (!f) continue;
    const k = dogrudanAnahtarlar(d.n, sf);
    const eski = fnSabit.get(f);
    if (eski === undefined) fnSabit.set(f, k);
    else if (eski === null || k === null || eski.join() !== k.join()) fnSabit.set(f, null);
  }
  for (const d of dogrudan) olaylar.push({ satir: satir(d.n), sinif: d.sinif, baglam: baglamOf(d.n, new Set()), metin: metinOf(d.n, sf), anahtarlar: coz(dogrudanAnahtarlar(d.n, sf)) });
  for (const c of cagrilar) {
    const s = yazanSinif.get(c.hedef);
    if (!s) continue;
    const arg = bilinenAnahtar(c.n.arguments[0], sf);
    const anahtarlar = coz(arg ? [arg] : (fnSabit.get(c.hedef) ?? null));
    for (const sinif of s) olaylar.push({ satir: satir(c.n), sinif, baglam: baglamOf(c.n, new Set()), metin: metinOf(c.n, sf), anahtarlar });
  }
  const ihlal = (["AYAR", "SERI"] as const).filter((s) => olaylar.some((o) => o.sinif === s && o.baglam === "SET") && !olaylar.some((o) => o.sinif === s && o.baglam === "RESTORE"));
  // ANAHTAR DÜZEYİ: bilinen anahtarlı her SET, aynı anahtarı geri alan bir RESTORE ya da o sınıfta
  // anahtarı çözülemeyen (genel — ör. önceki değerler üzerinde döngü) bir RESTORE ile örtülmeli.
  const ortusmeyen: string[] = [];
  for (const sinif of ["AYAR", "SERI"] as const) {
    const restore = olaylar.filter((o) => o.sinif === sinif && o.baglam === "RESTORE");
    if (restore.length === 0 || restore.some((o) => o.anahtarlar === null)) continue;
    const geriAlinan = new Set(restore.flatMap((o) => o.anahtarlar ?? []));
    for (const o of olaylar.filter((x) => x.sinif === sinif && x.baglam === "SET" && x.anahtarlar)) {
      for (const k of o.anahtarlar!) if (!geriAlinan.has(k)) ortusmeyen.push(`:${o.satir} ${sinif} ${k}`);
    }
  }
  return { dosya, olaylar, ihlal: [...ihlal], ortusmeyen: [...new Set(ortusmeyen)] };
}

/**
 * Kaynaktan ortak-ad çözücü: `SETTING_KEYS.X` → "db.anahtari" ve `setFeatureFlags` girdi alanı
 * (`loginMethods`) → o alanın bloğunda yazılan TEK `SETTING_KEYS.X`in DB adı. Elle liste YOK: eşleme
 * `system-setting.service.ts`in kendisinden okunur (servis değişince çözücü de değişir).
 */
export function kaynaktanCozucu(servisMetni: string): AnahtarCozucu {
  const sf = ts.createSourceFile("system-setting.service.ts", servisMetni, ts.ScriptTarget.Latest, true);
  const ayar = new Map<string, string>();
  const alan = new Map<string, string>();
  const gez = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "SETTING_KEYS" && n.initializer) {
      let o: ts.Expression = n.initializer;
      while (ts.isAsExpression(o) || ts.isSatisfiesExpression(o)) o = o.expression;
      if (ts.isObjectLiteralExpression(o)) for (const p of o.properties) if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)) ayar.set(p.name.getText(sf), p.initializer.text);
    }
    if (ts.isIfStatement(n) && /hasOwnProperty\.call\(input, "([A-Za-z]+)"\)/.test(n.expression.getText(sf))) {
      const ad = /hasOwnProperty\.call\(input, "([A-Za-z]+)"\)/.exec(n.expression.getText(sf))![1]!;
      const refs = new Set([...n.thenStatement.getText(sf).matchAll(/SETTING_KEYS\.([A-Z0-9_]+)/g)].map((m) => m[1]!));
      alan.set(ad, refs.size === 1 ? [...refs][0]! : "");
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return (metin: string) => {
    const m = /^SETTING_KEYS\.([A-Z0-9_]+)$/.exec(metin);
    if (m && ayar.has(m[1]!)) return ayar.get(m[1]!)!;
    if (alan.has(metin)) return ayar.get(alan.get(metin)!) ?? ""; // tek SETTING_KEYS'e bağlanmayan alan: bilinmez
    return metin;
  };
}
