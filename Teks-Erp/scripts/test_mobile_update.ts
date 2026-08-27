// TEST: Mobil güncelleme deposu — DONMUŞ MANİFEST SÖZLEŞMESİ.
//
// ⚠️ NEDEN BU BEKÇİ VAR:
// Bu uçların istemcisi bizim yazdığımız bir ekran DEĞİL, `expo-updates`
// paketinin native kodudur. Sözleşmenin yarısı bizim elimizde değil ve
// ihlallerin TAMAMI SESSİZDİR — yanlış başlık, eksik CRLF, yanlış sınırlayıcı
// ya da bozuk imza "hata" olarak değil "güncelleme yok" olarak görünür.
// Bozulduğunda kimse fark etmez; sahaya günlerce güncelleme gitmez ve sebebi
// "sunucu çalışıyor, uç 200 dönüyor" diye aranmaz.
//
// ⚠️ SUNUCU ARTIK MANİFEST ÜRETMEZ (2026-08-26): kod imzalama gövdenin HAM
// baytları üzerinden doğrulandığı için manifest yayın anında dondurulur
// (`mobil/scripts/lib/manifest.mjs` — TEK üretici). Buradaki iddialar bu yüzden
// "doğru üretiyor mu" değil, "donmuş baytları BOZMADAN ve doğru başlıklarla
// servis ediyor mu" sorusunu ölçer.
//
// Çalıştır: npx tsx scripts/test_mobile_update.ts
import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const REPO_KOK = path.join(__dirname, "..", "..");
const MOBIL = path.join(REPO_KOK, "mobil");

/* ------------------------------------------------------------------ *
 * Sahte depo — VPS'teki nginx'in servis ettiği düzenin AYNISI
 * ------------------------------------------------------------------ */

const RV = "54.2";
const DAMGA_ESKI = "1787700000000";
const DAMGA_YENI = "1787800000000";
const BOUNDARY = "tekserpota";

const kok = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-ota-"));
process.env.MOBILE_UPDATE_DIR = kok;

// Gerçek imza anahtarı — testin kendi anahtar çiftini üretmesi, imzanın
// GERÇEKTEN doğrulanabildiğini ölçmenin tek yolu.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function paketYaz(damga: string, bundleIcerik: Buffer, varlikIcerik: Buffer): string {
  const dir = path.join(kok, "ota", RV, damga);
  const bundleRel = `_expo/static/js/android/index-${crypto.createHash("md5").update(bundleIcerik).digest("hex")}.hbc`;
  const varlikRel = `assets/${crypto.createHash("md5").update(varlikIcerik).digest("hex")}`;
  fs.mkdirSync(path.join(dir, path.dirname(bundleRel)), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, bundleRel), bundleIcerik);
  fs.writeFileSync(path.join(dir, varlikRel), varlikIcerik);
  return bundleRel;
}

const b64url = (b: Buffer) =>
  crypto.createHash("sha256").update(b).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Yayın script'inin ürettiğinin aynısı: donmuş + imzalı multipart gövde. */
function manifestYaz(damga: string, bundleRel: string, bundleIcerik: Buffer, hedefAd: string) {
  const manifest = {
    id: `00000000-0000-4000-8000-${damga.slice(-12)}`,
    createdAt: new Date(Number(damga)).toISOString(),
    runtimeVersion: RV,
    launchAsset: {
      hash: b64url(bundleIcerik),
      key: crypto.createHash("md5").update(bundleIcerik).digest("hex"),
      contentType: "application/javascript",
      fileExtension: ".bundle",
      url: `https://ornek/mobil/ota/${RV}/${damga}/${bundleRel}`,
    },
    assets: [],
    metadata: {},
    extra: {},
  };
  const govde = JSON.stringify(manifest);
  const imza = crypto.sign("RSA-SHA256", Buffer.from(govde, "utf8"), privateKey).toString("base64");
  const parca = (ad: string, icerik: string, ek?: string) =>
    `--${BOUNDARY}\r\ncontent-disposition: form-data; name="${ad}"\r\n` +
    `content-type: application/json; charset=utf-8\r\n${ek ? `${ek}\r\n` : ""}\r\n${icerik}\r\n`;
  const tam = Buffer.from(
    parca("manifest", govde, `expo-signature: sig="${imza}", keyid="main", alg="rsa-v1_5-sha256"`) +
      parca("extensions", JSON.stringify({ assetRequestHeaders: {} })) +
      `--${BOUNDARY}--\r\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(kok, "ota", RV, hedefAd), tam);
  return { tam, manifest, govde, imza };
}

const ESKI_BUNDLE = Buffer.from("// eski paket");
const YENI_BUNDLE = Buffer.from("// yeni paket");
const VARLIK = Buffer.from([9, 8, 7, 6, 5]);
const eskiRel = paketYaz(DAMGA_ESKI, ESKI_BUNDLE, VARLIK);
const yeniRel = paketYaz(DAMGA_YENI, YENI_BUNDLE, VARLIK);
const eskiMan = manifestYaz(DAMGA_ESKI, eskiRel, ESKI_BUNDLE, `manifest-${DAMGA_ESKI}`);
const yeniMan = manifestYaz(DAMGA_YENI, yeniRel, YENI_BUNDLE, `manifest-${DAMGA_YENI}`);
// Yayında olan = `manifest`
fs.writeFileSync(path.join(kok, "ota", RV, "manifest"), yeniMan.tam);

// APK yayını
const apkDir = path.join(kok, "apk");
fs.mkdirSync(apkDir, { recursive: true });
const APK = Buffer.from("PK sahte apk");
fs.writeFileSync(path.join(apkDir, "TeksERP-2.9.8-vc55.apk"), APK);
fs.writeFileSync(
  path.join(apkDir, "surum.json"),
  JSON.stringify({ versionCode: 55, versionName: "2.9.8", dosya: "TeksERP-2.9.8-vc55.apk" }),
);

/* ------------------------------------------------------------------ *
 * Multipart ayrıştırıcı — istemcinin yaptığı işin sadeleştirilmişi
 * ------------------------------------------------------------------ */

function ayristir(contentType: string, govde: string) {
  const b = /boundary=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/^"|"$/g, "");
  const out: Record<string, { govde: string; imza: string | null }> = {};
  if (!b) return out;
  for (const blok of govde.split(`--${b}`)) {
    const i = blok.indexOf("\r\n\r\n");
    if (i < 0) continue;
    const basliklar = blok.slice(0, i);
    const ad = /name="([^"]+)"/i.exec(basliklar)?.[1];
    if (!ad) continue;
    out[ad] = {
      govde: blok.slice(i + 4).replace(/\r\n$/, ""),
      imza: /expo-signature:\s*(.+)/i.exec(basliklar)?.[1]?.trim() ?? null,
    };
  }
  return out;
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  // app, MOBILE_UPDATE_DIR ayarlandıktan SONRA yüklenmeli (config modül
  // yüklenirken okur) — bu yüzden dinamik import.
  const { default: app } = await import("../src/app");
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const taban = `http://127.0.0.1:${port}/api/mobile`;

  // ---------------------------------------------------------------- §1
  console.log("\n§1 — Manifest: donmuş baytlar + protokol başlıkları");
  {
    const r = await fetch(`${taban}/updates/ota/${RV}/manifest`);
    const govde = Buffer.from(await r.arrayBuffer());
    check("200 döner", r.status === 200, `status=${r.status}`);
    check("expo-protocol-version: 1", r.headers.get("expo-protocol-version") === "1");
    check("expo-sfv-version: 0", r.headers.get("expo-sfv-version") === "0");
    check(
      "content-type multipart/mixed + sınırlayıcı",
      (r.headers.get("content-type") ?? "").includes(`multipart/mixed; boundary=${BOUNDARY}`),
      r.headers.get("content-type") ?? "",
    );
    check("manifest önbelleklenmez", (r.headers.get("cache-control") ?? "").includes("no-cache"));
    // EN KRİTİK İDDİA: baytlar BİREBİR. Tek bayt oynarsa imza çöker.
    check("gövde diskteki dosyayla BİREBİR aynı", govde.equals(yeniMan.tam));
  }

  // ---------------------------------------------------------------- §2
  console.log("\n§2 — İmza: servis edilen gövde SERTİFİKAYLA doğrulanıyor");
  {
    const r = await fetch(`${taban}/updates/ota/${RV}/manifest`);
    const p = ayristir(r.headers.get("content-type") ?? "", await r.text());
    check("`manifest` parçası var", !!p.manifest);
    check("`expo-signature` parça başlığında (HTTP başlığında DEĞİL)", !!p.manifest?.imza);
    check("HTTP yanıt başlığında imza YOK", r.headers.get("expo-signature") === null);
    const sig = /sig="([^"]+)"/.exec(p.manifest?.imza ?? "")?.[1] ?? "";
    const gecerli = crypto.verify(
      "RSA-SHA256",
      Buffer.from(p.manifest?.govde ?? "", "utf8"),
      crypto.createPublicKey(publicPem),
      Buffer.from(sig, "base64"),
    );
    check("imza GEÇERLİ (istemcinin yaptığı doğrulamanın aynısı)", gecerli);
    check("keyid taşınıyor", /keyid="main"/.test(p.manifest?.imza ?? ""));
    check("alg taşınıyor", /alg="rsa-v1_5-sha256"/.test(p.manifest?.imza ?? ""));
    const man = JSON.parse(p.manifest?.govde ?? "{}");
    check("runtimeVersion doğru", man.runtimeVersion === RV);
  }

  // ---------------------------------------------------------------- §3
  console.log("\n§3 — Paket dosyaları: baytlar birebir, uzun önbellek");
  {
    const r = await fetch(`${taban}/updates/ota/${RV}/${DAMGA_YENI}/${yeniRel}`);
    check("bundle iner", r.status === 200, `status=${r.status}`);
    check("içerik önbelleklenebilir", (r.headers.get("cache-control") ?? "").includes("immutable"));
    check("baytlar birebir", Buffer.from(await r.arrayBuffer()).equals(YENI_BUNDLE));
    const ra = await fetch(`${taban}/updates/ota/${RV}/${DAMGA_YENI}/assets/${crypto.createHash("md5").update(VARLIK).digest("hex")}`);
    check("varlık baytları birebir", Buffer.from(await ra.arrayBuffer()).equals(VARLIK));
  }

  // ---------------------------------------------------------------- §4
  console.log("\n§4 — Geri alma: `manifest` üzerine eski kopya konur");
  {
    fs.writeFileSync(path.join(kok, "ota", RV, "manifest"), eskiMan.tam);
    const r = await fetch(`${taban}/updates/ota/${RV}/manifest`);
    const govde = Buffer.from(await r.arrayBuffer());
    check("eski paket yayına döner", govde.equals(eskiMan.tam));
    check("yeni paketin baytları DEĞİL", !govde.equals(yeniMan.tam));
    fs.writeFileSync(path.join(kok, "ota", RV, "manifest"), yeniMan.tam);
  }

  // ---------------------------------------------------------------- §5
  console.log("\n§5 — Bilinmeyen sürüm / eksik yayın (fail-closed)");
  {
    const r = await fetch(`${taban}/updates/ota/99.9/manifest`);
    check("yayını olmayan sürüm → 404", r.status === 404, `status=${r.status}`);
    const rk = await fetch(`${taban}/updates/ota/${encodeURIComponent("../..")}/manifest`);
    check("sürüm alanıyla kaçış reddedilir", rk.status >= 400, `status=${rk.status}`);
  }

  // ---------------------------------------------------------------- §6
  console.log("\n§6 — Yol kaçışı (yol istemciden gelir)");
  {
    // ⚠️ SONDA TASARIMI: hedef GERÇEKTEN VAR OLAN, depo DIŞINDA bir dosya
    // olmalı. Var olmayan bir yol koruma silinse de 404 döner ve bekçi yeşil
    // kalır — bu kör nokta 2026-08-26'da ölçülüp düzeltildi.
    const disari = path.join(kok, "..", path.basename(kok) + "-disari.txt");
    fs.writeFileSync(disari, "depo disinda");
    const rel = `../${path.basename(disari)}`;
    for (const kotu of [rel, encodeURIComponent(rel), "..%2F..%2Fetc%2Fpasswd"]) {
      const r = await fetch(`${taban}/updates/${kotu}`);
      check(`"${kotu}" servis EDİLMEZ`, r.status !== 200, `status=${r.status}`);
    }
    fs.rmSync(disari, { force: true });
  }

  // ---------------------------------------------------------------- §7
  console.log("\n§7 — Kurulum dosyası künyesi + APK");
  {
    const r = await fetch(`${taban}/updates/apk/surum.json`);
    check("künye iner", r.status === 200, `status=${r.status}`);
    check("künye önbelleklenmez", (r.headers.get("cache-control") ?? "").includes("no-cache"));
    check("versionCode doğru", ((await r.json()) as { versionCode: number }).versionCode === 55);
    const ra = await fetch(`${taban}/updates/apk/TeksERP-2.9.8-vc55.apk`);
    check(
      "APK doğru içerik tipiyle iner",
      ra.headers.get("content-type")?.includes("application/vnd.android.package-archive") === true,
      ra.headers.get("content-type") ?? "",
    );
    check("APK baytları birebir", Buffer.from(await ra.arrayBuffer()).equals(APK));
  }

  // ---------------------------------------------------------------- §8
  console.log("\n§8 — Yetki: yönetim ucu kimlik ister, güncelleme uçları İSTEMEZ");
  {
    const rs = await fetch(`${taban}/updates-state`);
    check("depo durumu kimliksiz 401", rs.status === 401, `status=${rs.status}`);
    const rp = await fetch(`${taban}/updates/ota/${RV}/manifest`);
    check("manifest kimliksiz 200 (açılamayan tablete düzeltme yolu)", rp.status === 200);
  }

  // ---------------------------------------------------------------- §9
  console.log("\n§9 — Depo kökü + sınırlayıcı, İKİ PROJE arasında tutarlı");
  {
    const { MOBILE_UPDATE_ROOT, MULTIPART_BOUNDARY } = await import("../src/config/mobile-update");
    check("MOBILE_UPDATE_DIR ortam değişkeni geçerli", MOBILE_UPDATE_ROOT === path.resolve(kok));

    const varsayilan = path.resolve(path.join(process.cwd(), "..", "mobil-guncelleme"));
    check(
      "varsayılan kök cwd'nin ALTINDA değil (deploy silmesin)",
      !varsayilan.startsWith(path.resolve(process.cwd()) + path.sep),
      varsayilan,
    );

    // ⚠️ Sınırlayıcı İKİ PROJEDE yaşıyor: gövdeyi mobil yayın script'i üretir,
    // Content-Type başlığını backend (ve VPS'te nginx) basar. Ayrışırlarsa
    // istemci gövdeyi HİÇ göremez ve durum "güncelleme yok" olarak görünür.
    const feedYol = path.join(MOBIL, "scripts/lib/feed.cjs");
    const mobilBoundary = /MULTIPART_BOUNDARY\s*=\s*'([^']+)'/.exec(
      fs.readFileSync(feedYol, "utf8"),
    )?.[1];
    check("mobil tarafındaki sınırlayıcı okunabildi", !!mobilBoundary, String(mobilBoundary));
    check(
      "backend ↔ mobil sınırlayıcı AYNI",
      MULTIPART_BOUNDARY === mobilBoundary,
      `backend=${MULTIPART_BOUNDARY} mobil=${mobilBoundary}`,
    );

    // nginx yapılandırması da aynı sınırlayıcıyı basmak zorunda.
    const nginxYol = path.join(REPO_KOK, "deploy/guncelleme-sunucusu/nginx/default.conf");
    if (fs.existsSync(nginxYol)) {
      const conf = fs.readFileSync(nginxYol, "utf8");
      check("nginx yapılandırması aynı sınırlayıcıyı basıyor", conf.includes(`boundary=${MULTIPART_BOUNDARY}`));
      check("nginx expo-protocol-version başlığını basıyor", /add_header\s+expo-protocol-version\s+1/.test(conf));
    } else {
      check("nginx yapılandırması repoda (deploy/guncelleme-sunucusu/)", false, "dosya yok");
    }
  }

  server.close();
}

main()
  .catch((e) => {
    console.error("\nBEKLENMEYEN HATA:", e);
    fail++;
  })
  .finally(() => {
    fs.rmSync(kok, { recursive: true, force: true });
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  SONUÇ: ${pass} geçti, ${fail} kaldı`);
    console.log("=".repeat(60));
    process.exit(fail > 0 ? 1 : 0);
  });
