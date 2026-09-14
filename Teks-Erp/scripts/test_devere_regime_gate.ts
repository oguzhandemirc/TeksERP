// =============================================================================
// DEVERE REJİM KAPISI BEKÇİSİ — `devere.enabled` kapısı ZİNCİRİ ölçüyor mu?
// =============================================================================
// Devere (çözgü hazırlama / levent) iplik kg defterini TÜKETİR: levent doğarken
// `WARP_ISSUE` hareketi yazılır. Bu yüzden bağımlılık üç halkadır —
// devere → iplik → ticaret — ve `MODULE_DEPENDENCIES` TEK ön koşul taşır, yani
// geçişli kapanışı KENDİ ÜRETMEZ.
//
// ⚠️ BU BEKÇİNİN ASIL SORUSU: okuma kapısı zinciri ELLE ölçüyor mu? Yazma yolu
// (`setFeatureFlags`) çiftleri ayrı ayrı doğruladığı için tutarlı bir DB'de
// zincir dolaylı korunur; ama gövdenin dokunmadığı çift atlanır (ölçüldü:
// `assertModuleDependencies` yalnız input'un dokunduğu çifti bakar). Elle SQL,
// eski dump ya da yarım bir profil uygulaması "ticaret KAPALI + iplik AÇIK +
// devere AÇIK" üretebilir; kapı yalnız kendi anahtarına baksaydı levent doğar
// ve kapalı ticaret rejiminde iplik defterine satır yazılırdı.
//
// ⚠️ FAZ 1a YÜZEYİ DOĞDU (route · servis · Prisma modeli · Çözgü Kartları
// ekranı). §6 yüzeyi POZİTİF olarak arar: silinirse ya da kapısız bir router
// eklenirse kırmızı verir ("0 bulgu ≠ hiç bakılmadı" körlük zemini).
//
// ⚠️ §1–§6 METİN ölçer; §7 AKIŞ ölçer ve bu ayrım pahalıya öğrenildi: kapı,
// route, izin ve ekran yeşilken faz TEK KART üretemiyordu (iplik denyesinin
// hiçbir yazma yüzeyi yoktu). Statik bekçi bunu göremez.
//
// DB'YE YAZAR (§7 fikstürü: iki `TEST-DEVERE-<pid>` iplik kalemi + bir çözgü
// kartı, `finally`de silinir). HTTP atmaz, sunucu istemez.
// Koşum: npx tsx scripts/run-all-tests.ts devere_regime
//
// NEGATİF SONDALAR (yazılırken koşuldu, dosya sha256 ile geri yüklendi):
//   ① (2026-09-14, K3) `requireDevereEnabled` gövdesine `readIplikEnabled` dalı geri kondu
//      → §2b kırmızı (bağımlılık KALKTI: hazır levent alan fabrika iplik stoku tutmaz).
//   ② (2026-09-14, K3) `MODULE_DEPENDENCIES.devereEnabled = "iplikEnabled"` geri kondu
//      → §4a kırmızı; `warp-beam-wind.service`ten `applyYarnMovementTx` çağrısı düşürüldü → §4b kırmızı.
//   (Eski ①/② — ticaret dalı/sırası — GEÇERSİZ: zincir artık ölçülmüyor, kapı yalnız devere okur.)
//   ③ `MODULE_DEPENDENCIES.devereEnabled` silindi → §4a + §4b kırmızı.
//   ④ `readDevereEnabled`in `asBoolean` varsayılanı `true`ya çevrildi → §5 kırmızı.
//   ⑤ (2026-09-15, Faz 3 E2) `warp-beam.routes.ts`ten `router.use("/", warpBeamMountRoutes)` düşürüldü
//      → §6c kırmızı (alt yönlendirici beyanı ÖLÇÜLÜR: ana kapılı VE alt takılı değilse KAPISIZ).
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import {
  MODULE_DEPENDENCIES,
  MODULE_FLAG_KEYS,
  MODULE_LABELS,
  MODULE_SETTING_KEYS,
} from "../src/constants/module-flags";
import { readDevereEnabled } from "../src/services/system-setting.service";
// §7 akışı için: kartı route'un KULLANDIĞI servis örneğiyle açıyoruz — ikinci
// bir yapılandırma yazmak, bekçiyi üretimden ayrı bir kurulumu ölçer hâle
// getirirdi (`uniqueField`/`duplicateNameField` orada tanımlı).
import { warpSpecService } from "../src/routes/warp-spec.routes";
import { ItemType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { yorumlariSok } from "./lib/regime-gate-scan";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const SRC = path.resolve(__dirname, "../src");
const MIDDLEWARE = path.join(SRC, "middlewares/module.middleware.ts");
const KAPI = "requireDevereEnabled";

/** `export async function requireDevereEnabled(...)` gövdesini kaba ama YETERLİ
 *  biçimde keser: bir sonraki `export async function` başlığına kadar. */
function kapiGovdesi(kod: string): string {
  const bas = kod.indexOf(`export async function ${KAPI}`);
  if (bas < 0) return "";
  const sonrasi = kod.slice(bas + 10);
  const son = sonrasi.indexOf("export async function");
  return son < 0 ? kod.slice(bas) : kod.slice(bas, bas + 10 + son);
}

async function main(): Promise<void> {
  console.log("=== DEVERE REJİM KAPISI BEKÇİSİ (devere.enabled) ===\n");

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  check("§1a Körlük zemini: middleware dosyası okunabildi", fs.existsSync(MIDDLEWARE), MIDDLEWARE);
  const ham = fs.readFileSync(MIDDLEWARE, "utf8");
  // Yorumlar SÖKÜLÜR: bu dosyanın başlığı kapı adlarını ve gerekçeleri ANLATIR;
  // sökülmezse gövde kontrolleri yorumda eşleşip vakumen yeşil kalırdı
  // (`test_module_grandfathering` §1a2'nin dersi).
  const kod = yorumlariSok(ham);
  const govde = kapiGovdesi(kod);
  check("§1b Körlük zemini: kapı gövdesi ayrıştırıldı", govde.length > 200, `${govde.length} karakter`);

  // ── §2 ⭐ KAPI YALNIZ DEVERE OKUR — bağımlılık KALKTI (DEVERE-LEVENT §9.7d; 1e K3 2026-09-14) ──
  check("§2a ⭐ Kapı devere anahtarını okuyor", govde.includes("readDevereEnabled"));
  check(
    "§2b ⭐ Kapı iplik/ticaret OKUMAZ (hazır/fason levent iplik tüketmez; \"iplik KAPALI + devere AÇIK\" meşru)",
    !/readIplikEnabled|readTicaretEnabled/.test(govde),
    "iplik kapısı AKSİYON ANINDA: içeride sarım `applyYarnMovementTx` → iplik kapalıysa 403 (test_warp_beam_lifecycle §10)",
  );

  // ── §3 ⭐ MESAJ ────────────────────────────────────────────────────────────
  check('§3a ⭐ Gövde `modul:"ticaret"` / `modul:"iplik"` DÖNDÜRMEZ (bağımlı değil)', !/modul:\s*"(ticaret|iplik)"/.test(govde));
  check(
    '§3c Kendi dalı ortak `modulKapali("devere", …)` kullanıyor (403 + MODULE_DISABLED)',
    /modulKapali\(\s*"devere"/.test(govde),
  );
  check(
    "§3d Kapı `requirePermission`ın YERİNE geçmiyor (dosyada izin kontrolü yok)",
    !/requirePermission|hasPermission/.test(govde),
    "bayrak ve izin iki AYRI sorudur",
  );

  // ── §4 ⭐ BAĞIMLILIK TABLOSU ve DÖRT TABLO HİZASI ─────────────────────────
  check(
    "§4a ⭐ `MODULE_DEPENDENCIES.devereEnabled` YOK (PURCHASED/SUBCONTRACT levent iplik tüketmez)",
    MODULE_DEPENDENCIES["devereEnabled"] === undefined,
    `bugün: ${MODULE_DEPENDENCIES["devereEnabled"] ?? "YOK"}`,
  );
  const windSrc = yorumlariSok(fs.readFileSync(path.join(SRC, "services/warp-beam-wind.service.ts"), "utf8"));
  check(
    "§4b ⭐ İplik kapısı AKSİYON ANINDA: sarım servisi iplik defterine YALNIZ `applyYarnMovementTx` ile yazar (kapı motorun içinde), bayrağı kendisi okumaz",
    /applyYarnMovementTx\(/.test(windSrc) && !/readIplikEnabled/.test(windSrc),
  );
  check("§4c Anahtar dört tabloda da var (alan)", MODULE_FLAG_KEYS.has("devereEnabled"));
  check("§4d Anahtar dört tabloda da var (DB)", MODULE_SETTING_KEYS.has("devere.enabled"));
  check(
    "§4e Türkçe adı yazılı",
    (MODULE_LABELS["devereEnabled"] ?? "").length > 3,
    MODULE_LABELS["devereEnabled"] ?? "YOK",
  );

  // ── §5 ⭐ VARSAYILAN KAPALI (satır yokken) ────────────────────────────────
  // Ortam verisinden BAĞIMSIZ: satır YOK diyen sahte istemci. Canlı DB'ye
  // bakmak, birinin panelden açtığı bir kurulumda sahte kırmızı verirdi.
  const bosIstemci = {
    systemSetting: { findUnique: () => Promise.resolve(null) },
  } as unknown as Pick<typeof prisma, "systemSetting">;
  check(
    "§5 ⭐ Satır yokken devere KAPALI (dünkü davranış: devere yoktu)",
    (await readDevereEnabled(bosIstemci)) === false,
    "üretim modülünün 'satır yoksa TRUE' sigortası buraya KOPYALANMAZ",
  );

  // ── §6 ⭐ DEVERE MODELİNE DOKUNAN HER ROUTER KAPILI MI ────────────────────
  // Faz 1a'nın yüzeyi doğdu (çözgü kartı). Bundan sonra devere tablolarına
  // dokunan bir router kapısız doğarsa bu bölüm kırmızı verir — "modül kapalı"
  // cümlesi yalnız kapı TAKILI olduğu sürece doğrudur.
  const routerDizin = path.join(SRC, "routes");
  const routerlar = fs.readdirSync(routerDizin).filter((f) => f.endsWith(".ts"));
  check("§6a Körlük zemini: router dizini tarandı", routerlar.length >= 40, `n=${routerlar.length}`);

  /** Devere-ÖZEL Prisma model erişimcileri (Faz 1b'de `warpBeam`/`warpBeamEvent` eklenir). */
  const DEVERE_MODELLERI = ["warpSpec", "warpBeam", "warpBeamEvent"];
  const dokunanlar: string[] = [];
  const kapisizlar: string[] = [];
  /**
   * ALT YÖNLENDİRİCİ beyanı (Faz 3): dosya kapıyı KENDİ taşımaz, kapılı ana router'ın `router.use("/", …)`
   * ardındadır. Beyan ÖLÇÜLÜR: ana dosya kapıyı taşımalı VE alt dosyayı import edip `router.use` ile takmalı —
   * ikisi de yoksa alt dosya KAPISIZ sayılır (beyan bayatlarsa kırmızı).
   */
  const ALT_YONLENDIRICI: Record<string, string> = { "warp-beam-mount.routes.ts": "warp-beam.routes.ts" };
  const anaKapiliVeTakili = (alt: string, ana: string): boolean => {
    const anaMetin = yorumlariSok(fs.readFileSync(path.join(routerDizin, ana), "utf8"));
    const modul = alt.replace(/\.ts$/, "");
    const importAdi = new RegExp(`import\\s+(\\w+)\\s+from\\s+"\\./${modul.replace(/\./g, "\\.")}"`).exec(anaMetin)?.[1];
    return anaMetin.includes(KAPI) && !!importAdi && new RegExp(`router\\.use\\("/",\\s*${importAdi}\\)`).test(anaMetin);
  };
  for (const f of routerlar) {
    const metin = yorumlariSok(fs.readFileSync(path.join(routerDizin, f), "utf8"));
    const dokunuyor =
      DEVERE_MODELLERI.some((m) => new RegExp(`\\b(prisma|tx)\\.${m}\\b`).test(metin)) ||
      /WarpSpecService|warpSpecService|warp-beam(-wind|-mount|-consume)?\.service/.test(metin);
    if (!dokunuyor) continue;
    dokunanlar.push(f);
    const kapili = metin.includes(KAPI) || (ALT_YONLENDIRICI[f] !== undefined && anaKapiliVeTakili(f, ALT_YONLENDIRICI[f]));
    if (!kapili) kapisizlar.push(f);
  }
  check(
    "§6b Körlük zemini: devere yüzeyi BULUNDU (yoksa §6c vakumen yeşil kalırdı)",
    dokunanlar.length >= 1,
    dokunanlar.join(", ") || "devere router'ı yok — yüzey silindiyse bekçi daraltılmalı",
  );
  check(
    "§6c ⭐ Devere modeline dokunan HER router `requireDevereEnabled` taşıyor",
    kapisizlar.length === 0,
    kapisizlar.length === 0
      ? `${dokunanlar.length} router kapılı`
      : `KAPISIZ: ${kapisizlar.join(", ")}`,
  );
  check(
    "§6d Kapı ölü değil: middleware dışa aktarılmış",
    new RegExp(`export async function ${KAPI}`).test(kod),
  );

  // ── §7 ⭐ "KART AÇ" AKIŞI — fazın ilan ettiği çıktı GERÇEKTEN üretilebiliyor mu
  // §1–§6 METNE bakar; hiçbiri "bir çözgü kartı açılabiliyor mu" sorusunu
  // sormaz. Ölçüldü (2026-09-12 denetimi): kapı, route, izin ve ekran yeşilken
  // bile TEK KART açılamıyordu — iplik kaleminin denye alanının hiçbir YAZMA
  // yüzeyi yoktu, yani her deneme "denye boş" 400'üne düşüyordu. Statik bekçi
  // bunu göremez; akış bu yüzden burada.
  const damga = `TEST-DEVERE-${process.pid}`;
  let iplikId: string | null = null;
  let denyesizIplikId: string | null = null;
  let kartId: string | null = null;
  try {
    const iplik = await prisma.item.create({
      data: {
        code: `${damga}-IPL1`,
        name: `${damga}-IPLIK-DENYELI`,
        itemType: ItemType.YARN,
        unit: "KG",
        // Metin: Decimal kolona JS float yazmak yasak.
        linearDensityDen: "150",
      },
      select: { id: true },
    });
    iplikId = iplik.id;

    const sonuc = await warpSpecService.create({
      code: `${damga}-K1`,
      name: `${damga}-KART`,
      yarnItemId: iplikId,
      endsCount: 4200,
    });
    kartId = (sonuc as { data?: { id?: string } }).data?.id ?? null;
    check(
      "§7a ⭐ Denyeli iplikle çözgü kartı AÇILABİLİYOR (fazın ilan ettiği çıktı)",
      kartId !== null,
      kartId ?? "kart açılamadı — faz çıktısı üretilemiyor",
    );

    const denyesiz = await prisma.item.create({
      data: {
        code: `${damga}-IPL2`,
        name: `${damga}-IPLIK-DENYESIZ`,
        itemType: ItemType.YARN,
        unit: "KG",
      },
      select: { id: true },
    });
    denyesizIplikId = denyesiz.id;
    let reddedildi = false;
    let redMesaji = "";
    try {
      await warpSpecService.create({
        code: `${damga}-K2`,
        name: `${damga}-KART2`,
        yarnItemId: denyesizIplikId,
        endsCount: 100,
      });
    } catch (e) {
      reddedildi = true;
      redMesaji = (e as Error).message;
    }
    check(
      "§7b ⭐ Denyesiz iplikle kart AÇILAMIYOR (hata kart açılırken söylenir)",
      reddedildi,
      reddedildi ? redMesaji.slice(0, 80) : "denyesiz iplik kabul edildi — hesap sessizce 0 kg gösterirdi",
    );

    // §7c: red mesajı VAR OLAN bir yüzeye gönderiyor mu? "kalem kartından
    // denyeyi girin" cümlesi, o alan panelde çizilmiyorsa operatörü olmayan
    // bir kutuya yollar — denetimin ORTA-1'i tam olarak buydu.
    const FORM = path.resolve(__dirname, "../../Electron/src/pages/Items/ItemFormDialog.tsx");
    const formMetni = fs.existsSync(FORM) ? fs.readFileSync(FORM, "utf8") : "";
    const yuzeyVar = /linearDensityDen/.test(formMetni);
    check(
      "§7c ⭐ Denye red mesajının gönderdiği yüzey VAR (kalem formunda alan çizili)",
      yuzeyVar,
      !formMetni
        ? "ItemFormDialog okunamadı"
        : yuzeyVar
          ? "ItemFormDialog denye alanını taşıyor"
          : "ItemFormDialog'da denye alanı YOK — 'kalem kartından denyeyi girin' mesajı " +
            "operatörü hiç çizilmeyen bir kutuya gönderiyor",
    );
  } finally {
    if (kartId) await prisma.warpSpec.deleteMany({ where: { id: kartId } });
    for (const id of [iplikId, denyesizIplikId]) {
      if (id) await prisma.item.deleteMany({ where: { id } });
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("BEKÇİ ÇÖKTÜ:", e);
  await prisma.$disconnect();
  process.exit(1);
});
