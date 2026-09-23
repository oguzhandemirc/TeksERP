// =============================================================================
// MANDAL — GLOBAL AYAR YAZAN BEKÇİ GERİ ALMAYI `finally`de YAPAR (AST)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bekci_ayar_geri_alma   (DB'siz)
//
// ⭐ NEDEN (2026-09-24, ca ölçümü + 1e): sistem ayarı / modül bayrağı / numara serisi biçimi bütün
//    paketin paylaştığı durumdur. Onu yazıp geri almayı `finally` DIŞINDA yapan bekçi düştüğünde
//    ayar yanlış kalır ve SONRAKİ bekçi kırmızı verir — suç başkasına kalır. Fikstür satırından farkı
//    budur (fikstür yalnız kendini etkiler). Tarayıcı: `scripts/lib/bekci-ayar-geri-alma.ts`.
//
// NE ÖLÇER (kodu, anlatımı değil):
//   §1 ⭐ `scripts/test_*.ts` içinde global ayar yazan her bekçi, yazdığı her sınıf (AYAR / SERI) için
//      en az bir RESTORE olayı taşır (finally bloğu · `.finally(cb)` · yalnız oradan çağrılan fonksiyon)
//   §2 muaf listesi İKİ YÖNLÜ: muaf satırın gerekçesi var · muaf dosya hâlâ SET taşıyor (ölü muaf yok)
//   §3 KALICI SONDALAR (sentetik kaynak, her koşumda): ① try içinde yazıp try SONUNDA geri alan
//      → İHLAL · ② aynısı `finally`de → temiz · ③ yardımcı fonksiyon + finally'den çağrı → temiz ·
//      ④ `.then`/`.catch`de geri alma (finally değil) → İHLAL · ⑤ `.finally(cb)` → temiz ·
//      ⑥ yorumda "finally" geçmesi sayılmaz → İHLAL · ⑦ seri sınıfı ayrı ölçülür
//   §1b ANAHTAR DÜZEYİ: bilinen anahtarlı her SET (literal · SABİT · `setFeatureFlags` alanı · yol
//      anahtarı) aynı anahtarı geri alan bir RESTORE ya da o sınıfta genel (döngü) RESTORE ile örtülür.
//      Anahtarlar DB adına normalleşir; eşleme `system-setting.service.ts`ten TÜRETİLİR (elle liste yok).
//   §4 körlük zemini: yazan bekçi sayısı ≥ 80
// ⚠️ SINIR (beyan): anahtarı çözülemeyen (değişken) yazım sınıf düzeyinde kalır; genel bir RESTORE
//    varsa örtülü sayılır. Birebirlik (ayarın ESKİ değerine dönmesi) ölçülmez;
//    o, bekçinin kendi `ayar geri alındı` kontrolünün işidir.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { dosyaTara, kaynaktanCozucu } from "./lib/bekci-ayar-geri-alma";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** Global ayarı yazıp DURUMU DEĞİŞTİRMEYEN bekçiler (aynı değeri yazar) — gerekçeli. */
const MUAF: ReadonlyArray<{ dosya: string; neden: string }> = [
  { dosya: "test_superadmin.ts", neden: "HTTP turu modül anahtarına MEVCUT değeri yazar (yetki kapısını ölçer, durum değişmez)" },
];

function main(): void {
  const dizin = __dirname;
  const dosyalar = fs.readdirSync(dizin).filter((f) => /^test_.*\.ts$/.test(f));
  const muafSet = new Set(MUAF.map((m) => m.dosya));
  const cozucu = kaynaktanCozucu(fs.readFileSync(path.join(dizin, "..", "src", "services", "system-setting.service.ts"), "utf8"));
  let yazan = 0;
  const ihlal: string[] = [];
  const ortusmeyen: string[] = [];
  const setliMuaf = new Set<string>();
  for (const f of dosyalar) {
    const r = dosyaTara(f, fs.readFileSync(path.join(dizin, f), "utf8"), cozucu);
    if (r.olaylar.length) yazan++;
    if (muafSet.has(f)) { if (r.olaylar.some((o) => o.baglam === "SET")) setliMuaf.add(f); continue; }
    if (r.ortusmeyen.length) ortusmeyen.push(`${f} ${r.ortusmeyen.slice(0, 3).join(" · ")}`);
    if (r.ihlal.length) {
      const set = r.olaylar.filter((o) => o.baglam === "SET" && r.ihlal.includes(o.sinif)).map((o) => `:${o.satir}`).slice(0, 4).join(",");
      ihlal.push(`${f} [${r.ihlal.join("+")}] SET${set}`);
    }
  }
  check("§1 ⭐ global ayar yazan her bekçi geri almayı `finally`de yapar", ihlal.length === 0, ihlal.length ? ihlal.join(" | ") : `${yazan} yazan bekçi`);

  check("§1b ⭐ ANAHTAR DÜZEYİ: bilinen anahtarlı her SET aynı anahtarı geri alan bir RESTORE ile örtülü", ortusmeyen.length === 0, ortusmeyen.join(" | "));
  // Çözücü kaynaktan türer: bayrak alanı → DB anahtarı eşlemesi gerçekten kuruldu mu (sessiz çözücü = kör kol)
  check("§1c çözücü canlı: `loginMethods` → `auth.loginMethods`, `depoMultiEnabled` → `depo.multiEnabled`", cozucu("loginMethods") === "auth.loginMethods" && cozucu("depoMultiEnabled") === "depo.multiEnabled", `${cozucu("loginMethods")} · ${cozucu("depoMultiEnabled")}`);
  check("§2a muaf satırlarının gerekçesi var", MUAF.every((m) => m.neden.trim().length > 20));
  const olu = MUAF.filter((m) => !setliMuaf.has(m.dosya)).map((m) => m.dosya);
  check("§2b muaf listesinde ölü satır yok (muaf dosya hâlâ SET taşıyor)", olu.length === 0, olu.join(", "));

  const sonda = (kod: string) => dosyaTara("sonda.ts", kod).ihlal;
  const onEk = `import prisma from "x";\n`;
  check("§3① try içinde yazıp try SONUNDA geri alan → İHLAL", sonda(onEk + `async function main(){ const o = await prisma.systemSetting.findUnique({where:{key:"k"}}); try { await prisma.systemSetting.update({where:{key:"k"},data:{value:1}}); await prisma.systemSetting.update({where:{key:"k"},data:{value:o}}); } catch(e){} }`).includes("AYAR"));
  check("§3② aynı geri alma `finally`de → temiz", sonda(onEk + `async function main(){ try { await prisma.systemSetting.update({where:{key:"k"},data:{value:1}}); } finally { await prisma.systemSetting.update({where:{key:"k"},data:{value:0}}); } }`).length === 0);
  check("§3③ yardımcı fonksiyon + finally'den çağrı → temiz", sonda(onEk + `async function setFlag(v:boolean){ await prisma.systemSetting.upsert({where:{key:"k"},create:{key:"k",value:v},update:{value:v}}); }\nasync function main(){ try { await setFlag(true); } finally { await setFlag(false); } }`).length === 0);
  check("§3④ `.then`/`.catch`de geri alma (finally değil) → İHLAL", sonda(onEk + `async function main(){ await prisma.systemSetting.upsert({where:{key:"k"},create:{key:"k",value:1},update:{value:1}}); }\nmain().then(async()=>{ await prisma.systemSetting.deleteMany({where:{key:"k"}}); }).catch(async()=>{ await prisma.systemSetting.deleteMany({where:{key:"k"}}); });`).includes("AYAR"));
  check("§3⑤ `.finally(cb)` geri alma → temiz", sonda(onEk + `async function main(){ await prisma.systemSetting.upsert({where:{key:"k"},create:{key:"k",value:1},update:{value:1}}); }\nmain().finally(async()=>{ await prisma.systemSetting.deleteMany({where:{key:"k"}}); });`).length === 0);
  check("§3⑥ yorumdaki `finally` sayılmaz → İHLAL", sonda(onEk + `async function main(){ await prisma.systemSetting.update({where:{key:"k"},data:{value:1}}); // finally geri alınır\n /* finally { geri al } */ }`).includes("AYAR"));
  check("§3⑦ seri sınıfı ayrı: AYAR finally'de, SERI değil → SERI İHLAL", (() => { const r = sonda(onEk + `async function main(){ try { await prisma.numberSeries.update({where:{key:"s"},data:{prefix:"X"}}); await prisma.systemSetting.update({where:{key:"k"},data:{value:1}}); } finally { await prisma.systemSetting.update({where:{key:"k"},data:{value:0}}); } }`); return r.includes("SERI") && !r.includes("AYAR"); })());

  check("§3⑧ ANAHTAR: iki ayar yazılır, yalnız biri finally'de geri alınır → örtülmeyen", dosyaTara("sonda.ts", onEk + `async function main(){ try { await prisma.systemSetting.update({where:{key:"a.b"},data:{value:1}}); await prisma.systemSetting.update({where:{key:"c.d"},data:{value:1}}); } finally { await prisma.systemSetting.update({where:{key:"a.b"},data:{value:0}}); } }`).ortusmeyen.some((x) => x.includes("c.d")));
  check("§3⑨ ANAHTAR: önceki değerler üzerinde döngüyle geri alma (genel) → örtülü", dosyaTara("sonda.ts", onEk + `const once = new Map(); async function main(){ try { await prisma.systemSetting.update({where:{key:"a.b"},data:{value:1}}); } finally { for (const [key, v] of once) await prisma.systemSetting.update({where:{key},data:{value:v}}); } }`).ortusmeyen.length === 0);
  check("§4 körlük zemini: ≥80 bekçi global ayar yazıyor", yazan >= 80, `${yazan}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
