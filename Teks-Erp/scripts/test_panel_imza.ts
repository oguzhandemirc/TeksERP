// =============================================================================
// BEKÇİ — istemci sürüm künyesi İMZA tarafı (`scripts/panel-imza.ts` · `guven-capasi-ekle.ts panel|tablet`) + kâhin
// =============================================================================
// DB'siz, ağsız. Her şey GEÇİCİ dizinde; HOME geçici dizine çevrilir (~/.tekserp'e yazılmaz), gerçek çapalara
// dokunulmaz (çapa denemesi geçici KOPYADA). Panel doğrulayıcısı bağımlılıksız JS (Electron/electron/guncelleme/);
// protokolün JWS'i (Teks-Erp/src/lib/license/protocol/jws.ts) onun KÂHİNİdir. NE ÖLÇER:
//   §0 kâhin — `TYP.PANEL` = panelin typ'i (kayıt defterinde tekil) · protokol `signJws` ile panel `signReleaseDoc`
//      BAYT-EŞİT · bozulmuş belgelerde protokol `verifyJws` ile panel `verifyJwsWithAnchor` AYNI kodu verir
//   §1 anahtar dosyası — (b) panel anahtarı parolalı (0600, sürüm 2, düz özel yarı YOK) ve açılır; yanlış parola ·
//      (a) üretim PAKET anahtarı açılır; hazırlık PAKET (parolasız) · gevşek izin · düz `d` · depo içine yazım ·
//      ezme · biçim dışı kid → RED
//   §2 imza aracı uçtan uca (gerçek CLI, parola stdin) — imzala → latest.yml künyeli ve panel KABUL eder; çapada
//      olmayan anahtar · kurulum dosyası latest.yml'den farklı · argv'de parola · gerçek (boş) çapa → RED ve
//      latest.yml DEĞİŞMEZ; imzadan sonra kurcalanan latest.yml → dogrula RED; yeniden imza tek blok
//   §3 çapa aracı (`guven-capasi-ekle.ts panel`, geçici kopyada) — (a) `--paket-kid` PAKET çapasındaki anahtarı
//      ekler, ikinci kez değişiklik yok · (b) `--dosya` panel anahtarını ekler · PAKET çapasında olmayan paket-
//      kid'i · biçim dışı kid · elle bozulmuş dosya → RED, yazım yok · gerçek ağacın çapa dosyası biçimde ·
//      `tablet` aynı kurallarla YALNIZ tablet çapasına yazar
//   §4 tablet APK künyesi (`apk-imzala` · `apk-dogrula`, gerçek CLI) — `TYP.APK` tekil · imzala → surum.json künyeli,
//      eski tabletin alanları korunur, yayın kapısının doğrulayıcısı KABUL eder; çapada olmayan anahtar · APK ≠
//      surum.json · gerçek (boş) çapa → RED, dosya DEĞİŞMEZ; imzadan sonra kurcalanan alan / değiştirilen APK /
//      başka kanal → apk-dogrula RED. (Tabletin saf JS doğrulayıcısıyla eşdeğerlik: mobil `apkKunye.test.ts` kâhini.)
// ⭐ KALICI SONDA ✓K: §0c bozulma tablosu, §1/§2/§3 ret dalları her koşumda ısırır.
// Koşum: node ../scripts/agir-is.mjs -- npx tsx scripts/test_panel_imza.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TYP, b64uEncode, signJws, verifyJws } from "../src/lib/license/protocol";
import { generatePackageKey, generateWrappedPackageKey, writePackageKey } from "./lib/butunluk-imza";
import { CAPA_DOSYALARI, PANEL_CAPA_DOSYASI, TABLET_CAPA_DOSYASI, panelCapasiOku } from "./lib/guven-capasi";
import { DEPO_KOKU, generatePanelKey, openPanelSigningKey, writePanelKey } from "./lib/panel-imza";
import { main as capaEkle } from "./guven-capasi-ekle";
import { checkProductionAnchor, publicKeyFromX, verifyJwsWithAnchor } from "../../Electron/electron/guncelleme/kunye-jws.mjs";
import { PANEL_RELEASE_TYP, buildReleaseDoc, signReleaseDoc, verifyUpdateInfo } from "../../Electron/electron/guncelleme/panel-kunye.mjs";
import { parseLatestYml } from "../../Electron/electron/guncelleme/latest-yml.mjs";
import { APK_RELEASE_TYP, verifyApkSurumJson } from "../../mobil/scripts/lib/apk-kunye.mjs";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const TEKS = path.resolve(__dirname, "..");
const TEMP = mkdtempSync(path.join(os.tmpdir(), "panel-imza-"));
const PAROLA = "bekci-panel-parolasi-2026";
const pw = (): Promise<Buffer> => Promise.resolve(Buffer.from(PAROLA));
let sayac = 0;
function dizin(ad: string): string {
  const d = path.join(TEMP, `${ad}-${sayac++}`);
  mkdirSync(d, { recursive: true });
  return d;
}
function xOf(privateKey: KeyObject): string {
  return (privateKey.export({ format: "jwk" }) as { x: string }).x;
}

// ── §0 kâhin ─────────────────────────────────────────────────────────────────
function bolum0(): void {
  console.log("\n§0 kâhin — protokol JWS ↔ panel doğrulayıcısı");
  const typlar = Object.values(TYP);
  check("§0a TYP.PANEL = panelin typ'i (tekserp-panel) ve kayıt defterinde TEKİL", TYP.PANEL === PANEL_RELEASE_TYP && typlar.filter((t) => t === TYP.PANEL).length === 1, TYP.PANEL);
  const { privateKey } = generateKeyPairSync("ed25519");
  const kid = "panel-2099";
  const doc = buildReleaseDoc({
    kanal: "adnansahin",
    surum: "1.4.3",
    commit: "0efe882d",
    yayinZamani: "2026-10-01T01:00:00.000Z",
    paket: { ad: "TeksERP-1.4.3-Setup.exe", boyut: 12, sha512: createHash("sha512").update("x").digest("hex") },
    capa: [kid],
  });
  const panel = signReleaseDoc({ doc, kid, privateKey });
  const protokol = signJws({ typ: TYP.PANEL, kid, payload: { ...doc }, privateKey });
  check("§0b protokol signJws ile panel signReleaseDoc BAYT-EŞİT (aynı başlık sırası · aynı JSON · deterministik Ed25519)", panel === protokol, `${panel.length} bayt`);
  const yabanci = generateKeyPairSync("ed25519").privateKey;
  const anahtarlar = [{ kid, x: xOf(privateKey) }];
  const key = publicKeyFromX(anahtarlar[0]!.x)!;
  const [h, p, s] = panel.split(".") as [string, string, string];
  const bas = (o: unknown): string => b64uEncode(JSON.stringify(o));
  const tablo: Array<[string, string]> = [
    ["geçerli", panel],
    ["imza baytı bozuk", `${h}.${p}.${b64uEncode(Buffer.alloc(64, 3))}`],
    ["yük değişmiş", `${h}.${bas({ ...doc, surum: "9.9.9" })}.${s}`],
    ["typ başka (tekserp-surum)", signJws({ typ: "tekserp-surum", kid, payload: { ...doc }, privateKey })],
    ["bilinmeyen kid", signJws({ typ: TYP.PANEL, kid: "panel-2098", payload: { ...doc }, privateKey: yabanci })],
    ["alg none", `${bas({ alg: "none", typ: TYP.PANEL, kid })}.${p}.${s}`],
    ["alg HS256", `${bas({ alg: "HS256", typ: TYP.PANEL, kid })}.${p}.${s}`],
    ["başlıkta jwk", `${bas({ alg: "EdDSA", typ: TYP.PANEL, kid, jwk: {} })}.${p}.${s}`],
    ["iki parça", `${h}.${p}`],
    ["dolgulu base64", `${h}=.${p}.${s}`],
    ["boş", ""],
    ["çok uzun", `${h}.${"A".repeat(40 * 1024)}.${s}`],
  ];
  const farklar: string[] = [];
  for (const [ad, token] of tablo) {
    const a = verifyJws(token, { typ: TYP.PANEL, findKey: (k) => (k === kid ? key : undefined) });
    const b = verifyJwsWithAnchor(token, { typ: PANEL_RELEASE_TYP, keys: anahtarlar });
    const ka = a.ok ? "OK" : a.code;
    const kb = b.ok ? "OK" : b.code;
    if (ka !== kb) farklar.push(`${ad}: protokol ${ka} ↔ panel ${kb}`);
  }
  check(`§0c ⭐ ${tablo.length} belgelik bozulma tablosunda protokol verifyJws ile panel doğrulayıcısı AYNI sonucu verir`, farklar.length === 0, farklar.join(" · ") || "aynı");
  const ilk = verifyJwsWithAnchor(panel, { typ: PANEL_RELEASE_TYP, keys: anahtarlar });
  check("§0d körlük zemini: tablonun 'geçerli' satırı gerçekten KABUL, 'bozuk imza' gerçekten JWS_IMZA", ilk.ok && !verifyJwsWithAnchor(tablo[1]![1], { typ: PANEL_RELEASE_TYP, keys: anahtarlar }).ok);
}

// ── §1 anahtar dosyaları ──────────────────────────────────────────────────────
async function reddeder(fn: () => Promise<unknown>, desen: RegExp): Promise<string | null> {
  try {
    await fn();
    return "RED bekleniyordu, geçti";
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return desen.test(m) ? null : `beklenmeyen hata: ${m}`;
  }
}

async function bolum1(): Promise<{ panelDosyasi: string; panelX: string }> {
  console.log("\n§1 anahtar dosyaları — (a) PAKET · (b) panel yayın anahtarı");
  const d = dizin("anahtar");
  const dosya = writePanelKey(d, await generatePanelKey("panel-2099", Buffer.from(PAROLA)));
  const k = JSON.parse(readFileSync(dosya, "utf8")) as Record<string, unknown>;
  check(
    "§1a (b) panel anahtarı: 0600, sürüm 2, parolalı (düz `d` YOK), parola dosyada yok",
    (statSync(dosya).mode & 0o777) === 0o600 && k.tur === "tekserp-panel-anahtar" && k.surum === 2 && !("d" in k) && !readFileSync(dosya, "utf8").includes(PAROLA),
  );
  const acik = await openPanelSigningKey(dosya, pw);
  check("§1b panel anahtarı doğru parolayla açılır, açılan özel yarı dosyadaki açık yarıyla eşleşir", acik.kid === "panel-2099" && xOf(acik.privateKey) === k.x);
  check("§1c yanlış parola → RED", (await reddeder(() => openPanelSigningKey(dosya, () => Promise.resolve(Buffer.from("yanlis-parola-uzun"))), /Parola hatalı/)) === null);
  const paket = writePackageKey(dizin("paket"), await generateWrappedPackageKey("paket-2099", Buffer.from(PAROLA)));
  const pa = await openPanelSigningKey(paket, pw);
  check("§1d (a) üretim PAKET anahtarı (paket-<yıl>, parolalı) panel künyesini imzalamak için açılır", pa.kid === "paket-2099");
  const hazirlik = writePackageKey(dizin("hazirlik"), generatePackageKey("paket-hazirlik", ["TEST", "DEMO"]));
  check("§1e hazırlık PAKET anahtarı (parolasız) → RED", (await reddeder(() => openPanelSigningKey(hazirlik, pw), /ÜRETİM PAKET/)) === null);
  const gevsek = path.join(dizin("gevsek"), "panel-2099.panel.json");
  copyFileSync(dosya, gevsek);
  chmodSync(gevsek, 0o644);
  check("§1f gevşek izinli (644) anahtar dosyası → RED", (await reddeder(() => openPanelSigningKey(gevsek, pw), /chmod 600/)) === null);
  const duz = path.join(dizin("duz"), "panel-2099.panel.json");
  writeFileSync(duz, JSON.stringify({ ...k, d: b64uEncode(randomBytes(32)) }), { mode: 0o600 });
  check("§1g düz özel yarı (`d`) taşıyan panel dosyası → RED (biçimsiz)", (await reddeder(() => openPanelSigningKey(duz, pw), /biçimsiz/)) === null);
  check("§1h depo İÇİNE yazım → RED", (await reddeder(async () => writePanelKey(path.join(DEPO_KOKU, "tmp-panel-anahtari"), await generatePanelKey("panel-2098", Buffer.from(PAROLA))), /depo içine/)) === null);
  check("§1i var olan dosyanın üstüne yazım → RED", (await reddeder(async () => writePanelKey(d, await generatePanelKey("panel-2099", Buffer.from(PAROLA))), /EEXIST/)) === null);
  check("§1j biçim dışı kid (panel-fikstur) ile anahtar üretilmez", (await reddeder(() => generatePanelKey("panel-fikstur", Buffer.from(PAROLA)), /panel-<yıl>/)) === null);
  check("§1k zayıf parola ile anahtar üretilmez", (await reddeder(() => generatePanelKey("panel-2097", Buffer.from("kisa")), /en az 12/)) === null);
  return { panelDosyasi: dosya, panelX: String(k.x) };
}

// ── §2 imza aracı uçtan uca ───────────────────────────────────────────────────
interface Kosum {
  readonly kod: number | null;
  readonly cikti: string;
}
function cli(argv: readonly string[], input = ""): Kosum {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/panel-imza.ts", ...argv], {
    cwd: TEKS,
    input,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME: path.join(TEMP, "ev") },
  });
  return { kod: r.status, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** electron-builder çıktısı gibi: kurulum dosyası + latest.yml (imzasız). */
function paketDizini(surum = "1.4.3"): { dizin: string; latest: string; exe: string } {
  const d = dizin("paket");
  const ad = `TeksERP-${surum}-Setup.exe`;
  const govde = randomBytes(8192);
  writeFileSync(path.join(d, ad), govde);
  const b64 = createHash("sha512").update(govde).digest("base64");
  writeFileSync(path.join(d, "latest.yml"), `version: ${surum}\nfiles:\n  - url: ${ad}\n    sha512: ${b64}\n    size: ${govde.length}\n    isAdminRightsRequired: true\npath: ${ad}\nsha512: ${b64}\nreleaseDate: '2026-10-01T01:00:00.000Z'\n`);
  return { dizin: d, latest: path.join(d, "latest.yml"), exe: path.join(d, ad) };
}

function capaDosyasi(liste: ReadonlyArray<{ kid: string; x: string }>): string {
  const f = path.join(dizin("capa"), "capa.json");
  writeFileSync(f, JSON.stringify({ anahtarlar: liste }));
  return f;
}

function bolum2(anahtar: { panelDosyasi: string; panelX: string }): void {
  console.log("\n§2 imza aracı uçtan uca (gerçek CLI, parola stdin)");
  const capa = capaDosyasi([{ kid: "panel-2099", x: anahtar.panelX }]);
  const p = paketDizini();
  const imzala = (dizinPaket: string, ek: readonly string[] = [], capaYolu: string | null = capa): Kosum =>
    cli(["imzala", "--musteri=adnansahin", `--dizin-paket=${dizinPaket}`, `--anahtar=${anahtar.panelDosyasi}`, ...(capaYolu ? [`--capa=${capaYolu}`] : []), ...ek], `${PAROLA}\n`);
  const r = imzala(p.dizin);
  const metin = readFileSync(p.latest, "utf8");
  const info = parseLatestYml(metin);
  const v = info.ok ? verifyUpdateInfo(info.value, { keys: [{ kid: "panel-2099", x: anahtar.panelX }], channel: "adnansahin", installedVersion: "1.4.2" }) : null;
  check("§2a imzala → çıkış 0, latest.yml künyeli ve panelin doğrulayıcısı KABUL eder (kanal · sürüm · dosya)", r.kod === 0 && v?.ok === true, r.cikti.trim().slice(-200));
  check("§2b dogrula (aynı çapa) → çıkış 0", cli(["dogrula", "--musteri=adnansahin", `--dizin-paket=${p.dizin}`, `--capa=${capa}`]).kod === 0);
  const ikinci = imzala(p.dizin);
  check("§2c yeniden imza → tek künye bloğu, yine geçerli", ikinci.kod === 0 && (readFileSync(p.latest, "utf8").match(/^tekserp:$/gm) ?? []).length === 1);

  const reddet = (ad: string, kosum: () => Kosum, desen: RegExp, kaynak = paketDizini()): void => {
    const once = readFileSync(kaynak.latest);
    const k = kosum();
    check(`${ad} → RED, latest.yml DEĞİŞMEDİ`, k.kod !== 0 && desen.test(k.cikti) && readFileSync(kaynak.latest).equals(once), `çıkış ${k.kod} ${k.cikti.trim().slice(-160)}`);
  };
  const q = paketDizini();
  reddet("§2d çapada olmayan anahtar (çapa yalnız panel-2098)", () => imzala(q.dizin, [], capaDosyasi([{ kid: "panel-2098", x: xOf(generateKeyPairSync("ed25519").privateKey) }])), /çapasında YOK/, q);
  const w = paketDizini();
  writeFileSync(w.exe, randomBytes(8192));
  reddet("§2e kurulum dosyası latest.yml'in söylediği değil (eski derleme kalıntısı)", () => imzala(w.dizin), /uyuşmuyor/, w);
  const a = paketDizini();
  reddet("§2f argv'de parola", () => cli(["imzala", "--musteri=adnansahin", `--dizin-paket=${a.dizin}`, `--anahtar=${anahtar.panelDosyasi}`, `--capa=${capa}`, "--parola=x"]), /Parola argümandan ALINMAZ/, a);
  const g = paketDizini();
  reddet("§2g gerçek üretim çapası (test anahtarı orada YOK ya da çapa boş)", () => imzala(g.dizin, [], null), /CAPA_BOS|çapasında YOK|kullanılamaz/, g);
  const t = paketDizini();
  imzala(t.dizin);
  writeFileSync(t.latest, readFileSync(t.latest, "utf8").replace(/size: (\d+)/, (_m, n: string) => `size: ${Number(n) + 1}`));
  const dk = cli(["dogrula", "--musteri=adnansahin", `--dizin-paket=${t.dizin}`, `--capa=${capa}`]);
  check("§2h imzadan SONRA kurcalanan latest.yml (boy) → dogrula RED (KUNYE_DOSYA)", dk.kod !== 0 && /KUNYE_DOSYA/.test(dk.cikti), dk.cikti.trim().slice(-160));
  const b = cli(["dogrula", "--musteri=testfabrika", `--dizin-paket=${p.dizin}`, `--capa=${capa}`]);
  check("§2i başka kanal adına doğrulama → RED (KUNYE_KANAL)", b.kod !== 0 && /KUNYE_KANAL/.test(b.cikti), b.cikti.trim().slice(-160));
}

// ── §3 çapa aracı ─────────────────────────────────────────────────────────────
function kopyaKok(): string {
  const kok = dizin("depo-kopyasi");
  for (const y of [CAPA_DOSYALARI.kokTs, ...CAPA_DOSYALARI.kokAynalari, CAPA_DOSYALARI.paketTs, CAPA_DOSYALARI.anchorRs, PANEL_CAPA_DOSYASI, TABLET_CAPA_DOSYASI]) {
    mkdirSync(path.dirname(path.join(kok, y)), { recursive: true });
    copyFileSync(path.join(DEPO_KOKU, y), path.join(kok, y));
  }
  // Boş çapalı başlangıç (gerçek dosya karar sonrası dolu olabilir): biçim aynı, yalnız liste boş.
  for (const y of [PANEL_CAPA_DOSYASI, TABLET_CAPA_DOSYASI]) {
    const j = JSON.parse(readFileSync(path.join(kok, y), "utf8")) as Record<string, unknown>;
    writeFileSync(path.join(kok, y), `${JSON.stringify({ ...j, anahtarlar: [] }, null, 2)}\n`);
  }
  return kok;
}

function sessiz<T>(fn: () => T): T {
  const log = console.log;
  const err = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}

function bolum3(anahtar: { panelDosyasi: string; panelX: string }): void {
  console.log("\n§3 çapa aracı (guven-capasi-ekle.ts panel) — geçici kopyada");
  const gercek = panelCapasiOku(DEPO_KOKU);
  const uretim = gercek.liste.length === 0 ? null : checkProductionAnchor([...gercek.liste]);
  check("§3a gerçek ağacın panel çapası biçimde (kesin JSON düzeni); doluysa üretim biçiminde", uretim === null || uretim.ok, gercek.liste.map((k) => k.kid).join(", ") || "BOŞ — anahtar kararı bekleniyor (paketleme durur)");
  const paket2026 = (readFileSync(path.join(DEPO_KOKU, CAPA_DOSYALARI.paketTs), "utf8").match(/kid: "(paket-\d{4})", x: "([^"]+)"/) ?? []) as string[];
  const kok = kopyaKok();
  const yaz = (argv: readonly string[]): number => sessiz(() => capaEkle([...argv, `--kok=${kok}`]));
  const oku = (): string => readFileSync(path.join(kok, PANEL_CAPA_DOSYASI), "utf8");
  const kuru = oku();
  check("§3b kuru koşum (--yaz yok): çıkış 0, dosya aynı", yaz(["panel", `--paket-kid=${paket2026[1]}`]) === 0 && oku() === kuru);
  const r1 = yaz(["panel", `--paket-kid=${paket2026[1]}`, "--yaz"]);
  const s1 = panelCapasiOku(kok).liste;
  check("§3c (a) --paket-kid: PAKET çapasındaki AYNI açık yarı panel çapasına girer", r1 === 0 && s1.length === 1 && s1[0]!.kid === paket2026[1] && s1[0]!.x === paket2026[2], JSON.stringify(s1));
  const ara = oku();
  check("§3d aynı kid + aynı anahtar ikinci kez → çıkış 0, değişiklik yok", yaz(["panel", `--paket-kid=${paket2026[1]}`, "--yaz"]) === 0 && oku() === ara);
  const r2 = yaz(["panel", `--dosya=${anahtar.panelDosyasi}`, "--yaz"]);
  const s2 = panelCapasiOku(kok).liste;
  check("§3e (b) --dosya: panel anahtarı SONA eklenir, liste üretim çapası olarak geçerli", r2 === 0 && s2.length === 2 && s2[1]!.kid === "panel-2099" && checkProductionAnchor([...s2]).ok, JSON.stringify(s2.map((k) => k.kid)));
  const once = oku();
  for (const [ad, argv, beklenen] of [
    ["PAKET çapasında olmayan paket- kid'i", ["panel", "--kid=paket-2098", `--x=${xOf(generateKeyPairSync("ed25519").privateKey)}`], 1],
    ["biçim dışı kid (panel-fikstur)", ["panel", "--kid=panel-fikstur", `--x=${xOf(generateKeyPairSync("ed25519").privateKey)}`], 1],
    ["hazırlık PAKET kid'i", ["panel", "--paket-kid=paket-hazirlik"], 1],
    ["aynı kid BAŞKA anahtar (rotasyon yeni kid'dir)", ["panel", "--kid=panel-2099", `--x=${xOf(generateKeyPairSync("ed25519").privateKey)}`], 1],
    ["kid/x yok", ["panel"], 64],
  ] as const) {
    const r = yaz([...argv, "--yaz"]);
    check(`§3f ${ad} → çıkış ${beklenen}, dosya aynı`, r === beklenen && oku() === once, `çıkış ${r}`);
  }
  writeFileSync(path.join(kok, PANEL_CAPA_DOSYASI), once.replace('"anahtarlar": [', '"anahtarlar":  ['));
  check("§3g elle bozulmuş biçim → çıkış 2 (BICIM), yazım yok", yaz(["panel", "--kid=panel-2097", `--x=${anahtar.panelX}`, "--yaz"]) === 2);

  const tablet = panelCapasiOku(DEPO_KOKU, TABLET_CAPA_DOSYASI);
  const tUretim = tablet.liste.length === 0 ? null : checkProductionAnchor([...tablet.liste]);
  check("§3h gerçek ağacın TABLET çapası biçimde; doluysa üretim biçiminde", tUretim === null || tUretim.ok, tablet.liste.map((k) => k.kid).join(", ") || "BOŞ — anahtar kararı bekleniyor (APK yayını durur)");
  const panelOnce = oku();
  const tOku = (): string => readFileSync(path.join(kok, TABLET_CAPA_DOSYASI), "utf8");
  const r3 = yaz(["tablet", `--dosya=${anahtar.panelDosyasi}`, "--yaz"]);
  const t1 = panelCapasiOku(kok, TABLET_CAPA_DOSYASI).liste;
  check("§3i tablet --dosya: anahtar YALNIZ tablet çapasına girer (panel çapası aynı)", r3 === 0 && t1.length === 1 && t1[0]!.kid === "panel-2099" && oku() === panelOnce, JSON.stringify(t1));
  const r4 = yaz(["tablet", `--paket-kid=${paket2026[1]}`, "--yaz"]);
  check("§3j tablet --paket-kid: PAKET çapasındaki aynı açık yarı tablet çapasına SONA eklenir", r4 === 0 && panelCapasiOku(kok, TABLET_CAPA_DOSYASI).liste[1]?.x === paket2026[2]);
  const tOnce = tOku();
  check("§3k tablet: biçim dışı kid → çıkış 1, dosya aynı", yaz(["tablet", "--kid=tablet-2099", `--x=${anahtar.panelX}`, "--yaz"]) === 1 && tOku() === tOnce);
}

// ── §4 tablet APK künyesi ─────────────────────────────────────────────────────
function apkDizini(): { apk: string; kunye: string; govde: Buffer } {
  const d = dizin("apk");
  const govde = randomBytes(20_000);
  const apk = path.join(d, "TeksERP-1.0.16-vc57.apk");
  writeFileSync(apk, govde);
  const kunye = path.join(d, "surum.json");
  writeFileSync(kunye, JSON.stringify({
    versionCode: 57, versionName: "1.0.16", dosya: "TeksERP-1.0.16-vc57.apk", sha256: createHash("sha256").update(govde).digest("hex"),
    boyut: govde.length, zorunlu: false, notlar: null, yayinTarihi: "2026-10-01T01:00:00.000Z",
    indirmeUrl: "https://guncelleme.etkiliyazilim.com/adnansahin/mobil/apk/TeksERP-1.0.16-vc57.apk",
  }, null, 2));
  return { apk, kunye, govde };
}

function bolum4(anahtar: { panelDosyasi: string; panelX: string }): void {
  console.log("\n§4 tablet APK künyesi (apk-imzala · apk-dogrula, gerçek CLI)");
  const typlar = Object.values(TYP);
  check("§4a TYP.APK = tabletin typ'i (tekserp-apk) ve kayıt defterinde TEKİL", TYP.APK === APK_RELEASE_TYP && typlar.filter((t) => t === TYP.APK).length === 1, TYP.APK);
  const keys = [{ kid: "panel-2099", x: anahtar.panelX }];
  const capa = capaDosyasi(keys);
  const imzala = (p: { apk: string; kunye: string }, kanal = "adnansahin", capaYolu: string | null = capa): Kosum =>
    cli(["apk-imzala", `--musteri=${kanal}`, `--apk=${p.apk}`, `--kunye=${p.kunye}`, `--anahtar=${anahtar.panelDosyasi}`, ...(capaYolu ? [`--capa=${capaYolu}`] : [])], `${PAROLA}\n`);
  const dogrula = (p: { apk: string; kunye: string }, kanal = "adnansahin"): Kosum =>
    cli(["apk-dogrula", `--musteri=${kanal}`, `--apk=${p.apk}`, `--kunye=${p.kunye}`, `--capa=${capa}`]);
  const p = apkDizini();
  const once = JSON.parse(readFileSync(p.kunye, "utf8")) as Record<string, unknown>;
  const r = imzala(p);
  const sonra = JSON.parse(readFileSync(p.kunye, "utf8")) as Record<string, unknown>;
  const v = verifyApkSurumJson(sonra, { keys, channel: "adnansahin" });
  const korundu = Object.keys(once).every((k) => JSON.stringify(once[k]) === JSON.stringify(sonra[k]));
  check("§4b apk-imzala → çıkış 0, surum.json künyeli, eski tabletin alanları AYNEN, yayın kapısının doğrulayıcısı KABUL eder",
    r.kod === 0 && v.ok && korundu && v.ok && v.value.doc.paket.boyut === p.govde.length, r.cikti.trim().slice(-200));
  check("§4c apk-dogrula → çıkış 0", dogrula(p).kod === 0);

  const reddet = (ad: string, q: { apk: string; kunye: string }, kosum: () => Kosum, desen: RegExp): void => {
    const bas = readFileSync(q.kunye);
    const k = kosum();
    check(`${ad} → RED, surum.json DEĞİŞMEDİ`, k.kod !== 0 && desen.test(k.cikti) && readFileSync(q.kunye).equals(bas), `çıkış ${k.kod} ${k.cikti.trim().slice(-160)}`);
  };
  const a = apkDizini();
  reddet("§4d çapada olmayan anahtar", a, () => imzala(a, "adnansahin", capaDosyasi([{ kid: "panel-2098", x: xOf(generateKeyPairSync("ed25519").privateKey) }])), /çapasında YOK/);
  const b = apkDizini();
  writeFileSync(b.apk, randomBytes(20_000));
  reddet("§4e APK surum.json'un söylediği dosya değil", b, () => imzala(b), /uyuşmuyor/);
  const c = apkDizini();
  reddet("§4f gerçek üretim tablet çapası (test anahtarı orada YOK ya da çapa boş)", c, () => imzala(c, "adnansahin", null), /CAPA_BOS|çapasında YOK|kullanılamaz/);
  const d = apkDizini();
  reddet("§4g argv'de parola", d, () => cli(["apk-imzala", "--musteri=adnansahin", `--apk=${d.apk}`, `--kunye=${d.kunye}`, `--anahtar=${anahtar.panelDosyasi}`, `--capa=${capa}`, "--parola=x"]), /Parola argümandan ALINMAZ/);

  const t = apkDizini();
  imzala(t);
  const tj = JSON.parse(readFileSync(t.kunye, "utf8")) as Record<string, unknown>;
  writeFileSync(t.kunye, JSON.stringify({ ...tj, sha256: "0".repeat(64) }));
  const dk = dogrula(t);
  check("§4h imzadan SONRA kurcalanan surum.json alanı (eski tablet başka dosya indirirdi) → apk-dogrula RED (KUNYE_DOSYA)", dk.kod !== 0 && /KUNYE_DOSYA/.test(dk.cikti), dk.cikti.trim().slice(-160));
  const u = apkDizini();
  imzala(u);
  writeFileSync(u.apk, randomBytes(20_000));
  const du = dogrula(u);
  check("§4i imzadan SONRA değiştirilen APK → apk-dogrula RED (DOSYA_OZETI)", du.kod !== 0 && /DOSYA_OZETI/.test(du.cikti), du.cikti.trim().slice(-160));
  const dk2 = dogrula(p, "testfabrika");
  check("§4j başka kanal adına doğrulama → RED (KUNYE_KANAL)", dk2.kod !== 0 && /KUNYE_KANAL/.test(dk2.cikti), dk2.cikti.trim().slice(-160));
}

async function main(): Promise<void> {
  try {
    bolum0();
    const anahtar = await bolum1();
    bolum2(anahtar);
    bolum3(anahtar);
    bolum4(anahtar);
  } finally {
    rmSync(TEMP, { recursive: true, force: true });
    if (existsSync(path.join(DEPO_KOKU, "tmp-panel-anahtari"))) rmSync(path.join(DEPO_KOKU, "tmp-panel-anahtari"), { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail ? 1 : 0);
}

void main();
