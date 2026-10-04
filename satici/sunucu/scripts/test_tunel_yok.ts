// =============================================================================
// TÜNEL YOK — satıcı portalının tek yolu ERİŞİM'dir (Cloudflare Access); emekli tünel (TAILNET) dinleyicisi,
// rotası, imza kapsamı ve ayarı GERİ GELEMEZ. Tripwire (sunucu çekirdeği: satici/sunucu/src + scripts):
//   (1) server.ts'te `http.createServer` TAM 3 ve açılış satırının dinleyicileri genel/ic/erisim (sırayla)
//   (2) src/'de "TAILNET" dizgisi/tip literali YALNIZ roles.ts `Exclude<PortalDinleyici, "TAILNET">` beyanında;
//       hiçbir tanımlayıcı/dosya adı "tailnet" taşımaz (AST — yorumlar sayılmaz)
//   (3) config.ts'te PORT_TAILNET / TAILNET_* yok (AST) ve `loadConfig` eski ortam değişkenlerini yapılandırmaya ALMAZ
//   (4) SIGNING_ORIGINS'in hiçbir türünde TAILNET yok · (6) `runInListenerScope("TAILNET")` ATAR
//   (5) DB (kendi `_test` DB'si): elle yazılmış geçerli belirteçli `dinleyici: TAILNET` oturumu ERİŞİM'de ÇÖZÜLMEZ;
//       AYNI satır ERISIM'e çekilince AYNI belirteç çözülür (✓K — reddin kör olmadığı)
//   (7) scripts/: SATICI_DINLIYOR okuyucuları `tailnet=` beklemez, silinen tailnet-app modülü anılmaz
//   (8) deploy/satici: emekli beş dağıtım dosyası (loopback örtüsü · portal-tunel.cjs · portal-baglan.mjs · vds/tailnet-hazirla.sh
//       · vds/tekserp-satici-tailnet@.service) YOK, dizinde adı tünel anan dosya yok; docker-compose*.yml · Dockerfile ·
//       imaj-derle.sh · ornek*.env METNİNDE (yorum dahil) 4611 · tailnet · portal-tunel geçmez; compose-denetle.mjs Ⓚ kalıntı
//       (ön + çözülmüş) ve Ⓞ tek portal denetimlerini taşır
// ⭐ KALICI SONDA ✓K (her koşumda): (2)/(3)'ün AST tarayıcısı sentetik kaynakta ısırır (dizgi · tip literali ·
//    tanımlayıcı · özellik adı) ve roles.ts beyanını geçirir; (5) ERISIM eşi çözülür; (8) metin deseni sentetik
//    satırlarda ısırır, temiz satırı geçirir ve taranan dosya kümesi boş değil (kör tarama yeşil veremez).
// NEGATİF SONDA (2026-10-05, dosya DIŞI, cp + shasum ile geri alındı): `SIGNING_ORIGINS.KOK`/`ARA`ya "TAILNET" → §2a · §4a ❌
//   (+ test_ara_imzaci §0a · §2g, test_imza_parolasi §7c2 ❌) · server.ts'e 4. `http.createServer` → §1a ❌ · resolveSession'dan
//   dinleyici denetimi kaldırıldı → §5a ❌ (test_erisim_kapisi YEŞİL kaldı: aynı rolde ikinci dinleyici yok, bağı yalnız §5a
//   ölçer) · config şemasına `PORT_TAILNET` → §2a · §3a · §3b ❌.
// NEGATİF SONDA (T2 deploy kapsamı, 2026-10-05, dosya DIŞI, cp + shasum ile geri alındı / yeni dosya silindi):
//   portal-tunel.cjs geri → §8a · §8b ❌ · vds/tailnet-yeni.sh → §8b ❌ · Dockerfile'a `COPY portal-tunel.cjs` · ornek.env'e
//   TAILNET_IP · docker-compose.yml'ye "4611" yorumu → §8c ❌ · compose-denetle'de EMEKLI_ORTULER boş · ön denetim çağrısı
//   kapalı · Ⓞ beklenen = örtü var mı · çözülmüş Ⓚ bloğu silindi → §8e ❌ (her biri 16–17/18).
// Koşum: npx tsx scripts/test_tunel_yok.ts   (yalnız (5) DB'ye dokunur, kendi _test DB'si)
// =============================================================================
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { loadConfig } from "../src/config";
import { SIGNING_ORIGINS } from "../src/keys/signing-scope";
import { runInListenerScope } from "../src/lib/request-scope";
import { anahtarOrtamiKur, hedefDbKapisi, kapat, kontrol, portalKullaniciAc, sonuc, temizlePortal } from "./lib/test-ortam";

const KOK = path.resolve(__dirname, "..");
const SRC = path.join(KOK, "src");
const DEPLOY = path.resolve(KOK, "..", "..", "deploy", "satici");
/** Emekli tünelin dağıtım dosyaları (deploy/satici'ye göre). */
const EMEKLI_DOSYALAR = ["docker-compose.loopback.yml", "portal-tunel.cjs", "portal-baglan.mjs", "vds/tailnet-hazirla.sh", "vds/tekserp-satici-tailnet@.service"];
/** Dağıtım metninde tünel izi: eski port, tailnet (TAILNET_* dahil), iletici servis. */
const TUNEL_IZI = /4611|tailnet|portal-tunel/i;

function dosyalarOzyineli(dizin: string): string[] {
  return readdirSync(dizin).flatMap((ad) => {
    const tam = path.join(dizin, ad);
    return statSync(tam).isDirectory() ? dosyalarOzyineli(tam) : [tam];
  });
}

function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(dizin)) {
    const tam = path.join(dizin, ad);
    if (statSync(tam).isDirectory()) out.push(...tsDosyalari(tam));
    else if (ad.endsWith(".ts")) out.push(tam);
  }
  return out;
}

/** Bir kaynakta "tailnet" anılan AST düğümleri (yorum hariç). İzinli tek yer: `Exclude<…, "TAILNET">` tip argümanı. */
function tailnetAnilari(dosya: string, metin: string): string[] {
  const sf = ts.createSourceFile(dosya, metin, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const satir = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const izinli = (n: ts.Node): boolean => {
    // "TAILNET" dizgisi → LiteralTypeNode → Exclude<…> tip referansının İKİNCİ argümanı.
    const lit = n.parent;
    const ref = lit?.parent;
    return (
      ts.isLiteralTypeNode(lit) &&
      ref !== undefined &&
      ts.isTypeReferenceNode(ref) &&
      ts.isIdentifier(ref.typeName) &&
      ref.typeName.text === "Exclude" &&
      ref.typeArguments?.[1] === lit
    );
  };
  const gez = (n: ts.Node): void => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /tailnet/i.test(n.text)) {
      if (!izinli(n)) out.push(`${dosya}:${satir(n)} dizgi "${n.text.slice(0, 40)}"`);
    } else if ((ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && /tailnet/i.test(n.text)) {
      out.push(`${dosya}:${satir(n)} şablon "${n.text.slice(0, 40)}"`);
    } else if ((ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) && /tailnet/i.test(n.text)) {
      out.push(`${dosya}:${satir(n)} tanımlayıcı ${n.text}`);
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

/** server.ts: `http.createServer(` çağrı sayısı ve SATICI_DINLIYOR şablonundaki dinleyici adları. */
function sunucuOlcumu(metin: string): { createServer: number; dinleyiciler: string[] } {
  const sf = ts.createSourceFile("server.ts", metin, ts.ScriptTarget.Latest, true);
  let createServer = 0;
  let dinleyiciler: string[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "createServer") createServer++;
    if (ts.isTemplateExpression(n) && n.head.text.startsWith("SATICI_DINLIYOR")) {
      const parcalar = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join("\u0000");
      dinleyiciler = [...parcalar.matchAll(/([a-z]+)=/g)].map((m) => m[1]!);
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return { createServer, dinleyiciler };
}

async function main(): Promise<void> {
  console.log("\n§1 dinleyiciler (server.ts)");
  const srv = sunucuOlcumu(readFileSync(path.join(SRC, "server.ts"), "utf8"));
  kontrol("§1a server.ts'te http.createServer TAM 3 (genel · iç · erişim)", srv.createServer === 3, `${srv.createServer}`);
  kontrol("§1b açılış satırının dinleyicileri genel/ic/erisim (sırayla; tailnet= yok)", JSON.stringify(srv.dinleyiciler) === JSON.stringify(["genel", "ic", "erisim"]), srv.dinleyiciler.join(","));

  console.log("\n§2 src/'de TAILNET yalnız emekli beyanında (AST)");
  const dosyalar = tsDosyalari(SRC);
  const anilar = dosyalar.flatMap((d) => tailnetAnilari(path.relative(KOK, d), readFileSync(d, "utf8")));
  kontrol("§2a src/'de \"TAILNET\" dizgisi/tanımlayıcısı YOK (izinli tek yer: roles.ts Exclude<…, \"TAILNET\">)", anilar.length === 0, anilar.slice(0, 5).join(" | "));
  const roller = readFileSync(path.join(SRC, "portal", "roles.ts"), "utf8");
  kontrol("§2b emekli beyanı yerinde: roles.ts PortalListener = Exclude<PortalDinleyici, \"TAILNET\">", /export type PortalListener = Exclude<PortalDinleyici, "TAILNET">;/.test(roller));
  const adlar = dosyalar.filter((d) => /tailnet/i.test(path.basename(d))).map((d) => path.relative(KOK, d));
  kontrol("§2c src/'de adı tailnet içeren dosya yok (tailnet-app.ts silindi)", adlar.length === 0, adlar.join(","));
  const sonda = tailnetAnilari("sonda.ts", [
    'type A = Exclude<X, "TAILNET">;',
    'const o = "TAILNET";',
    'type B = "TAILNET" | "GENEL";',
    "const createTailnetApp = 1;",
    "const c = { PORT_TAILNET: 1 };",
    "const d = `x${1}tailnet=`;",
    'type C = Exclude<"TAILNET", X>;',
  ].join("\n"));
  kontrol(
    "§2d ✓K tarayıcı sentetik kaynakta ısırır: dizgi · tip birliği · tanımlayıcı · özellik adı · şablon · Exclude'un İLK argümanı (6), beyanı geçirir",
    sonda.length === 6 && !sonda.some((x) => x.startsWith("sonda.ts:1 ")),
    sonda.join(" | "),
  );

  console.log("\n§3 yapılandırma");
  const cfgAnilari = tailnetAnilari("src/config.ts", readFileSync(path.join(SRC, "config.ts"), "utf8"));
  kontrol("§3a config.ts'te PORT_TAILNET / TAILNET_* anahtarı yok (AST)", cfgAnilari.length === 0, cfgAnilari.join(" | "));
  const cfg = loadConfig({ DATABASE_URL: "postgresql://x@127.0.0.1:1/x_test", PORT_TAILNET: "4611", TAILNET_BIND: "0.0.0.0", TAILNET_LOOPBACK: "1", TAILNET_CEREZ_GUVENLI: "0" });
  const sizan = Object.keys(cfg).filter((k) => /tailnet/i.test(k));
  kontrol("§3b eski ortam değişkenleri verilse de yapılandırmaya GİRMEZ (açılış etkisiz)", sizan.length === 0, sizan.join(","));

  console.log("\n§4 imza kapsamı");
  const kapsamlar = Object.entries(SIGNING_ORIGINS).filter(([, v]) => (v as readonly string[]).includes("TAILNET")).map(([k]) => k);
  kontrol("§4a SIGNING_ORIGINS'in hiçbir türünde TAILNET yok (KÖK · ARA = ERİŞİM · CLI)", kapsamlar.length === 0 && JSON.stringify(SIGNING_ORIGINS.KOK) === JSON.stringify(["ERISIM", "CLI"]), kapsamlar.join(",") || JSON.stringify(SIGNING_ORIGINS));

  console.log("\n§6 dinleyici kapsamı");
  let acildi = "AÇILMADI";
  try {
    runInListenerScope("TAILNET" as never, () => {
      acildi = "AÇILDI";
    });
  } catch {
    // beklenen
  }
  kontrol("§6a runInListenerScope(\"TAILNET\") ATAR (tip dışı çağrı çalışma anında da RED)", acildi === "AÇILMADI");

  console.log("\n§7 scripts/ (bekçi düzeneği)");
  const scriptler = tsDosyalari(path.join(KOK, "scripts")).filter((d) => path.basename(d) !== "test_tunel_yok.ts");
  const okuyucular = scriptler.filter((d) => {
    const m = readFileSync(d, "utf8");
    return /SATICI_DINLIYOR/.test(m) && /tailnet=/.test(m);
  });
  const modulAnan = scriptler.filter((d) => /tailnet-app|createTailnetApp/.test(readFileSync(d, "utf8")));
  kontrol("§7a SATICI_DINLIYOR okuyucuları tailnet= beklemez; silinen tailnet-app modülü anılmaz", okuyucular.length === 0 && modulAnan.length === 0, [...okuyucular, ...modulAnan].map((d) => path.relative(KOK, d)).join(","));

  console.log("\n§8 deploy/satici (dağıtım)");
  const kalan = EMEKLI_DOSYALAR.filter((f) => existsSync(path.join(DEPLOY, f)));
  kontrol("§8a emekli beş dağıtım dosyası YOK (loopback örtüsü · portal-tunel.cjs · portal-baglan.mjs · vds/tailnet-*)", kalan.length === 0, kalan.join(","));
  const deployDosyalari = dosyalarOzyineli(DEPLOY).map((d) => path.relative(DEPLOY, d));
  const adAnan = deployDosyalari.filter((d) => /tailnet|portal-tunel|portal-baglan|loopback/i.test(path.basename(d)));
  kontrol("§8b deploy/satici'de adı tünel anan dosya yok (tailnet · portal-tunel · portal-baglan · loopback)", adAnan.length === 0, adAnan.join(","));
  const taranan = deployDosyalari.filter((d) => /^(docker-compose[^/]*\.yml|Dockerfile|imaj-derle\.sh|ornek[^/]*\.env)$/.test(d)).sort();
  const izli = taranan.flatMap((d) =>
    readFileSync(path.join(DEPLOY, d), "utf8")
      .split("\n")
      .flatMap((l, i) => (TUNEL_IZI.test(l) ? [`${d}:${i + 1}`] : [])),
  );
  const beklenenTaranan = ["Dockerfile", "docker-compose.bildirim.yml", "docker-compose.portal-genel.yml", "docker-compose.yml", "imaj-derle.sh", "ornek-uretim.env", "ornek.env"];
  kontrol(
    "§8c docker-compose*.yml · Dockerfile · imaj-derle.sh · ornek*.env metninde (yorum dahil) 4611 / tailnet / TAILNET_ / portal-tunel YOK",
    izli.length === 0 && beklenenTaranan.every((d) => taranan.includes(d)),
    izli.slice(0, 6).join(" | ") || `${taranan.length} dosya: ${taranan.join(",")}`,
  );
  const izSonda = ["TAILNET_IP=100.64.0.9", '      - "127.0.0.1:4611:4611"', "  portal-tunel:", "    networks: [kenar, tailnet]", "COPY portal-tunel.cjs /usr/local/lib/"].filter((l) => TUNEL_IZI.test(l)).length;
  kontrol("§8d ✓K desen sentetik tünel satırlarında ısırır (5/5), temiz satırı geçirir", izSonda === 5 && !TUNEL_IZI.test("    networks: [kenar, ic, ic-api]"), `${izSonda}/5`);
  const denetle = readFileSync(path.join(DEPLOY, "compose-denetle.mjs"), "utf8");
  const kKontrol = (denetle.match(/kontrol\(`Ⓚ /g) ?? []).length;
  kontrol(
    "§8e compose-denetle.mjs: Ⓚ kalıntı denetimi (ön + çözülmüş; emekli örtü loopback · servis portal-tunel · TAILNET_*/PORT_TAILNET) ve Ⓞ tek portal (üretimde portal-genel zorunlu) var",
    kKontrol === 2 &&
      /const EMEKLI_ORTULER = \[[^\]]*"docker-compose\.loopback\.yml"/.test(denetle) &&
      /const EMEKLI_SERVISLER = \[[^\]]*"portal-tunel"/.test(denetle) &&
      /const tunelAnahtari = \(k\) => \/\^\(TAILNET_\|PORT_TAILNET\$\)\/\.test\(k\);/.test(denetle) &&
      /^kalintiOnDenetle\(envDosyasi, /m.test(denetle) &&
      /const beklenenPortal = projeOrtamiAdi === "uretim";/.test(denetle) &&
      /"Ⓞ üretimde portal-genel örtüsü ZORUNLU/.test(denetle),
    `Ⓚ kontrol: ${kKontrol}`,
  );

  console.log("\n§5 DB: TAILNET oturumu çözülmez");
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { prisma } = await import("../src/lib/prisma");
  const { resolveSession, sessionTokenDigest } = await import("../src/portal/auth.service");
  const kullanicilar: string[] = [];
  try {
    const yonetici = await portalKullaniciAc(ortam.ctx, "SATICI_YONETICI");
    kullanicilar.push(yonetici.id);
    const belirtec = randomBytes(32).toString("base64url");
    const simdi = Date.now();
    const satir = await prisma.portalOturumu.create({
      data: { kullaniciId: yonetici.id, belirtecOzeti: sessionTokenDigest(belirtec), dinleyici: "TAILNET", sonKullanim: new Date(simdi), bitis: new Date(simdi + 3_600_000) },
    });
    const tailnetle = await resolveSession(ortam.ctx, { listener: "ERISIM", token: belirtec });
    const genelde = await resolveSession(ortam.ctx, { listener: "GENEL", token: belirtec });
    kontrol("§5a geçerli belirteçli TAILNET oturumu ERİŞİM'de de GENEL'de de ÇÖZÜLMEZ", tailnetle === null && genelde === null, `${tailnetle?.id ?? "null"} / ${genelde?.id ?? "null"}`);
    await prisma.portalOturumu.update({ where: { id: satir.id }, data: { dinleyici: "ERISIM" } });
    const erisimde = await resolveSession(ortam.ctx, { listener: "ERISIM", token: belirtec });
    kontrol("§5b ✓K AYNI satır ERISIM'e çekilince AYNI belirteç ERİŞİM'de çözülür (ret kör değil)", erisimde?.id === satir.id && erisimde.listener === "ERISIM", erisimde?.id ?? "null");
  } finally {
    await temizlePortal({ kullanicilar });
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
