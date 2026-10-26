// =============================================================================
// BEKÇİ — EKRAN YOLU: backend mesajındaki menü yolu panelin menüsünde VAR mı (DB'siz)
// =============================================================================
// Kullanıcıya dönen "şu ekrandan yapın" cümleleri tek kaynaktan (`src/constants/panel-ekran-yolu.ts`,
// ayar ekranları `panel-ayar-yolu.ts` → `test_ayar_yol_tarifi`) gelir. Doğduğu gün 14 cümle elle
// yazılmıştı; 7'si panelde olmayan yolu gösteriyordu ("Sistem → Kalite Sınıfları", "Kalite → Hata
// Tipleri", "Sistem → Raporlar", "Tanımlar → Cihaz Kaydı", "Makine Donanımı", "Envanter", "Etiketler →
// Atamalar") (arşiv 2026-10-13).
//   §1 panel menü kaynakları okunur (AST): `nav-config` sol menü + beş hub karosu (Tanımlar ·
//      Operasyon · Muhasebe · Yetkilendirme · Sistem); `TERIM.x.y` başlıkları backend TERIM'iyle
//      çözülür (iki dosya bayt-eşit, `test_terim_eski_ad`)
//   §2 `PANEL_EKRAN` her girişi: menü sol menüde, karo o menünün hub'ında, alt etiket beyanlı
//      panel dosyasında; `ALT_KAYNAK` ile tablo birebir
//   §3 backend `src/` dizgelerinde (yorum değil) elle yazılmış menü yolu YOK — beyanlı istisna hariç
//   §4 her istisna satırı hâlâ bir dizgeyle eşleşiyor (ölü muaf birikmez)
//   §5 sondalar (dosyada yaşar)
// NEGATİF SONDA (B, bu commit): tabloda "Hata Tipleri" → "Hata Tipi" → §2a ❌; warehouse.helper'a
// elle "Tanımlar → Depolar'dan" geri yazıldı → §3a ❌.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { PANEL_EKRAN, YOL_AYRACI, ekranYolu, type PanelEkran } from "../src/constants/panel-ekran-yolu";
import { TERIM, TERIM_AD } from "../src/constants/terim";
import { hubKaroDosyalari } from "./lib/panel-karo-dosyalari";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const KOK = path.join(__dirname, "..");
const SRC = path.join(KOK, "src");
const PANEL_SRC = path.join(KOK, "..", "Electron", "src");
const NAV = "components/layout/nav-config.ts";
/** Sol menü satırının `to`su → o hub'ın klasörü (karo dosyaları `scripts/lib/panel-karo-dosyalari.ts`ten; UX-2 bölünmesi). */
const HUB: Record<string, string> = {
  "/definitions": "Definitions",
  "/operations": "Operations",
  "/finance": "Finance",
  "/access": "Access",
  "/system": "System",
  "/quality": "Quality",
  "/documents": "Documents",
};
/** Karo içi alt etiketin (sekme/bölüm/düğme) paneldeki yeri. */
const ALT_KAYNAK: Partial<Record<PanelEkran, string>> = {
  etiketDuzenleri: "pages/Labels/tabs-config.ts",
  etiketAtamalari: "pages/Labels/tabs-config.ts",
  kisaKimlikler: "pages/Access/Users/AccessUsersPage.tsx",
  raporGorunurlugu: "pages/System/ModuleProfile/ModuleProfilePage.tsx",
};
const TABLOLAR = ["constants/panel-ekran-yolu.ts", "constants/panel-ayar-yolu.ts"];
/** Menü yolu GİBİ görünen ama menü yolu olmayan (ya da kökü tablodan gelen) dizgeler — dosya + parça + neden. */
const ISTISNA: ReadonlyArray<{ dosya: string; parca: string; neden: string }> = [
  { dosya: "constants/report-catalog.ts", parca: "Sipariş → Teslim Süresi", neden: "rapor başlığı (süre aralığı), menü yolu değil" },
  { dosya: "constants/audit-tablo-etiketleri.ts", parca: "Top → Çuval Atama", neden: "audit modül adı (atama yönü), menü yolu değil — B2 sözlük taşıması" },
  { dosya: "constants/audit-tablo-etiketleri.ts", parca: "Kartela → Çuval", neden: "audit modül adı (atama yönü), menü yolu değil" },
  { dosya: "constants/audit-tablo-etiketleri.ts", parca: "Çuval → Sevkiyat", neden: "audit modül adı (atama yönü), menü yolu değil" },
  { dosya: "services/helpers/targetable-property.helper.ts", parca: "Kat → Tambur, Gramaj → Kurşun", neden: "özellik → istasyon eşlemesi örneği" },
  { dosya: "services/import/adapters/station.adapter.ts", parca: "Hayır → KK1", neden: "içe aktarım sütun yardımı (değer → anlam)" },
  { dosya: "services/subcontractor.service.ts", parca: "Partiler → Birleştir", neden: "karo içi gezinme; kökü `ekranYolu(\"terbiyeIsEmirleri\")`" },
  { dosya: "constants/permission-catalog.ts", parca: "Sistem → ", neden: "izin açıklaması (izin kataloğu ekranında kısa ekran adı); ayrı tur" },
  { dosya: "constants/permission-catalog.ts", parca: "Özellik Anahtarları → ", neden: "izin açıklaması; ayrı tur" },
  { dosya: "constants/permission-catalog.ts", parca: "Baskı & Cihazlar → ", neden: "izin açıklaması; ayrı tur" },
  { dosya: "constants/permission-catalog.ts", parca: "Şirket & Güvenlik → ", neden: "izin açıklaması; ayrı tur" },
];

function kaynak(rel: string): ts.SourceFile {
  const tam = path.join(PANEL_SRC, rel);
  return ts.createSourceFile(rel, fs.readFileSync(tam, "utf8"), ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** `TERIM.a.b` · `TERIM_AD.a` → değer; çözülemezse null. */
function terimCoz(e: ts.Expression): string | null {
  const zincir: string[] = [];
  let n: ts.Expression = e;
  while (ts.isPropertyAccessExpression(n)) { zincir.unshift(n.name.text); n = n.expression; }
  if (!ts.isIdentifier(n) || (n.text !== "TERIM" && n.text !== "TERIM_AD")) return null;
  let v: unknown = n.text === "TERIM" ? TERIM : TERIM_AD;
  for (const k of zincir) v = (v as Record<string, unknown> | undefined)?.[k];
  return typeof v === "string" ? v : null;
}
/** Başlık ifadesi: düz dizge · `TERIM.x.y` · `${TERIM.x.y} Şablonları`. */
function metinCoz(e: ts.Expression): string | null {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return terimCoz(e);
  if (ts.isTemplateExpression(e)) {
    let s = e.head.text;
    for (const sp of e.templateSpans) {
      const v = terimCoz(sp.expression);
      if (v === null) return null;
      s += v + sp.literal.text;
    }
    return s;
  }
  return null;
}
function prop(o: ts.ObjectLiteralExpression, ad: string): ts.Expression | null {
  for (const p of o.properties) if (ts.isPropertyAssignment(p) && p.name.getText() === ad) return p.initializer;
  return null;
}
/** `export const <ad>Tiles = [ {…}, … ]` öğelerinin `alan` değerleri (çözülemeyen → "?"); birleşim dizileri (`...x`) öğe değildir. */
function diziAlanlari(sf: ts.SourceFile, alan: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text.endsWith("Tiles") && n.initializer && ts.isArrayLiteralExpression(n.initializer)) {
      for (const el of n.initializer.elements) {
        if (!ts.isObjectLiteralExpression(el)) continue;
        const v = prop(el, alan);
        out.push(v ? metinCoz(v) ?? "?" : "?");
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

interface Menu { label: string; to: string }
function solMenu(): Menu[] {
  const out: Menu[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      const l = prop(n, "label");
      const t = prop(n, "to");
      const lv = l ? metinCoz(l) : null;
      if (lv !== null && t && ts.isStringLiteral(t)) out.push({ label: lv, to: t.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(kaynak(NAV));
  return out;
}
/** Dosyada dizge ya da JSX metni olarak geçen bütün etiketler (kırpılmış). */
function dosyaEtiketleri(rel: string): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.add(n.text.trim());
    if (ts.isJsxText(n)) out.add(n.text.trim());
    ts.forEachChild(n, visit);
  };
  visit(kaynak(rel));
  return out;
}

interface PanelMenusu { menu: Map<string, string[]>; okunamayan: string[] }
function paneliOku(): PanelMenusu {
  const menu = new Map<string, string[]>();
  const okunamayan: string[] = [];
  for (const m of solMenu()) {
    const hub = HUB[m.to];
    if (!hub) continue;
    const basliklar = hubKaroDosyalari(PANEL_SRC, hub).flatMap((f) => diziAlanlari(kaynak(f), "title"));
    basliklar.forEach((b, i) => { if (b === "?") okunamayan.push(`${m.label}#${i}`); });
    menu.set(m.label, basliklar);
  }
  return { menu, okunamayan };
}

type Giris = { menu: string; karo: string; alt?: string };
function girisFarklari(p: PanelMenusu, tablo: Record<string, Giris>, alt: Record<string, string | undefined>, etiket: (rel: string) => Set<string>): string[] {
  return Object.entries(tablo).flatMap(([k, e]) => {
    const karolar = p.menu.get(e.menu);
    if (!karolar) return [`${k}: sol menüde "${e.menu}" hub'ı yok`];
    if (!karolar.includes(e.karo)) return [`${k}: "${e.menu}" hub'ında "${e.karo}" karosu yok`];
    if (e.alt === undefined) return alt[k] ? [`${k}: ALT_KAYNAK var ama tabloda alt yok`] : [];
    const dosya = alt[k];
    if (!dosya) return [`${k}: alt "${e.alt}" için ALT_KAYNAK beyanı yok`];
    return etiket(dosya).has(e.alt) ? [] : [`${k}: "${e.alt}" ${dosya} içinde yok`];
  });
}

// UX-2 (2026-10-26): + Kalite Güvence · Belgeler; "Muhasebe" → "Ön Muhasebe"; "Bildirimler" satırı kalktı.
const KOK_MENU = ["Anasayfa", "Operasyon", "Kalite Güvence", "Maliyet & Teklif", "Ön Muhasebe", "Raporlar", "Tanımlar", "Belgeler", "Yetkilendirme", "Sistem"];
function desenler(kokler: readonly string[]): RegExp[] {
  return [
    new RegExp(`(^|[^\\p{L}])(${kokler.join("|")})\\s*[→›>]\\s*\\S`, "u"),
    /(^|[^\p{L}])\p{Lu}\p{Ll}+\s*[→›]\s*[\p{Lu}"]/u,
    /(^|[^\p{L}])\p{Lu}\p{Ll}+ > \p{Lu}/u,
  ];
}
let DESEN = desenler(KOK_MENU);
interface Bulgu { dosya: string; satir: number; metin: string }
function elleYollar(src: string, ad: string): Bulgu[] {
  const sf = ts.createSourceFile(ad, src, ts.ScriptTarget.Latest, true);
  const out: Bulgu[] = [];
  const visit = (n: ts.Node): void => {
    let metin: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) metin = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) metin = n.text;
    if (metin !== null && DESEN.some((d) => d.test(metin))) out.push({ dosya: ad, satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, metin });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const muafMi = (b: Bulgu): boolean => ISTISNA.some((i) => i.dosya === b.dosya && b.metin.includes(i.parca));

function tsDosyalari(dizin: string): string[] {
  return fs.readdirSync(dizin, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dizin, e.name);
    return e.isDirectory() ? tsDosyalari(p) : e.name.endsWith(".ts") ? [p] : [];
  });
}

function main(): void {
  console.log("\n=== Ekran yolu — backend mesajındaki menü yolu panelin menüsünde ===\n");
  const p = paneliOku();
  const karoSayisi = [...p.menu.values()].reduce((n, k) => n + k.length, 0);
  check("§1a panel menüsü okundu (körlük zemini: 7 hub, ≥ 60 karo)", p.menu.size === 7 && karoSayisi >= 60,
    `${[...p.menu.entries()].map(([m, k]) => `${m}:${k.length}`).join(" · ")}`);
  check("§1b her karo başlığı çözüldü (düz dizge / TERIM)", p.okunamayan.length === 0, p.okunamayan.join(" · "));
  check("§1c sol menü kökleri bekçinin bildiği kümede", solMenu().every((m) => KOK_MENU.includes(m.label)),
    solMenu().map((m) => m.label).filter((l) => !KOK_MENU.includes(l)).join(" · "));
  DESEN = desenler([...new Set([...KOK_MENU, ...solMenu().map((m) => m.label)])]);

  const fark = girisFarklari(p, PANEL_EKRAN, ALT_KAYNAK, dosyaEtiketleri);
  check("§2a `PANEL_EKRAN` her yolu panelde var (menü → karo → alt)", fark.length === 0, fark.join(" · "));
  check("§2b `ekranYolu` tek ayraçla biçimler", ekranYolu("etiketAtamalari") === ["Belgeler", "Etiketler", "Etiket Atamaları"].join(YOL_AYRACI) && YOL_AYRACI === " → ");

  const tumKaynak = tsDosyalari(SRC).filter((f) => !f.endsWith("panel-ekran-yolu.ts")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const kullanilmayan = Object.keys(PANEL_EKRAN).filter((k) => !tumKaynak.includes(`ekranYolu("${k}")`));
  check("§2c tablodaki her ekran en az bir mesajda kullanılıyor (ölü ayna satırı yok)", kullanilmayan.length === 0, kullanilmayan.join(" · "));

  const dosyalar = tsDosyalari(SRC).map((f) => path.relative(SRC, f).split(path.sep).join("/"));
  const bulgular = dosyalar.filter((rel) => !TABLOLAR.includes(rel)).flatMap((rel) => elleYollar(fs.readFileSync(path.join(SRC, rel), "utf8"), rel));
  const elle = bulgular.filter((b) => !muafMi(b));
  check("§3a backend dizgelerinde elle yazılmış menü yolu YOK (yol `panel-ekran-yolu`ndan gelir)", elle.length === 0,
    elle.map((b) => `${b.dosya}:${b.satir} "${b.metin.slice(0, 70)}"`).join(" · "));
  check("§3b körlük zemini: taranan dosya ≥ 300", dosyalar.length >= 300, String(dosyalar.length));
  const olu = ISTISNA.filter((i) => !bulgular.some((b) => b.dosya === i.dosya && b.metin.includes(i.parca)));
  check("§4a her istisna satırı hâlâ bir dizgeyle eşleşiyor", olu.length === 0, olu.map((i) => `${i.dosya} "${i.parca}"`).join(" · "));

  check("§5a sonda: elle yol yakalanır (kök menü, eski '>' biçimi, uydurma kök, şablon parçası)",
    elleYollar(`const a = "Tanımlar → Depolar'dan açın";`, "s.ts").length === 1
      && elleYollar("const a = `x ${b} Muhasebe > Faturalar`;", "s.ts").length === 1
      && elleYollar(`const a = "Kalite → Hata Tipleri'nden";`, "s.ts").length === 1
      && elleYollar("const a = `${b} — Makine Donanımı → Yazıcı IP`;", "s.ts").length === 1);
  check("§5b sonda: yorum, durum geçişi ve ayraçsız metin yakalanmaz",
    elleYollar(`// Tanımlar → Depolar\nconst a = "OFF → SHADOW"; const b = "x > 0"; const c = "Tanımlar ekranı";`, "s.ts").length === 0);
  const sahte = (e: Giris): number => girisFarklari(p, { x: e }, { x: e.alt ? "pages/Labels/tabs-config.ts" : undefined }, dosyaEtiketleri).length;
  check("§5c sonda: uydurma menü, kaymış karo ve olmayan alt etiket yakalanır",
    sahte({ menu: "Kalite", karo: "Hata Tipleri" }) === 1 && sahte({ menu: "Sistem", karo: "Kalite Sınıfları" }) === 1
      && sahte({ menu: "Belgeler", karo: "Etiketler", alt: "Atamalar" }) === 1 && sahte({ menu: "Belgeler", karo: "Etiketler", alt: "Etiket Atamaları" }) === 0);
}

try {
  main();
} catch (err) {
  fail++;
  console.error("❌ Bekçi hata ile durdu:", err);
}
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
