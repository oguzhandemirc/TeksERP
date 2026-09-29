// Web sürümünü GERÇEK Chromium'da açar (duman.sh; playwright paneldeki e2e kurulumundan, PW=<yol>):
// CSP ihlali ve konsol hatası sayar, giriş ekranı çizildi mi ölçer, ekran görüntüsü alır.
// Çıkış: 0 temiz · 1 ihlal/hata/giriş formu yok. curl başlığı ölçer; stilin gerçekten uygulandığını
// yalnız tarayıcı gösterir (react-native-web'in boş <style> ögesi CSP'ye takılınca sayfa stilsiz çizildi).
//   PW=Electron/node_modules/playwright node deploy/patron/tarayici-duman.cjs <url> <ekran.png>
const { chromium } = require(process.env.PW || "playwright");

(async () => {
  const [url, ekran] = process.argv.slice(2);
  const tarayici = await chromium.launch();
  const sayfa = await tarayici.newPage();
  const ihlal = [];
  const hata = [];
  sayfa.on("console", (m) => {
    if (m.type() === "error") hata.push(m.text().slice(0, 200));
  });
  sayfa.on("pageerror", (e) => hata.push(String(e).slice(0, 200)));
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
  const temiz = yanit.status() === 200 && ihlal.length === 0 && hata.length === 0 && girdi >= 2;
  console.log(`  ${temiz ? "✅" : "❌"} durum ${yanit.status()} · CSP ihlali ${ihlal.length} · konsol hatası ${hata.length} · girdi ${girdi} · "${metin.slice(-60)}"`);
  for (const x of [...ihlal, ...hata]) console.log(`     ↳ ${x}`);
  process.exit(temiz ? 0 : 1);
})().catch((e) => {
  console.error(`  ❌ tarayıcı açılamadı: ${e.message}`);
  process.exit(1);
});
