// =============================================================================
// Kod koruma 2a — esbuild TEK DOSYA PAKETLEME PROVASI (ölçüm; üretim hattı DEĞİL)
// =============================================================================
// Sunucuyu (`src/server.ts`) ve yol sondasını esbuild ile tek `.cjs`e paketler,
// paket düzenini (app/{dist,prisma,assets,public,package.json,node_modules})
// geçici bir sahnede kurar, isteğe bağlı olarak sunucuyu 127.0.0.1'de açıp
// /health + kimlikli uçları yoklar ve KENDİ açtığı süreci kapatır.
//
// Koşum (Teks-Erp/ içinden; hedef DB `_test` olmak ZORUNDA — fixtureHedefEngeli):
//   node ../scripts/agir-is.mjs -- npx tsx scripts/olcum/paket-provasi.ts \
//        [--varyant=dis|tam] [--minify] [--calistir] [--port=4472] [--sahne=<dizin>] [--node=<ikili>]
//   --node : paketi koşturacak Node ikilisi (varsayılan bu süreç); hedef sürüm Node 24
//   dis (varsayılan) : yalnız BİZİM kod paketlenir (packages: "external")
//   tam              : node_modules da paketlenir; DISARIDA listesi hariç
// Çıktı: <sahne>/ozet.json + <sahne>/metafile.json (modul-sinirlari.ts girdisi).
// =============================================================================
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, type Metafile } from "esbuild";
import { cocukOrtami, fixtureHedefEngeli, hedefDbAdi } from "../lib/hedef-db-kapisi";

const TEKS = path.resolve(__dirname, "..", "..");
// `scripts/build-araclar.mjs` ile AYNI küme: Prisma üretilmiş istemcisi ve bwip-js çalışma anında çözülür.
const DISARIDA = ["@prisma/client", ".prisma/client", ".prisma/client/default", "prisma", "bwip-js"];

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"] as const;
  }),
);
const varyant = args.get("varyant") ?? "dis";
if (varyant !== "dis" && varyant !== "tam") {
  console.error(`X bilinmeyen varyant: ${varyant} (dis | tam)`);
  process.exit(2);
}
const minify = args.has("minify");
const calistir = args.has("calistir");
const port = Number(args.get("port") ?? 4472);
const nodeBin = path.resolve(args.get("node") ?? process.execPath);
const sahne = path.resolve(
  args.get("sahne") ?? path.join(tmpdir(), "tekserp-kod-koruma-2a", `${varyant}${minify ? "-min" : ""}`),
);
const app = path.join(sahne, "app");

const engel = fixtureHedefEngeli();
if (engel) {
  console.error(`X hedef DB reddedildi (${hedefDbAdi()}): ${engel}`);
  process.exit(2);
}

function kurSahne(): void {
  rmSync(sahne, { recursive: true, force: true });
  mkdirSync(path.join(app, "dist", "tools"), { recursive: true });
  for (const ad of ["node_modules", "prisma", "assets", "public"]) {
    symlinkSync(path.join(TEKS, ad), path.join(app, ad));
  }
  copyFileSync(path.join(TEKS, "package.json"), path.join(app, "package.json"));
  // Kendi `_test` .env'imiz (fabrika .env'i DEĞİL — kapı yukarıda ölçtü); sunucu cwd'den okur.
  symlinkSync(path.join(TEKS, ".env"), path.join(app, ".env"));
}

async function paketle(): Promise<{ metafile: Metafile; ms: number; uyarilar: string[] }> {
  const t0 = Date.now();
  const r = await build({
    entryPoints: {
      server: path.join(TEKS, "src", "server.ts"),
      "yol-sondasi": path.join(TEKS, "scripts", "olcum", "yol-sondasi.ts"),
    },
    outdir: path.join(app, "dist"),
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    packages: varyant === "dis" ? "external" : undefined,
    external: DISARIDA,
    minify,
    sourcemap: "external",
    metafile: true,
    legalComments: "none",
    logLevel: "silent",
  });
  // Paketteki yedek aracı (backup-impact toolPath) `build-araclar.mjs` ile aynı biçimde.
  await build({
    entryPoints: [path.join(TEKS, "scripts", "yedek-sifrele.ts")],
    outfile: path.join(app, "dist", "tools", "yedek-sifrele.cjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    external: DISARIDA,
    logLevel: "silent",
  });
  const uyarilar = r.warnings.map((w) => `${w.location?.file ?? "?"}: ${w.text}`);
  return { metafile: r.metafile, ms: Date.now() - t0, uyarilar };
}

/** Paketin çalışma anında hâlâ `require` ettiği yerleşik olmayan modüller (paket dışı bağımlılık yüzeyi). */
function kalanRequireler(dosya: string): string[] {
  const src = readFileSync(dosya, "utf8");
  const set = new Set<string>();
  for (const m of src.matchAll(/require\(\s*["']([^"'./][^"']*)["']\s*\)/g)) {
    const ad = m[1];
    if (ad.startsWith("node:")) continue;
    set.add(ad);
  }
  const yerlesik = new Set(builtinModules);
  return [...set].filter((a) => !yerlesik.has(a.split("/")[0])).sort();
}

async function bekle(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function http(yol: string, init?: RequestInit): Promise<{ status: number; body: unknown; tip: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${yol}`, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* düz metin */
  }
  return { status: res.status, body, tip: res.headers.get("content-type") ?? "" };
}

async function sunucuProvasi(): Promise<Record<string, unknown>> {
  const log: string[] = [];
  const t0 = Date.now();
  const cocuk = spawn(nodeBin, [path.join("dist", "server.cjs")], {
    cwd: app,
    env: cocukOrtami({ PORT: String(port), HOST: "127.0.0.1", DISCOVERY_MDNS_ENABLED: "false" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  cocuk.stdout.on("data", (d: Buffer) => log.push(d.toString()));
  cocuk.stderr.on("data", (d: Buffer) => log.push(d.toString()));
  let cikis: number | null = null;
  cocuk.on("exit", (c) => (cikis = c));

  let saglikMs: number | null = null;
  for (let i = 0; i < 600 && cikis === null; i++) {
    try {
      const r = await http("/health");
      if (r.status === 200) {
        saglikMs = Date.now() - t0;
        break;
      }
    } catch {
      /* henüz dinlemiyor */
    }
    await bekle(100);
  }
  const sonuc: Record<string, unknown> = { saglikMs, erkenCikis: cikis };
  try {
    if (saglikMs !== null) {
      const health = await http("/health");
      sonuc.health = health;
      sonuc.loginMethods = (await http("/api/auth/login-methods")).status;
      const giris = await http("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "123123", clientType: "electron" }),
      });
      sonuc.login = giris.status;
      const token = (giris.body as { data?: { token?: string } })?.data?.token;
      if (token) {
        const h = { authorization: `Bearer ${token}` };
        const admin = await http("/api/admin/health", { headers: h });
        sonuc.adminHealth = {
          status: admin.status,
          // Uç sarmasız döner (`res.json(buildRichHealth())`) — `data` altında değil.
          version: (admin.body as { version?: string })?.version ?? null,
        };
        sonuc.lisansDurum = (await http("/api/license/durum", { headers: h })).status;
        sonuc.items = (await http("/api/items?limit=1", { headers: h })).status;
        sonuc.swaggerUi = (await http("/api-docs/")).status;
        const css = await http("/api-docs/swagger-ui.css");
        sonuc.swaggerCss = `${css.status} ${css.tip}`;
      }
    }
  } finally {
    if (cikis === null) {
      cocuk.kill("SIGTERM");
      for (let i = 0; i < 80 && cikis === null; i++) await bekle(100);
      if (cikis === null) cocuk.kill("SIGKILL");
    }
  }
  const tumLog = log.join("");
  sonuc.logHataSatiri = tumLog.split("\n").filter((s) => /hata|error|UYARI|uyari|Cannot find|ENOENT/i.test(s)).slice(0, 30);
  writeFileSync(path.join(sahne, "sunucu.log"), tumLog);
  return sonuc;
}

async function main(): Promise<void> {
  kurSahne();
  const { metafile, ms, uyarilar } = await paketle();
  writeFileSync(path.join(sahne, "metafile.json"), JSON.stringify(metafile));
  const serverOut = path.join(app, "dist", "server.cjs");
  const girdiler = Object.keys(metafile.inputs);
  const ozet: Record<string, unknown> = {
    varyant,
    minify,
    hedefDb: hedefDbAdi(),
    paketlemeMs: ms,
    serverKB: Math.round(statSync(serverOut).size / 1024),
    mapKB: existsSync(`${serverOut}.map`) ? Math.round(statSync(`${serverOut}.map`).size / 1024) : null,
    srcGirdi: girdiler.filter((g) => g.startsWith("src/")).length,
    nodeModulesGirdi: girdiler.filter((g) => g.includes("node_modules/")).length,
    kalanRequire: kalanRequireler(serverOut),
    uyarilar,
  };
  if (calistir) {
    ozet.node = spawnSync(nodeBin, ["-v"], { encoding: "utf8" }).stdout.trim();
    const probe = spawnSync(nodeBin, [path.join("dist", "yol-sondasi.cjs")], { cwd: app, encoding: "utf8" });
    ozet.yolSondasi = probe.status === 0 ? JSON.parse(probe.stdout) : { status: probe.status, stderr: probe.stderr.slice(0, 2000) };
    ozet.sunucu = await sunucuProvasi();
  }
  writeFileSync(path.join(sahne, "ozet.json"), JSON.stringify(ozet, null, 2));
  process.stdout.write(JSON.stringify(ozet, null, 2) + "\n");
  process.stdout.write(`sahne: ${sahne}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
