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
// =============================================================================
import fs from "fs";
import path from "path";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import {
  SCREEN_CATALOG,
  SCREENLESS_PERMISSIONS,
  permissionsWithoutScreen,
  screensUsing,
} from "../src/constants/screen-catalog";

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

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
