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
//      compose'un varsayılanı 0. §2e–§2h (G22): bağlam İZİN LİSTESİ (`*` ile başlar; .env/döküm/şifreli yedek
//      dışlanır, scripts/ girmez) · çalışma aşaması root DEĞİL ve scripts/ kopyalamaz · compose backend'i
//      salt-okunur kök FS + cap_drop ALL + no-new-privileges ile açar; kalıcı sondalar her koşumda.
//   §3 kök (demo) Dockerfile: çalışma aşaması src/tsx/seed taşımaz; seed ayrı hedef.
//   §4 demo aktarımı: izin listesi + `git archive`; yasak desen hem örneklerle hem
//      gerçek aktarım kümesiyle ölçülür; Dockerfile'ın her COPY kaynağı kümede var.
//   §5 korumalı Linux imajı (Faz 2f) DURAĞAN: izin listesi `*` ile başlar, çalışma aşaması
//      root değil + bağlamdan yalnız docker/ betikleri, machine-id silinir; compose ro/127/seed 0.
//      §5c teslim künyesi 2e aracıyla imzalanır: anahtar açıkça verilir (varsayılan yol yok, boşsa DUR), yoksa paket yok,
//      künye müşterisiz, .jws SHA256SUMS'ta.
//      §5d vekil ayarları (TRUST_PROXY · LOGIN_LOCKOUT_SCOPE · RATE_LIMIT_*) backend'e boş varsayılanla geçer;
//      şablon TRUST_PROXY'yi boş doğurur. §5e şablonun LICENSE_SERVER_URL açıklaması vendor-url.ts sabitleriyle aynı.
//      §5f compose · şablon · runbook API portunu ağa açmayı önermez (Docker'da LAN TLS yok, yayın ufw'yi atlar).
//      §5g runbook seed parolasını konteynerden temizletir (seed'den sonra bayraksız up -d + uzunluk ölçümü).
//      §5h runbook konteynerin lisans cevaplarını anar (zayıf tanıma onayı); adlar protokol kataloğunda (uclar.ts).
//      §5i göçlü geri alma şemayı ÖNCE sıfırlar (pg_restore --clean yeni göçün tablolarını bırakır), göç sayısını ölçer.
//      §5j runbook §9 compose'un bütün birimlerini `<proje>_` adıyla anar; kaldırma `-v` değil adıyla.
//   §6 satıcı imajı (G2/G3) DURAĞAN: `satici/sunucu/scripts/` altındaki her CLI `dist-cli`'a derlenir ve
//      `test -f` kapısında; compose'da `/dosyalar` yazılır, `/derlemeler` + `/yayin` salt okunur (⑨'un docker'sız ikizi).
// =============================================================================
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
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

// §2e–§2h (G22) — Teks-Erp imajı sertleştirmesi DURAĞAN (CI'da docker yokken de ölçülür).
function teksStatik(dockerfile: string, ignore: string, compose: string): string[] {
  const ih: string[] = [];
  const satir = ignore.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (satir[0] !== "*") ih.push("Teks-Erp/.dockerignore izin listesi `*` ile başlamıyor (blocklist yeni dosyayı — fabrika dökümünü — sızdırır)");
  for (const zorunlu of ["**/.env*", "**/*.dump", "**/*.tkenc"]) if (!satir.includes(zorunlu)) ih.push(`.dockerignore ${zorunlu} dışlamıyor`);
  const izinli = satir.filter((l) => l.startsWith("!")).map((l) => l.slice(1));
  for (const yasak of izinli.filter((l) => /^(scripts|dump|lisans|backups|\.env)/.test(l))) ih.push(`.dockerignore yasak içeriğe izin veriyor: !${yasak}`);
  const a = asamalar(dockerfile);
  const son = a[a.length - 1];
  const kullanici = [...(son?.satirlar ?? [])].reverse().map((k) => /^USER\s+(\S+)/i.exec(k)?.[1]).find(Boolean) ?? "";
  if (!kullanici || /^(0|root)(:|$)/.test(kullanici)) ih.push(`çalışma aşaması USER root/boş (${kullanici || "yok"})`);
  const kaynak = son?.satirlar.flatMap(kopyaKaynaklari) ?? [];
  if (kaynak.some((k) => /^\.?\/?scripts\/?$/.test(k))) ih.push("çalışma aşaması scripts/ kopyalıyor (yıkıcı bakım betikleri imaja girer)");
  const backend = compose.slice(compose.indexOf("\n  backend:"), compose.indexOf("\nvolumes:"));
  if (!/^\s+read_only: true$/m.test(backend)) ih.push("compose backend kök dosya sistemini salt-okunur açmıyor");
  if (!/cap_drop: \["ALL"\]/.test(backend)) ih.push("compose backend yetkileri düşürmüyor (cap_drop ALL)");
  if (!/no-new-privileges:true/.test(backend)) ih.push("compose backend no-new-privileges taşımıyor");
  if (!/tmpfs: \["\/tmp/.test(backend)) ih.push("compose backend /tmp'yi bellekte açmıyor (salt-okunur FS'de entrypoint yazamaz)");
  return ih;
}
{
  const df = oku("Teks-Erp/Dockerfile");
  const ig = oku("Teks-Erp/.dockerignore");
  const dc = oku("Teks-Erp/docker-compose.yml");
  const gercek = teksStatik(df, ig, dc);
  check("§2e ⭐ Teks-Erp imajı: izin listesi bağlam · root olmayan çalışma aşaması · scripts/ yok · sertleştirilmiş compose", gercek.length === 0, gercek.join(" | "));
  const sondalar: Array<[string, string, string, string]> = [
    ["blocklist .dockerignore", df, ig.replace(/^\*$/m, "node_modules"), dc],
    ["dump dışlaması söküldü", df, ig.replace(/^\*\*\/\*\.dump$/m, ""), dc],
    ["scripts/ izni", df, `${ig}\n!scripts/**\n`, dc],
    ["USER satırı söküldü", df.replace(/^USER node$/m, ""), ig, dc],
    ["USER root", df.replace(/^USER node$/m, "USER root"), ig, dc],
    ["scripts/ yeniden kopyalandı", df.replace(/^USER node$/m, "COPY scripts ./scripts\nUSER node"), ig, dc],
    ["compose read_only kalktı", df, ig, dc.replace("    read_only: true\n", "")],
    ["compose cap_drop kalktı", df, ig, dc.replace('    cap_drop: ["ALL"]\n', "")],
    ["compose no-new-privileges kalktı", df, ig, dc.replace('    security_opt: ["no-new-privileges:true"]\n', "")],
  ];
  for (const [ad, d, i, c] of sondalar) {
    const uygulandi = d !== df || i !== ig || c !== dc;
    check(`§2f sonda: ${ad} → kırmızı`, uygulandi && teksStatik(d, i, c).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
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
  const disGirdiler = [...oku("Electron/build-identity.ts").matchAll(/from\s+"\.\.\/((?:deploy|scripts)\/[^"]+)"/g)].map((m) => m[1]);
  const disEksik = disGirdiler.filter((g) => !kume.includes(g));
  check("§4g panel derlemesinin depo-dışı girdileri (build-identity → deploy/ · scripts/) kümede",
    disGirdiler.length >= 2 && disEksik.length === 0, disEksik.join(", ") || disGirdiler.join(", ") || "desen bulunamadı");

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

// §5d — vekil ayarları: compose backend'e geçer (yoksa vekil arkasında herkes tek IP), varsayılan BOŞ
// (vekilsiz kurulumda bugünkü davranış), şablon TRUST_PROXY'yi boş doğurur ("true" sahte XFF'e güvenir).
const VEKIL_ANAHTARLARI = ["TRUST_PROXY", "LOGIN_LOCKOUT_SCOPE", "RATE_LIMIT_ENABLED", "RATE_LIMIT_WINDOW_SEC", "RATE_LIMIT_WRITE_MAX", "RATE_LIMIT_LOGIN_MAX"];
function vekilStatik(compose: string, envOrnek: string): string[] {
  const ih: string[] = [];
  const bas = compose.indexOf("\n  backend:");
  const son = compose.indexOf("\n  yedek:");
  const backend = bas >= 0 && son > bas ? compose.slice(bas, son) : "";
  if (!backend) ih.push("compose backend servisi bulunamadı");
  for (const a of VEKIL_ANAHTARLARI) {
    if (!new RegExp(`^\\s+${a}: \\$\\{${a}:-\\}$`, "m").test(backend)) ih.push(`compose backend ${a}'yi boş varsayılanla geçirmiyor`);
  }
  const tp = /^TRUST_PROXY=(.*)$/m.exec(envOrnek);
  if (!tp) ih.push(".env.ornek TRUST_PROXY satırı yok");
  else if (tp[1].trim() !== "") ih.push(`.env.ornek TRUST_PROXY boş doğmuyor (${tp[1].trim()})`);
  if (!/^RATE_LIMIT_ENABLED=/m.test(envOrnek)) ih.push(".env.ornek RATE_LIMIT_ENABLED satırı yok");
  return ih;
}
{
  const dc = oku("Teks-Erp/docker/korumali/docker-compose.yml");
  const eo = oku("Teks-Erp/docker/korumali/.env.ornek");
  const gercek = vekilStatik(dc, eo);
  check("§5d ⭐ compose vekil ayarlarını (TRUST_PROXY · giriş kilidi · hız sınırı) boş varsayılanla geçirir, şablon güvenmez", gercek.length === 0, gercek.join(" | "));
  const sondalar: Array<[string, string, string]> = [
    ["TRUST_PROXY geçmiyor", dc.replace(/^\s+TRUST_PROXY: .*\n/m, ""), eo],
    ["TRUST_PROXY varsayılanı true", dc.replace("${TRUST_PROXY:-}", "${TRUST_PROXY:-true}"), eo],
    ["RATE_LIMIT_ENABLED geçmiyor", dc.replace(/^\s+RATE_LIMIT_ENABLED: .*\n/m, ""), eo],
    ["anahtar yedek servisinde", dc.replace(/^\s+LOGIN_LOCKOUT_SCOPE: .*\n/m, "").replace("      YEDEK_SAAT:", "      LOGIN_LOCKOUT_SCOPE: ${LOGIN_LOCKOUT_SCOPE:-}\n      YEDEK_SAAT:"), eo],
    ["şablon TRUST_PROXY=true", dc, eo.replace(/^TRUST_PROXY=.*$/m, "TRUST_PROXY=true")],
  ];
  for (const [ad, c, e] of sondalar) {
    const uygulandi = c !== dc || e !== eo;
    check(`§5d sonda: ${ad} → kırmızı`, uygulandi && vekilStatik(c, e).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

// §5e — şablonun lisans adresi açıklaması tek çözüm yeriyle (vendor-url.ts) aynı şeyi söyler:
// boş = üretim satıcısı, yalnız `kapali` dışarı çıkışı kapatır.
function lisansAdresiStatik(envOrnek: string, vendorUrl: string): string[] {
  const ih: string[] = [];
  const varsayilan = /DEFAULT_LICENSE_SERVER_URL = "([^"]+)"/.exec(vendorUrl)?.[1];
  const kapali = /LICENSE_SERVER_DISABLED = "([^"]+)"/.exec(vendorUrl)?.[1];
  if (!varsayilan || !kapali) return ["vendor-url.ts sabitleri okunamadı (ÖLÇÜLEMEDİ)"];
  const satirlar = envOrnek.split("\n");
  const i = satirlar.findIndex((l) => l.startsWith("LICENSE_SERVER_URL="));
  let j = i;
  while (j > 0 && satirlar[j - 1].startsWith("#")) j--;
  const yorum = i >= 0 ? satirlar.slice(j, i).join("\n") : "";
  if (!yorum) ih.push(".env.ornek LICENSE_SERVER_URL açıklamasız");
  if (!yorum.includes(varsayilan)) ih.push(`açıklama boş değerin ${varsayilan} olduğunu söylemiyor`);
  if (!yorum.includes(`\`${kapali}\``)) ih.push(`açıklama çıkışı kapatan \`${kapali}\` değerini anmıyor`);
  if (/boşsa dışarı çıkılmaz/i.test(yorum)) ih.push("açıklama 'boşsa dışarı çıkılmaz' diyor (boş = üretim satıcısı)");
  return ih;
}
{
  const eo = oku("Teks-Erp/docker/korumali/.env.ornek");
  const vu = oku("Teks-Erp/src/lib/license/vendor-url.ts");
  const gercek = lisansAdresiStatik(eo, vu);
  check("§5e ⭐ şablonun LICENSE_SERVER_URL açıklaması vendor-url.ts ile aynı (boş = üretim satıcısı, `kapali` = çıkış yok)", gercek.length === 0, gercek.join(" | "));
  const eski = eo.replace(/^# Satıcı lisans sunucusu kökü[\s\S]*?(?=^LICENSE_SERVER_URL=)/m, "# Satıcı lisans sunucusu kökü (boşsa dışarı çıkılmaz; motor gözlemde kalır).\n");
  check("§5e sonda: eski açıklama → kırmızı", eski !== eo && lisansAdresiStatik(eski, vu).length > 0, eski !== eo ? "" : "MUTASYON UYGULANMADI");
}

// §5f — teslim dosyaları ve runbook API portunu ağa açmayı ÖNERMEZ: Docker'da LAN TLS yok (4000 şifresiz) ve
// Docker yayını ufw'yi atlar. 0.0.0.0'ı anan her satır yasak kipindedir; şablon değeri 127.0.0.1.
const DINLE_DOSYALARI = ["Teks-Erp/docker/korumali/docker-compose.yml", "Teks-Erp/docker/korumali/.env.ornek", "docs/ops/LINUX-DOCKER-KURULUM.md"];
function dinleStatik(dosyalar: Record<string, string>): string[] {
  const ih: string[] = [];
  for (const [ad, metin] of Object.entries(dosyalar)) {
    metin.split("\n").forEach((l, n) => {
      if (/0\.0\.0\.0/.test(l) && !/yazılmaz|yazılırsa|yazmayın|değiştirilmez/i.test(l)) ih.push(`${ad}:${n + 1} 0.0.0.0'ı yasak kipinde anmıyor`);
    });
  }
  const eo = dosyalar["Teks-Erp/docker/korumali/.env.ornek"] ?? "";
  if (!/^TEKSERP_DINLE=127\.0\.0\.1$/m.test(eo)) ih.push(".env.ornek TEKSERP_DINLE=127.0.0.1 doğmuyor");
  return ih;
}
{
  const d = Object.fromEntries(DINLE_DOSYALARI.map((y) => [y, oku(y)]));
  const gercek = dinleStatik(d);
  check("§5f ⭐ compose · şablon · runbook API portunu ağa açmayı önermez (0.0.0.0 yalnız yasak kipinde)", gercek.length === 0, gercek.join(" | "));
  const eoAd = "Teks-Erp/docker/korumali/.env.ornek";
  const sondalar: Array<[string, Record<string, string>]> = [
    ["eski öneri satırı", { ...d, [eoAd]: d[eoAd] + "# fabrika ağına açmak için 0.0.0.0 ya da LAN IP'si\n" }],
    ["şablon 0.0.0.0 doğar", { ...d, [eoAd]: d[eoAd].replace(/^TEKSERP_DINLE=.*$/m, "TEKSERP_DINLE=0.0.0.0") }],
  ];
  for (const [ad, dd] of sondalar) check(`§5f sonda: ${ad} → kırmızı`, dinleStatik(dd).length > 0);
}

// §5g — runbook ilk kurulumu seed parolasını konteynerde BIRAKMAZ: ilk `up`tan sonra bayraksız `up -d`
// (yeniden yaratma) ve parolayı basmadan uzunluğunu ölçen doğrulama; parola komut satırına yazılmaz.
function seedTemizlikStatik(runbook: string): string[] {
  const ih: string[] = [];
  const bas = runbook.indexOf("## 2.");
  const son = runbook.indexOf("\n## 3.");
  const b2 = bas >= 0 && son > bas ? runbook.slice(bas, son) : "";
  if (!b2) return ["runbook §2 bulunamadı (ÖLÇÜLEMEDİ)"];
  const ilk = b2.search(/^SEED_ON_EMPTY=1 docker compose up -d/m);
  if (ilk < 0) ih.push("§2'de ilk (seed'li) up yok");
  const sonra = ilk >= 0 ? b2.slice(ilk + 1) : "";
  if (!/^docker compose up -d(\s|$)/m.test(sonra)) ih.push("seed'den sonra bayraksız `docker compose up -d` (yeniden yaratma) yok");
  if (!/ILK_YONETICI_PAROLASI.*length\(\$2\)/.test(sonra)) ih.push("parolanın konteynerden gittiği (uzunluk 0) ölçülmüyor");
  if (/ILK_YONETICI_PAROLASI='[^']*'\s+docker compose/.test(b2)) ih.push("parola komut satırında veriliyor (komut geçmişi)");
  return ih;
}
{
  const rb = oku("docs/ops/LINUX-DOCKER-KURULUM.md");
  const gercek = seedTemizlikStatik(rb);
  check("§5g ⭐ runbook seed parolasını konteynerden temizletir (bayraksız up -d + uzunluk ölçümü)", gercek.length === 0, gercek.join(" | "));
  const sil = rb.replace(/^docker compose up -d {2,}.*\n/m, "");
  check("§5g sonda: temizlik adımı silindi → kırmızı", sil !== rb && seedTemizlikStatik(sil).length > 0, sil !== rb ? "" : "MUTASYON UYGULANMADI");
}

// §5h — runbook konteynerin bilinen lisans cevaplarını anar ve adları protokol kataloğunda yaşar (ad kayarsa kırmızı):
// iki etkenli konteyner ilk etkinleştirmede zayıf tanıma onayı bekler; lisans birimi silinen kurulum taşıma kodu ister.
const RUNBOOK_LISANS_KODLARI = ["ZAYIF_TANIMA_ONAY_BEKLIYOR", "TASIMA_KODU_GEREKLI"];
function lisansKoduStatik(runbook: string, uclar: string, kodlar: string[]): string[] {
  const ih: string[] = [];
  for (const k of kodlar) {
    if (!runbook.includes(k)) ih.push(`runbook ${k}'yi anmıyor`);
    if (!uclar.includes(`"${k}"`)) ih.push(`${k} protokol kataloğunda (uclar.ts) yok`);
  }
  return ih;
}
{
  const rb = oku("docs/ops/LINUX-DOCKER-KURULUM.md");
  const uc = oku("Teks-Erp/src/lib/license/protocol/uclar.ts");
  const gercek = lisansKoduStatik(rb, uc, RUNBOOK_LISANS_KODLARI);
  check("§5h ⭐ runbook konteynerin lisans cevaplarını (zayıf tanıma onayı…) anar, adlar protokol kataloğunda", gercek.length === 0, gercek.join(" | "));
  check("§5h sonda: runbook'tan silindi → kırmızı", lisansKoduStatik(rb.split("ZAYIF_TANIMA_ONAY_BEKLIYOR").join("ZAYIF"), uc, RUNBOOK_LISANS_KODLARI).length > 0);
  check("§5h sonda: katalogda yeniden adlandı → kırmızı", lisansKoduStatik(rb, uc.split('"ZAYIF_TANIMA_ONAY_BEKLIYOR"').join('"ZAYIF_TANIMA"'), RUNBOOK_LISANS_KODLARI).length > 0);
}

// §5i — göçlü geri alma şemayı ÖNCE sıfırlar: `pg_restore --clean` yalnız dökümdeki nesneleri düşürür, yeni göçün
// tabloları kalır ve sonraki güncellemede aynı göç "zaten var" ile düşer (BULUT-KURULUM §4.4 GOC telafisi).
function geriAlmaStatik(runbook: string): string[] {
  const ih: string[] = [];
  const bas = runbook.indexOf("\n## 6.");
  const son = runbook.indexOf("\n## 7.");
  const b6 = bas >= 0 && son > bas ? runbook.slice(bas, son) : "";
  if (!b6) return ["runbook §6 bulunamadı (ÖLÇÜLEMEDİ)"];
  for (const l of b6.split("\n")) {
    if (/pg_restore[^\n]*--clean/.test(l) && !/YETMEZ/.test(l)) ih.push("§6 geri yüklemeyi `pg_restore --clean` ile öneriyor");
  }
  const sifirla = b6.search(/DROP SCHEMA public CASCADE/);
  const yukle = b6.search(/yedek pg_restore --no-owner -d /);
  if (sifirla < 0) ih.push("§6 public şemasını sıfırlamıyor");
  if (yukle < 0) ih.push("§6 pg_restore adımı yok");
  if (sifirla >= 0 && yukle >= 0 && sifirla > yukle) ih.push("§6 şemayı geri yüklemeden SONRA sıfırlıyor");
  if (/^[^#\n]*\b(dropdb|createdb)\b/m.test(b6.replace(/^- .*$/gm, ""))) ih.push("§6 veritabanını silip yaratıyor (audit_guard gider)");
  if (!/_prisma_migrations/.test(b6)) ih.push("§6 göç sayısını ölçmüyor");
  return ih;
}
{
  const rb = oku("docs/ops/LINUX-DOCKER-KURULUM.md");
  const gercek = geriAlmaStatik(rb);
  check("§5i ⭐ göçlü geri alma: şema sıfırla → pg_restore → göç sayısı (pg_restore --clean önerilmez)", gercek.length === 0, gercek.join(" | "));
  const sondalar: Array<[string, string]> = [
    ["--clean'e dönüş", rb.replace("yedek pg_restore --no-owner -d ", "yedek pg_restore --clean --if-exists --no-owner -d ")],
    ["sıfırlama silindi", rb.replace(/^.*DROP SCHEMA public CASCADE.*\n/m, "")],
  ];
  for (const [ad, r] of sondalar) check(`§5i sonda: ${ad} → kırmızı`, r !== rb && geriAlmaStatik(r).length > 0, r !== rb ? "" : "MUTASYON UYGULANMADI");
}

// §5j — `down -v` kurulumu lisansla birlikte siler: runbook §9 compose'un BÜTÜN birimlerini `<proje>_` adıyla anar
// (birim eklenip runbook'a yazılmazsa kırmızı) ve kaldırmayı `-v` yerine adıyla yaptırır.
function birimStatik(compose: string, runbook: string): string[] {
  const ih: string[] = [];
  const vbas = compose.indexOf("\nvolumes:");
  const birimler = vbas >= 0 ? [...compose.slice(vbas).matchAll(/^ {2}([a-z_]+):\s*$/gm)].map((m) => m[1]) : [];
  if (birimler.length < 4) return [`compose birimleri okunamadı (${birimler.join(",") || "yok"}) — ÖLÇÜLEMEDİ`];
  const bas = runbook.indexOf("\n## 9.");
  const b9 = bas >= 0 ? runbook.slice(bas, (runbook.indexOf("\n## 10.", bas) + 1 || runbook.length + 1) - 1) : "";
  if (!b9) return ["runbook §9 (birimler) bulunamadı"];
  for (const b of birimler) if (!b9.includes(`<proje>_${b}`)) ih.push(`§9 <proje>_${b} birimini anmıyor`);
  const rm = /^docker volume rm (.+?)(\s+#.*)?$/m.exec(b9);
  if (!rm) ih.push("§9 kaldırmayı birim adıyla (docker volume rm) yaptırmıyor");
  else for (const b of birimler) if (!rm[1].includes(`<proje>_${b}`)) ih.push(`§9 volume rm satırında <proje>_${b} yok`);
  if (/^docker compose down -v/m.test(b9)) ih.push("§9 komut olarak `down -v` veriyor");
  if (!/TASIMA_KODU_GEREKLI/.test(b9)) ih.push("§9 lisans biriminin silinmesinin sonucunu (TASIMA_KODU_GEREKLI) söylemiyor");
  return ih;
}
{
  const dc = oku("Teks-Erp/docker/korumali/docker-compose.yml");
  const rb = oku("docs/ops/LINUX-DOCKER-KURULUM.md");
  const gercek = birimStatik(dc, rb);
  check("§5j ⭐ runbook §9 compose'un bütün birimlerini adıyla anar, kaldırma `-v` değil adıyla, lisans sonucu yazılı", gercek.length === 0, gercek.join(" | "));
  const sondalar: Array<[string, string, string]> = [
    ["compose'a yeni birim", dc.replace(/\nvolumes:\n/, "\nvolumes:\n  ota:\n"), rb],
    ["rm satırından lisans düştü", dc, rb.replace(/ <proje>_lisans(?=\s+# GERİ)/, "")],
    ["kaldırma -v'ye döndü", dc, rb.replace(/^docker compose down\ndocker volume rm .*$/m, "docker compose down -v")],
  ];
  for (const [ad, c, r] of sondalar) check(`§5j sonda: ${ad} → kırmızı`, (c !== dc || r !== rb) && birimStatik(c, r).length > 0, c !== dc || r !== rb ? "" : "MUTASYON UYGULANMADI");
}

// §5c — teslim künyesi İMZALI çıkar (2e aracı, `build-korumali-imza.ts belge`): anahtar yoksa paket
// üretilmez, imza ve imzalı liste dosyası SHA256SUMS'a girer, imza özetlerden ÖNCE atılır.
function teslimImzaStatik(betik: string): string[] {
  const kod = betik.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const ih: string[] = [];
  const imza = kod.search(/build-korumali-imza\.ts belge --belge="\$CIKTI\/PAKET-DOCKER\.json" --anahtar="\$ANAHTAR"/);
  if (imza < 0) ih.push("künye imza aracına verilmiyor");
  if (!/\[ -f "\$ANAHTAR" \] \|\| \{[^}]*exit 1; \}/.test(kod)) ih.push("anahtar yokken paket üretimi durmuyor");
  // Anahtar AÇIKÇA verilir: varsayılan yol yok, boş değer durur (fail-closed); künye müşteri taşımaz.
  if (!/^ANAHTAR="\$\{TEKSERP_PAKET_ANAHTARI:-\}"$/m.test(kod)) ih.push("anahtarın varsayılan yolu var (açıkça verilmeli)");
  const bos = kod.search(/\[ -n "\$ANAHTAR" \] \|\| \{[^}]*exit 1; \}/), dosya = kod.search(/\[ -f "\$ANAHTAR" \]/);
  if (bos < 0 || dosya < 0 || bos > dosya) ih.push("anahtar verilmediğinde paket üretimi durmuyor");
  if (/TEKSERP_MUSTERI/.test(kod) || !/^\s*musteri: null,/m.test(kod)) ih.push("künye müşteriyi ortamdan okuyor (ortak paket müşterisiz)");
  const ozet = kod.search(/for f in [^;\n]*PAKET-DOCKER\.json\.jws; do/);
  if (ozet < 0) ih.push("imza dosyası SHA256SUMS'a girmiyor");
  if (!/for f in [^;\n]*butunluk-liste\.txt[^;\n]*; do/.test(kod)) ih.push("imzalı liste dosyası SHA256SUMS'a girmiyor");
  else if (imza > ozet) ih.push("imza özetlerden SONRA atılıyor");
  return ih;
}
{
  const t = oku("Teks-Erp/docker/korumali/teslim-paketle.sh");
  const g = teslimImzaStatik(t);
  check("§5c ⭐ teslim künyesi 2e aracıyla imzalanır (anahtarsız paket yok, .jws + liste dosyası SHA256SUMS'ta)", g.length === 0, g.join(" | ") || "temiz");
  const sondalar: Array<[string, string]> = [
    ["imza çağrısı silindi", t.replace(/^\( cd "\$REPO\/Teks-Erp" && npx tsx scripts\/build-korumali-imza\.ts belge.*$/m, "( true ) \\")],
    ["anahtarsız devam", t.replace(/imzasız teslim paketi üretilmez" >&2; exit 1; \}/, 'imzasız teslim paketi üretilmez" >&2; }')],
    ["jws özetsiz", t.replace("PAKET-DOCKER.json PAKET-DOCKER.json.jws; do", "PAKET-DOCKER.json; do")],
    ["liste özetsiz", t.replace(".env.ornek butunluk-liste.txt PAKET-DOCKER.json", ".env.ornek PAKET-DOCKER.json")],
    ["varsayılan anahtar yolu geri", t.replace('ANAHTAR="${TEKSERP_PAKET_ANAHTARI:-}"', 'ANAHTAR="${TEKSERP_PAKET_ANAHTARI:-$HOME/.tekserp/satici-hazirlik/paket-hazirlik.paket.json}"')],
    ["boş anahtar kapısı silindi", t.replace(/^\[ -n "\$ANAHTAR" \].*\n/m, "")],
    ["TEKSERP_MUSTERI geri", t.replace("  musteri: null,", "  musteri: process.env.TEKSERP_MUSTERI || null,")],
  ];
  for (const [ad, m] of sondalar) {
    check(`§5c sonda: ${ad} → kırmızı`, m !== t && teslimImzaStatik(m).length > 0, m !== t ? "" : "MUTASYON UYGULANMADI");
  }
}

// -----------------------------------------------------------------------------
// §6 — satıcı imajı: VDS'te tsx/kaynak yok → her CLI imajda derlenmiş durmalı (G2: `modul-anahtari`
// eksikti, `ice-aktar` VDS'te koşamıyordu); compose dağıtım bağları (G3) docker'sız da ölçülür.
// -----------------------------------------------------------------------------
console.log("\n=== §6 satıcı imajı (dist-cli · dağıtım bağları) ===\n");
const SATICI_CLI = readdirSync(join(KOK, "satici/sunucu/scripts"))
  .filter((f) => f.endsWith(".ts") && !f.startsWith("test_") && f !== "run-all-tests.ts")
  .map((f) => f.slice(0, -3));
function saticiImajStatik(dockerfile: string, compose: string): string[] {
  const ih: string[] = [];
  const derleme = /--outDir dist-cli[^\n]*\n[^\n]*/.exec(dockerfile)?.[0] ?? "";
  for (const cli of SATICI_CLI) {
    if (!derleme.includes(`scripts/${cli}.ts`)) ih.push(`dist-cli derlemesinde yok: ${cli}`);
    if (!dockerfile.includes(`test -f dist-cli/scripts/${cli}.js`)) ih.push(`test -f kapısı yok: ${cli}`);
  }
  if (!/\}:\/dosyalar\s*$/m.test(compose)) ih.push("/dosyalar yazılır bağlı değil");
  for (const h of ["derlemeler", "yayin"]) if (!new RegExp(`\\}:/${h}:ro\\s*$`, "m").test(compose)) ih.push(`/${h} salt okunur bağlı değil`);
  return ih;
}
{
  const df = oku("deploy/satici/Dockerfile");
  const dc = oku("deploy/satici/docker-compose.yml");
  check("§6 körlük zemini: satıcı CLI'ları bulundu (anahtar · modul-anahtari · portal-kullanici)", ["anahtar", "modul-anahtari", "portal-kullanici"].every((c) => SATICI_CLI.includes(c)), SATICI_CLI.join(", "));
  const g = saticiImajStatik(df, dc);
  check("§6a ⭐ her satıcı CLI'ı imajda derlenir + test -f; /dosyalar rw, /derlemeler + /yayin ro", g.length === 0, g.join(" | ") || "temiz");
  const sondalar: Array<[string, string, string]> = [
    ["modul-anahtari derlenmiyor", df.replace(" scripts/modul-anahtari.ts", ""), dc],
    ["test -f kapısı yok", df.replace(" && test -f dist-cli/scripts/modul-anahtari.js", ""), dc],
    ["yayın kökü yazılır", df, dc.replace(":/yayin:ro", ":/yayin")],
    ["dosyalar salt okunur", df, dc.replace(/\}:\/dosyalar$/m, "}:/dosyalar:ro")],
  ];
  for (const [ad, d, c] of sondalar) {
    const uygulandi = d !== df || c !== dc;
    check(`§6b sonda: ${ad} → kırmızı`, uygulandi && saticiImajStatik(d, c).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
