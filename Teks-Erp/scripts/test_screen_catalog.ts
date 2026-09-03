// =============================================================================
// BEKÇİ: Ekran manifestosu GERÇEKLE uyumlu mu? (2026-08-19)
// Çalıştır: npx tsx scripts/test_screen_catalog.ts
// =============================================================================
// `src/constants/screen-catalog.ts` elle yazılır — yani BAYATLAYABİLİR. Bu bekçi
// onu İKİ İSTEMCİNİN GERÇEK beyanlarına karşı doğrular: Electron route dosyası
// ve mobil ekran listesi. Yeni bir ekran eklenip manifestoya yazılmazsa test
// kırmızı verir; manifestoda olmayan bir izin kodu da öyle.
//
// Karar belgesi: docs/design/YETKI-MIMARISI.md
//
// ⚠️ İKİ BİÇİM birden çözülür: satır içi dizi (`requireAnyPermission={["a","b"]}`)
// VE sabit referans (`requireAnyPermission={DOCUMENT_DESIGN_READ}`). İlk yazımda
// yalnız satır içi taranıyordu ve DÖRT belge tasarım ekranı sessizce kapsam
// dışında kalmıştı — tam da bu bekçinin yakalaması gereken şey.
//
// 2026-09-03 (P6) — DÖRT YENİ BÖLÜM: §7 tamlık (her ekran bir modüle/çekirdek
// bloğa eşli) · §8 ekransız modül muafı · §9 Electron KARO ↔ `modul` hizası ·
// §10 backend rejim kapısı olan her modülün ≥1 ekranı.
//
// NEGATİF SONDALAR — 2026-09-03'te koşuldu (cp + md5 ile birebir geri alındı;
// taban 33/0):
//   SONDA-A1 → çıkış 1 · 2 ❌ · §7b + §9f — `operations/work-orders` modülü kısa
//              ada ("uretim") çevrildi (muafı da ölüye düşürdü — zincir ölçüldü)
//   SONDA-A2 → çıkış 1 · 2 ❌ · §7b + §7c — `EKRAN_MODUL_DEGERLERI`nden
//              `depoMultiEnabled` silindi (`MODULE_FLAG_KEYS` birebirlemesi)
//   SONDA-A3 → çıkış 1 · 2 ❌ · §8b + §9c — muaf modüle (`kumasTeknikEnabled`)
//              ekran eşlendi (ölü muaf)
//   SONDA-A4 → çıkış 1 · 1 ❌ · §9f — `KARO_BEKLEYEN`e ihlal üretmeyen ölü giriş
//   SONDA-A5 → çıkış 1 · 4 ❌ · §8a + §9c + §9e + §10b — `operations/yarn-stock`
//              modülü `ticaretEnabled`a çevrildi (karo `iplikEnabled` kaldı)
// ⚠️ A2/A5 plandaki sondaların İKAMESİDİR: özgün öneri `module-flags.ts` ve
//    Electron regime dosyasını bozmayı istiyordu; o dosyalar bu turda paralel
//    çalışan başka ajanların kapsamındaydı. İkameler AYNI yüklemleri (birebirleme
//    ve karo hizası) ölçer, yalnız bozmayı manifesto tarafından uygular.
// =============================================================================
import fs from "fs";
import path from "path";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { MODULE_FLAG_KEYS } from "../src/constants/module-flags";
import {
  EKRANSIZ_MODULLER,
  EKRAN_MODUL_DEGERLERI,
  SCREEN_CATALOG,
  SCREENLESS_PERMISSIONS,
  permissionsWithoutScreen,
  screenCountByModul,
  screensOfModul,
  screensUsing,
  type EkranModul,
  type ScreenEntry,
} from "../src/constants/screen-catalog";
import { yorumlariSok } from "./lib/regime-gate-scan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const ROOT = path.join(__dirname, "..", "..");
const ELECTRON_ROUTES = path.join(ROOT, "Electron", "src", "routes", "content-routes.tsx");
const ELECTRON_PERMS = path.join(ROOT, "Electron", "src", "lib", "permissions.ts");
const MOBILE_PERMS = path.join(ROOT, "mobil", "src", "types", "permissions.ts");

/** Electron'daki `export const X = ["a","b"]` sabitlerini çözer. */
function readPermissionConstants(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!fs.existsSync(ELECTRON_PERMS)) return out;
  const src = fs.readFileSync(ELECTRON_PERMS, "utf8");
  for (const m of src.matchAll(/export const (\w+)\s*=\s*\[([^\]]*)\]/g)) {
    out[m[1]!] = [...m[2]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  }
  return out;
}

/** Electron route dosyasından yol → izin listesi. */
function readElectronRoutes(): Array<{ path: string; perms: string[]; viaConst?: string }> {
  const src = fs.readFileSync(ELECTRON_ROUTES, "utf8");
  const consts = readPermissionConstants();
  const rows: Array<{ path: string; perms: string[]; viaConst?: string }> = [];
  const blocks = [...src.matchAll(/path:\s*"([^"]+)"([\s\S]*?)(?=path:\s*"|$)/g)];
  for (const b of blocks) {
    const body = b[2]!.slice(0, 800);
    const one = /requirePermission="([^"]+)"/.exec(body);
    const inline = /requireAnyPermission=\{\[([\s\S]*?)\]\}/.exec(body);
    const ref = /requireAnyPermission=\{(\w+)\}/.exec(body);
    let perms: string[] = [];
    if (one) perms = [one[1]!];
    else if (inline) perms = [...inline[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
    else if (ref) perms = consts[ref[1]!] ?? [];
    // ⚠️ SABİT REFERANSLI route, çözülemese bile LİSTEYE GİRER (perms boş).
    // Aksi halde çözüm bozulduğunda satır sessizce atlanır ve bekçi YEŞİL kalır —
    // negatif sondada tam olarak bu oldu (2026-08-19), bölüm 0b bunun için var.
    if (perms.length || ref) rows.push({ path: b[1]!, perms, viaConst: ref?.[1] });
  }
  return rows;
}

/** Mobil `MOBILE_SCREENS` beyanı: ekran anahtarı → izin. */
function readMobileScreens(): Array<{ key: string; permission: string }> {
  const src = fs.readFileSync(MOBILE_PERMS, "utf8");
  return [...src.matchAll(/key: '([^']+)',\s*\n\s*permission: '([^']+)'/g)].map((m) => ({
    key: m[1]!,
    permission: m[2]!,
  }));
}


// =============================================================================
// §9 ALTYAPISI — Electron KARO çözücüsü (üç biçim)
// =============================================================================
// Karo görünürlük kuralı üç biçimde yazılıyor ve ÜÇÜ DE metinden çözülebilir:
//   ① satır içi ok   — `visibleWhen: (ctx) => ctx.depoMultiEnabled`
//   ② saf yüklem     — `visibleWhen: isYarnStockVisible` → import satırından
//                      dosyayı bul, gövdesindeki `return ctx.<alan>`ı oku
//   ③ menü bayrağı   — `featureFlag: "financeEnabled"` (karo ya da nav satırı;
//                      nav yolu bir ÖN EKSE alt ekranlar miras alır)
// ⚠️ Çözücü bir biçimi kaçırırsa o karo "kapısız" sayılır ve hiza kontrolü
// SESSİZCE yeşile döner. Bu yüzden §9a/§9b zemin sayaçları `>=` eşikleriyle
// konuyor (bekçinin 2026-08-19'daki kendi dersi: sabit-referanslı dört route
// sessizce kapsam dışı kalmıştı).
const ELECTRON_SRC = path.join(ROOT, "Electron", "src");
const TILE_FILES = [
  "pages/Operations/tile-config.ts",
  "pages/Definitions/tile-config.ts",
  "pages/System/tile-config.ts",
  "pages/Access/tile-config.ts",
  "pages/Finance/tile-config.ts",
  "pages/Reports/tile-config.ts",
];
const NAV_FILE = "components/layout/nav-config.ts";

interface KaroBilgisi {
  /** Ekran anahtarı (`to` yolunun baştaki `/`si atılmış hâli). */
  key: string;
  /** Karonun bağlı olduğu bağlam alanı (`ticaretEnabled`) — yoksa null. */
  alan: string | null;
  /** Yüklem negasyonlu mu (`!ctx.financeEnabled`)? */
  negatif: boolean;
  /** Çözüm biçimi — zemin raporu için. */
  bicim: "satirici" | "yuklem" | "featureFlag" | "nav-miras" | "yok";
  kaynak: string;
}

/** `export const X = "..."` sabitlerini Electron ağacından çözer (`to: SABIT`). */
function electronStringConsts(): Record<string, string> {
  const out: Record<string, string> = {};
  const yuru = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const tam = path.join(dir, e.name);
      if (e.isDirectory()) yuru(tam);
      else if (e.name.endsWith(".ts")) {
        const src = fs.readFileSync(tam, "utf8");
        for (const m of src.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"/g)) {
          out[m[1]!] = m[2]!;
        }
      }
    }
  };
  yuru(ELECTRON_SRC);
  return out;
}

/** `visibleWhen: <fn>` → yüklem dosyasındaki `return <param>.<alan>` alanı. */
function yuklemAlani(dosya: string, fnAdi: string): { alan: string; negatif: boolean } | null {
  const src = yorumlariSok(fs.readFileSync(dosya, "utf8"));
  const imp = new RegExp(`import\\s*\\{[^}]*\\b${fnAdi}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`).exec(src);
  if (!imp) return null;
  const hedef = path.join(path.dirname(dosya), `${imp[1]!}.ts`);
  if (!fs.existsSync(hedef)) return null;
  const govde = yorumlariSok(fs.readFileSync(hedef, "utf8"));
  const fn = new RegExp(
    `export function ${fnAdi}\\s*\\(\\s*([A-Za-z0-9_]+)[^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`,
  ).exec(govde);
  if (!fn) return null;
  const ret = new RegExp(`return\\s+(!)?${fn[1]!}\\.([A-Za-z0-9_]+)\\s*;`).exec(fn[2]!);
  if (!ret) return null;
  return { alan: ret[2]!, negatif: Boolean(ret[1]) };
}

/** Bir `to:` eşleşmesini saran `{ … }` bloğunu süslü parantez sayarak bulur. */
function saranBlok(metin: string, idx: number): string {
  let bas = idx;
  let derinlik = 0;
  while (bas > 0) {
    bas--;
    const c = metin[bas]!;
    if (c === "}") derinlik++;
    else if (c === "{") {
      if (derinlik === 0) break;
      derinlik--;
    }
  }
  let son = idx;
  derinlik = 0;
  while (son < metin.length) {
    const c = metin[son]!;
    if (c === "{") derinlik++;
    else if (c === "}") {
      if (derinlik === 0) break;
      derinlik--;
    }
    son++;
  }
  return metin.slice(bas, son);
}

/**
 * Ekran anahtarının ETKİN karo kapısı: kendi `visibleWhen`i yoksa MENÜ ön ekinden
 * miras alınır (`/finance/cheques` ← nav `/finance` `featureFlag`i).
 *
 * ⚠️ Miras GERÇEK bir kapıdır: menü satırı gizlendiğinde alt ekranların HEPSİ
 * erişilemez olur. Miras okunmasaydı 9 finans ekranı "kapısız" görünür ve §9c
 * yanlış kırmızı verirdi — yani bekçi kendi kör noktasını ihlal sayardı.
 */
function karoAlaniCoz(
  key: string,
  karolar: Map<string, KaroBilgisi>,
  navMiras: Array<{ onEk: string; alan: string }>,
): KaroBilgisi | null {
  const dogrudan = karolar.get(key);
  if (dogrudan && dogrudan.alan) return dogrudan;
  const miras = navMiras
    .filter((n) => key === n.onEk || key.startsWith(`${n.onEk}/`))
    // En UZUN (en spesifik) ön ek kazanır.
    .sort((a, b) => b.onEk.length - a.onEk.length)[0];
  if (miras) {
    return { key, alan: miras.alan, negatif: false, bicim: "nav-miras", kaynak: NAV_FILE };
  }
  return dogrudan ?? null;
}

function karolariOku(): { karolar: Map<string, KaroBilgisi>; navMiras: Array<{ onEk: string; alan: string }> } {
  const consts = electronStringConsts();
  const karolar = new Map<string, KaroBilgisi>();
  const navMiras: Array<{ onEk: string; alan: string }> = [];

  const isle = (rel: string, navMi: boolean): void => {
    const dosya = path.join(ELECTRON_SRC, rel);
    if (!fs.existsSync(dosya)) return;
    const metin = yorumlariSok(fs.readFileSync(dosya, "utf8"));
    for (const m of metin.matchAll(/\bto:\s*(?:"([^"]+)"|([A-Z][A-Z0-9_]*))/g)) {
      const yol = m[1] ?? consts[m[2]!] ?? null;
      if (!yol || !yol.startsWith("/")) continue;
      const key = yol.slice(1);
      const blok = saranBlok(metin, m.index!);
      let alan: string | null = null;
      let negatif = false;
      let bicim: KaroBilgisi["bicim"] = "yok";
      const satirici = /visibleWhen:\s*\(\s*([A-Za-z0-9_]+)\s*\)\s*=>\s*(!)?\1\.([A-Za-z0-9_]+)/.exec(blok);
      const ref = /visibleWhen:\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/.exec(blok);
      const ff = /featureFlag:\s*"([^"]+)"/.exec(blok);
      if (satirici) {
        alan = satirici[3]!;
        negatif = Boolean(satirici[2]);
        bicim = "satirici";
      } else if (ref) {
        const c = yuklemAlani(dosya, ref[1]!);
        if (c) {
          alan = c.alan;
          negatif = c.negatif;
          bicim = "yuklem";
        }
      } else if (ff) {
        alan = ff[1]!;
        bicim = "featureFlag";
      }
      if (navMi) {
        if (alan) navMiras.push({ onEk: key, alan });
        continue;
      }
      // Aynı yol iki dosyada geçerse KAPILI olan kazanır (nav girişi hub'ı da
      // listeler; karo dosyası daha spesifiktir).
      const eski = karolar.get(key);
      if (!eski || (eski.alan === null && alan !== null)) {
        karolar.set(key, { key, alan, negatif, bicim, kaynak: rel });
      }
    }
  };

  for (const f of TILE_FILES) isle(f, false);
  isle(NAV_FILE, true);
  // Nav girişleri hub ekranlarının KENDİSİ için de bir karodur (`/finance`).
  for (const n of navMiras) {
    if (!karolar.has(n.onEk)) {
      karolar.set(n.onEk, { key: n.onEk, alan: n.alan, negatif: false, bicim: "featureFlag", kaynak: NAV_FILE });
    }
  }
  return { karolar, navMiras };
}

// =============================================================================
// §9 MUAF LİSTELERİ — hepsi GEREKÇELİ ve ÖLÜ MUAF KIRMIZI
// =============================================================================
/** Karosu modül alanına bağlı ama ekranın modülü ÇEKİRDEK — rejim VARYANTI. */
const KARO_VARYANT: ReadonlyArray<{ key: string; reason: string }> = [
  {
    key: "definitions/customers",
    reason:
      "Karo `!financeEnabled` ile çizilir: aynı ana veri, ticaret kurulumunda tek " +
      "'Cariler' ekranında sunulur. Modül aidiyeti değişmez (çekirdek ana veri), " +
      "değişen SUNUMDUR — negasyonlu yüklem bir modül kapısı değildir.",
  },
  {
    key: "definitions/subcontractors",
    reason: "customers ile aynı varyant çifti (`!financeEnabled` — fason firma sunumu).",
  },
  {
    key: "definitions/cariler",
    reason:
      "Varyantın diğer yüzü (`financeEnabled`): müşteri + fason firma TEK listede. " +
      "Veri çekirdektir; bayrak yalnız hangi sunumun çizileceğini seçer.",
  },
];

/**
 * Modülü ModulKey ama karosu HENÜZ bayrağa bağlanmamış ekranlar.
 *
 * ⚠️ LİSTE 2026-09-03'TE (P5) BOŞALDI ve BOŞ KALMALIDIR. Sekiz ekranın hepsi
 * karosuna bağlandı: üretim karoları (`work-orders` · `product-balance` ·
 * `kursun-dagitim` · `routes` · `product-recipes` · `traveler-card`) →
 * `productionEnabled`; ayrıca İKİ CANLI AYRIŞMA kapandı — `goods-receipts`
 * (backend `requireTicaretEnabled` taşıyordu, karo kapısızdı) ve `item-prices`
 * (backend ticaret, karo hâlâ `financeEnabled`).
 *
 * Yeni satır eklemek BİLİNÇLİ bir park kararıdır: gerekçesi "hangi kurulumda
 * ne ters gider" sorusuna cevap vermeli ve §9f ölü muafı kırmızıya çevirir.
 */
const KARO_BEKLEYEN: ReadonlyArray<{ key: string; reason: string }> = [];

/**
 * `/api/reports` bilinçli KAPISIZ.
 *
 * ⚠️ 2026-09-03'te BOŞALDI: `reports/production` ve `reports/quality` karoları
 * `productionEnabled`e BAĞLANDI. Asimetri BİLİNÇLİ ve yönü zararsız — karo
 * gizlenir, uç 200 dönmeye devam eder. Ters yön ("karo var, uç 403") kullanıcıyı
 * sebebi yazmayan bir hataya sokardı; bu yön yalnız görmediği bir ekranı
 * açmamasıdır. Uç bazlı ayrım yazıldığı gün `module.middleware` kapısı da
 * eklenir ve asimetri kapanır.
 */
const RAPOR_KARMA: ReadonlyArray<{ key: string; reason: string }> = [];

/** Hiçbir hub karosu OLMAYAN ekranlar — gizlenecek karo yok, hiza ölçülemez. */
const KARO_YOK: ReadonlyArray<{ key: string; reason: string }> = [
  {
    key: "definitions/station-capabilities",
    reason:
      "Tanımlar hub'ında karosu YOK (ölçüldü): ekrana yalnız komut paletinden " +
      "(`command-entries.deep.ts`) ve İstasyonlar sayfasından giriliyor. Gizlenecek " +
      "bir karo olmadığı için karo↔modül hizası ölçülemez; P5 karo eklerse muaf ÖLÜR.",
  },
];


function main(): void {
  console.log("=== Ekran manifestosu bekçisi ===\n");

  // Set<string>: PERMISSION_CATALOG dar union taşır, manifesto düz string —
  // dar tipli Set'te `.has(string)` derlenmez.
  const catalogCodes = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));
  const byKey = new Map(SCREEN_CATALOG.map((s) => [`${s.app}:${s.key}`, s]));

  // ── Körlük zeminleri ─────────────────────────────────────────────────────
  // Tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile
  // çıkar. Sayılar bugünkü gerçekten belirgin şekilde AŞAĞIDA tutulur.
  const routes = readElectronRoutes();
  const mobileScreens = readMobileScreens();
  check("körlük zemini: Electron route beyanı okundu", routes.length >= 75, `${routes.length} route`);
  check("körlük zemini: mobil ekran beyanı okundu", mobileScreens.length >= 12, `${mobileScreens.length} ekran`);
  check("körlük zemini: manifesto dolu", SCREEN_CATALOG.length >= 50, `${SCREEN_CATALOG.length} ekran`);
  check(
    "körlük zemini: sabit-referanslı izin listeleri çözüldü",
    Object.keys(readPermissionConstants()).length >= 2,
    `${Object.keys(readPermissionConstants()).length} sabit`,
  );

  // ── 0b) Sabit-referanslı korumalar ÇÖZÜLDÜ mü ───────────────────────────
  // Körlük zemini tek başına yetmedi: çözüm bozulunca o route'lar listeden
  // düşüyor, kalan 73 route zemini geçiriyordu. Bu kontrol doğrudan çözümü ölçer.
  const constRoutes = routes.filter((r) => r.viaConst);
  check(
    "körlük zemini: sabit-referansla korunan route var",
    constRoutes.length >= 4,
    `${constRoutes.length} route`,
  );
  const unresolved = constRoutes.filter((r) => r.perms.length === 0).map((r) => `${r.path} (${r.viaConst})`);
  check("sabit-referanslı korumaların hepsi çözüldü", unresolved.length === 0, unresolved.join(" · "));

  // ── 1) Manifestodaki her kod GERÇEK bir izin mi ──────────────────────────
  const unknown: string[] = [];
  for (const s of SCREEN_CATALOG) {
    for (const c of [...s.requires, ...s.capabilities.map((x) => x.code)]) {
      if (!catalogCodes.has(c)) unknown.push(`${s.key} → ${c}`);
    }
  }
  check("manifestodaki her kod PERMISSION_CATALOG'da var", unknown.length === 0, unknown.join(" · "));

  // ── 2) Anahtarlar benzersiz ──────────────────────────────────────────────
  check(
    "ekran anahtarları benzersiz",
    byKey.size === SCREEN_CATALOG.length,
    `${SCREEN_CATALOG.length} giriş / ${byKey.size} benzersiz`,
  );

  // ── 3) Her mobil ekran manifestoda ve İZNİ AYNI ──────────────────────────
  const mobileMissing: string[] = [];
  const mobileMismatch: string[] = [];
  for (const m of mobileScreens) {
    const entry = byKey.get(`mobile:${m.key}`);
    if (!entry) mobileMissing.push(m.key);
    else if (!entry.requires.includes(m.permission)) mobileMismatch.push(`${m.key}: ${m.permission}`);
  }
  check("her mobil ekran manifestoda", mobileMissing.length === 0, mobileMissing.join(", "));
  check("mobil ekranların giriş izni birebir", mobileMismatch.length === 0, mobileMismatch.join(", "));

  // ── 4) Her Electron route izni bir ekranda beyan edilmiş ─────────────────
  // Alt yollar (`:id`, `new`, `edit`) ebeveyne katlanır — manifesto EKRAN
  // seviyesindedir, route seviyesinde değil.
  const uncovered: string[] = [];
  for (const r of routes) {
    const segs = r.path.split("/").filter((x) => !x.startsWith(":") && x !== "new" && x !== "edit");
    const key = segs.slice(0, 2).join("/") || segs[0]!;
    const entry = byKey.get(`desktop:${key}`);
    if (!entry) {
      uncovered.push(`${r.path} (ekran yok)`);
      continue;
    }
    const known = new Set([...entry.requires, ...entry.capabilities.map((c) => c.code)]);
    const miss = r.perms.filter((p) => !known.has(p));
    if (miss.length) uncovered.push(`${r.path} → ${miss.join(",")}`);
  }
  check("her Electron route izni manifestoda beyanlı", uncovered.length === 0, uncovered.slice(0, 6).join(" · "));

  // ── 5) Ekranı olmayan izin YOK (muaflar gerekçeli) ──────────────────────
  const orphans = permissionsWithoutScreen();
  check("ekranı beyan edilmeyen izin yok", orphans.length === 0, orphans.join(", "));

  // Muaf listesi İKİ YÖNLÜ: artık bir ekranda geçen kod muaf kalmamalı (ölü muaf
  // gerçek bir boşluğu sessizce kapsam dışında tutar).
  const staleExempt = SCREENLESS_PERMISSIONS.filter(
    (e) => !e.code.endsWith(":*") && screensUsing(e.code).length > 0,
  ).map((e) => e.code);
  check("muaf listesi bayat değil", staleExempt.length === 0, staleExempt.join(", "));
  check(
    "her muafın gerekçesi yazılı",
    SCREENLESS_PERMISSIONS.every((e) => e.reason.trim().length > 10),
  );

  // ── 6) Ortak yetkiler görünür olmalı (arayüz sözleşmesi) ────────────────
  // Birden çok ekranda geçen yetki, panelde "başka ekranlarda da kullanılıyor"
  // diye gösterilecek. Böyle bir yetki HİÇ yoksa `screensUsing` boşa düşmüştür.
  const shared = PERMISSION_CATALOG.map((p) => p.code).filter((c) => screensUsing(c).length > 1);
  check("ortak (çok ekranlı) yetki tespiti çalışıyor", shared.length >= 5, `${shared.length} ortak yetki`);

  // ═══════════════════════════════════════════════════════════════════════════
  // §7 ⭐ TAMLIK — her ekran bir modüle ya da çekirdek bloğa eşli (TASARIM §3)
  // ═══════════════════════════════════════════════════════════════════════════
  const bosModul = SCREEN_CATALOG.filter(
    (x) => typeof (x as ScreenEntry).modul !== "string" || !x.modul.trim(),
  ).map((x) => `${x.app}:${x.key}`);
  check(
    "§7a ⭐ Her ekran `modul` beyanı taşıyor (boş/whitespace yok)",
    bosModul.length === 0,
    bosModul.join(", "),
  );
  const bilinmeyen = SCREEN_CATALOG.filter((x) => !EKRAN_MODUL_DEGERLERI.has(x.modul)).map(
    (x) => `${x.key} → "${x.modul}"`,
  );
  check(
    "§7b ⭐ Her `modul` değeri tanınan kümede (kısa ad / yazım hatası yok)",
    bilinmeyen.length === 0,
    bilinmeyen.length
      ? `${bilinmeyen.join(" · ")} — geçerli değerler: ${[...EKRAN_MODUL_DEGERLERI].join(", ")}`
      : "",
  );
  // ⭐ ModulKey union'ı `MODULE_FLAG_KEYS` ile BİREBİR (liste kopyalanmaz, import edilir).
  const modulKeyDegerleri = [...EKRAN_MODUL_DEGERLERI].filter(
    (v) => !v.startsWith("cekirdek:") && !v.startsWith("planlanan:"),
  );
  const katalogFazlasi = modulKeyDegerleri.filter((v) => !MODULE_FLAG_KEYS.has(v));
  const bayrakFazlasi = [...MODULE_FLAG_KEYS].filter((v) => !modulKeyDegerleri.includes(v));
  check(
    "§7c ⭐ `ModulKey` ↔ `MODULE_FLAG_KEYS` BİREBİR (iki yönlü)",
    katalogFazlasi.length === 0 && bayrakFazlasi.length === 0,
    [
      katalogFazlasi.length ? `katalogda fazla: ${katalogFazlasi.join(", ")}` : "",
      bayrakFazlasi.length ? `katalogda EKSİK: ${bayrakFazlasi.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || `${modulKeyDegerleri.length} anahtar`,
  );
  const dagilim = screenCountByModul();
  check(
    "§7d Körlük zemini: manifesto tamlık ölçümü için yeterince dolu",
    SCREEN_CATALOG.length >= 85,
    `${SCREEN_CATALOG.length} ekran`,
  );
  check(
    "§7e Körlük zemini: en az 5 farklı modül/blok değeri kullanılıyor",
    Object.keys(dagilim).length >= 5,
    `${Object.keys(dagilim).length} farklı değer`,
  );
  console.log("\n   Modül dağılımı (ölçüm, kırmızı değil):");
  for (const [k, v] of Object.entries(dagilim).sort((a, b) => b[1] - a[1])) {
    console.log(`     · ${String(v).padStart(3)} ekran — ${k}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §8 EKRANSIZ MODÜL MUAFI (SCREENLESS_PERMISSIONS ikizi)
  // ═══════════════════════════════════════════════════════════════════════════
  const muafModuller = new Set(EKRANSIZ_MODULLER.map((e) => e.modul));
  const ekransiz = [...MODULE_FLAG_KEYS].filter(
    (m) => screensOfModul(m as EkranModul).length === 0 && !muafModuller.has(m as never),
  );
  check(
    "§8a ⭐ Her modülün ya ≥1 ekranı var ya gerekçeli muafı",
    ekransiz.length === 0,
    ekransiz.length
      ? `ekranı da muafı da YOK: ${ekransiz.join(", ")} — ya ekran eşle ya EKRANSIZ_MODULLER'e gerekçesiyle yaz`
      : "",
  );
  const oluModulMuaf = EKRANSIZ_MODULLER.filter((e) => screensOfModul(e.modul).length > 0).map(
    (e) => `${e.modul} (${screensOfModul(e.modul).length} ekran)`,
  );
  check(
    "§8b ⭐ Ekransız muaf listesi BAYAT değil (ölü muaf kırmızı)",
    oluModulMuaf.length === 0,
    oluModulMuaf.length ? `artık ekranı VAR: ${oluModulMuaf.join(", ")} — muafı sil` : "",
  );
  check(
    "§8c Her ekransız muafın gerekçesi yazılı",
    EKRANSIZ_MODULLER.every((e) => e.reason.trim().length > 10),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // §9 ⭐ Electron KARO ↔ `modul` HİZASI (YALNIZ `app === "desktop"`)
  // ═══════════════════════════════════════════════════════════════════════════
  // ⚠️ DARALTMA AÇIKÇA YAZILIR: mobil ekran beyanı (`MOBILE_SCREENS`) modül
  // koşulu TAŞIMIYOR (`useVisibleScreens.conditional` boş) — mobil ikiz
  // yazılabilir hâle geldiğinde bu bölüm genişler. Sessiz kapsam boşluğu
  // bırakmamak için sayaç aşağıda raporlanıyor.
  const { karolar, navMiras } = karolariOku();
  const cozulenYuklem = [...karolar.values()].filter((k) => k.alan !== null).length;
  const mirasliEkran = SCREEN_CATALOG.filter(
    (x) => x.app === "desktop" && karoAlaniCoz(x.key, karolar, navMiras)?.bicim === "nav-miras",
  ).length;
  check("§9a Körlük zemini: karo beyanları okundu", karolar.size >= 40, `${karolar.size} karo`);
  check(
    "§9b Körlük zemini: bayrağa bağlı karo yüklemi çözüldü",
    cozulenYuklem >= 6,
    `${cozulenYuklem} yüklem (biçimler: ${[
      ...new Set([...karolar.values()].filter((k) => k.alan).map((k) => k.bicim)),
    ].join(", ")})`,
  );
  check(
    "§9b2 Körlük zemini: nav ön ek mirası çözülüyor",
    mirasliEkran >= 5,
    `${mirasliEkran} ekran menü bayrağını miras alıyor`,
  );
  const mobilEkran = SCREEN_CATALOG.filter((x) => x.app === "mobile").length;
  console.log(
    `\n   ℹ️  §9 KAPSAMI: yalnız masaüstü (${SCREEN_CATALOG.length - mobilEkran} ekran). ` +
      `Mobil ${mobilEkran} ekran modül koşulu taşımıyor (P1'in açık kalanı).`,
  );

  const varyantMuaf = new Map(KARO_VARYANT.map((e) => [e.key, e.reason]));
  const bekleyenMuaf = new Map(KARO_BEKLEYEN.map((e) => [e.key, e.reason]));
  const raporMuaf = new Map(RAPOR_KARMA.map((e) => [e.key, e.reason]));
  const karoYokMuaf = new Map(KARO_YOK.map((e) => [e.key, e.reason]));
  const muafliMi = (key: string): boolean =>
    varyantMuaf.has(key) || bekleyenMuaf.has(key) || raporMuaf.has(key) || karoYokMuaf.has(key);

  const kullanilanMuaf = new Set<string>();
  const ihlalIleri: string[] = [];
  const karosuz: string[] = [];
  for (const scr of SCREEN_CATALOG) {
    if (scr.app !== "desktop") continue;
    if (!MODULE_FLAG_KEYS.has(scr.modul)) continue;
    const karo = karoAlaniCoz(scr.key, karolar, navMiras);
    if (!karo) {
      if (karoYokMuaf.has(scr.key)) kullanilanMuaf.add(scr.key);
      else karosuz.push(`${scr.key} (${scr.modul})`);
      continue;
    }
    if (karo.alan === scr.modul && !karo.negatif) continue;
    if (muafliMi(scr.key)) {
      kullanilanMuaf.add(scr.key);
      continue;
    }
    ihlalIleri.push(
      `${scr.key}: manifesto=${scr.modul} · karo=${karo.negatif ? "!" : ""}${karo.alan ?? "(kapısız)"} [${karo.bicim}]`,
    );
  }
  check(
    "§9c ⭐ Modüle ait her masaüstü ekranın karosu AYNI bayrağa bağlı",
    ihlalIleri.length === 0,
    ihlalIleri.length
      ? `${ihlalIleri.join(" · ")} — karo ile manifesto ayrışırsa kullanıcı ya görünmeyen bir ekranın ` +
        "iznini arar ya görünen bir karoya tıklayıp 403 alır"
      : "",
  );
  check(
    "§9d Modüle ait her masaüstü ekranın bir karosu çözülebildi",
    karosuz.length === 0,
    karosuz.length ? `karo bulunamadı: ${karosuz.join(", ")} — çözücü kör olabilir ya da KARO_YOK muafı gerekir` : "",
  );

  // TERS YÖN: karo bir modül bayrağına bağlı ama ekranın modülü BAŞKA.
  const ihlalTers: string[] = [];
  for (const karo of karolar.values()) {
    if (!karo.alan || !MODULE_FLAG_KEYS.has(karo.alan)) continue;
    const scr = SCREEN_CATALOG.find((x) => x.app === "desktop" && x.key === karo.key);
    if (!scr) continue;
    if (!karo.negatif && scr.modul === karo.alan) continue;
    if (muafliMi(scr.key)) {
      kullanilanMuaf.add(scr.key);
      continue;
    }
    ihlalTers.push(
      `${karo.key}: karo=${karo.negatif ? "!" : ""}${karo.alan} · manifesto=${scr.modul}`,
    );
  }
  check(
    "§9e ⭐ Bayrağa bağlı her karonun ekranı AYNI modüle beyanlı (ters yön)",
    ihlalTers.length === 0,
    ihlalTers.join(" · "),
  );

  const tumMuaflar = [
    ...KARO_VARYANT.map((e) => ({ ...e, liste: "KARO_VARYANT" })),
    ...KARO_BEKLEYEN.map((e) => ({ ...e, liste: "KARO_BEKLEYEN" })),
    ...RAPOR_KARMA.map((e) => ({ ...e, liste: "RAPOR_KARMA" })),
    ...KARO_YOK.map((e) => ({ ...e, liste: "KARO_YOK" })),
  ];
  const oluKaroMuaf = tumMuaflar
    .filter((e) => !kullanilanMuaf.has(e.key))
    .map((e) => `${e.liste}:${e.key}`);
  check(
    "§9f ⭐ Karo muaf listelerinde ÖLÜ satır yok (P5 bitince liste kendini kapatır)",
    oluKaroMuaf.length === 0,
    oluKaroMuaf.length
      ? `artık ihlal üretmiyor: ${oluKaroMuaf.join(", ")} — muafı SİL (bayat muaf gerçek bir ` +
        "boşluğu sessizce kapsam dışında tutar)"
      : `${tumMuaflar.length} muafın hepsi canlı`,
  );
  check(
    "§9g Her karo muafının gerekçesi yazılı",
    tumMuaflar.every((e) => e.reason.trim().length > 10),
    tumMuaflar
      .filter((e) => e.reason.trim().length <= 10)
      .map((e) => e.key)
      .join(", "),
  );
  console.log(`\n   ℹ️  Nav ön ek mirası: ${navMiras.map((n) => `${n.onEk}→${n.alan}`).join(", ") || "(yok)"}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // §10 TERS YÖN — backend REJİM KAPISI olan her modülün ≥1 ekranı var
  // ═══════════════════════════════════════════════════════════════════════════
  // Kaynak `src/middlewares/*.ts` içindeki `require<Alan>` export'larıdır —
  // bekçi dosyası DEĞİL (`test_feature_flag_contract`in `REGIME_GATES` sabiti
  // bir fonksiyon gövdesinde yaşıyor, export edilmiyor). Middleware ADI zaten
  // sözleşme (jenerik fabrika YASAK — module.middleware başlığı).
  const MW_DIZIN = path.join(ROOT, "Teks-Erp", "src", "middlewares");
  const kapiliAlanlar = new Set<string>();
  for (const f of fs.readdirSync(MW_DIZIN).filter((x) => x.endsWith(".ts"))) {
    const metin = yorumlariSok(fs.readFileSync(path.join(MW_DIZIN, f), "utf8"));
    for (const m of metin.matchAll(/export async function require([A-Z][A-Za-z0-9]*Enabled)\s*\(/g)) {
      const alan = m[1]!.charAt(0).toLowerCase() + m[1]!.slice(1);
      if (MODULE_FLAG_KEYS.has(alan)) kapiliAlanlar.add(alan);
    }
  }
  check(
    "§10a Körlük zemini: backend rejim kapısı bulundu",
    kapiliAlanlar.size >= 4,
    `${kapiliAlanlar.size} kapı → ${[...kapiliAlanlar].sort().join(", ")}`,
  );
  const kapiliAmaEkransiz = [...kapiliAlanlar].filter(
    (a) => screensOfModul(a as EkranModul).length === 0,
  );
  check(
    "§10b ⭐ Kapısı olan her modülün en az bir ekranı beyanlı",
    kapiliAmaEkransiz.length === 0,
    kapiliAmaEkransiz.length
      ? `kapı VAR ekran YOK: ${kapiliAmaEkransiz.join(", ")} — route korunuyor ama hangi ekranın ` +
        "gizleneceği hiçbir yerde yazmıyor"
      : "",
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
