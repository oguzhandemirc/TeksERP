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
//      §5k bulut kenarı örneği (runbook §10): TRUST_PROXY=1 + hız sınırı, port yalnız 127.0.0.1, konak ağı yalnız sertleştirilmiş kenarda, teslim dışı.
//      §5l teslim paketi `backend-oci` biçimi (L3): dış tar üyeleri + künye kapsamı = `scripts/lib/oci-paket.ts`, etiket
//      `tekserp-korumali:<sürüm>`, compose şablonu doldurulur (yer tutucu kalmaz), imaj kimliği ARŞİVDEN (`.Id` yok),
//      güncelleyici künyesi imajın içinde ikiliden yeniden ölçülür, dış tar ustar + sahip 0:0 + Mac meta verisiz.
//      §5m imaj derlemesi (`sahne.mjs`) native'in gömülü çapa kipini bayt koduyla kıyaslar (`native-capa-kipi.mjs`).
//   §6 satıcı imajı (G2/G3) DURAĞAN: `satici/sunucu/scripts/` altındaki her CLI `dist-cli`'a derlenir ve
//      `test -f` kapısında; compose'da `/dosyalar` yazılır, `/derlemeler` + `/yayin` salt okunur (⑨'un docker'sız ikizi).
//   §7 güncelleyicinin yöneteceği düzen (GUNCELLEYICI-SAGLAMLIK L5): §7a–§7e `TEKSERP_GOC_ACILISTA` (yok/boş/1 =
//      bugünkü açılışta göç · 0 = göç yok, şema denetimi · başka = çık) ve `goc` aracı DAVRANIŞI (sh + sahteler) ·
//      §7f çıkış kodları betik ↔ `docker/korumali/acilis-kodlari.json` iki yönlü · §7g imajda `goc` bağı ·
//      §7h güncelleyicili compose kuralları · §7i elle compose ile ayrışma yok · §7j anahtar yalnız güncelleyicili compose'da,
//      teslim paketi elle compose'u DEĞİL güncelleyicili şablonu taşır ·
//      §7k kurulum sınıfı (`TEKSERP_KURULUM_SINIFI`) compose'dan backend'e geçer, şablon boş, bulut örneği BARINDIRILAN.
// =============================================================================
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { git } from "./lib/git";
import { ociImajArsivi, ociKapsam, ociUyeler } from "./lib/oci-paket";
// Bekçi/koşucu gerçek Anahtar Zinciri'ne GİTMEZ: parola okuyan araçlar kasa yerine stdin/dosya kullanır (scripts/lib/parola-kasasi.mjs).
process.env.TEKSERP_PAROLA_KASASI = "kapali";

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
// Docker yayını ufw'yi atlar. 0.0.0.0'ı anan her satır yasak kipindedir (tasarımın 443 kenarı hariç); şablon 127.0.0.1.
const DINLE_DOSYALARI = ["Teks-Erp/docker/korumali/docker-compose.yml", "Teks-Erp/docker/korumali/.env.ornek", "docs/ops/LINUX-DOCKER-KURULUM.md"];
function dinleStatik(dosyalar: Record<string, string>): string[] {
  const ih: string[] = [];
  for (const [ad, metin] of Object.entries(dosyalar)) {
    metin.split("\n").forEach((l, n) => {
      if (/0\.0\.0\.0(?!:443)/.test(l) && !/yazılmaz|yazılırsa|yazmayın|değiştirilmez/i.test(l)) ih.push(`${ad}:${n + 1} 0.0.0.0'ı yasak kipinde anmıyor`);
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

// §5k — bulut kenarı örneği (bizim yönettiğimiz sunucu, runbook §10): backend tek vekile güvenir ("1", true değil) ve
// hız sınırı açık; API portu .env ne derse desin yalnız 127.0.0.1 (`!override`) — TRUST_PROXY=1'in güvenli olma şartı;
// konak ağı yalnız kenarda, kenar yetkisi düşürülmüş + salt okunur; örnek müşteri teslim paketine girmez.
function bulutOrnekStatik(ornek: string, teslim: string): string[] {
  const ih: string[] = [];
  const kb = ornek.indexOf("\n  kenar:");
  const backend = kb > 0 ? ornek.slice(ornek.indexOf("\n  backend:"), kb) : "";
  const kenar = kb > 0 ? ornek.slice(kb) : "";
  if (!backend || !kenar) return ["bulut örneğinde backend/kenar servisi bulunamadı"];
  if (!/^\s+TRUST_PROXY: "1"$/m.test(backend)) ih.push("backend TRUST_PROXY \"1\" değil");
  if (!/^\s+RATE_LIMIT_ENABLED: "true"$/m.test(backend)) ih.push("backend hız sınırı açık değil");
  const pm = /^ {4}ports: !override\n((?: {6}- .*\n)+)/m.exec(backend);
  if (!pm) ih.push("backend portu `ports: !override` ile ezilmiyor (.env'deki TEKSERP_DINLE sızar)");
  else if (!pm[1].trim().split("\n").every((l) => /- "127\.0\.0\.1:/.test(l))) ih.push("backend portu yalnız 127.0.0.1 değil");
  if ((ornek.match(/network_mode:/g) ?? []).length !== 1 || !/^ {4}network_mode: host$/m.test(kenar)) ih.push("konak ağı yalnız kenarda değil");
  if (/^ {4}ports:/m.test(kenar)) ih.push("kenar port yayımlıyor (Docker yayını ufw'yi atlar)");
  if (!/^ {4}read_only: true$/m.test(kenar)) ih.push("kenar kök FS salt okunur değil");
  if (!/cap_drop: \["ALL"\]/.test(kenar)) ih.push("kenar yetkileri düşürmüyor");
  const ek = /cap_add: \[([^\]]*)\]/.exec(kenar)?.[1].split(",").map((x) => x.trim().replace(/"/g, "")) ?? [];
  const izinli = new Set(["NET_BIND_SERVICE", "SETUID", "SETGID", "CHOWN"]);
  if (ek.some((c) => !izinli.has(c))) ih.push(`kenar beyansız yetki ekliyor (${ek.join(",")})`);
  if (!/no-new-privileges:true/.test(kenar)) ih.push("kenar no-new-privileges taşımıyor");
  for (const m of kenar.matchAll(/^ {6}- (\.\/kenar\/\S+)$/gm)) if (!m[1].endsWith(":ro")) ih.push(`kenar bağı salt okunur değil: ${m[1]}`);
  if (/bulut-ornek/.test(teslim.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"))) ih.push("bulut örneği müşteri teslim paketine giriyor");
  return ih;
}
{
  const bo = oku("Teks-Erp/docker/korumali/docker-compose.bulut-ornek.yml");
  const tp = oku("Teks-Erp/docker/korumali/teslim-paketle.sh");
  const gercek = bulutOrnekStatik(bo, tp);
  check("§5k ⭐ bulut kenarı örneği: TRUST_PROXY=1 + hız sınırı, port yalnız 127.0.0.1 (!override), konak ağı yalnız sertleştirilmiş kenarda, teslim dışı", gercek.length === 0, gercek.join(" | "));
  const sondalar: Array<[string, string, string]> = [
    ["TRUST_PROXY true", bo.replace('TRUST_PROXY: "1"', 'TRUST_PROXY: "true"'), tp],
    ["!override kalktı", bo.replace("ports: !override", "ports:"), tp],
    ["port 0.0.0.0", bo.replace('- "127.0.0.1:${TEKSERP_PORT', '- "0.0.0.0:${TEKSERP_PORT'), tp],
    ["kenar port yayını", bo.replace("    network_mode: host\n", '    ports: ["443:443"]\n'), tp],
    ["kenar cap_drop kalktı", bo.replace('    cap_drop: ["ALL"]\n', ""), tp],
    ["kenara SYS_ADMIN", bo.replace('"CHOWN"]', '"CHOWN", "SYS_ADMIN"]'), tp],
    ["teslim pakete girdi", bo, tp.replace('cp "$BURASI/.env.ornek"', 'cp "$BURASI/docker-compose.bulut-ornek.yml" "$SAHNE/"\ncp "$BURASI/.env.ornek"')],
  ];
  for (const [ad, o, t] of sondalar) check(`§5k sonda: ${ad} → kırmızı`, (o !== bo || t !== tp) && bulutOrnekStatik(o, t).length > 0, o !== bo || t !== tp ? "" : "MUTASYON UYGULANMADI");
}

// §5c — teslim künyesi İMZALI çıkar (2e aracı, `build-korumali-imza.ts belge`): anahtar yoksa paket
// üretilmez, imza ve imzalı liste dosyası SHA256SUMS'a girer, imza özetlerden ÖNCE atılır.
function teslimImzaStatik(betik: string): string[] {
  const kod = betik.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const ih: string[] = [];
  const imza = kod.search(/build-korumali-imza\.ts belge --belge="\$SAHNE\/PAKET-DOCKER\.json" --anahtar="\$ANAHTAR"/);
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
  if (!/test_korumali_imaj\.mjs" --imaj="\$ETIKET" --imzali \|\| \{[^}]*exit 1; \}/.test(kod)) ih.push("imzasız imaj teslim ediliyor (bekçi --imzali yok)");
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
    ["liste özetsiz", t.replace("guncelleyici-kunye.json butunluk-liste.txt PAKET-DOCKER.json", "guncelleyici-kunye.json PAKET-DOCKER.json")],
    ["varsayılan anahtar yolu geri", t.replace('ANAHTAR="${TEKSERP_PAKET_ANAHTARI:-}"', 'ANAHTAR="${TEKSERP_PAKET_ANAHTARI:-$HOME/.tekserp/satici-hazirlik/paket-hazirlik.paket.json}"')],
    ["boş anahtar kapısı silindi", t.replace(/^\[ -n "\$ANAHTAR" \].*\n/m, "")],
    ["TEKSERP_MUSTERI geri", t.replace("  musteri: null,", "  musteri: process.env.TEKSERP_MUSTERI || null,")],
    ["imzasız imaj teslimi", t.replace('--imaj="$ETIKET" --imzali ||', '--imaj="$ETIKET" ||')],
  ];
  for (const [ad, m] of sondalar) {
    check(`§5c sonda: ${ad} → kırmızı`, m !== t && teslimImzaStatik(m).length > 0, m !== t ? "" : "MUTASYON UYGULANMADI");
  }
}

// §5l — teslim paketi `backend-oci` biçimi (sözleşme 5, L3): üye kümesi ve künye kapsamı TEK kaynaktan
// (`scripts/lib/oci-paket.ts`, yayıncı aynısını ölçer); etiket compose'un istediği; şablon doldurulur; imaj kimliği
// config özeti ARŞİVDEN (containerd `.Id`'si index özetidir); güncelleyici künyesi imajda ikiliden; dış tar belirlenimli.
function teslimOciStatik(betik: string): string[] {
  const kod = betik.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const ih: string[] = [];
  const sentetik = (x: string): string => x.replace(ociImajArsivi("S"), "$AD");
  const uyeler = /^UYELER="([^"]*)"$/m.exec(kod)?.[1].split(/\s+/) ?? [];
  if (JSON.stringify([...uyeler].sort()) !== JSON.stringify(ociUyeler("S").map(sentetik).sort())) ih.push(`dış tar üyeleri oci-paket.ts ociUyeler ile aynı değil (${uyeler.join(" ")})`);
  if (!/tar [^\n]*-cf "\$CIKTI\/\$PAKET\.part" \$UYELER/.test(kod)) ih.push("dış tar UYELER listesinden kurulmuyor");
  const kapsam = /"\$GKUNYE" \\\n\s+(.+)$/m.exec(kod)?.[1].trim().split(/\s+/).map((x) => x.replace(/"/g, "")) ?? [];
  if (JSON.stringify(kapsam) !== JSON.stringify(ociKapsam("S").map(sentetik))) ih.push(`künye kapsamı oci-paket.ts ociKapsam ile aynı değil (${kapsam.join(" ")})`);
  if (!/^AD="tekserp-korumali_\$\{SURUM\}_linux-amd64\.tar\.gz"$/m.test(kod) || !/^PAKET="tekserp-backend-oci-\$\{SURUM\}\.tar"$/m.test(kod)) ih.push("imaj arşivi / paket adı oci-paket.ts biçiminde değil");
  if (!/\[ "\$ETIKET" = "tekserp-korumali:\$SURUM" \] \|\| \{[^}]*exit 1; \}/.test(kod)) ih.push("imaj etiketi tekserp-korumali:<sürüm> zorunlu değil");
  if (!/^sed "s\/@@SURUM@@\/\$SURUM\/g" "\$BURASI\/docker-compose\.guncelleyici\.yml" > "\$SAHNE\/docker-compose\.yml"$/m.test(kod)) ih.push("compose güncelleyicili şablondan sürümle doldurulmuyor");
  if (!/if grep -q '@@' "\$SAHNE\/docker-compose\.yml"; then [^\n]*exit 1; fi/.test(kod)) ih.push("doldurulmamış yer tutucu denetimi yok");
  if (/\{\{\.Id\}\}/.test(kod)) ih.push("imaj kimliği docker image inspect .Id'den (containerd'de index özeti)");
  if (!/backend-bildirim\.ts imaj-kimlik --arsiv="\$SAHNE\/\$AD"/.test(kod) || !/kimlik: imajKimlik/.test(kod)) ih.push("imaj kimliği arşivden ölçülmüyor");
  if (!/docker run --rm --network none --platform linux\/amd64 -v "\$GDIZIN:\/g:ro" --entrypoint \/g\/tekserp-guncelleyici "\$ETIKET" kunye/.test(kod)) ih.push("güncelleyici künyesi imajın içinde ikiliden ölçülmüyor");
  if (!/if \(!ayni\(gDosya, gOlcu\)\)/.test(kod)) ih.push("ölçülen künye CI dosyasıyla kıyaslanmıyor");
  if (!/tar --format=ustar --owner=0 --group=0 --numeric-owner -cf/.test(kod)) ih.push("GNU tar dalı ustar + sahip 0:0 değil");
  if (!/COPYFILE_DISABLE=1 tar --format=ustar --uid 0 --gid 0 --no-xattrs --no-mac-metadata -cf/.test(kod)) ih.push("bsdtar dalı ustar + 0:0 + Mac meta verisiz değil");
  if (!/platform: "linux-x64-oci", gocSayisi: Number\(goc\)/.test(kod) || !/guncelleyici: \{ surum: gOlcu\.surum, sha256: gSha \}/.test(kod)) ih.push("künye platform/gocSayisi/guncelleyici alanlarını taşımıyor");
  return ih;
}
{
  const t = oku("Teks-Erp/docker/korumali/teslim-paketle.sh");
  const g = teslimOciStatik(t);
  check("§5l ⭐ teslim paketi backend-oci biçiminde (üyeler/kapsam = oci-paket.ts, etiket, doldurulmuş şablon, kimlik arşivden, künye imajda ölçülür, belirlenimli tar)", g.length === 0, g.join(" | ") || "temiz");
  const sondalar: Array<[string, string]> = [
    ["dış tar'dan güncelleyici düştü", t.replace("docker-compose.yml .env.ornek tekserp-guncelleyici guncelleyici-kunye.json PAKET-DOCKER.json PAKET-DOCKER.json.jws", "docker-compose.yml .env.ornek guncelleyici-kunye.json PAKET-DOCKER.json PAKET-DOCKER.json.jws")],
    ["kapsamdan künye düştü", t.replace(/("\$GKUNYE" \\\n\s+"\$AD" docker-compose\.yml \.env\.ornek tekserp-guncelleyici) guncelleyici-kunye\.json/, "$1")],
    ["etiket kapısı kalktı", t.replace(/^\[ "\$ETIKET" = "tekserp-korumali:\$SURUM" \].*\n/m, "")],
    ["elle compose girdi (doldurma kalktı)", t.replace(/^sed "s\/@@SURUM@@\/\$SURUM\/g" "\$BURASI\/docker-compose\.guncelleyici\.yml"/m, 'cp "$BURASI/docker-compose.yml"')],
    ["yer tutucu denetimi kalktı", t.replace(/^if grep -q '@@'.*\n/m, "")],
    [".Id geri", t.replace("IMAJ_KIMLIK=$( cd", "IMAJ_KIMLIK=$(docker image inspect \"$ETIKET\" --format '{{.Id}}') # $( cd")],
    ["künye imajda ölçülmüyor", t.replace("--entrypoint /g/tekserp-guncelleyici \"$ETIKET\" kunye", "--entrypoint cat \"$ETIKET\" /g/guncelleyici-kunye.json")],
    ["sahip 0:0 kalktı (GNU)", t.replace("--owner=0 --group=0 --numeric-owner ", "")],
    ["Mac meta verisi girdi", t.replace("--no-xattrs --no-mac-metadata ", "")],
  ];
  for (const [ad, m] of sondalar) check(`§5l sonda: ${ad} → kırmızı`, m !== t && teslimOciStatik(m).length > 0, m !== t ? "" : "MUTASYON UYGULANMADI");
}

// §5m — imaj derlemesi native'in gömülü çapa kipini bayt koduyla kıyaslar (Windows `paketle.ps1` ile aynı kapı, G3):
// sahne native'i kopyaladıktan SONRA `native-capa-kipi.mjs` koşar ve sıfır olmayan çıkışta derleme durur.
function sahneCapaStatik(sahne: string): string[] {
  const kod = sahne.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const kopya = kod.search(/kopyala\(path\.join\(PROJ, 'native', 'lisans-cekirdek', 'dist-uretim', NATIVE\), path\.join\(SAHNE, 'native', NATIVE\)\)/);
  const cagri = kod.search(/\['scripts\/native-capa-kipi\.mjs', path\.join\(SAHNE, 'native', NATIVE\), path\.join\(dist, 'server-kunye\.json'\)\]/);
  const ih: string[] = [];
  if (cagri < 0) ih.push("sahne native-capa-kipi.mjs çağırmıyor");
  else if (kopya < 0 || cagri < kopya) ih.push("çapa kipi native kopyalanmadan önce ölçülüyor");
  if (!/if \(capa\.status !== 0\) dur\(/.test(kod)) ih.push("çapa kipi uyuşmazlığında derleme durmuyor");
  return ih;
}
{
  const t = oku("Teks-Erp/docker/korumali/sahne.mjs");
  const g = sahneCapaStatik(t);
  check("§5m ⭐ imaj derlemesi native çapa kipini bayt koduyla kıyaslar (native-capa-kipi.mjs, uyuşmazlıkta DUR)", g.length === 0, g.join(" | ") || "temiz");
  const sondalar: Array<[string, string]> = [
    ["çağrı silindi", t.replace(/^  const capa = spawnSync\(.*\n/m, "  const capa = { status: 0 };\n")],
    ["çıkış yok sayıldı", t.replace("if (capa.status !== 0) dur(", "if (false) dur(")],
  ];
  for (const [ad, m] of sondalar) check(`§5m sonda: ${ad} → kırmızı`, m !== t && sahneCapaStatik(m).length > 0, m !== t ? "" : "MUTASYON UYGULANMADI");
}

// §5l — G13 imaj içi bütünlük listesi (`imaj-imzala.mjs`): Windows paketinin AYNI aracı (`build-korumali-imza.ts
// imzala`, kapsam `integrity-scope.ts`) — betik kendi özetini/imzasını yazmaz; anahtar açıkça verilir; etiket
// yalnız imajın kendi native çekirdeğinin öz-denetimi GECERLI ise kalır. Dockerfile kapsamı imzalanabilir kurar
// (`node_modules/.bin` bağları yok, runtime Node imzalı `runtime/` altında).
function imajImzaStatik(betik: string, dockerfile: string): string[] {
  const kod = betik.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const ih: string[] = [];
  if (!/'scripts\/build-korumali-imza\.ts', 'imzala'/.test(kod)) ih.push("imza Windows aracından (build-korumali-imza.ts imzala) geçmiyor");
  if (/createHash|createSign|\bsign\(|privateKey/.test(kod)) ih.push("betik kendi özetini/imzasını üretiyor (tek kaynak dışı)");
  if (!/process\.env\.TEKSERP_PAKET_ANAHTARI \|\| ''/.test(kod) || !/if \(!anahtar\) red\(/.test(kod)) ih.push("anahtar açıkça verilmeden imza atılabiliyor");
  const oz = kod.search(/const o = ozDenetim\(hedef, y\);/), birak = kod.search(/^\s+hedefYazildi = false;/m);
  if (oz < 0 || birak < 0 || birak < oz) ih.push("öz-denetimden ÖNCE imzalı etiket bırakılıyor");
  if (!/rapor\?\.durum === 'GECERLI'/.test(kod)) ih.push("öz-denetim GECERLI dışını kabul ediyor");
  if (!/if \(hedefYazildi\) \{\s*docker\(\['image', 'rm', hedef\]\)/.test(kod)) ih.push("düşen imzada etiket silinmiyor");
  if (!/'--network', 'none'/.test(kod)) ih.push("öz-denetim ağlı koşuyor");
  if (!/rm -rf node_modules\/\.bin/.test(dockerfile)) ih.push("Dockerfile node_modules/.bin bağlarını bırakıyor (imzalanamaz)");
  if (!/COPY --from=runtime-node --chown=root:root \/w\/sahne\/runtime\/bin\/node \/app\/runtime\/bin\/node/.test(dockerfile)) ih.push("runtime Node imzalı kapsamda (app/runtime) değil");
  return ih;
}
{
  const b = oku("Teks-Erp/docker/korumali/imaj-imzala.mjs");
  const d = oku("Teks-Erp/docker/korumali/Dockerfile");
  const g = imajImzaStatik(b, d);
  check("§5l ⭐ imaj içi liste: Windows imza aracı + kapsamı, anahtar açıkça, etiket yalnız öz-denetim GECERLI ise, imzalanabilir kapsam", g.length === 0, g.join(" | ") || "temiz");
  const sondalar: Array<[string, string, string]> = [
    ["kendi özeti", b.replace("import fs from 'node:fs';", "import fs from 'node:fs';\nimport { createHash } from 'node:crypto';"), d],
    ["imza aracı atlandı", b.replace("'scripts/build-korumali-imza.ts', 'imzala'", "'scripts/baska.ts', 'imzala'"), d],
    ["varsayılan anahtar", b.replace("process.env.TEKSERP_PAKET_ANAHTARI || ''", "process.env.TEKSERP_PAKET_ANAHTARI || '~/.tekserp/pkt.json'"), d],
    ["öz-denetim GECERLI şartı gevşedi", b.replace("rapor?.durum === 'GECERLI'", "rapor?.durum !== 'GECERSIZ'"), d],
    ["düşünce etiket kalır", b.replace("docker(['image', 'rm', hedef]);", "void 0;"), d],
    ["öz-denetim ağlı", b.replace("'--network', 'none',", ""), d],
    ["etiket öz-denetimden önce bırakıldı", b.replace("    hedefYazildi = true;\n", "    hedefYazildi = false;\n"), d],
    [".bin geri", b, d.replace("  && rm -rf node_modules/.bin \\\n", "")],
    ["runtime kapsam dışı", b, d.replace("/app/runtime/bin/node\nRUN", "/usr/local/bin/node2\nRUN")],
  ];
  for (const [ad, mb, md] of sondalar) {
    const uyg = mb !== b || md !== d;
    check(`§5l sonda: ${ad} → kırmızı`, uyg && imajImzaStatik(mb, md).length > 0, uyg ? "" : "MUTASYON UYGULANMADI");
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

// -----------------------------------------------------------------------------
// §7 — güncelleyicinin yöneteceği düzen (GUNCELLEYICI-SAGLAMLIK L5): açılışta göç anahtarı · `goc` aracı ·
// açılış çıkış kodları tablosu · güncelleyicili compose şablonu
// -----------------------------------------------------------------------------
console.log("\n=== §7 açılışta göç anahtarı · goc aracı · çıkış kodları · güncelleyicili compose ===\n");

interface AcilisKodu { kod: number; ad: string; anlam: string }
const KODLAR_YOLU = "Teks-Erp/docker/korumali/acilis-kodlari.json";
const acilisKodlari = (JSON.parse(oku(KODLAR_YOLU)) as { kodlar: AcilisKodu[] }).kodlar;
const kod = (ad: string): number => {
  const k = acilisKodlari.find((x) => x.ad === ad);
  if (!k) throw new Error(`${KODLAR_YOLU}: ${ad} yok`);
  return k.kod;
};

const SAHTELER7: Record<string, string> = {
  npx: `echo "npx $*" >> "$STUB_LOG"
case "$*" in
  "prisma migrate deploy")
    n=$(cat "$STUB_SAYAC" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$STUB_SAYAC"
    if [ "$n" -le "\${STUB_DEPLOY_FAIL:-0}" ]; then echo "Error: migration failed \${STUB_DEPLOY_CIKTI:-}"; exit 1; fi
    exit 0 ;;
  "prisma migrate resolve"*) exit "\${STUB_RESOLVE_EXIT:-0}" ;;
esac
exit 0`,
  psql: `echo "psql $*" >> "$STUB_LOG"
case "$*" in
  *"-f "*) exit "\${STUB_PSQL_F_EXIT:-0}" ;;
  *to_regclass*) [ "$STUB_TABLO" = fail ] && exit 2; printf '%s\\n' "$STUB_TABLO" ;;
  *"finished_at IS NULL AND rolled_back_at"*) printf '%s\\n' "\${STUB_YARIM:-0}" ;;
  *"finished_at IS NOT NULL"*) [ "$STUB_DB" = fail ] && exit 2; cat "$STUB_DB" ;;
  *"ORDER BY started_at"*) printf '%s\\n' "\${STUB_FAILED:-}" ;;
  *"FROM users"*) printf '%s\\n' "\${STUB_USERS:-3}" ;;
esac
exit 0`,
  node: `echo "node $*" >> "$STUB_LOG"; exit 0`,
};
const GOCLER = ["20260101000000_init", "20260201000000_dizin_eszamanli", "20260301000000_kolon"];
const ESZAMANLI = "20260201000000_dizin_eszamanli";

interface Kosum7 extends Kosum { cagri: { deploy: number; denetim: boolean; sunucu: boolean; seed: boolean; elle: boolean; resolve: boolean } }
function kos7(env: Record<string, string>, o: { db?: string[]; gocBagi?: boolean; arg?: string[] } = {}): Kosum7 {
  const dir = mkdtempSync(join(tmpdir(), "docker-goc-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    for (const [ad, govde] of Object.entries(SAHTELER7)) {
      writeFileSync(join(bin, ad), `#!/bin/sh\n${govde}\n`);
      chmodSync(join(bin, ad), 0o755);
    }
    for (const g of GOCLER) {
      mkdirSync(join(dir, "prisma", "migrations", g), { recursive: true });
      writeFileSync(join(dir, "prisma", "migrations", g, "migration.sql"), g === ESZAMANLI ? "CREATE INDEX CONCURRENTLY x ON y (z);\n" : "SELECT 1;\n");
    }
    const dbYolu = join(dir, "db.txt");
    writeFileSync(dbYolu, (o.db ?? GOCLER).map((x) => `${x}\n`).join(""));
    const logYolu = join(dir, "stub.log");
    writeFileSync(logYolu, "");
    let betik = ENTRYPOINT;
    if (o.gocBagi) {
      betik = join(dir, "goc");
      symlinkSync(ENTRYPOINT, betik);
    }
    const r = spawnSync("sh", [betik, ...(o.arg ?? [])], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
      env: {
        PATH: `${bin}:/usr/bin:/bin`, STUB_LOG: logYolu, STUB_SAYAC: join(dir, "sayac"), STUB_DB: dbYolu, STUB_TABLO: "t", HOME: dir,
        DATABASE_URL: URL_SEMALI, ...env,
      },
    });
    const log = readFileSync(logYolu, "utf8").split("\n").filter(Boolean);
    return {
      cikis: r.status, log, stdout: `${r.stdout ?? ""}${r.stderr ?? ""}`, hata: r.error?.message,
      cagri: {
        deploy: log.filter((l) => l === "npx prisma migrate deploy").length,
        denetim: log.some((l) => l.includes("to_regclass")),
        sunucu: log.includes("node dist/server.js"),
        seed: log.some((l) => l.includes("FROM users")),
        elle: log.some((l) => /^psql .* -f prisma\/migrations\//.test(l)),
        resolve: log.some((l) => l.startsWith("npx prisma migrate resolve --applied")),
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// §7a–§7f davranış: her senaryo çıkış kodunu TABLODAN okur (betikteki sayı tabloya bağlı mı da ölçülür).
type Beklenti = { cikis: number; deploy: number; denetim: boolean; sunucu: boolean; ek?: (k: Kosum7) => boolean };
const ACILIS_BUGUN: Beklenti = { cikis: 0, deploy: 1, denetim: false, sunucu: true };
const senaryolar7: Array<{ ad: string; env: Record<string, string>; o?: Parameters<typeof kos7>[1]; b: Beklenti }> = [
  { ad: "§7a ⭐ anahtar YOK → bugünkü açılış (göç + sunucu, şema denetimi yok)", env: {}, b: ACILIS_BUGUN },
  { ad: "§7a anahtar boş → bugünkü açılış", env: { TEKSERP_GOC_ACILISTA: "" }, b: ACILIS_BUGUN },
  { ad: "§7a anahtar \"1\" → bugünkü açılış", env: { TEKSERP_GOC_ACILISTA: "1" }, b: ACILIS_BUGUN },
  { ad: "§7a bugünkü açılış: göç düşerse sunucu açılmaz (GOC_BASARISIZ)", env: { STUB_DEPLOY_FAIL: "1", STUB_FAILED: GOCLER[2]! }, b: { cikis: kod("GOC_BASARISIZ"), deploy: 1, denetim: false, sunucu: false } },
  { ad: "§7b ⭐ \"0\" + şema = imaj → göç YOK, denetim var, sunucu açılır", env: { TEKSERP_GOC_ACILISTA: "0" }, b: { cikis: 0, deploy: 0, denetim: true, sunucu: true } },
  { ad: "§7b ⭐ \"0\" + bekleyen göç → GOC_BEKLIYOR, sunucu açılmaz", env: { TEKSERP_GOC_ACILISTA: "0" }, o: { db: GOCLER.slice(0, 2) }, b: { cikis: kod("GOC_BEKLIYOR"), deploy: 0, denetim: true, sunucu: false } },
  { ad: "§7b \"0\" + göç tablosu yok → GOC_BEKLIYOR", env: { TEKSERP_GOC_ACILISTA: "0", STUB_TABLO: "f" }, b: { cikis: kod("GOC_BEKLIYOR"), deploy: 0, denetim: true, sunucu: false } },
  { ad: "§7b ⭐ \"0\" + yarım göç → GOC_YARIM", env: { TEKSERP_GOC_ACILISTA: "0", STUB_YARIM: "1" }, b: { cikis: kod("GOC_YARIM"), deploy: 0, denetim: true, sunucu: false } },
  { ad: "§7b ⭐ \"0\" + imajın tanımadığı göç (eski imaj yeni şemada) → SEMA_ILERIDE", env: { TEKSERP_GOC_ACILISTA: "0" }, o: { db: [...GOCLER, "29990101000000_gelecek"] }, b: { cikis: kod("SEMA_ILERIDE"), deploy: 0, denetim: true, sunucu: false } },
  { ad: "§7b \"0\" + DB'ye ulaşılamıyor → SEMA_OLCULEMEDI", env: { TEKSERP_GOC_ACILISTA: "0", STUB_TABLO: "fail" }, b: { cikis: kod("SEMA_OLCULEMEDI"), deploy: 0, denetim: true, sunucu: false } },
  { ad: "§7b \"0\" + bitmiş göçler okunamıyor → SEMA_OLCULEMEDI", env: { TEKSERP_GOC_ACILISTA: "0", STUB_DB: "fail" }, b: { cikis: kod("SEMA_OLCULEMEDI"), deploy: 0, denetim: true, sunucu: false } },
  { ad: "§7b \"0\" + yarım sayısı anlamsız → SEMA_OLCULEMEDI", env: { TEKSERP_GOC_ACILISTA: "0", STUB_YARIM: "ERROR" }, b: { cikis: kod("SEMA_OLCULEMEDI"), deploy: 0, denetim: true, sunucu: false } },
  { ad: "§7c ⭐ tanınmayan değer (\"evet\") → KIP_GECERSIZ, göç de sunucu da yok", env: { TEKSERP_GOC_ACILISTA: "evet" }, b: { cikis: kod("KIP_GECERSIZ"), deploy: 0, denetim: false, sunucu: false } },
  { ad: "§7d ⭐ goc aracı (argüman) → göç + denetim, sunucu ve seed YOK, GOC_TAMAM", env: {}, o: { arg: ["goc"] }, b: { cikis: 0, deploy: 1, denetim: true, sunucu: false, ek: (k) => !k.cagri.seed && /^GOC_TAMAM$/m.test(k.stdout) } },
  { ad: "§7d ⭐ goc aracı (imajdaki `goc` bağı) → aynı", env: {}, o: { gocBagi: true }, b: { cikis: 0, deploy: 1, denetim: true, sunucu: false, ek: (k) => !k.cagri.seed && /^GOC_TAMAM$/m.test(k.stdout) } },
  { ad: "§7d goc aracı anahtarı yok sayar (\"0\" olsa da göç koşar)", env: { TEKSERP_GOC_ACILISTA: "0" }, o: { gocBagi: true }, b: { cikis: 0, deploy: 1, denetim: true, sunucu: false } },
  { ad: "§7d goc sonrası şema imajdan ileride → SEMA_ILERIDE (ad kümesi eşitliği)", env: {}, o: { gocBagi: true, db: [...GOCLER, "29990101000000_gelecek"] }, b: { cikis: kod("SEMA_ILERIDE"), deploy: 1, denetim: true, sunucu: false } },
  { ad: "§7d goc \"başarılı\" ama göç DB'ye yazılmamış → GOC_BEKLIYOR", env: {}, o: { gocBagi: true, db: GOCLER.slice(1) }, b: { cikis: kod("GOC_BEKLIYOR"), deploy: 1, denetim: true, sunucu: false } },
  { ad: "§7e ⭐ CONCURRENTLY göçü (tek yer: goc) → psql ile uygulanır + resolve + yeniden deploy", env: { STUB_DEPLOY_FAIL: "1", STUB_FAILED: ESZAMANLI }, o: { gocBagi: true }, b: { cikis: 0, deploy: 2, denetim: true, sunucu: false, ek: (k) => k.cagri.elle && k.cagri.resolve } },
  { ad: "§7e CONCURRENTLY psql düştü → GOC_ELLE_BASARISIZ", env: { STUB_DEPLOY_FAIL: "1", STUB_FAILED: ESZAMANLI, STUB_PSQL_F_EXIT: "3" }, o: { gocBagi: true }, b: { cikis: kod("GOC_ELLE_BASARISIZ"), deploy: 1, denetim: false, sunucu: false } },
  { ad: "§7e CONCURRENTLY resolve düştü → GOC_ELLE_BASARISIZ", env: { STUB_DEPLOY_FAIL: "1", STUB_FAILED: ESZAMANLI, STUB_RESOLVE_EXIT: "1" }, o: { gocBagi: true }, b: { cikis: kod("GOC_ELLE_BASARISIZ"), deploy: 1, denetim: false, sunucu: false } },
  { ad: "§7e düşen göç tespit edilemedi → GOC_TANISIZ", env: { STUB_DEPLOY_FAIL: "1" }, o: { gocBagi: true }, b: { cikis: kod("GOC_TANISIZ"), deploy: 1, denetim: false, sunucu: false } },
  { ad: "§7e düşen göç çıktıdan okunur, SQL imajda yok → GOC_SQL_YOK", env: { STUB_DEPLOY_FAIL: "1", STUB_DEPLOY_CIKTI: "29990101000000_yok" }, o: { gocBagi: true }, b: { cikis: kod("GOC_SQL_YOK"), deploy: 1, denetim: false, sunucu: false } },
  { ad: "§7e deploy deneme tavanında bitmedi → GOC_DENEME_TUKENDI (eskiden sessizce sunucu açılırdı)", env: { STUB_DEPLOY_FAIL: "99", STUB_FAILED: ESZAMANLI }, b: { cikis: kod("GOC_DENEME_TUKENDI"), deploy: 20, denetim: false, sunucu: false } },
];
for (const s of senaryolar7) {
  const k = kos7(s.env, s.o);
  if (k.hata || k.cikis === null) {
    check(`${s.ad}: betik koşturulabildi`, false, `ÖLÇÜLEMEDİ — ${k.hata ?? "sinyal"}`);
    continue;
  }
  const c = k.cagri;
  const ok = k.cikis === s.b.cikis && c.deploy === s.b.deploy && c.denetim === s.b.denetim && c.sunucu === s.b.sunucu && (s.b.ek ? s.b.ek(k) : true);
  check(s.ad, ok, ok ? "" : `çıkış ${k.cikis} (beklenen ${s.b.cikis}) · deploy ${c.deploy}/${s.b.deploy} · denetim ${c.denetim} · sunucu ${c.sunucu} · ${k.stdout.trim().split("\n").slice(-1)[0]}`);
}

// §7f çıkış kodları: betik ↔ tablo İKİ YÖNLÜ; betikte beyansız `exit N` yok; kodlar node/sinyal/kabuk aralığına çarpmaz.
function kodTablosuStatik(betik: string, tablo: AcilisKodu[]): string[] {
  const ih: string[] = [];
  const kodSatirlari = betik.split("\n").filter((l) => !/^\s*#/.test(l));
  const atama = new Map<string, number>();
  for (const l of kodSatirlari) {
    const m = /^KOD_([A-Z_]+)=(\d+)$/.exec(l.trim());
    if (m) atama.set(m[1]!, Number(m[2]));
  }
  if (atama.size === 0) ih.push("betikte KOD_ ataması yok");
  const adlar = new Set<string>();
  const sayilar = new Set<number>();
  for (const t of tablo) {
    if (adlar.has(t.ad) || sayilar.has(t.kod)) ih.push(`tabloda mükerrer: ${t.ad}/${t.kod}`);
    adlar.add(t.ad);
    sayilar.add(t.kod);
    if (!Number.isInteger(t.kod) || t.kod < 15 || t.kod > 125) ih.push(`kod ${t.kod} izinli aralıkta değil (15–125: node 1–14, kabuk 126–127, sinyal 128+)`);
    if (!t.anlam?.trim()) ih.push(`${t.ad} anlamsız`);
    if (atama.get(t.ad) !== t.kod) ih.push(`tablo ${t.ad}=${t.kod}, betik ${atama.get(t.ad) ?? "yok"}`);
  }
  for (const [ad, n] of atama) if (!adlar.has(ad)) ih.push(`betikte beyansız kod KOD_${ad}=${n}`);
  for (const l of kodSatirlari) {
    for (const m of l.matchAll(/\bexit\s+(\S+)/g)) {
      const a = m[1]!.replace(/[;}]+$/, "");
      if (a === "0") continue;
      const v = /^\$KOD_([A-Z_]+)$/.exec(a);
      if (!v || !atama.has(v[1]!)) ih.push(`beyansız çıkış: exit ${a}`);
    }
  }
  const kullanilan = new Set([...betik.matchAll(/\bexit \$KOD_([A-Z_]+)/g)].map((m) => m[1]!));
  for (const ad of atama.keys()) if (!kullanilan.has(ad)) ih.push(`KOD_${ad} hiçbir çıkışta kullanılmıyor (ölü kod)`);
  return ih;
}
{
  const betik = oku("Teks-Erp/docker/entrypoint.sh");
  const gercek = kodTablosuStatik(betik, acilisKodlari);
  check(`§7f ⭐ çıkış kodları betik ↔ ${KODLAR_YOLU} iki yönlü eşit, beyansız exit yok`, gercek.length === 0, gercek.join(" | ") || `${acilisKodlari.length} kod`);
  const sondalar: Array<[string, string, AcilisKodu[]]> = [
    ["betiğe çıplak exit 1", betik.replace('exit $KOD_GOC_BASARISIZ', "exit 1"), acilisKodlari],
    ["tablodan kod silindi", betik, acilisKodlari.filter((k) => k.ad !== "GOC_YARIM")],
    ["betikte sayı değişti", betik.replace("KOD_SEMA_ILERIDE=49", "KOD_SEMA_ILERIDE=50"), acilisKodlari],
    ["node koduna çarpan kod", betik.replace("KOD_KIP_GECERSIZ=40", "KOD_KIP_GECERSIZ=1"), acilisKodlari.map((k) => (k.ad === "KIP_GECERSIZ" ? { ...k, kod: 1 } : k))],
    ["ölü kod", betik.replace("KOD_SEMA_ILERIDE=49", "KOD_SEMA_ILERIDE=49\nKOD_OLU=59"), [...acilisKodlari, { kod: 59, ad: "OLU", anlam: "x" }]],
  ];
  for (const [ad, b, t] of sondalar) {
    const uygulandi = b !== betik || t !== acilisKodlari;
    check(`§7f sonda: ${ad} → kırmızı`, uygulandi && kodTablosuStatik(b, t).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

// §7g imaj: `goc` bağı açılış betiğine gider (güncelleyicinin `compose run … backend goc`u) ve CMD açılış betiği kalır.
function gocBagiStatik(dockerfile: string): string[] {
  const son = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
  const ih: string[] = [];
  if (!/^RUN ln -s \/usr\/local\/bin\/entrypoint\.sh \/usr\/local\/bin\/goc$/m.test(son)) ih.push("çalışma aşamasında `goc` bağı yok");
  if (!/^CMD \["\/usr\/local\/bin\/entrypoint\.sh"\]$/m.test(son)) ih.push("CMD açılış betiği değil (compose run komutu onu ezer)");
  if (!/^ENTRYPOINT \["\/usr\/bin\/tini", "--"\]$/m.test(son)) ih.push("ENTRYPOINT yalnız tini değil (`goc` komut olarak koşmaz)");
  return ih;
}
{
  const df = oku("Teks-Erp/docker/korumali/Dockerfile");
  const g = gocBagiStatik(df);
  check("§7g ⭐ korumalı imajda `goc` → entrypoint.sh bağı, ENTRYPOINT tini, CMD açılış betiği", g.length === 0, g.join(" | "));
  const sonda = df.replace(/^RUN ln -s \/usr\/local\/bin\/entrypoint\.sh \/usr\/local\/bin\/goc\n/m, "");
  check("§7g sonda: bağ silindi → kırmızı", sonda !== df && gocBagiStatik(sonda).length > 0, sonda !== df ? "" : "MUTASYON UYGULANMADI");
}

// §7h güncelleyicili compose şablonu kuralları (GUNCELLEYICI-SAGLAMLIK §1.2).
const ISARET = /\s+# GUNCELLEYICI$/;
const IPC_KOK = "/var/lib/tekserp/guncelleme";
function servisBloklari(compose: string): Map<string, string> {
  const bas = compose.indexOf("\nservices:\n");
  const out = new Map<string, string>();
  if (bas < 0) return out;
  const govde = compose.slice(bas + "\nservices:\n".length);
  const son = govde.search(/^\S/m);
  const servisler = son < 0 ? govde : govde.slice(0, son);
  const parcalar = servisler.split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m);
  for (const p of parcalar) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/m.exec(p);
    if (m) out.set(m[1]!, p);
  }
  return out;
}
function guncelleyiciComposeStatik(ham: string): string[] {
  const ih: string[] = [];
  const c = ham.split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(ISARET, "")).join("\n");
  const s = servisBloklari(c);
  if (!s.has("backend") || !s.has("postgres") || !s.has("yedek")) return [`servisler çözülemedi (${[...s.keys()].join(",")})`];
  for (const [ad, b] of s) if (!/^ {4}pull_policy: never$/m.test(b)) ih.push(`${ad}: pull_policy never değil (imaj dışarıdan çekilebilir)`);
  if (/\$\{TEKSERP_IMAJ\b/.test(c)) ih.push("imaj etiketi .env'den (TEKSERP_IMAJ) — compose ile aynı adımda değişmez");
  for (const ad of ["backend", "yedek"]) if (!/^ {4}image: tekserp-korumali:@@SURUM@@$/m.test(s.get(ad)!)) ih.push(`${ad}: imaj tekserp-korumali:@@SURUM@@ değil`);
  const be = s.get("backend")!;
  if (!/^ {4}restart: unless-stopped$/m.test(be)) ih.push("backend restart unless-stopped değil");
  if (!/^ {6}TEKSERP_GOC_ACILISTA: "0"$/m.test(be)) ih.push("backend TEKSERP_GOC_ACILISTA \"0\" değil (açılışta göç sürer)");
  if (!/^ {6}TEKSERP_DOGRULAMA_KIPI: \$\{TEKSERP_DOGRULAMA_KIPI:-\}$/m.test(be)) ih.push("backend doğrulama kipi değişkenini geçirmiyor");
  if (!new RegExp(`^ {6}TEKSERP_GUNCELLEME_DIZINI: ${IPC_KOK.replace(/\//g, "\\/")}$`, "m").test(be)) ih.push(`backend TEKSERP_GUNCELLEME_DIZINI ${IPC_KOK} değil`);
  const baglar = [...be.matchAll(/^ {6}- type: bind\n {8}source: (\S+)\n {8}target: (\S+)\n {8}read_only: (true|false)\n {8}bind: \{ create_host_path: false \}$/gm)]
    .map((m) => ({ kaynak: m[1]!, hedef: m[2]!, ro: m[3] === "true" }));
  const durum = baglar.find((b) => b.hedef === `${IPC_KOK}/durum`);
  const niyet = baglar.find((b) => b.hedef === `${IPC_KOK}/niyet`);
  if (!durum || durum.kaynak !== `${IPC_KOK}/durum` || !durum.ro) ih.push("durum/ bağı yok ya da salt okunur değil (create_host_path false)");
  if (!niyet || niyet.kaynak !== `${IPC_KOK}/niyet` || niyet.ro) ih.push("niyet/ bağı yok ya da yazılamaz (create_host_path false)");
  if (/^ {6}- \S*guncelleme/m.test(be)) ih.push("IPC dizini kısa sözdizimiyle bağlı (eksik dizini root sahipli UYDURUR)");
  return ih;
}
const GUNCELLEYICI_COMPOSE = "Teks-Erp/docker/korumali/docker-compose.guncelleyici.yml";
{
  const gc = oku(GUNCELLEYICI_COMPOSE);
  const g = guncelleyiciComposeStatik(gc);
  check("§7h ⭐ güncelleyicili compose: her serviste pull_policy never · imaj compose'da sürümlü · göç açılışta kapalı · IPC bağları (durum ro, niyet rw) · doğrulama kipi", g.length === 0, g.join(" | "));
  const sondalar: Array<[string, string]> = [
    ["postgres pull_policy kalktı", gc.replace(/(image: \$\{TEKSERP_PG_IMAJ[^\n]*\n) {4}pull_policy: never[^\n]*\n/, "$1")],
    ["imaj .env'den", gc.replace("    image: tekserp-korumali:@@SURUM@@  # GUNCELLEYICI\n", "    image: ${TEKSERP_IMAJ}\n")],
    ["göç açılışta", gc.replace('TEKSERP_GOC_ACILISTA: "0"', 'TEKSERP_GOC_ACILISTA: "1"')],
    ["durum yazılabilir", gc.replace(/(source: \/var\/lib\/tekserp\/guncelleme\/durum[^\n]*\n[^\n]*\n {8}read_only: )true/, "$1false")],
    ["niyet salt okunur", gc.replace(/(source: \/var\/lib\/tekserp\/guncelleme\/niyet[^\n]*\n[^\n]*\n {8}read_only: )false/, "$1true")],
    ["dizin uydurulur", gc.replace("bind: { create_host_path: false }", "bind: { create_host_path: true }")],
    ["doğrulama kipi sabit", gc.replace("TEKSERP_DOGRULAMA_KIPI: ${TEKSERP_DOGRULAMA_KIPI:-}", 'TEKSERP_DOGRULAMA_KIPI: "1"')],
    ["restart always", gc.replace(/(\n {2}backend:[\s\S]*?\n {4}restart: )unless-stopped/, "$1always")],
  ];
  for (const [ad, s] of sondalar) check(`§7h sonda: ${ad} → kırmızı`, s !== gc && guncelleyiciComposeStatik(s).length > 0, s !== gc ? "" : "MUTASYON UYGULANMADI");
}

// §7i ayrışma: güncelleyicili compose, elle kurulumun compose'unun AYNISIDIR — fark yalnız `# GUNCELLEYICI`
// işaretli, beyanlı biçimdeki satırlar + tabanın .env'den gelen imaj satırları. Ortak satırı yalnız birinde değiştirmek kırmızı.
const ISARETLI_IZINLI: RegExp[] = [
  /^ {4}pull_policy: never$/,
  /^ {4}image: tekserp-korumali:@@SURUM@@$/,
  /^ {6}TEKSERP_GOC_ACILISTA: "0"$/,
  /^ {6}TEKSERP_GUNCELLEME_DIZINI: \/var\/lib\/tekserp\/guncelleme$/,
  /^ {6}TEKSERP_DOGRULAMA_KIPI: \$\{TEKSERP_DOGRULAMA_KIPI:-\}$/,
  /^ {6}- type: bind$/,
  /^ {8}(source|target): \/var\/lib\/tekserp\/guncelleme\/(durum|niyet)$/,
  /^ {8}read_only: (true|false)$/,
  /^ {8}bind: \{ create_host_path: false \}$/,
];
const TABAN_YALNIZ: RegExp[] = [/^ {4}image: \$\{TEKSERP_IMAJ(:\?[^}]*)?\}$/];
function ayrismaStatik(taban: string, guncelleyici: string): string[] {
  const ih: string[] = [];
  const govde = (t: string) => t.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() && !/^\s*#/.test(l));
  const t = govde(taban).filter((l) => !TABAN_YALNIZ.some((r) => r.test(l)));
  const gTum = govde(guncelleyici);
  const isaretli = gTum.filter((l) => ISARET.test(l)).map((l) => l.replace(ISARET, ""));
  for (const l of isaretli) if (!ISARETLI_IZINLI.some((r) => r.test(l))) ih.push(`beyansız güncelleyici satırı: ${l.trim()}`);
  const g = gTum.filter((l) => !ISARET.test(l));
  const n = Math.max(t.length, g.length);
  for (let i = 0; i < n; i++) {
    if (t[i] !== g[i]) {
      ih.push(`ayrışma (satır ${i + 1}): elle «${(t[i] ?? "—").trim()}» ≠ güncelleyicili «${(g[i] ?? "—").trim()}»`);
      break;
    }
  }
  return ih;
}
{
  const dc = oku("Teks-Erp/docker/korumali/docker-compose.yml");
  const gc = oku(GUNCELLEYICI_COMPOSE);
  const g = ayrismaStatik(dc, gc);
  check("§7i ⭐ güncelleyicili compose = elle kurulum compose'u + yalnız beyanlı işaretli satırlar (ayrışma yok)", g.length === 0, g.join(" | "));
  const sondalar: Array<[string, string, string]> = [
    ["yalnız tabana yeni ortam değişkeni", dc.replace("      LICENSE_SERVER_URL: ${LICENSE_SERVER_URL:-}\n", "      LICENSE_SERVER_URL: ${LICENSE_SERVER_URL:-}\n      YENI_AYAR: ${YENI_AYAR:-}\n"), gc],
    ["yalnız güncelleyicilide ortak satır değişti", dc, gc.replace("statement_timeout=50s", "statement_timeout=0")],
    ["işaretsiz ek satır", dc, gc.replace("    restart: unless-stopped\n", "    restart: unless-stopped\n    privileged: true\n")],
    ["işaretle gizlenmiş yetki", dc, gc.replace("    restart: unless-stopped\n", "    restart: unless-stopped\n    privileged: true  # GUNCELLEYICI\n")],
  ];
  for (const [ad, d, c] of sondalar) {
    const uygulandi = d !== dc || c !== gc;
    check(`§7i sonda: ${ad} → kırmızı`, uygulandi && ayrismaStatik(d, c).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

// §7j varsayılan = bugünkü davranış: anahtarı yalnız güncelleyicili compose yazar; elle kurulum, bulut örneği ve
// demo compose'u onu taşımaz (taşırsa bugünkü kurulum açılışta göçü bırakır). Teslim paketi (`backend-oci`, L3)
// güncelleyicili şablonu TAŞIR, elle compose'u taşımaz (paketi güncelleyici açar; göç yalnız GOC adımında).
function anahtarYeriStatik(dosyalar: Record<string, string>, teslim: string): string[] {
  const ih: string[] = [];
  for (const [ad, m] of Object.entries(dosyalar)) if (/TEKSERP_GOC_ACILISTA/.test(m)) ih.push(`${ad} TEKSERP_GOC_ACILISTA taşıyor`);
  const kod = teslim.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  if (!/"\$BURASI\/docker-compose\.guncelleyici\.yml" > "\$SAHNE\/docker-compose\.yml"/.test(kod)) ih.push("teslim paketi güncelleyicili şablonu taşımıyor");
  if (/"\$BURASI\/docker-compose\.yml"/.test(kod)) ih.push("teslim paketi elle compose'u taşıyor (açılışta göçerdi)");
  return ih;
}
{
  const dosyalar: Record<string, string> = {
    "docker/korumali/docker-compose.yml": oku("Teks-Erp/docker/korumali/docker-compose.yml"),
    "docker/korumali/docker-compose.bulut-ornek.yml": oku("Teks-Erp/docker/korumali/docker-compose.bulut-ornek.yml"),
    "docker/korumali/.env.ornek": oku("Teks-Erp/docker/korumali/.env.ornek"),
    "docker-compose.yml (demo)": oku("Teks-Erp/docker-compose.yml"),
  };
  const tp = oku("Teks-Erp/docker/korumali/teslim-paketle.sh");
  const g = anahtarYeriStatik(dosyalar, tp);
  check("§7j ⭐ anahtar yalnız güncelleyicili compose'da (elle/bulut/demo compose bugünkü gibi açılışta göçer); teslim paketi güncelleyicili şablonu taşır", g.length === 0, g.join(" | "));
  const sonda = { ...dosyalar, "docker/korumali/docker-compose.yml": dosyalar["docker/korumali/docker-compose.yml"]!.replace("      PORT: \"4000\"\n", "      PORT: \"4000\"\n      TEKSERP_GOC_ACILISTA: \"0\"\n") };
  check("§7j sonda: elle compose'a anahtar → kırmızı", anahtarYeriStatik(sonda, tp).length > 0);
  const elle = tp.replace('"$BURASI/docker-compose.guncelleyici.yml" > "$SAHNE/docker-compose.yml"', '"$BURASI/docker-compose.yml" > "$SAHNE/docker-compose.yml"');
  check("§7j sonda: teslim elle compose'u taşır → kırmızı", elle !== tp && anahtarYeriStatik(dosyalar, elle).length > 0, elle !== tp ? "" : "MUTASYON UYGULANMADI");
}

// §7k kurulum sınıfı: compose backend'e `TEKSERP_KURULUM_SINIFI`ni boş varsayılanla geçirir (yoksa .env'deki değer
// konteynere ulaşmaz — saha bulgusu); şablon boş doğar (fabrika = bugünkü davranış); bulut örneği BARINDIRILAN'ı sabitler.
function kurulumSinifiStatik(d: { helper: string; compose: string; guncelleyici: string; envOrnek: string; bulut: string; runbook: string }): string[] {
  const ih: string[] = [];
  const ad = /export const INSTALL_CLASS_ENV = "([A-Z_]+)";/.exec(d.helper)?.[1];
  const sinif = /export const HOSTED_CLASS = "([A-Z_]+)";/.exec(d.helper)?.[1];
  if (!ad || !sinif) return ["install-class.helper.ts sabitleri okunamadı (ÖLÇÜLEMEDİ)"];
  const gecis = new RegExp(`^ {6}${ad}: \\$\\{${ad}:-\\}$`, "m");
  for (const [n, c] of [["elle compose", d.compose], ["güncelleyicili compose", d.guncelleyici]] as const) {
    const be = servisBloklari(c).get("backend") ?? "";
    if (!gecis.test(be)) ih.push(`${n} backend'e ${ad}'ı boş varsayılanla geçirmiyor`);
  }
  if (!new RegExp(`^${ad}=$`, "m").test(d.envOrnek)) ih.push(`.env.ornek ${ad}'ı boş doğurmuyor (fabrika kurulumu = bugünkü davranış)`);
  const bb = servisBloklari(`\n${d.bulut}`).get("backend") ?? "";
  if (!new RegExp(`^ {6}${ad}: ${sinif}$`, "m").test(bb)) ih.push(`bulut örneği backend'e ${ad}=${sinif} vermiyor`);
  const b10 = d.runbook.slice(d.runbook.indexOf("## 10."));
  if (!b10.includes(`${ad}=${sinif}`)) ih.push(`runbook §10 bulutta ${ad}=${sinif} zorunluluğunu anmıyor`);
  return ih;
}
{
  const d = {
    helper: oku("Teks-Erp/src/services/helpers/install-class.helper.ts"),
    compose: oku("Teks-Erp/docker/korumali/docker-compose.yml"),
    guncelleyici: oku(GUNCELLEYICI_COMPOSE),
    envOrnek: oku("Teks-Erp/docker/korumali/.env.ornek"),
    bulut: oku("Teks-Erp/docker/korumali/docker-compose.bulut-ornek.yml"),
    runbook: oku("docs/ops/LINUX-DOCKER-KURULUM.md"),
  };
  const g = kurulumSinifiStatik(d);
  check("§7k ⭐ kurulum sınıfı: iki compose backend'e boş varsayılanla geçirir, şablon boş, bulut örneği + runbook §10 BARINDIRILAN", g.length === 0, g.join(" | "));
  const SATIR = "      TEKSERP_KURULUM_SINIFI: ${TEKSERP_KURULUM_SINIFI:-}\n";
  const sondalar: Array<[string, typeof d]> = [
    ["elle compose geçirmiyor", { ...d, compose: d.compose.replace(SATIR, "") }],
    ["güncelleyicili compose geçirmiyor", { ...d, guncelleyici: d.guncelleyici.replace(SATIR, "") }],
    ["varsayılan BARINDIRILAN", { ...d, compose: d.compose.replace("${TEKSERP_KURULUM_SINIFI:-}", "${TEKSERP_KURULUM_SINIFI:-BARINDIRILAN}") }],
    ["şablon dolu doğuyor", { ...d, envOrnek: d.envOrnek.replace(/^TEKSERP_KURULUM_SINIFI=$/m, "TEKSERP_KURULUM_SINIFI=BARINDIRILAN") }],
    ["bulut örneği sınıfsız", { ...d, bulut: d.bulut.replace(/^ {6}TEKSERP_KURULUM_SINIFI: BARINDIRILAN\n/m, "") }],
    ["runbook anmıyor", { ...d, runbook: d.runbook.replace("`TEKSERP_KURULUM_SINIFI=BARINDIRILAN`", "") }],
  ];
  for (const [ad, s] of sondalar) {
    const uygulandi = JSON.stringify(s) !== JSON.stringify(d);
    check(`§7k sonda: ${ad} → kırmızı`, uygulandi && kurulumSinifiStatik(s).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
