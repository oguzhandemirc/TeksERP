// =============================================================================
// BEKÇİ — DOCKER YAPITLARININ HİJYENİ: seed kapısı · kaynaksız çalışma imajı ·
// demo aktarımının izin listesi
// Çalıştır: npx tsx scripts/run-all-tests.ts docker_hijyeni   (DB'siz)
// =============================================================================
//   §1 `docker/entrypoint.sh` seed'i YALNIZ şema boşken (`users` satırsız) VE
//      `SEED_ON_EMPTY=1` iken koşar; sayı okunamazsa atlar (fail-closed). İşaret
//      dosyasına bakan eski hâl, işaret kaybolunca dolu DB'ye seed koşup silinmiş
//      `admin`i bilinen parolayla geri doğuruyordu. DAVRANIŞ ölçülür: betik `sh`
//      ile, `psql`/`npx`/`node`/`npm` sahteleriyle koşturulur.
//   §2 Teks-Erp imajı + compose: seed çalışma imajına derlenmiş gider (src yok),
//      compose'un varsayılanı 0.
//   §3 kök (demo) Dockerfile: çalışma aşaması src/tsx/seed taşımaz; seed ayrı hedef.
//   §4 demo aktarımı: izin listesi + `git archive`; yasak desen hem örneklerle hem
//      gerçek aktarım kümesiyle ölçülür; Dockerfile'ın her COPY kaynağı kümede var.
//   §5 korumalı Linux imajı (Faz 2f) DURAĞAN: izin listesi `*` ile başlar, çalışma aşaması
//      root değil + bağlamdan yalnız docker/ betikleri, machine-id silinir; compose ro/127/seed 0.
// =============================================================================
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { git } from "./lib/git";

const KOK = join(__dirname, "..", "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}
const oku = (yol: string): string => readFileSync(join(KOK, yol), "utf8");

// -----------------------------------------------------------------------------
// §1 — entrypoint seed kapısı (davranış)
// -----------------------------------------------------------------------------
console.log("=== §1 docker/entrypoint.sh seed kapısı (sh + sahteler) ===\n");

const ENTRYPOINT = join(KOK, "Teks-Erp", "docker", "entrypoint.sh");
const SAHTELER: Record<string, string> = {
  npx: `echo "npx $*" >> "$STUB_LOG"; exit 0`,
  npm: `echo "npm $*" >> "$STUB_LOG"; exit 0`,
  psql: `echo "psql $*" >> "$STUB_LOG"
case "$STUB_PSQL" in
  fail) echo "psql: error: connection refused" >&2; exit 2 ;;
  *) printf '%s\\n' "$STUB_PSQL" ;;
esac`,
  node: `echo "node $*" >> "$STUB_LOG"
case "$1" in dist/tools/seed.cjs) exit "\${STUB_SEED_EXIT:-0}" ;; esac
exit 0`,
};

interface Kosum { cikis: number | null; log: string[]; stdout: string; hata?: string }
function kos(env: Record<string, string>): Kosum {
  const dir = mkdtempSync(join(tmpdir(), "docker-hijyen-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    for (const [ad, govde] of Object.entries(SAHTELER)) {
      writeFileSync(join(bin, ad), `#!/bin/sh\n${govde}\n`);
      chmodSync(join(bin, ad), 0o755);
    }
    const logYolu = join(dir, "stub.log");
    writeFileSync(logYolu, "");
    const r = spawnSync("sh", [ENTRYPOINT], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
      env: { PATH: `${bin}:/usr/bin:/bin`, STUB_LOG: logYolu, HOME: dir, ...env },
    });
    const log = readFileSync(logYolu, "utf8").split("\n").filter(Boolean);
    return { cikis: r.status, log, stdout: `${r.stdout ?? ""}${r.stderr ?? ""}`, hata: r.error?.message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const seedKostu = (k: Kosum): boolean => k.log.some((l) => l === "node dist/tools/seed.cjs" || /^npm run seed\b/.test(l));
const sunucuAcildi = (k: Kosum): boolean => k.log.includes("node dist/server.js");
const URL_SEMALI = "postgresql://u:p@h:5432/d?schema=public";

const senaryolar: Array<{ ad: string; env: Record<string, string>; seedBeklenir: boolean }> = [
  { ad: "A boş şema, SEED_ON_EMPTY verilmedi", env: { STUB_PSQL: "0" }, seedBeklenir: false },
  { ad: "B boş şema + SEED_ON_EMPTY=1", env: { STUB_PSQL: "0", SEED_ON_EMPTY: "1" }, seedBeklenir: true },
  { ad: "C dolu DB (3 kullanıcı) + SEED_ON_EMPTY=1", env: { STUB_PSQL: "3", SEED_ON_EMPTY: "1" }, seedBeklenir: false },
  { ad: "D psql düştü + SEED_ON_EMPTY=1", env: { STUB_PSQL: "fail", SEED_ON_EMPTY: "1" }, seedBeklenir: false },
  { ad: "E psql anlamsız çıktı + SEED_ON_EMPTY=1", env: { STUB_PSQL: 'ERROR:  relation "users" does not exist', SEED_ON_EMPTY: "1" }, seedBeklenir: false },
  { ad: "F boş şema + SEED_ON_EMPTY=true (1 değil)", env: { STUB_PSQL: "0", SEED_ON_EMPTY: "true" }, seedBeklenir: false },
];
for (const s of senaryolar) {
  const k = kos({ DATABASE_URL: URL_SEMALI, ...s.env });
  if (k.hata || k.cikis === null) {
    check(`§1 ${s.ad}: betik koşturulabildi`, false, `ÖLÇÜLEMEDİ — ${k.hata ?? "sinyal"}`);
    continue;
  }
  check(`§1 ⭐ ${s.ad} → seed ${s.seedBeklenir ? "KOŞAR" : "KOŞMAZ"}`, seedKostu(k) === s.seedBeklenir, k.log.join(" | "));
  check(`§1 ${s.ad} → sunucu yine açılır (çıkış 0)`, sunucuAcildi(k) && k.cikis === 0, `çıkış ${k.cikis}`);
}

// psql, Prisma'ya özgü `schema=` parametresini tanımaz; kapının sorgusu gerçekten DB'ye ulaşabilmeli.
{
  const k = kos({ DATABASE_URL: "postgresql://u:p@h:5432/d?sslmode=disable&schema=public", STUB_PSQL: "3" });
  const psqlSatirlari = k.log.filter((l) => l.startsWith("psql "));
  check("§1b ⭐ psql'e giden URL `schema=` taşımaz, diğer parametreler korunur",
    psqlSatirlari.length > 0 && psqlSatirlari.every((l) => !l.includes("schema=") && l.includes("postgresql://u:p@h:5432/d?sslmode=disable")),
    psqlSatirlari.join(" | ") || "psql hiç çağrılmadı");
}
{
  const k = kos({ DATABASE_URL: URL_SEMALI, STUB_PSQL: "0", SEED_ON_EMPTY: "1", STUB_SEED_EXIT: "1" });
  check("§1c seed başarısızsa sunucu yine açılır", sunucuAcildi(k) && k.cikis === 0, `çıkış ${k.cikis}`);
}
{
  const metin = oku("Teks-Erp/docker/entrypoint.sh");
  const kod = metin.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  check("§1d entrypoint işaret dosyasına bakmaz (`.seeded` yok)", !kod.includes(".seeded"));
}

// -----------------------------------------------------------------------------
// §2 — Teks-Erp imajı + compose
// -----------------------------------------------------------------------------
console.log("\n=== §2 Teks-Erp/Dockerfile + docker-compose.yml ===\n");

interface Asama { ad: string; kaynak: string; satirlar: string[] }
function asamalar(dockerfile: string): Asama[] {
  const sonuc: Asama[] = [];
  const kodSatirlari = dockerfile.split("\n").filter((l) => !/^\s*#/.test(l));
  // Devam satırları (`\`) tek komuta birleştirilir.
  const komutlar: string[] = [];
  let tampon = "";
  for (const l of kodSatirlari) {
    tampon += (tampon ? " " : "") + l.trim();
    if (!l.trimEnd().endsWith("\\")) { if (tampon.trim()) komutlar.push(tampon.replace(/\\\s/g, " ")); tampon = ""; }
  }
  for (const k of komutlar) {
    const m = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(k);
    if (m) sonuc.push({ ad: m[2] ?? `#${sonuc.length}`, kaynak: m[1], satirlar: [] });
    else if (sonuc.length) sonuc[sonuc.length - 1].satirlar.push(k);
  }
  return sonuc;
}
const kopyaKaynaklari = (satir: string): string[] => {
  if (!/^COPY\s/i.test(satir) || /--from=/.test(satir)) return [];
  const argumanlar = satir.replace(/^COPY\s+/i, "").split(/\s+/).filter((a) => !a.startsWith("--"));
  return argumanlar.slice(0, -1);
};

{
  const a = asamalar(oku("Teks-Erp/Dockerfile"));
  const build = a.find((x) => x.ad === "build");
  const runtime = a[a.length - 1];
  check("§2 körlük zemini: Teks-Erp/Dockerfile'da build + runtime aşaması bulundu", !!build && runtime?.ad === "runtime", a.map((x) => x.ad).join(", "));
  check("§2a ⭐ build aşaması seed'i tek dosyaya derler (dist/tools/seed.cjs)",
    !!build?.satirlar.some((s) => /esbuild\s+prisma\/seed\.ts\b.*--outfile=dist\/tools\/seed\.cjs/.test(s)));
  const rtKaynak = runtime?.satirlar.flatMap(kopyaKaynaklari) ?? [];
  check("§2b ⭐ runtime aşaması src/ kopyalamaz", !rtKaynak.some((k) => k === "." || /^\.?\/?src\b/.test(k)), rtKaynak.join(" "));
  check("§2c ⭐ entrypoint derlenmiş seed'i çağırır (`npm run seed` / ts-node değil)",
    /node dist\/tools\/seed\.cjs/.test(oku("Teks-Erp/docker/entrypoint.sh")) && !/npm run seed/.test(oku("Teks-Erp/docker/entrypoint.sh").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")));
  const compose = oku("Teks-Erp/docker-compose.yml");
  check("§2d ⭐ compose SEED_ON_EMPTY'i geçirir ve varsayılanı 0", /^\s+SEED_ON_EMPTY:\s*\$\{SEED_ON_EMPTY:-0\}\s*$/m.test(compose));
}

// -----------------------------------------------------------------------------
// §3 — kök (demo) Dockerfile
// -----------------------------------------------------------------------------
console.log("\n=== §3 kök Dockerfile (demo) ===\n");
const kokDockerfile = oku("Dockerfile");
const demoAsamalari = asamalar(kokDockerfile);
{
  const runtime = demoAsamalari[demoAsamalari.length - 1];
  const seed = demoAsamalari.find((x) => x.ad === "seed");
  check("§3 körlük zemini: son aşama `runtime` (varsayılan derleme hedefi)", runtime?.ad === "runtime", demoAsamalari.map((x) => x.ad).join(", "));
  const rt = runtime?.satirlar ?? [];
  const rtKaynak = rt.flatMap(kopyaKaynaklari);
  check("§3a ⭐ çalışma aşaması kaynak kopyalamaz (Teks-Erp/src)", !rtKaynak.some((k) => /(^|\/)src\/?$/.test(k)), rtKaynak.join(" "));
  check("§3b ⭐ çalışma aşaması tsx kurmaz/çağırmaz", !rt.some((s) => /\btsx\b/.test(s)));
  check("§3c ⭐ çalışma aşamasına prisma/ bütün olarak girmez (yalnız schema + migrations)",
    !rtKaynak.includes("Teks-Erp/prisma") && rtKaynak.includes("Teks-Erp/prisma/schema.prisma") && rtKaynak.includes("Teks-Erp/prisma/migrations"),
    rtKaynak.filter((k) => k.includes("prisma")).join(" "));
  check("§3d çalışma aşamasının prisma yapılandırması seed kancasız üretim JS'i",
    rt.some((s) => /^COPY\s+Teks-Erp\/deploy\/prisma\.config\.prod\.js\s+\.\/prisma\.config\.js$/.test(s)) && !rtKaynak.includes("Teks-Erp/prisma.config.ts"));
  check("§3e seed ayrı hedef (`FROM backend AS seed`)", seed?.kaynak === "backend");
}

// -----------------------------------------------------------------------------
// §4 — demo aktarımı: izin listesi + yasak desen
// -----------------------------------------------------------------------------
console.log("\n=== §4 docs/ops/deploy-demo.sh aktarımı ===\n");
{
  const betik = oku("docs/ops/deploy-demo.sh");
  const betikKod = betik.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  check("§4a ⭐ aktarım izin listesini okur ve `git archive HEAD` ile kurar",
    betikKod.includes("docs/ops/deploy-demo-izin-listesi.txt") && /git archive --format=tar HEAD -- \$PATHSPECS/.test(betikKod));
  check("§4b ⭐ çalışma ağacı doğrudan gönderilmez (rsync kaynağı yalnız aktarım dizini)",
    !/rsync[^\n]*\s\.\/\s/.test(betikKod) && /rsync \$RSYNC_OPTS '\$STAGE\/'/.test(betikKod));

  const m = /^YASAK_DESEN='([^']+)'$/m.exec(betik);
  check("§4 körlük zemini: YASAK_DESEN betikte bulundu", !!m);
  const desen = m ? new RegExp(m[1]) : /(?!)/;
  const yasakOrnekler = [
    "dump/tekserp_yeni_20260911_030001.dump", "tekserp.dump", "Teks-Erp/dump/a.sql", "Electron/release/Setup.exe",
    "BULGULAR-2026-09-04.md", "notlar/BULGULAR-X.md", ".env", "Teks-Erp/.env", "Electron/.env.production",
    "_anahtarlar/kok.key", "deploy/_anahtarlar/x", ".claude/settings.json",
  ];
  const kacan = yasakOrnekler.filter((y) => !desen.test(y));
  check("§4c ⭐ yasak desen her yasak örneği yakalar", kacan.length === 0, kacan.join(", ") || `${yasakOrnekler.length} örnek`);
  const masumOrnekler = [
    "Electron/src/pages/Operations/SackContentEdit/sackDump/dumpHtml.ts",
    "Teks-Erp/prisma/migrations/20260912120000_devere_modul_anahtari/migration.sql",
    "Teks-Erp/src/server.ts", "Electron/src/lib/env-guard.ts",
  ];
  const yanlis = masumOrnekler.filter((y) => desen.test(y));
  check("§4d yasak desen masum yolları geçirir (sınırlı eşleşme)", yanlis.length === 0, yanlis.join(", ") || `${masumOrnekler.length} örnek`);

  const liste = oku("docs/ops/deploy-demo-izin-listesi.txt").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  let kume: string[] = [];
  try {
    kume = git(["ls-files", "-z", "--", ...liste], { cwd: KOK }).split("\0").filter(Boolean);
  } catch (e) {
    check("§4 körlük zemini: aktarım kümesi git'ten ölçüldü", false, `ÖLÇÜLEMEDİ — ${(e as Error).message}`);
  }
  check("§4 körlük zemini: aktarım kümesi boş değil", kume.length > 100, `${kume.length} dosya`);
  const sizan = kume.filter((y) => desen.test(y));
  check("§4e ⭐ gerçek aktarım kümesinde yasak desene uyan dosya YOK", sizan.length === 0, sizan.slice(0, 10).join(", ") || "temiz");

  // Dockerfile'ın her COPY kaynağı kümede olmalı — dar liste imajı sunucuda kırar.
  const kaynaklar = demoAsamalari.flatMap((a) => a.satirlar.flatMap(kopyaKaynaklari));
  const eksik = kaynaklar.filter((k) => {
    const yol = k.replace(/\/$/, "");
    return !kume.some((f) => f === yol || f.startsWith(`${yol}/`));
  });
  check("§4f ⭐ kök Dockerfile'ın her COPY kaynağı aktarım kümesinde", kaynaklar.length > 5 && eksik.length === 0,
    eksik.join(", ") || `${kaynaklar.length} kaynak`);
  const kanal = oku("Electron/build-channel.ts").match(/from\s+"\.\.\/(deploy\/[^"]+)"/);
  check("§4g panel derlemesinin depo-dışı girdisi (build-channel → deploy/) kümede",
    !!kanal && kume.includes(kanal[1]), kanal?.[1] ?? "desen bulunamadı");

  const reset = oku("docs/ops/demo-reset.sh").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  check("§4h demo-reset seed'leri çalışma imajında (`compose run … tsx`) koşturmaz",
    !/compose run[^\n]*tsx/.test(reset) && /\$SEED_IMAGE npx tsx prisma\/seed\.ts/.test(reset));
  check("§4i deploy-demo seed'i seed imajında koşturur", /\$SEED_IMAGE npx tsx prisma\/seed-ticaret-demo\.ts/.test(betikKod) && !/compose run[^\n]*tsx/.test(betikKod));
  check("§4 körlük zemini: dosyalar var", existsSync(join(KOK, "docs/ops/deploy-demo-izin-listesi.txt")) && existsSync(ENTRYPOINT));
}

// -----------------------------------------------------------------------------
// §5 — korumalı Linux imajı (Faz 2f): DURAĞAN kapı — CI'da docker yokken de ölçülür.
// Derlenmiş imajın İÇERİĞİ kök `scripts/test_korumali_imaj.mjs`te (imaj yoksa ÖLÇÜLEMEDİ).
// -----------------------------------------------------------------------------
console.log("\n=== §5 korumalı imaj (Dockerfile · izin listesi · compose) ===\n");
function korumaliStatik(dockerfile: string, ignore: string, compose: string): string[] {
  const ih: string[] = [];
  const satir = ignore.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (satir[0] !== "*") ih.push("izin listesi `*` ile başlamıyor (blocklist yeni dosyayı sızdırır)");
  const son = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
  const kullanici = /^USER\s+(\S+)/m.exec(son)?.[1] ?? "";
  if (!kullanici || /^(0|root)(:|$)/.test(kullanici)) ih.push(`çalışma aşaması USER root/boş (${kullanici || "yok"})`);
  for (const m of son.matchAll(/^COPY\s+(?!--from)(?:--\S+\s+)*(\S+)/gm)) {
    if (!/^Teks-Erp\/docker\//.test(m[1])) ih.push(`çalışma aşaması bağlamdan kaynak kopyalıyor: ${m[1]}`);
  }
  if (!/rm -f \/etc\/machine-id/.test(son)) ih.push("çalışma aşaması /etc/machine-id'yi silmiyor");
  if (!/\/etc\/machine-id:ro/.test(compose)) ih.push("compose makine kimliğini salt-okunur bağlamıyor");
  if (!/\$\{TEKSERP_DINLE:-127\.0\.0\.1\}/.test(compose)) ih.push("compose portu varsayılan 127.0.0.1'e bağlamıyor");
  if (!/SEED_ON_EMPTY: \$\{SEED_ON_EMPTY:-0\}/.test(compose)) ih.push("compose SEED_ON_EMPTY varsayılanı 0 değil");
  if (!/read_only: true/.test(compose)) ih.push("compose kök dosya sistemini salt-okunur açmıyor");
  return ih;
}
{
  const df = oku("Teks-Erp/docker/korumali/Dockerfile");
  const ig = oku("Teks-Erp/docker/korumali/Dockerfile.dockerignore");
  const dc = oku("Teks-Erp/docker/korumali/docker-compose.yml");
  const gercek = korumaliStatik(df, ig, dc);
  check("§5a gerçek dosyalar temiz", gercek.length === 0, gercek.join(" | "));
  const sondalar: Array<[string, string, string, string]> = [
    ["izin listesi", df, ig.replace(/^\*$/m, "Teks-Erp/node_modules"), dc],
    ["USER root", df.replace(/^USER 10001:10001$/m, "USER root"), ig, dc],
    ["src kopyası", df.replace(/^WORKDIR \/app$/m, "COPY Teks-Erp/src /app/src\nWORKDIR /app"), ig, dc],
    ["machine-id", df.replace("rm -f /etc/machine-id", "true"), ig, dc],
    ["compose ro", df, ig, dc.replace("/etc/machine-id:ro", "/etc/machine-id")],
    ["compose port", df, ig, dc.replace("${TEKSERP_DINLE:-127.0.0.1}", "${TEKSERP_DINLE:-0.0.0.0}")],
    ["compose seed", df, ig, dc.replace("SEED_ON_EMPTY: ${SEED_ON_EMPTY:-0}", "SEED_ON_EMPTY: ${SEED_ON_EMPTY:-1}")],
    ["compose read_only", df, ig, dc.replace(/read_only: true/g, "read_only: false")],
  ];
  for (const [ad, d, i, c] of sondalar) {
    const uygulandi = d !== df || i !== ig || c !== dc;
    check(`§5b sonda: ${ad} → kırmızı`, uygulandi && korumaliStatik(d, i, c).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
