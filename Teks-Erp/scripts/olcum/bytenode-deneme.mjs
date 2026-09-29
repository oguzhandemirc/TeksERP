// =============================================================================
// Kod koruma 2a — BYTENODE FİZİBİLİTESİ (yalnız deneme; bytenode bağımlılık DEĞİL)
// =============================================================================
// bytenode package.json'a EKLENMEZ: ağaç dışı geçici bir dizine kurulur ve yolu
// --bytenode ile verilir. Betik HEDEF Node ikilisiyle koşulur (bayt kodu o ikiliye kilitli):
//   <node24>/bin/node scripts/olcum/bytenode-deneme.mjs \
//       --bytenode=<geçici>/node_modules/bytenode --paket=<paket-provasi sahnesi>/app \
//       [--tekrar=5] [--port=4480] [--yabanci-node=/usr/local/bin/node]
// Ölçer: .jsc üretim süresi/boyutu · toString ve yığın davranışı · düz metin dizge sızıntısı ·
// başlatma süresi + RSS (düz .cjs ↔ .jsc) · başka Node sürümüyle yükleme reddi.
// Sunucuyu yalnız 127.0.0.1'de, paketin `.env`indeki `_test` DB ile açar; KENDİ sürecini kapatır.
// =============================================================================
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const bytenodeYol = args.get("bytenode");
const paket = args.get("paket") && path.resolve(args.get("paket"));
if (!bytenodeYol || !paket) {
  console.error("X --bytenode=<dizin> ve --paket=<app dizini> zorunlu");
  process.exit(2);
}
const tekrar = Number(args.get("tekrar") ?? 5);
const port = Number(args.get("port") ?? 4480);
const yabanciNode = args.get("yabanci-node");

// Hedef DB kapısı (fail-closed): paketin .env'i `_test` ile biten, fabrika olmayan bir DB göstermeli.
const envMetni = readFileSync(path.join(paket, ".env"), "utf8");
const url = /^DATABASE_URL=['"]?([^'"\n]+)/m.exec(envMetni)?.[1] ?? "";
const dbAdi = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();
if (!dbAdi.endsWith("_test") || dbAdi.startsWith("tekserp_fabrika")) {
  console.error(`X hedef DB reddedildi: '${dbAdi || "(okunamadı)"}' — yalnız *_test`);
  process.exit(2);
}

const require = createRequire(import.meta.url);
// V8 sabit havuzu dizgeyi tek baytlı (latin1) ya da iki baytlı (UTF-16LE) tutar; ikisi de düz metindir.
const icerir = (buf, s) => buf.includes(Buffer.from(s, "latin1")) || buf.includes(Buffer.from(s, "utf16le"));
const bytenode = require(path.resolve(bytenodeYol));
const sonuc = { node: process.version, v8: process.versions.v8, platform: `${process.platform}-${process.arch}` };

// ── 1) Küçük örnek: toString · yığın · adlar ──────────────────────────────────
const gecici = mkdtempSync(path.join(tmpdir(), "bytenode-2a-"));
const ornekJs = path.join(gecici, "ornek.cjs");
writeFileSync(
  ornekJs,
  [
    "class LisansKapisi {",
    "  denetle(x) {",
    "    if (!x) throw new Error('lisans yok'); // kaynakta 3. satır",
    "    return 'ok:' + x;",
    "  }",
    "}",
    "function gizliHesap(a, b) {",
    "  // bu yorum bayt kodda kalmamalı",
    "  const tuz = 'GIZLI-DIZGE-2A';",
    "  return a * b + tuz.length;",
    "}",
    "module.exports = { LisansKapisi, gizliHesap, arrow: (q) => q + 1 };",
  ].join("\n"),
);
const ornekJsc = path.join(gecici, "ornek.jsc");
bytenode.compileFile({ filename: ornekJs, output: ornekJsc, compileAsModule: true });
const ornek = require(ornekJsc);
let yigin = "";
try {
  new ornek.LisansKapisi().denetle(0);
} catch (e) {
  yigin = String(e.stack).split("\n").slice(0, 3).join(" | ");
}
const jscBayt = readFileSync(ornekJsc);
sonuc.ornek = {
  calisiyor: ornek.gizliHesap(3, 4) === 26 && new ornek.LisansKapisi().denetle("a") === "ok:a",
  toStringFonksiyon: JSON.stringify(ornek.gizliHesap.toString().slice(0, 60)),
  toStringSinifUzunluk: ornek.LisansKapisi.toString().length,
  fonksiyonAdi: ornek.gizliHesap.name,
  sinifAdi: ornek.LisansKapisi.name,
  length: ornek.gizliHesap.length,
  yigin,
  jscIcindeDizge: icerir(jscBayt, "GIZLI-DIZGE-2A"),
  jscIcindeYorum: icerir(jscBayt, "bayt kodda kalmamal"),
  jscIcindeAd: icerir(jscBayt, "gizliHesap"),
};

// ── 2) Sunucu paketi → .jsc ───────────────────────────────────────────────────
const serverCjs = path.join(paket, "dist", "server.cjs");
const serverJsc = path.join(paket, "dist", "server.jsc");
const t0 = Date.now();
bytenode.compileFile({ filename: serverCjs, output: serverJsc, compileAsModule: true });
const derlemeMs = Date.now() - t0;
const yukleyici = path.join(paket, "dist", "server-jsc.cjs");
writeFileSync(yukleyici, `require(${JSON.stringify(path.resolve(bytenodeYol))});\nrequire("./server.jsc");\n`);
const jscSunucu = readFileSync(serverJsc);
sonuc.sunucuDerleme = {
  derlemeMs,
  cjsKB: Math.round(statSync(serverCjs).size / 1024),
  jscKB: Math.round(statSync(serverJsc).size / 1024),
  // Bayt kodun sabit havuzu dizgeleri düz tutar — okunabilirlik ölçüsü.
  dizgeTurkceHata: icerir(jscSunucu, "Kullanıcı adı gerekli"),
  dizgeSql: icerir(jscSunucu, "pg_advisory_xact_lock"),
  adLicenseGate: icerir(jscSunucu, "licenseGate"),
  adAssertKursun: icerir(jscSunucu, "assertKursunTabletMayWrite"),
};

// ── 3) Başlatma süresi + RSS ──────────────────────────────────────────────────
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
/** Kimlikli duman: paket-provasi ile aynı uçlar — .jsc yalnız /health'i değil iş yolunu da taşıyor mu. */
async function duman() {
  const u = (y) => `http://127.0.0.1:${port}${y}`;
  const giris = await fetch(u("/api/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "123123", clientType: "electron" }),
  });
  const token = (await giris.json().catch(() => ({})))?.data?.token;
  const h = token ? { authorization: `Bearer ${token}` } : {};
  const st = async (y) => (await fetch(u(y), { headers: h })).status;
  const css = await fetch(u("/api-docs/swagger-ui.css"));
  return {
    login: giris.status,
    adminHealth: await st("/api/admin/health"),
    lisansDurum: await st("/api/license/durum"),
    items: await st("/api/items?limit=1"),
    rolls: await st("/api/rolls?limit=1"),
    swaggerCss: `${css.status} ${css.headers.get("content-type") ?? ""}`,
  };
}

async function baslat(dosya, dumanKos = false) {
  const t = Date.now();
  const cocuk = spawn(process.execPath, [dosya], {
    cwd: paket,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DISCOVERY_MDNS_ENABLED: "false" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  cocuk.stderr.on("data", (d) => (stderr += d));
  let cikis = null;
  cocuk.on("exit", (c) => (cikis = c));
  let ms = null;
  for (let i = 0; i < 600 && cikis === null; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.status === 200) {
        ms = Date.now() - t;
        break;
      }
    } catch {
      /* henüz dinlemiyor */
    }
    await bekle(50);
  }
  let rssMB = null;
  let dumanSonuc;
  if (ms !== null) {
    await bekle(1500);
    const ps = spawnSync("ps", ["-o", "rss=", "-p", String(cocuk.pid)], { encoding: "utf8" });
    rssMB = Math.round(Number(ps.stdout.trim()) / 1024);
  }
  // RSS'ten SONRA: duman yığını büyütür, başlatma ölçüsünü kirletmesin.
  if (ms !== null && dumanKos) dumanSonuc = await duman().catch((e) => ({ hata: String(e) }));
  if (cikis === null) {
    cocuk.kill("SIGTERM");
    for (let i = 0; i < 80 && cikis === null; i++) await bekle(100);
    if (cikis === null) cocuk.kill("SIGKILL");
  }
  return { ms, rssMB, duman: dumanSonuc, stderr: ms === null ? stderr.slice(0, 800) : undefined };
}
const olcum = { cjs: [], jsc: [] };
for (let i = 0; i < tekrar; i++) {
  olcum.cjs.push(await baslat(serverCjs, i === 0));
  olcum.jsc.push(await baslat(yukleyici, i === 0));
}
const medyan = (xs) => {
  const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
sonuc.baslatma = {
  tekrar,
  cjsMs: olcum.cjs.map((o) => o.ms),
  jscMs: olcum.jsc.map((o) => o.ms),
  cjsMedyanMs: medyan(olcum.cjs.map((o) => o.ms)),
  jscMedyanMs: medyan(olcum.jsc.map((o) => o.ms)),
  cjsRssMB: medyan(olcum.cjs.map((o) => o.rssMB)),
  jscRssMB: medyan(olcum.jsc.map((o) => o.rssMB)),
  dumanCjs: olcum.cjs[0]?.duman,
  dumanJsc: olcum.jsc[0]?.duman,
  hata: olcum.jsc.find((o) => o.stderr)?.stderr,
};

// ── 4) Başka Node ikilisiyle yükleme ──────────────────────────────────────────
if (yabanciNode) {
  const r = spawnSync(
    yabanciNode,
    ["-e", `require(${JSON.stringify(path.resolve(bytenodeYol))}); try { require(${JSON.stringify(ornekJsc)}); console.log("YUKLENDI"); } catch (e) { console.log("RED: " + e.message); }`],
    { encoding: "utf8" },
  );
  const v = spawnSync(yabanciNode, ["-v"], { encoding: "utf8" }).stdout.trim();
  sonuc.yabanciNode = { surum: v, sonuc: (r.stdout + r.stderr).trim().split("\n").slice(-1)[0] };
}

process.stdout.write(JSON.stringify(sonuc, null, 2) + "\n");
