// Web sürümünü GERÇEK Chromium'da açar (duman.sh; playwright paneldeki e2e kurulumundan, PW=<yol>):
// CSP ihlali ve konsol hatası sayar, giriş ekranı çizildi mi ölçer, ekran görüntüsü alır.
// Çıkış: 0 temiz · 1 ihlal/hata/giriş formu yok. curl başlığı ölçer; stilin gerçekten uygulandığını
// yalnız tarayıcı gösterir (react-native-web'in boş <style> ögesi CSP'ye takılınca sayfa stilsiz çizildi).
//   PW=Electron/node_modules/playwright node deploy/patron/tarayici-duman.cjs <url> <ekran.png>
//   node deploy/patron/tarayici-duman.cjs --oz-sinama   (istisna süzgecinin öz sınaması; tarayıcı açmaz)

// BEYANLI İSTİSNA — tek kalem: Cloudflare Web Analytics beacon'ını kenar (CF) sayfaya kendisi ekler;
// CSP'miz dış betiğe izin vermediği için engellenir ve sayfaya etkisi yoktur (analitik gitmez, o kadar).
// Bölge ayarına dokunulmaz, CSP gevşetilmez; yalnız BU ihlal duman sayımından düşer, sayısı ayrıca basılır.
const BEACON = "https://static.cloudflareinsights.com/";

/** CSP ihlali satırı: "<yönerge> <engellenen URI>". Yalnız script-src* + beacon kökü istisnadır. */
function beyanliIhlal(satir) {
  const [yonerge, uri] = String(satir).split(" ");
  return /^script-src(-elem)?$/.test(yonerge || "") && typeof uri === "string" && uri.startsWith(BEACON);
}

/** Konsol hatası: tarayıcının aynı engelleme için bastığı CSP iletisi (beacon URL'si + CSP ibaresi). */
function beyanliKonsol(metin) {
  const m = String(metin);
  return m.includes(`'${BEACON}`) && /Content Security Policy/.test(m) && !m.replace(new RegExp(`'${BEACON}[^']*'`, "g"), "").includes("http");
}

function ozSinama() {
  const vakalar = [
    [beyanliIhlal("script-src-elem https://static.cloudflareinsights.com/beacon.min.js/v8c78df7c7c0f484497ecbca7046644da1771523124516"), true],
    [beyanliIhlal("script-src https://static.cloudflareinsights.com/beacon.min.js"), true],
    [beyanliIhlal("script-src-elem https://static.cloudflareinsights.com.evil.example/x.js"), false],
    [beyanliIhlal("script-src-elem https://cdn.example.com/x.js"), false],
    [beyanliIhlal("style-src-elem https://static.cloudflareinsights.com/x.css"), false],
    [beyanliIhlal("connect-src https://static.cloudflareinsights.com/cdn-cgi/rum"), false],
    [beyanliKonsol("Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/v8c' violates the following Content Security Policy directive: \"script-src 'self'\"."), true],
    [beyanliKonsol("Refused to load the script 'https://static.cloudflareinsights.com/beacon.min.js' because it violates the following Content Security Policy directive"), true],
    [beyanliKonsol("Loading the script 'https://cdn.example.com/x.js' violates the following Content Security Policy directive"), false],
    [beyanliKonsol("TypeError: Invalid URL"), false],
    [beyanliKonsol("Loading the script 'https://static.cloudflareinsights.com/b.js' violates the following Content Security Policy directive; also 'https://cdn.example.com/y.js'"), false],
  ];
  const bozuk = vakalar.map(([g, b], i) => (g === b ? null : i)).filter((i) => i !== null);
  console.log(`  ${bozuk.length === 0 ? "✅" : "❌"} beyanlı istisna öz sınaması: ${vakalar.length - bozuk.length}/${vakalar.length}${bozuk.length ? ` — bozuk vaka: ${bozuk.join(",")}` : ""}`);
  process.exit(bozuk.length === 0 ? 0 : 1);
}

async function main() {
  const { chromium } = require(process.env.PW || "playwright");
  const [ham, ekran] = process.argv.slice(2);
  // Sondaki '/' kırpılır: `<url>/` + '/' çift eğik çizgi üretirdi (expo-router "Invalid URL").
  const url = String(ham).replace(/\/+$/, "");
  const tarayici = await chromium.launch();
  const sayfa = await tarayici.newPage();
  const ihlal = [];
  const hata = [];
  sayfa.on("console", (m) => {
    if (m.type() === "error") hata.push(m.text().slice(0, 400));
  });
  sayfa.on("pageerror", (e) => hata.push(String(e).slice(0, 400)));
  await sayfa.exposeFunction("__csp", (x) => ihlal.push(x));
  await sayfa.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => window.__csp(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const yanit = await sayfa.goto(`${url}/`, { waitUntil: "networkidle" });
  await sayfa.waitForTimeout(1500);
  const girdi = await sayfa.locator("input").count();
  const metin = ((await sayfa.textContent("body")) || "").replace(/\s+/g, " ").trim();
  if (ekran) await sayfa.screenshot({ path: ekran });
  await tarayici.close();
  const istisna = ihlal.filter(beyanliIhlal).length + hata.filter(beyanliKonsol).length;
  const ihlalKalan = ihlal.filter((x) => !beyanliIhlal(x));
  const hataKalan = hata.filter((x) => !beyanliKonsol(x));
  const temiz = yanit.status() === 200 && ihlalKalan.length === 0 && hataKalan.length === 0 && girdi >= 2;
  console.log(`  ${temiz ? "✅" : "❌"} durum ${yanit.status()} · CSP ihlali ${ihlalKalan.length} · konsol hatası ${hataKalan.length} · beyanlı istisna (CF beacon) ${istisna} · girdi ${girdi} · "${metin.slice(-60)}"`);
  for (const x of [...ihlalKalan, ...hataKalan]) console.log(`     ↳ ${x.slice(0, 200)}`);
  process.exit(temiz ? 0 : 1);
}

if (process.argv[2] === "--oz-sinama") ozSinama();
else
  main().catch((e) => {
    console.error(`  ❌ tarayıcı açılamadı: ${e.message}`);
    process.exit(1);
  });
