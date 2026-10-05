// =============================================================================
// Test: mDNS servis ilanı — fail-open + kapanış sözleşmesi (2026-08-26)
// Çalıştır: npx tsx scripts/test_discovery_advertiser.ts
// =============================================================================
// NEDEN: bu modülün iki sözü var ve ikisi de kırıldığında SESSİZ değil, YIKICI:
//
//  1) FAIL-OPEN. `bonjour-service` 1.4.4'te `new Bonjour(opts)` — yani ikinci
//     parametre VERİLMEZSE — bind hatasında varsayılan davranış
//     `function (err) { throw err; }` olur (ölçüldü: dist/lib/mdns-server.js:16).
//     Windows'ta 5353 portunu Apple Bonjour Service / Adobe / Windows'un kendi
//     yanıtlayıcısı tutabilir. O ikinci parametreyi silen bir "sadeleştirme"
//     FABRİKANIN BACKEND'İNİ DÜŞÜRÜR. Bu bekçi hem parametrenin kaynakta
//     durduğunu hem de modül yüklenemediğinde sürecin ayakta kaldığını ölçer.
//
//  2) KAPANIŞ KAPISI. `stopMdnsAdvertiser` asla asılı kalmamalı: `server.ts`'in
//     5 sn'lik zorla-çıkış sayacı işliyor ve pm2 Windows'ta `kill_timeout` sonrası
//     HARD KILL eder. Geri çağrısını hiç çağırmayan bir kütüphaneyle bile
//     dönmek zorunda.
//
// Körlük zemini: modülün dışa açtığı semboller gerçekten fonksiyon olmalı —
// yeniden adlandırma yüzünden tüm dosya boş yere yeşile çıkmasın.
//
// NEGATİF SINAMA KAYDI (2026-08-26) — dosyalar sonra birebir geri yüklendi:
//   • constructor tek argümana indirildi (`new BonjourCtor({} as never)`)
//       → §1c KIRMIZI (22/1). GERÇEK ihlal yakalanıyor.
//   • callback adlandırılmış fonksiyona çıkarıldı (meşru düzenleme)
//       → §1c YEŞİL (23/0). HAKSIZ kırmızı vermiyor — bu ikinci ölçüm birincisi
//         kadar önemli: haksız kırmızı veren bekçi gevşetilir, gevşetilince
//         gerçek ihlali de kaçırır.
//   • `stopMdnsAdvertiser`ın iç kapısı (setTimeout) kaldırıldı
//       → test ASILI kaldı, "Sonuç" satırı hiç basılmadı (SIGALRM/142). Kapı
//         load-bearing.
//   §5 (adres süzgeci, 2026-10-05): kablolama söküldü → §5e 1 ❌ · `lanExclusionOf`
//   hep null → 14 ❌ · fallback satırı silindi → §5c 1 ❌; geri yüklenince 52/0.
// =============================================================================
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  startMdnsAdvertiser,
  stopMdnsAdvertiser,
  getMdnsState,
  __resetMdnsStateForTests,
  installAddressFilter,
  MDNS_SERVICE_TYPE,
} from "../src/jobs/mdns-advertiser.job";
import {
  lanExclusionOf,
  partitionLanAddresses,
  filterAdvertisedRecords,
  getLanAddresses,
} from "../src/lib/lan-addresses";
import type { NetworkInterfaceInfo } from "os";
import {
  buildAdvertisedTxt,
  encodedTxtLength,
  TXT_BUDGET_BYTES,
} from "../src/lib/discovery-txt";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const SRC = resolve(__dirname, "../src");

/**
 * ⚠️ EVENT LOOP TUTAMACI — SİLME.
 *
 * `whenIdentityReady`ın iç sayacı `.unref()`lidir ve bu SUNUCUDA doğrudur
 * (kimlik beklemesi kapanan bir prosesi bekletmemeli). Ama bir script'te loop'u
 * tutan başka bir şey yoksa Node, awaited promise çözülmeden ÇIKAR ve test
 * **sessizce `exit 0`** verir. Bu bekçinin ilk koşumunda tam olarak bu oldu:
 * §3b'den sonrası hiç koşmadı, çıkış kodu 0'dı, yani yeşil göründü.
 *
 * Ref'li tutamak bunu imkânsız kılar: iş biterse temizlenir; bitmezse koşucunun
 * 180sn zaman aşımına düşer — yani "sessiz yeşil" yerine GÖRÜNÜR kırmızı.
 */
const keepAlive = setInterval(() => {}, 1000);

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // §0 — Körlük zemini
  // ---------------------------------------------------------------------
  check(
    "§0 modül sembolleri duruyor",
    typeof startMdnsAdvertiser === "function" &&
      typeof stopMdnsAdvertiser === "function" &&
      typeof getMdnsState === "function",
    `tip: ${MDNS_SERVICE_TYPE}`,
  );

  // ---------------------------------------------------------------------
  // §1 — Fail-open
  // ---------------------------------------------------------------------
  // 1a) Bayrak kapalıyken HİÇ soket açılmaz.
  __resetMdnsStateForTests();
  process.env.DISCOVERY_MDNS_ENABLED = "false";
  let loaderCalled = false;
  const disabled = await startMdnsAdvertiser({
    loader: () => {
      loaderCalled = true;
      return {};
    },
  });
  check(
    "§1a bayrak kapalıyken ilan kurulmuyor",
    disabled.active === false && disabled.reason === "disabled",
    `${disabled.reason}`,
  );
  check("§1a bayrak kapalıyken modül YÜKLENMİYOR bile", loaderCalled === false);

  // 1b) Modül yüklenemezse süreç AYAKTA kalır ve durum "module-missing" olur.
  delete process.env.DISCOVERY_MDNS_ENABLED;
  __resetMdnsStateForTests();
  const broken = await startMdnsAdvertiser({
    loader: () => {
      throw new Error("MODULE_NOT_FOUND: bonjour-service");
    },
    identityWaitMs: 10,
  });
  check(
    "§1b modül yüklenemedi → active:false, reason:module-missing",
    broken.active === false && broken.reason === "module-missing",
    `${broken.reason}: ${broken.error ?? ""}`,
  );
  check("§1b ...ve SÜREÇ AYAKTA (throw etmedi)", true, "buraya ulaşıldı");

  // 1c) Kaynakta errorCallback parametresi DURUYOR (fail-open'ın taşıyıcısı).
  const jobSrc = readFileSync(resolve(SRC, "jobs/mdns-advertiser.job.ts"), "utf8");
  check(
    "§1c körlük zemini: iş dosyası okundu",
    jobSrc.length > 1000,
    `${jobSrc.length} bayt`,
  );
  // İddia "ikinci argüman VAR" — inline arrow mı, adlandırılmış fonksiyon mu
  // önemli değil. Daha dar bir kalıp (`({}, (`) callback'i bir değişkene çıkaran
  // meşru bir düzenlemede haksız kırmızı verir; haksız kırmızı veren bekçi
  // gevşetilir ve gevşetilince gerçek ihlali de kaçırır.
  check(
    "§1c `new BonjourCtor(...)` İKİNCİ argümanla çağrılıyor (hata geri-çağrısı)",
    /new\s+BonjourCtor\s*\(\s*\{[^}]*\}\s*,/.test(jobSrc),
    "ikinci argüman yerinde",
  );
  // Kütüphanenin varsayılanının gerçekten `throw` olduğunu da kilitle — bu
  // varsayım değişirse yukarıdaki kontrolün GEREKÇESİ düşer, kendisi değil.
  const libSrc = readFileSync(
    resolve(__dirname, "../node_modules/bonjour-service/dist/lib/mdns-server.js"),
    "utf8",
  );
  check(
    "§1d kütüphanenin varsayılan hata davranışı HÂLÂ `throw` (gerekçe geçerli)",
    /errorCallback\s*!==\s*null[\s\S]{0,120}throw\s+err/.test(libSrc),
    "varsayılan: throw err",
  );

  // 1e) Yükleyici geçerli ama sınıf değilse de düşmez.
  __resetMdnsStateForTests();
  const notAClass = await startMdnsAdvertiser({
    loader: () => ({ Bonjour: "bu bir sınıf değil" }),
    identityWaitMs: 10,
  });
  check(
    "§1e yükleyici saçma değer döndürdü → yine fail-open",
    notAClass.active === false && notAClass.reason === "module-missing",
    notAClass.reason,
  );

  // ---------------------------------------------------------------------
  // §2 — TXT bütçesi: kırpar, ASLA throw etmez
  // ---------------------------------------------------------------------
  const normal = buildAdvertisedTxt({
    discoveryVersion: 1,
    installationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    serverName: "SAHINSRV",
    companyName: "Adnan Şahin Tekstil",
    version: "2.9.0",
    apiBasePath: "/api",
  });
  check(
    "§2 normal girdi bütçenin altında",
    encodedTxtLength(normal) <= TXT_BUDGET_BYTES,
    `${encodedTxtLength(normal)}/${TXT_BUDGET_BYTES} bayt`,
  );
  check("§2 kimlik verilince `iid` alanı var", normal.iid !== undefined);

  const noId = buildAdvertisedTxt({
    discoveryVersion: 1,
    installationId: null,
    serverName: "SAHINSRV",
    companyName: "Adnan Şahin Tekstil",
    version: "2.9.0",
    apiBasePath: "/api",
  });
  // Boş string DEĞİL, alanın HİÇ olmaması gerekiyor: istemci "kimlik yok" ile
  // "kimlik var ama boş" ayrımını buradan yapıyor.
  check(
    "§2 kimlik yokken `iid` alanı HİÇ YOK (boş string değil)",
    !("iid" in noId),
    JSON.stringify(noId),
  );

  let threw = false;
  let huge = normal;
  try {
    huge = buildAdvertisedTxt({
      discoveryVersion: 1,
      installationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      serverName: "S".repeat(500),
      companyName: "Ç".repeat(5000),
      version: "2.9.0",
      apiBasePath: "/api",
    });
  } catch {
    threw = true;
  }
  check("§2 devasa girdi THROW ETMEDİ (ilan hiç yapılmamaktansa kırpılır)", !threw);
  check(
    "§2 devasa girdi bütçeye KIRPILDI",
    encodedTxtLength(huge) <= TXT_BUDGET_BYTES,
    `${encodedTxtLength(huge)}/${TXT_BUDGET_BYTES} bayt`,
  );
  check(
    "§2 kırpma sonrası kimlik KORUNDU (ayırt edici alan feda edilmedi)",
    huge.iid === "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    String(huge.iid),
  );

  // ---------------------------------------------------------------------
  // §3 — Kapanış kapısı
  // ---------------------------------------------------------------------
  // 3a) Hiç başlamamışken de döner.
  __resetMdnsStateForTests();
  const t0 = Date.now();
  await stopMdnsAdvertiser();
  check("§3a hiç başlamamışken stop() anında döner", Date.now() - t0 < 200, `${Date.now() - t0} ms`);

  // 3b) Geri çağrısını HİÇ çağırmayan sahte kütüphaneyle bile kapı içinde döner.
  __resetMdnsStateForTests();
  const started = await startMdnsAdvertiser({
    loader: () => ({
      Bonjour: class {
        publish(): { updateTxt: () => void } {
          return { updateTxt: () => {} };
        }
        // Bilerek SESSİZ: geri çağrı asla çağrılmıyor.
        unpublishAll(): void {}
        destroy(): void {}
      },
    }),
    identityWaitMs: 10,
  });
  check("§3b sahte kütüphaneyle ilan kuruldu", started.active === true, started.reason);

  const t1 = Date.now();
  await stopMdnsAdvertiser();
  const elapsed = Date.now() - t1;
  check(
    "§3b geri çağrısı gelmeyen kütüphanede bile stop() <=1200ms'de döner",
    elapsed <= 1200,
    `${elapsed} ms`,
  );
  check("§3b stop sonrası durum active:false", getMdnsState().active === false);

  // ---------------------------------------------------------------------
  // §4 — Kapanış KABLOLAMASI (server.ts kaynağı)
  // ---------------------------------------------------------------------
  const serverSrc = readFileSync(resolve(SRC, "server.ts"), "utf8");
  check("§4 körlük zemini: server.ts okundu", serverSrc.length > 2000, `${serverSrc.length} bayt`);
  const shutdownAt = serverSrc.indexOf("function gracefulShutdown");
  const closeAt = serverSrc.indexOf("server.close(", shutdownAt);
  const stopAt = serverSrc.indexOf("stopMdnsAdvertiser()", shutdownAt);
  check(
    "§4 körlük zemini: gracefulShutdown bloğu bulundu",
    shutdownAt > 0 && closeAt > shutdownAt,
    `shutdown@${shutdownAt}, close@${closeAt}`,
  );
  check(
    "§4 stopMdnsAdvertiser gracefulShutdown İÇİNDE ve server.close'dan ÖNCE",
    stopAt > shutdownAt && stopAt < closeAt,
    `stop@${stopAt}`,
  );
  check(
    "§4 ilan açılışta başlatılıyor",
    /startMdnsAdvertiser\(\s*\{/.test(serverSrc),
    "startMdnsAdvertiser({ port })",
  );

  // ---------------------------------------------------------------------
  // §5 — İlan yalnız kullanılabilir adresleri taşır (sanal / kendi kendine atanmış elenir)
  // ---------------------------------------------------------------------
  const elenir: Array<[string, string, string]> = [
    ["Ethernet 2", "169.254.12.7", "link-local"],
    ["Ethernet", "fe80::1c2b:3a4d:5e6f:7081", "link-local"],
    ["vEthernet (Default Switch)", "172.20.144.1", "virtual-adapter"],
    ["vEthernet (WSL (Hyper-V firewall))", "172.29.0.1", "virtual-adapter"],
    ["VirtualBox Host-Only Network", "192.168.56.1", "virtual-adapter"],
    ["VMware Network Adapter VMnet8", "192.168.150.1", "virtual-adapter"],
    ["docker0", "172.17.0.1", "virtual-adapter"],
    ["Tailscale", "100.101.102.103", "virtual-adapter"],
    ["utun8", "100.102.98.100", "virtual-adapter"],
    ["ZeroTier One [8056c2e21c000001]", "10.147.17.5", "virtual-adapter"],
  ];
  for (const [iface, addr, beklenen] of elenir) {
    check(`§5a ${iface} ${addr} → ${beklenen}`, lanExclusionOf(iface, addr) === beklenen, String(lanExclusionOf(iface, addr)));
  }
  const kalir: Array<[string, string]> = [
    ["Ethernet", "192.168.1.10"],
    ["Wi-Fi", "10.0.0.5"],
    ["vEthernet (Harici Anahtar)", "192.168.1.20"],
    ["eth0", "172.17.0.2"],
    ["en0", "fd12:3456:789a::1"],
    ["utun3", "10.8.0.2"],
    ["Ethernet", "100.64.0.9"],
  ];
  for (const [iface, addr] of kalir) {
    check(`§5a ${iface} ${addr} DUYURULUR (haksız eleme yok)`, lanExclusionOf(iface, addr) === null, String(lanExclusionOf(iface, addr)));
  }

  const nic = (address: string, family: "IPv4" | "IPv6", internal = false): NetworkInterfaceInfo =>
    ({ address, family, internal, netmask: family === "IPv4" ? "255.255.255.0" : "ffff:ffff:ffff:ffff::", mac: "00:15:5d:01:02:03", cidr: null, ...(family === "IPv6" ? { scopeid: 0 } : {}) }) as NetworkInterfaceInfo;
  const sunucuKartlari = {
    Ethernet: [nic("192.168.1.10", "IPv4"), nic("fe80::1", "IPv6")],
    "Ethernet 2": [nic("169.254.12.7", "IPv4")],
    "vEthernet (Default Switch)": [nic("172.20.144.1", "IPv4")],
    Tailscale: [nic("100.101.102.103", "IPv4")],
    "Loopback Pseudo-Interface 1": [nic("127.0.0.1", "IPv4", true)],
  };
  const kayit = (type: string, data: string) => ({ name: "x.local", type, ttl: 120, data });
  const tumKayitlar = [
    kayit("PTR", "TeksERP._teks-erp._tcp.local"),
    kayit("SRV", "srv"),
    kayit("TXT", "txt"),
    kayit("A", "192.168.1.10"),
    kayit("AAAA", "fe80::1"),
    kayit("A", "169.254.12.7"),
    kayit("A", "172.20.144.1"),
    kayit("A", "100.101.102.103"),
  ];
  const suzulmus = filterAdvertisedRecords(tumKayitlar, sunucuKartlari);
  const aKayitlari = suzulmus.filter((r) => r.type === "A" || r.type === "AAAA").map((r) => r.data);
  check("§5b ilan yalnız gerçek LAN adresini taşır", JSON.stringify(aKayitlari) === JSON.stringify(["192.168.1.10"]), JSON.stringify(aKayitlari));
  check(
    "§5b adres dışı kayıtlar (PTR/SRV/TXT) dokunulmadan kalır",
    ["PTR", "SRV", "TXT"].every((t) => suzulmus.some((r) => r.type === t)),
  );

  const yalnizSanal = {
    "vEthernet (Default Switch)": [nic("172.20.144.1", "IPv4")],
    "Ethernet 2": [nic("169.254.12.7", "IPv4")],
  };
  const sanalKayitlar = [kayit("SRV", "srv"), kayit("A", "172.20.144.1"), kayit("A", "169.254.12.7")];
  check(
    "§5c eleme hiç adres bırakmazsa ilan DEĞİŞMEZ (keşif bugünkünden kötüye gitmez)",
    filterAdvertisedRecords(sanalKayitlar, yalnizSanal) === sanalKayitlar,
  );
  const bolum = partitionLanAddresses(getLanAddresses(sunucuKartlari));
  check(
    "§5d banner bölümü: bir duyurulan, üç duyurulmayan",
    bolum.usable.length === 1 && bolum.usable[0]?.address === "192.168.1.10" && bolum.excluded.length === 3 && !bolum.fallback,
    JSON.stringify(bolum.usable.map((u) => u.address)),
  );
  const bolumSanal = partitionLanAddresses(getLanAddresses(yalnizSanal));
  check("§5d yalnız sanal kartta banner bütün listeyi gösterir (fallback)", bolumSanal.fallback && bolumSanal.usable.length === 2);

  // 5e) Kablolama: ilan kurulurken yayınlanan servisin records()'u SARILIR.
  __resetMdnsStateForTests();
  const hamRecords = (): typeof tumKayitlar => tumKayitlar;
  const servis: { updateTxt: () => void; records: () => typeof tumKayitlar } = { updateTxt: () => {}, records: hamRecords };
  const wired = await startMdnsAdvertiser({
    loader: () => ({
      Bonjour: class {
        publish(): typeof servis {
          return servis;
        }
        unpublishAll(cb?: () => void): void {
          cb?.();
        }
        destroy(cb?: () => void): void {
          cb?.();
        }
      },
    }),
    identityWaitMs: 10,
  });
  check("§5e sahte kütüphaneyle ilan kuruldu", wired.active === true, wired.reason);
  check("§5e startMdnsAdvertiser yayınlanan servisin records()'unu sardı", servis.records !== hamRecords);
  await stopMdnsAdvertiser();

  const sarilacak: { records: () => typeof tumKayitlar } = { records: hamRecords };
  check("§5e süzgeç enjekte kartlarla takıldı", installAddressFilter(sarilacak, () => sunucuKartlari));
  check(
    "§5e sarılmış records() yalnız LAN adresini döner",
    JSON.stringify(sarilacak.records().filter((r) => r.type === "A").map((r) => r.data)) === JSON.stringify(["192.168.1.10"]),
  );
  check("§5e records'u olmayan servis → false (ilan elemesiz sürer, düşmez)", installAddressFilter({}) === false);

  // 5f) Gerçek kütüphane: kayıtlar publish DÖNDÜKTEN SONRA okunur — sarma ilk duyuruya yetişir.
  const { Registry } = require("bonjour-service/dist/lib/registry") as {
    Registry: new (server: unknown) => { publish(c: { name: string; type: string; port: number }): { records?: unknown; destroyed: boolean; activated: boolean } };
  };
  let registerCalls = 0;
  const sahteSunucu = {
    mdns: { query: () => {}, on: () => {}, removeListener: () => {}, respond: () => {} },
    register: () => {
      registerCalls++;
    },
    unregister: () => {},
  };
  const reg = new Registry(sahteSunucu);
  const gercekServis = reg.publish({ name: "bekci", type: MDNS_SERVICE_TYPE, port: 4999 });
  check("§5f gerçek kütüphanede records() bir örnek metodu (sarılabilir)", typeof gercekServis.records === "function");
  check("§5f publish döndüğünde kayıtlar HENÜZ okunup kaydedilmedi (yoklama asenkron)", registerCalls === 0, `register×${registerCalls}`);
  gercekServis.destroyed = true;
  gercekServis.activated = false;

  clearInterval(keepAlive);
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
