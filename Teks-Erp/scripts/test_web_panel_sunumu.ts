// =============================================================================
// Test: web paneli statik sunumu (docs/design/BULUT-WEB-PANELI.md § Statik sunum)
// Çalıştır: npx tsx scripts/test_web_panel_sunumu.ts
// =============================================================================
// app.ts `WEB_DIST_DIR`i modül yüklenirken okur: iki kip iki ALT SÜREÇTE kurulur (aynı dosya, `--kip`
// argümanıyla). Panel kipi geçici bir sahte dist-web (index.html + özetli asset) ile açılır; DB'ye dokunulmaz.
//   §1 kipsiz (WEB_DIST_DIR yok): kök / durum sayfası (bugünkü davranış), frame-ancestors 'none' YOK
//   §2 panel kipi: / → index.html + no-store · assets immutable · derin yol SPA geri düşüşü no-store ·
//      /api/olmayan JSON (HTML değil) · CSP frame-ancestors 'none' + X-Frame-Options DENY
//   §3 negatif sondalar: denetleyiciler bozulmuş sentetik cevapta kırmızı
// =============================================================================
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

export interface Cevap {
  status: number;
  basliklar: Record<string, string>;
  govde: string;
}

const NO_STORE = "no-store";
const IMMUTABLE = "public, max-age=31536000, immutable";
const PANEL_IMI = "ef-b-sahte-panel";

// ── Saf denetleyiciler (sondalar bunları bozulmuş cevaplarla besler) ─────────────
const csp = (c: Cevap): string => c.basliklar["content-security-policy"] ?? "";
const html = (c: Cevap): boolean => (c.basliklar["content-type"] ?? "").includes("text/html");

export function panelKokIhlali(c: Cevap): string[] {
  const ih: string[] = [];
  if (c.status !== 200) ih.push(`/ status ${c.status}`);
  if (!c.govde.includes(PANEL_IMI)) ih.push("/ panelin index.html'i değil");
  if (c.basliklar["cache-control"] !== NO_STORE) ih.push(`/ Cache-Control=${c.basliklar["cache-control"] ?? "yok"}`);
  return ih;
}
export function assetIhlali(c: Cevap): string[] {
  const ih: string[] = [];
  if (c.status !== 200) ih.push(`asset status ${c.status}`);
  if (c.basliklar["cache-control"] !== IMMUTABLE) ih.push(`asset Cache-Control=${c.basliklar["cache-control"] ?? "yok"}`);
  return ih;
}
export function spaIhlali(c: Cevap): string[] {
  const ih: string[] = [];
  if (c.status !== 200 || !c.govde.includes(PANEL_IMI)) ih.push(`derin yol index.html'e düşmedi (status ${c.status})`);
  if (c.basliklar["cache-control"] !== NO_STORE) ih.push(`derin yol Cache-Control=${c.basliklar["cache-control"] ?? "yok"}`);
  return ih;
}
export function apiIhlali(c: Cevap): string[] {
  const ih: string[] = [];
  if (html(c) || c.govde.includes(PANEL_IMI)) ih.push("/api/olmayan HTML'e düştü");
  if (!(c.basliklar["content-type"] ?? "").includes("application/json")) ih.push(`/api/olmayan JSON değil (${c.basliklar["content-type"] ?? "yok"})`);
  return ih;
}
export function cerceveIhlali(c: Cevap): string[] {
  const ih: string[] = [];
  if (!/(^|;)\s*frame-ancestors 'none'(;|$)/.test(csp(c))) ih.push("CSP frame-ancestors 'none' yok");
  if ((c.basliklar["x-frame-options"] ?? "").toUpperCase() !== "DENY") ih.push(`X-Frame-Options=${c.basliklar["x-frame-options"] ?? "yok"}`);
  return ih;
}
export function kipsizKokIhlali(c: Cevap): string[] {
  const ih: string[] = [];
  if (c.status !== 200 || !html(c)) ih.push(`/ durum sayfası değil (status ${c.status})`);
  if (c.govde.includes(PANEL_IMI)) ih.push("kipsizde panel sunuldu");
  if (csp(c).includes("frame-ancestors 'none'")) ih.push("kipsizde CSP değişti (frame-ancestors 'none')");
  return ih;
}

// ── Alt süreç: app'i kur, istekleri at, cevapları JSON bas ─────────────────────
async function altSurec(): Promise<void> {
  const { default: app } = await import("../src/app");
  const sunucu = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => sunucu.once("listening", () => r()));
  const kok = `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`;
  const al = async (yol: string, accept = "text/html"): Promise<Cevap> => {
    const r = await fetch(kok + yol, { headers: { accept } });
    return { status: r.status, basliklar: Object.fromEntries(r.headers.entries()), govde: await r.text() };
  };
  const sonuc = {
    kok: await al("/"),
    asset: await al("/assets/x-abc123.js", "*/*"),
    spa: await al("/panel/derin-yol"),
    api: await al("/api/olmayan", "application/json"),
  };
  sunucu.close();
  process.stdout.write(`\n@@SONUC@@${JSON.stringify(sonuc)}\n`);
  process.exit(0);
}

type Sonuc = { kok: Cevap; asset: Cevap; spa: Cevap; api: Cevap };

function kosAlt(webDist: string | null): Sonuc {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.WEB_DIST_DIR;
  if (webDist) env.WEB_DIST_DIR = webDist;
  const r = spawnSync(process.execPath, [...process.execArgv, __filename, "--kip"], {
    env,
    cwd: path.resolve(path.dirname(__filename), ".."),
    encoding: "utf8",
    timeout: 120_000,
  });
  const satir = (r.stdout ?? "").split("\n").find((s) => s.startsWith("@@SONUC@@"));
  if (!satir) throw new Error(`alt süreç sonuç basmadı (çıkış ${r.status}):\n${(r.stderr ?? "").slice(-2000)}`);
  return JSON.parse(satir.slice("@@SONUC@@".length)) as Sonuc;
}

let pass = 0;
let fail = 0;
function check(ad: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${detay ? ` — ${detay}` : ""}`);
}

async function ana(): Promise<void> {
  const gecici = mkdtempSync(path.join(os.tmpdir(), "ef-b-dist-web-"));
  try {
    mkdirSync(path.join(gecici, "assets"));
    writeFileSync(path.join(gecici, "index.html"), `<!doctype html><html><head><script type="module" src="/assets/x-abc123.js"></script></head><body>${PANEL_IMI}</body></html>`);
    writeFileSync(path.join(gecici, "assets", "x-abc123.js"), "console.log('ef-b');\n");

    console.log("=== §1 kipsiz (WEB_DIST_DIR yok) ===\n");
    const k = kosAlt(null);
    const k1 = kipsizKokIhlali(k.kok);
    check("§1a ⭐ kök / durum sayfası, panel yok, CSP bugünkü", k1.length === 0, k1.join(" | "));
    const k2 = apiIhlali(k.api);
    check("§1b /api/olmayan JSON (HTML değil)", k2.length === 0, k2.join(" | "));
    console.log(`   gözlem: kipsiz /api/olmayan status ${k.api.status}`);

    console.log("\n=== §2 panel kipi (WEB_DIST_DIR = sahte dist-web) ===\n");
    const p = kosAlt(gecici);
    const olc: Array<[string, string[]]> = [
      ["§2a ⭐ / → index.html + Cache-Control no-store", panelKokIhlali(p.kok)],
      ["§2b ⭐ özetli asset → public, max-age=31536000, immutable", assetIhlali(p.asset)],
      ["§2c ⭐ /panel/derin-yol → SPA geri düşüşü + no-store", spaIhlali(p.spa)],
      ["§2d ⭐ /api/olmayan JSON, asla HTML", apiIhlali(p.api)],
      ["§2e ⭐ CSP frame-ancestors 'none' + X-Frame-Options DENY (kök + derin yol)", [...cerceveIhlali(p.kok), ...cerceveIhlali(p.spa)]],
    ];
    for (const [ad, ih] of olc) check(ad, ih.length === 0, ih.join(" | "));
    console.log(`   gözlem: panel kipi /api/olmayan status ${p.api.status} · ${p.api.govde.slice(0, 160)}`);

    console.log("\n=== §3 negatif sondalar (bozulmuş cevap → kırmızı) ===\n");
    const bas = (c: Cevap, b: Record<string, string | undefined>): Cevap => {
      const basliklar = { ...c.basliklar };
      for (const [a, v] of Object.entries(b)) {
        if (v === undefined) delete basliklar[a];
        else basliklar[a] = v;
      }
      return { ...c, basliklar };
    };
    const sondalar: Array<[string, Cevap, Cevap, (c: Cevap) => string[]]> = [
      ["index önbelleklenir", p.kok, bas(p.kok, { "cache-control": "public, max-age=0" }), panelKokIhlali],
      ["asset immutable değil", p.asset, bas(p.asset, { "cache-control": NO_STORE }), assetIhlali],
      ["SPA geri düşüşü başlıksız", p.spa, bas(p.spa, { "cache-control": undefined }), spaIhlali],
      ["/api HTML'e düştü", p.api, { status: 200, basliklar: { ...p.api.basliklar, "content-type": "text/html; charset=UTF-8" }, govde: p.kok.govde }, apiIhlali],
      ["frame-ancestors 'self'", p.kok, bas(p.kok, { "content-security-policy": csp(p.kok).replace("frame-ancestors 'none'", "frame-ancestors 'self'") }), cerceveIhlali],
      ["X-Frame-Options SAMEORIGIN", p.kok, bas(p.kok, { "x-frame-options": "SAMEORIGIN" }), cerceveIhlali],
      ["kipsizde panel sunuldu", k.kok, { ...k.kok, govde: p.kok.govde }, kipsizKokIhlali],
    ];
    for (const [ad, once, sonra, f] of sondalar) {
      const uygulandi = JSON.stringify(once) !== JSON.stringify(sonra);
      check(`sonda: ${ad} → kırmızı`, uygulandi && f(sonra).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
    }
  } finally {
    rmSync(gecici, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail ? 1 : 0);
}

if (process.argv.includes("--kip")) {
  void altSurec().catch((e) => {
    console.error(e);
    process.exit(2);
  });
} else {
  void ana().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
