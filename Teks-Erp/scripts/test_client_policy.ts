// =============================================================================
// Test: İstemci sürüm politikası tutarlı mı? (2026-08-27)
// Çalıştır: npx tsx scripts/test_client_policy.ts
// =============================================================================
// NEDEN: Politika, sahadaki panelleri KİLİTLEYEBİLEN tek koldur. Yanlış bir
// değer fabrikadaki bütün masaüstü panelleri aynı anda kullanılamaz hale
// getirir ve düzeltmesi yeni bir backend deploy'u gerektirir. Bu yüzden değer
// koddadır (panelde ayar DEĞİL) ve buradaki invariantlarla kilitlidir.
//
// EN KRİTİK KONTROL — §3: `minVersion`, sahaya çıkan panel sürümünden BÜYÜK
// olamaz. Olsaydı, en güncel paneli kurmuş bir makine bile kapıyı görür ve
// güncellenecek bir şey olmadığı için o kapıdan ÇIKAMAZDI: panel sonsuza dek
// "sunucu daha yeni sürüm istiyor" der, güncelleyici "en güncelsin" der.
// Bu, kendi kendini kurtaramayan tek arıza biçimidir.
// =============================================================================
import fs from "fs";
import path from "path";

import { CLIENT_VERSION_POLICIES, ELECTRON_VERSION_POLICY } from "../src/config/client-version-policy";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const SURUM_RE = /^\d+\.\d+\.\d+$/;

function cmp(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

console.log("\n§1 — Politika biçimi");
check("minVersion MAJOR.MINOR.PATCH", SURUM_RE.test(ELECTRON_VERSION_POLICY.minVersion),
  ELECTRON_VERSION_POLICY.minVersion);
check("currentVersion MAJOR.MINOR.PATCH", SURUM_RE.test(ELECTRON_VERSION_POLICY.currentVersion),
  ELECTRON_VERSION_POLICY.currentVersion);

console.log("\n§2 — İç tutarlılık");
check("minVersion <= currentVersion",
  cmp(ELECTRON_VERSION_POLICY.minVersion, ELECTRON_VERSION_POLICY.currentVersion) <= 0,
  `${ELECTRON_VERSION_POLICY.minVersion} vs ${ELECTRON_VERSION_POLICY.currentVersion}`);

console.log("\n§3 — Sahaya çıkan panelle uyum (EN KRİTİK)");
const pkgPath = path.resolve(__dirname, "../../Electron/package.json");
if (!fs.existsSync(pkgPath)) {
  check("Electron/package.json okunabildi", false, pkgPath);
} else {
  const panelSurum = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version as string;
  check("panel sürümü okunabildi", SURUM_RE.test(panelSurum), panelSurum);
  // Kilitlenme senaryosu: minVersion panelden büyükse, en güncel panel bile
  // kapıda kalır ve indirecek bir şey olmadığı için çıkamaz.
  check("minVersion <= Electron package.json sürümü (kurtarılamaz kilit YOK)",
    cmp(ELECTRON_VERSION_POLICY.minVersion, panelSurum) <= 0,
    `min ${ELECTRON_VERSION_POLICY.minVersion} vs panel ${panelSurum}`);
  // currentVersion yayındaki sürümü yansıtmalı; sapma "sahadaki panel kaç sürüm
  // geride" sorusunu sunucudan cevaplanamaz hale getirir (uyarı düzeyi değil,
  // çünkü backend ve panel AYRI deploy edilir — eşitlik zorunlu tutulmaz).
  if (ELECTRON_VERSION_POLICY.currentVersion !== panelSurum) {
    console.log(`ℹ️  currentVersion (${ELECTRON_VERSION_POLICY.currentVersion}) ile panel (${panelSurum}) ayrışmış — ayrı deploy edildilerse normal, yayın sonrası güncellenmeli.`);
  }
}

console.log("\n§4 — Uç mount edilmiş mi (yazıldı ama mount edilmedi sınıfı)");
const appTs = fs.readFileSync(path.resolve(__dirname, "../src/app.ts"), "utf-8");
check("app.ts route'u mount ediyor", appTs.includes('app.use("/api/client-policy"'));
check("app.ts import ediyor", appTs.includes("client-policy.routes"));
const routeTs = fs.readFileSync(
  path.resolve(__dirname, "../src/routes/client-policy.routes.ts"), "utf-8");
check("uç PUBLIC (verifyToken YOK — giriş öncesi sorulabilmeli)",
  !routeTs.includes("verifyToken"));
check("uç PARAMETRELİ (yeni istemci route'a değil kayıt defterine yazılır)",
  routeTs.includes('router.get("/:istemci"'));
check("tanımsız istemci 404 (fail-open okunur; boş politika DEĞİL)",
  routeTs.includes("status(404)"));
check("künye ucu var (GET /api/client-policy — API sürümü + TÜM istemciler)",
  routeTs.includes('router.get("/"'));
check("künye API sürümünü taşıyor", routeTs.includes("apiVersion: APP_VERSION"));
check("tekil yanıt da apiVersion taşıyor (ikinci istek gerekmesin)",
  routeTs.includes("apiVersion: APP_VERSION, ...policy"));

console.log("\n§5 — Kayıt defteri");
check("electron kayıtlı", CLIENT_VERSION_POLICIES.electron === ELECTRON_VERSION_POLICY);
for (const [ad, p] of Object.entries(CLIENT_VERSION_POLICIES)) {
  check(`${ad}: minVersion <= currentVersion`, cmp(p.minVersion, p.currentVersion) <= 0,
    `${p.minVersion} vs ${p.currentVersion}`);
}

console.log(`\n${fail === 0 ? "✅ TÜMÜ GEÇTİ" : "❌ BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı\n`);
process.exit(fail === 0 ? 0 : 1);
