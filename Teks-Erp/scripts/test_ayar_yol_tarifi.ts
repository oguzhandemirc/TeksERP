// =============================================================================
// BEKÇİ — AYAR YOL TARİFİ: backend mesajındaki menü yolu panelde VAR mı (DB'siz)
// =============================================================================
// Kullanıcıya dönen "şuradan açılır" cümleleri tek kaynaktan (`src/constants/panel-ayar-yolu.ts`)
// gelir; o tablo panelin ayar kataloğunun (`Electron/src/pages/GeneralSettings/settings-config.ts`)
// aynasıdır. Menü 2026-09-24'te bölündü, backend'de 17 cümle "Genel Ayarlar …" demeye devam etti;
// kullanıcı alarmı açmak için olmayan menüyü aradı (arşiv 2026-10-11).
//   §1 panel kataloğu okunur (AST): ekran adı · kategori adı/bölümü · ayar satırı başlıkları
//      (körlük zemini) + `settingsCategoryTrail` biçimi beklenen kalıpta
//   §2 `PANEL_SETTING_SCREEN` her girişi panelin ürettiği menü yoluyla bayt bayt aynı
//   §3 `PANEL_SETTING_ROW` her satırı panelde O ekranda, AYNI başlıkla duruyor
//   §4 backend `src/` dizgelerinde (yorum değil) elle yazılmış AYAR yolu YOK: "Genel Ayarlar",
//      "Ayarlar →/>/›", "Sistem → <ayar ekranı>" (ekran adları panelden okunur) — tek muaf tablonun kendisi.
//      Sistem menüsünün ayar dışı ekranları (Raporlar, Lisans, Kalite Sınıfları…) bu bekçinin kapsamı dışında.
//   §5 tablodaki her satır en az bir yerde kullanılıyor (ölü ayna satırı birikmez)
//   §6 sondalar (dosyada yaşar): elle yol yakalanır, yorum yakalanmaz, kaymış ayna yakalanır
// GEREKLİ Mİ: evet — doğduğu gün ağaçta 17 bayat yol vardı (12'si "Genel Ayarlar", 5'i eski
// "Ayarlar > …" biçimi; dördünde ayar başlığı da paneldekinden farklıydı) + 7 doğru ama elle
// yazılmış "Sistem → Modüller" (tabloya bağlandı).
// NEGATİF SONDA (B, bu commit): tabloda "Tezgah izleme" → "Tezgah" → §2a ❌; satır başlığı bir harf
// değişti → §3a ❌; `loom-alarm.routes`a elle "Genel Ayarlar → Tezgah" geri yazıldı → §4a + §5a ❌.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { PANEL_SETTING_SCREEN, PANEL_SETTING_ROW } from "../src/constants/panel-ayar-yolu";

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
const PANEL = path.join(KOK, "..", "Electron", "src", "pages", "GeneralSettings", "settings-config.ts");
const TABLO = "constants/panel-ayar-yolu.ts";

interface PanelKategori { id: string; label: string; section: string; flags: Map<string, string> }
interface PanelKatalogu { sectionSurface: Map<string, string>; surfaceLabel: Map<string, string>; kategoriler: PanelKategori[]; trailGovdesi: string }

function strProp(o: ts.ObjectLiteralExpression, ad: string): string | null {
  for (const p of o.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === ad) {
      const v = p.initializer;
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) return v.text;
    }
  }
  return null;
}
function nesneHaritasi(o: ts.ObjectLiteralExpression): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of o.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))) {
      m.set(p.name.getText().replace(/^["']|["']$/g, ""), p.initializer.text);
    }
  }
  return m;
}

function paneliOku(kaynak: string): PanelKatalogu {
  const sf = ts.createSourceFile("settings-config.ts", kaynak, ts.ScriptTarget.Latest, true);
  const out: PanelKatalogu = { sectionSurface: new Map(), surfaceLabel: new Map(), kategoriler: [], trailGovdesi: "" };
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const ad = n.name.text;
      if (ad === "SECTION_SURFACE" && ts.isObjectLiteralExpression(n.initializer)) out.sectionSurface = nesneHaritasi(n.initializer);
      if (ad === "SURFACE_LABEL" && ts.isObjectLiteralExpression(n.initializer)) out.surfaceLabel = nesneHaritasi(n.initializer);
      if (ad === "SETTINGS_CATEGORIES" && ts.isArrayLiteralExpression(n.initializer)) {
        for (const el of n.initializer.elements) {
          if (!ts.isObjectLiteralExpression(el)) continue;
          const flags = new Map<string, string>();
          for (const p of el.properties) {
            if (ts.isPropertyAssignment(p) && p.name.getText() === "flags" && ts.isArrayLiteralExpression(p.initializer)) {
              for (const f of p.initializer.elements) {
                if (!ts.isObjectLiteralExpression(f)) continue;
                const key = strProp(f, "key");
                const title = strProp(f, "title");
                if (key && title) flags.set(key, title);
              }
            }
          }
          out.kategoriler.push({ id: strProp(el, "id") ?? "", label: strProp(el, "label") ?? "", section: strProp(el, "section") ?? "", flags });
        }
      }
    }
    if (ts.isFunctionDeclaration(n) && n.name?.text === "settingsCategoryTrail" && n.body) out.trailGovdesi = n.body.getText(sf);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Panelin `settingsCategoryTrail`i (biçimi §1c ölçer). */
function panelYolu(k: PanelKatalogu, id: string): string | null {
  const cat = k.kategoriler.find((c) => c.id === id);
  if (!cat) return null;
  const surface = k.sectionSurface.get(cat.section);
  const label = surface ? k.surfaceLabel.get(surface) : undefined;
  if (!surface || !label) return null;
  const base = `Sistem → ${label}`;
  return surface === "vendor" ? base : `${base} → ${cat.label}`;
}

function ekranFarklari(k: PanelKatalogu, tablo: Record<string, string>): string[] {
  return Object.entries(tablo).filter(([id, yol]) => panelYolu(k, id) !== yol).map(([id, yol]) => `${id}: tablo "${yol}" ↔ panel "${panelYolu(k, id) ?? "YOK"}"`);
}
function satirFarklari(k: PanelKatalogu, tablo: Record<string, { ekran: string; baslik: string }>): string[] {
  return Object.entries(tablo).flatMap(([key, s]) => {
    const cat = k.kategoriler.find((c) => c.flags.has(key));
    if (!cat) return [`${key}: panelde böyle bir ayar satırı yok`];
    if (cat.id !== s.ekran) return [`${key}: tablo ekranı "${s.ekran}" ↔ panelde "${cat.id}"`];
    const title = cat.flags.get(key);
    return title === s.baslik ? [] : [`${key}: tablo başlığı "${s.baslik}" ↔ panel "${title}"`];
  });
}

/** Elle yazılmış ayar yolu deseni — "Sistem → X" yalnız X bir AYAR ekranıysa (adlar panelden). */
function elleYolDeseni(ekranAdlari: readonly string[]): RegExp {
  const kac = ekranAdlari.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`Genel Ayarlar|Ayarlar\\s*[→>›]|Sistem\\s*[→>›]\\s*(${kac})`);
}
let ELLE_YOL = elleYolDeseni(["Özellik Anahtarları", "Modüller", "Baskı & Cihazlar", "Bu Bilgisayar", "Şirket & Güvenlik"]);
/** Dizge parçalarında (yorum değil) elle yazılmış ayar yolu. */
function elleYollar(kaynak: string, ad: string): string[] {
  const sf = ts.createSourceFile(ad, kaynak, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    let metin: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) metin = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) metin = n.text;
    if (metin !== null && ELLE_YOL.test(metin)) out.push(`${ad}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} "${metin.slice(0, 70)}"`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function tsDosyalari(dizin: string): string[] {
  return fs.readdirSync(dizin, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dizin, e.name);
    return e.isDirectory() ? tsDosyalari(p) : e.name.endsWith(".ts") ? [p] : [];
  });
}

function main(): void {
  console.log("\n=== Ayar yol tarifi — backend mesajındaki menü yolu panel kataloğunda ===\n");
  const k = paneliOku(fs.readFileSync(PANEL, "utf8"));
  const flagSayisi = k.kategoriler.reduce((n, c) => n + c.flags.size, 0);
  check("§1a panel kataloğu okundu (körlük zemini: ≥ 20 kategori, ≥ 50 ayar satırı, ekran adları dolu)",
    k.kategoriler.length >= 20 && flagSayisi >= 50 && k.sectionSurface.size >= 5 && k.surfaceLabel.size >= 5, `${k.kategoriler.length} kategori · ${flagSayisi} satır`);
  // Adı sabit/terimden gelen kategori (ör. iş emirleri) okunamaz; tabloda kullanılırsa §2a "YOK" der.
  check("§1b her kategorinin kimliği ve bölümü okunabildi", k.kategoriler.every((c) => c.id && c.section),
    k.kategoriler.filter((c) => !(c.id && c.section)).map((c) => c.id || "?").join(" · "));
  ELLE_YOL = elleYolDeseni([...k.surfaceLabel.values()]);
  check("§1c `settingsCategoryTrail` bekçinin taklit ettiği biçimde (değiştiyse bekçi de değişir)",
    k.trailGovdesi.includes("`Sistem → ${SURFACE_LABEL[surface]}`") && k.trailGovdesi.includes('surface === "vendor" ? base : `${base} → ${cat.label}`'),
    k.trailGovdesi.replace(/\s+/g, " ").slice(0, 160));

  const ekran = ekranFarklari(k, PANEL_SETTING_SCREEN);
  check("§2a `PANEL_SETTING_SCREEN` her yol panelin menü yoluyla bayt bayt aynı", ekran.length === 0, ekran.join(" · "));
  const satir = satirFarklari(k, PANEL_SETTING_ROW);
  check("§3a `PANEL_SETTING_ROW` her satır panelde O ekranda, AYNI başlıkla", satir.length === 0, satir.join(" · "));

  const dosyalar = tsDosyalari(SRC);
  const elle = dosyalar
    .map((f) => ({ f, rel: path.relative(SRC, f).split(path.sep).join("/") }))
    .filter(({ rel }) => rel !== TABLO)
    .flatMap(({ f, rel }) => elleYollar(fs.readFileSync(f, "utf8"), rel));
  check("§4a backend dizgelerinde elle yazılmış menü yolu YOK (yol `panel-ayar-yolu`ndan gelir)", elle.length === 0, elle.join(" · "));
  check("§4b körlük zemini: taranan dosya ≥ 300", dosyalar.length >= 300, String(dosyalar.length));

  const tumKaynak = dosyalar.filter((f) => !f.endsWith(TABLO)).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const olu = Object.keys(PANEL_SETTING_ROW).filter((key) => !tumKaynak.includes(`settingRowPath("${key}")`) && !tumKaynak.includes(`PANEL_SETTING_ROW.${key}`));
  check("§5a tablodaki her ayar satırı en az bir mesajda kullanılıyor", olu.length === 0, olu.join(" · "));

  check("§6a sonda: dizgede elle yol yakalanır (düz, şablon parçası, eski '>' biçimi)",
    elleYollar('const m = "Genel Ayarlar → Tezgah bölümünden açılır";', "s.ts").length === 1
      && elleYollar("const m = `x ${a} Ayarlar > Muhasebe`;", "s.ts").length === 1
      && elleYollar("const m = `${b} — Sistem → Modüller`;", "s.ts").length === 1);
  check("§6b sonda: yorum, yolsuz 'Ayarlar' kelimesi ve ayar dışı Sistem ekranı yakalanmaz",
    elleYollar('// Genel Ayarlar → Modüller\nconst a = { config: "Ayarlar", b: "Sistem → Raporlar bölümünden" };', "s.ts").length === 0);
  check("§6c sonda: kaymış ekran adı ve başlık yakalanır",
    ekranFarklari(k, { tezgah: "Sistem → Özellik Anahtarları → Tezgah" }).length === 1
      && satirFarklari(k, { tezgahAlarmEnabled: { ekran: "tezgah", baslik: "Tezgah alarmi" } }).length === 1
      && satirFarklari(k, { tezgahAlarmEnabled: { ekran: "dokuma", baslik: "Tezgah alarmı" } }).length === 1);
}

try {
  main();
} catch (err) {
  fail++;
  console.error("❌ Bekçi hata ile durdu:", err);
}
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
