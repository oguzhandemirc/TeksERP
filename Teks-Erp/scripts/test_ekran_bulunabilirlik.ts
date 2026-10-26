// =============================================================================
// BEKÇİ — EKRAN BULUNABİLİRLİĞİ: kataloğa giren her ekranın menü ya da palet girişi var (DB'siz)
// =============================================================================
// Kullanıcı şartı (2026-10-24): "tüm bunların arayüzde kaybolmaması, menüler altında kolay bulunabilir
// olması şart". UX-1 envanteri tek KIRMIZI (`/definitions/label-templates`: ne menüde ne palette) ve iki
// yalnız-palet ekran buldu; UX-2 kırmızıyı kapattı, bu bekçi yenisinin doğmasını durdurur.
//   §1 panel: `SCREEN_CATALOG` masaüstü ekranının `/key` adresi MENÜDE (yan menü `nav-config` · hub karo
//      dosyaları `panel-karo-dosyalari` · rapor kategori karoları) YA DA PALETTE (`command-entries*.ts`)
//      geçiyor. Girişsiz ekran istisnası YOK (taban 0).
//   §2 panel: yalnız palette olan ekran beyanlı (`YALNIZ_PALET`, gerekçeli); taban yalnız AŞAĞI; sayfa içi /
//      üst çubuk girişi (`SAYFA_ICI_GIRIS`) menü sayılır ama dosyası adresi hâlâ taşımalı;
//      (`YALNIZ_PALET_TABANI`); menüye kavuşan ekranın satırı ölüdür → kırmızı.
//   §3 tablet: katalog mobil anahtarı `MOBILE_SCREENS`te (modül seçimi ızgarası bu listeden çizilir).
//   §4 körlük zemini: okunan menü/palet adresi sayısı eşiğin üstünde; sondalar (dosyada yaşar).
// NEGATİF SONDA (B, 2026-10-26, bu commit): "Etiket Tasarımı" karosunun adresi `/definitions/labels`e çevrildi
//   → §1 ❌ (`definitions/label-templates` palette de yok, çünkü palet karodan türer); `YALNIZ_PALET`e menüde olan
//   `definitions/items` eklendi → §2b ölü beyan ❌ + §2c taban ❌. İkisi de `cmp` ile geri alındı.
// Koşum: npx tsx scripts/test_ekran_bulunabilirlik.ts   (DB GEREKMEZ)
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { SCREEN_CATALOG } from "../src/constants/screen-catalog";
import { yorumlariSok } from "./lib/regime-gate-scan";
import { tumKaroDosyalari } from "./lib/panel-karo-dosyalari";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  (ok ? console.log : console.error)(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const KOK = path.join(__dirname, "..", "..");
const PANEL_SRC = path.join(KOK, "Electron", "src");
const MOBIL_EKRANLAR = path.join(KOK, "mobil", "src", "types", "permissions.ts");

/** Yalnız palette (Ctrl+K) bulunan, menü girişi BİLİNÇLİ olarak açılmamış ekranlar — gerekçeli. */
const YALNIZ_PALET: Readonly<Record<string, string>> = {
  "definitions/machines": "Üretim İstasyonları ekranına birleşti; ayrı makine tablosu uzman görünümü (UX-1 SARI, patron kararı)",
  "definitions/station-capabilities": "Üretim İstasyonları ekranına birleşti; yetenek matrisi uzman görünümü (UX-1 SARI, patron kararı)",
};
/** Taban yalnız AŞAĞI: satır menüye kavuşunca silinir ve bu sayı da düşürülür. */
const YALNIZ_PALET_TABANI = 2;

/** Menü sayılan SAYFA İÇİ / ÜST ÇUBUK girişleri — dosya adresi hâlâ taşıyor mu ölçülür (ölü beyan kırmızı). */
const SAYFA_ICI_GIRIS: Readonly<Record<string, { dosya: string; neden: string }>> = {
  "settings/notifications": { dosya: "components/bildirim/BellPanel.tsx", neden: "üst çubuk zili → \"Bildirim tercihleri\" (ayrıca Kullanıcı Tercihleri kartı)" },
  "reports/ozel": { dosya: "pages/Reports/_v2/custom/CustomReportsSection.tsx", neden: "Raporlar › Rapor Merkezi › Özel raporlar bölümü → Yeni" },
};

/** Katalog anahtarının menü/palette adres biçimi farklıysa (alt yol ile açılan ekran) — gerekçeli. */
const GIRIS_ADRESI: Readonly<Record<string, string>> = {
  "reports/ozel": "/reports/ozel/yeni",
};

const MENU_SABIT = ["components/layout/nav-config.ts"];
const PALET = [
  "components/layout/command-entries.ts",
  "components/layout/command-entries.deep.ts",
  "components/layout/command-entries.reports.ts",
];

/** `Reports/<Kategori>/tile-config.ts` — rapor kategori hub'ının karoları (menü sayılır: Raporlar kökünden). */
function raporKategoriKarolari(): string[] {
  const kok = path.join(PANEL_SRC, "pages", "Reports");
  return fs.readdirSync(kok, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(kok, e.name, "tile-config.ts")))
    .map((e) => `pages/Reports/${e.name}/tile-config.ts`);
}

/** Electron ağacındaki `export const X = "/..."` sabitleri (`to: STOCK_COUNTS_PATH`). */
function yolSabitleri(): Map<string, string> {
  const out = new Map<string, string>();
  const yuru = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const tam = path.join(dir, e.name);
      if (e.isDirectory()) yuru(tam);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        for (const m of fs.readFileSync(tam, "utf8").matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*"(\/[^"]*)"/g)) out.set(m[1]!, m[2]!);
      }
    }
  };
  yuru(PANEL_SRC);
  return out;
}

/** Metindeki `to: "..."` / `to: \`...\`` (yer tutucusuz) / `to: SABIT` adresleri, sorgu dizgesi atılmış. */
export function adresler(metin: string, sabitler: ReadonlyMap<string, string>): string[] {
  const src = yorumlariSok(metin);
  const out: string[] = [];
  for (const m of src.matchAll(/\bto:\s*(?:"([^"]+)"|`([^`$]+)`|([A-Z][A-Z0-9_]*)\b)/g)) {
    const v = m[1] ?? m[2] ?? (m[3] ? sabitler.get(m[3]) : undefined);
    if (v) out.push(v.split("?")[0]!);
  }
  return out;
}

function oku(rel: string): string {
  return fs.readFileSync(path.join(PANEL_SRC, rel), "utf8");
}

export function bulunabilirlik(
  ekranlar: readonly string[],
  menu: ReadonlySet<string>,
  palet: ReadonlySet<string>,
  yalnizPalet: Readonly<Record<string, string>>,
): { girissiz: string[]; beyansizPalet: string[]; oluBeyan: string[] } {
  const adres = (k: string) => GIRIS_ADRESI[k] ?? `/${k}`;
  const girissiz = ekranlar.filter((k) => !menu.has(adres(k)) && !palet.has(adres(k)));
  const beyansizPalet = ekranlar.filter((k) => !menu.has(adres(k)) && palet.has(adres(k)) && !(k in yalnizPalet));
  const oluBeyan = Object.keys(yalnizPalet).filter((k) => !ekranlar.includes(k) || menu.has(adres(k)));
  return { girissiz, beyansizPalet, oluBeyan };
}

function sondalar(): void {
  const s = adresler(`// to: "/yorum"\nconst a = { to: "/x/y?tab=1" }; const b = { to: \`/z\` }; const c = { to: P }; const d = { to: \`/q/\${id}\` };`, new Map([["P", "/sabit"]]));
  check("§4b sonda: adres okuyucu dizge · şablon · sabit okur; yorum ve yer tutuculu şablonu saymaz",
    JSON.stringify(s) === JSON.stringify(["/x/y", "/z", "/sabit"]), JSON.stringify(s));
  const r = bulunabilirlik(["a/b", "c", "d", "e"], new Set(["/c"]), new Set(["/a/b", "/d"]), { d: "x", c: "ölü", z: "yok" });
  check("§4c sonda: girişsiz ekran · beyansız yalnız-palet · ölü beyan (menüde ya da katalogda yok) yakalanır",
    r.girissiz.join() === "e" && r.beyansizPalet.join() === "a/b" && r.oluBeyan.sort().join() === "c,z", JSON.stringify(r));
}

function main(): void {
  const sabitler = yolSabitleri();
  const menuDosyalari = [...MENU_SABIT, ...tumKaroDosyalari(PANEL_SRC), ...raporKategoriKarolari()];
  const menu = new Set(menuDosyalari.flatMap((f) => adresler(oku(f), sabitler)));
  for (const [k, g] of Object.entries(SAYFA_ICI_GIRIS)) {
    const adres = GIRIS_ADRESI[k] ?? `/${k}`;
    const metin = yorumlariSok(oku(g.dosya));
    const sabit = [...sabitler].find(([, v]) => v === adres)?.[0];
    const yasiyor = metin.includes(`"${adres}"`) || (sabit !== undefined && new RegExp(`\\b${sabit}\\b`).test(metin));
    check(`§2e sayfa içi giriş yaşıyor: /${k} ← ${g.dosya}`, yasiyor, g.neden);
    if (yasiyor) menu.add(adres);
  }
  const palet = new Set(PALET.flatMap((f) => adresler(oku(f), sabitler)));
  const ekranlar = SCREEN_CATALOG.filter((s) => s.app === "desktop").map((s) => s.key);

  console.log("\n§1–§2 — panel ekranı menüde ya da palette");
  const r = bulunabilirlik(ekranlar, menu, palet, YALNIZ_PALET);
  check("§1 ⭐ her katalog ekranının menü ya da palet girişi var (taban 0)", r.girissiz.length === 0,
    r.girissiz.map((k) => `/${k}`).join(", "));
  check("§2a yalnız palette olan ekran beyanlı (`YALNIZ_PALET`)", r.beyansizPalet.length === 0,
    r.beyansizPalet.map((k) => `/${k}`).join(", "));
  check("§2b beyan ölü değil (ekran katalogda ve hâlâ menüsüz)", r.oluBeyan.length === 0, r.oluBeyan.join(", "));
  const n = Object.keys(YALNIZ_PALET).length;
  check(`§2c yalnız-palet tabanı yalnız aşağı (${n} ≤ ${YALNIZ_PALET_TABANI})`, n <= YALNIZ_PALET_TABANI);
  for (const [k, adres] of Object.entries(GIRIS_ADRESI)) {
    check(`§2d giriş adresi beyanı yaşıyor: ${k} → ${adres}`, ekranlar.includes(k) && (menu.has(adres) || palet.has(adres)));
  }

  console.log("\n§3 — tablet ekranı modül seçimi listesinde");
  const mobilMetin = yorumlariSok(fs.readFileSync(MOBIL_EKRANLAR, "utf8"));
  const blok = mobilMetin.slice(mobilMetin.indexOf("export const MOBILE_SCREENS"));
  const mobilAnahtar = new Set([...blok.slice(0, blok.indexOf("\n];")).matchAll(/\bkey:\s*'([^']+)'/g)].map((m) => m[1]!));
  const mobilEksik = SCREEN_CATALOG.filter((s) => s.app === "mobile" && !mobilAnahtar.has(s.key)).map((s) => s.key);
  check("§3 ⭐ her mobil katalog ekranı `MOBILE_SCREENS`te", mobilEksik.length === 0, mobilEksik.join(", "));

  console.log("\n§4 — körlük zemini + sondalar");
  check(`§4a zemin: menü adresi ≥ 150, palet adresi ≥ 12, panel ekranı ≥ 120, tablet ekranı ≥ 20`,
    menu.size >= 150 && palet.size >= 12 && ekranlar.length >= 120 && mobilAnahtar.size >= 20,
    `menü ${menu.size} · palet ${palet.size} · panel ${ekranlar.length} · tablet ${mobilAnahtar.size}`);
  sondalar();
}

try {
  main();
} catch (err) {
  fail++;
  console.error("❌ Bekçi hata ile durdu:", err);
}
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
