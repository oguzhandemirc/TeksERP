// =============================================================================
// PUSH KÖPRÜSÜ ↔ BILDIRIM_KIPI AYRIMI (kullanıcı kararı 2026-11-13 "önce ayır, sonra aç"). Gerçek Expo YOK: Expo uçları
// süreç içi sahte HTTP sunucusudur (`EXPO_PUSH_URL`/`EXPO_MAKBUZ_URL` ona gösterilir; köprü kendi ExpoTransport'unu kullanır).
//   §1 ⭐ kapı tablosu: 3 kip × `BILDIRIM_NATIVE_PUSH` × belirteç; bulut kapısı açıkken köprü kapısı da açık (alt küme)
//   §2 açılış satırı: `kapali` + `acik` + belirteç → `birlesim=yalniz-kopru`; sır değeri satırda yok
//   §3 ⭐ kip `kapali` + `acik` + belirteç: dürt GERÇEK taşıyıcıya gider (sahte Expo isteği, yetki başlığı), bulut bildirim
//      işi KURULMAZ (çalışma zamanı null), `/api/bildirim/ayarlar` web push anahtarı null, bulut kipi telefon hedefi
//      (kayıtlı cihaz) Expo'ya HİÇ gitmez
//   §4 ⭐ makbuz döngüsü kip `kapali` iken koşar: `DeviceNotRegistered` → bağ geçersiz; sonraki dürt `gecersiz` + bağ silinir
//   §5 ⭐ kip `kapali` + bayrak kapalı → `gonderim:"kapali"`, Expo'ya istek yok · belirteç yok → kapalı
//   §6 kip `sahte` → köprü sahte (kayıtlı) taşıyıcı; Expo'ya istek yok · §7 kip `gercek` → bugünkü davranış
//   §8 ⭐ metin (sentinel), ham belirteç ve Expo erişim belirteci süreç günlüğünde YOK
//   §9 açılış bağlantısı (kaynak): server.ts makbuz döngüsünü koşulsuz başlatır + köprü satırını basar
// Koşum: npx tsx scripts/test_bildirim_koprusu_kip.ts   (kendi *_test DB'si)
// NEGATİF SONDA (2026-11-13, dosya kopyasıyla birebir geri alındı): N1 köprü kapısı yine `gercek` kip istedi ⇒ §1a · §2a
//   · §3a · §3b · §4a · §4b · N2 makbuz döngüsü bulut çalışma zamanına bağlandı ⇒ §4a · §4b · N3 `sahte` kip köprüyü
//   Expo'ya yolladı ⇒ §6a · N4 açılış satırına belirteç yazıldı ⇒ §2a · §2b · §8a · N5 server.ts döngüyü başlatmadı ⇒ §9a
// =============================================================================
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Client } from "pg";
import type { CloudConfig } from "../src/config";
import { BRIDGE_ONLY, bridgeGateState, bridgeGateSummary, nativePushState } from "../src/push/native-gate";
import { ExpoTransport, RecordingTransport } from "../src/push/transports";
import { createNotificationRuntime } from "../src/services/notification-scheduler";
import { bridgeTransport, tokenDigestOf } from "../src/services/push-bridge";
import { BridgeReceiptScheduler } from "../src/services/push-bridge-receipts";
import { cihazKaydet } from "./lib/bildirim-fikstur";
import { SATICI_ORTAMI, SENTINEL, belirtec, durt, gunlukYakala, kaydet, kurulum, sahteFetch, uretilenBelirtecler, veri, type SahteKurulum } from "./lib/kopru-ortam";
import { api, hesapKur, kontrol, ortamKur, PATRON_KOKU, sonuc, temizleTesis, tesisKur } from "./lib/test-ortam";

const gunluk = gunlukYakala();
const EXPO_BELIRTECI = `bekci-expo-erisim-${"x".repeat(24)}`;

interface SahteExpo {
  readonly adres: string;
  readonly gonderim: { yetkili: boolean; to: string[] }[];
  readonly makbuz: string[][];
  readonly olu: Set<string>;
  kapat(): Promise<void>;
}

/** Expo push + makbuz uçlarının sahtesi: her ileti için `bilet-<n>`; `olu`daki bilete makbuzda DeviceNotRegistered. */
async function sahteExpo(): Promise<SahteExpo> {
  const gonderim: SahteExpo["gonderim"] = [];
  const makbuz: string[][] = [];
  const olu = new Set<string>();
  let n = 0;
  const server = http.createServer((req, res) => {
    let ham = "";
    req.on("data", (c: Buffer) => (ham += c.toString("utf8")));
    req.on("end", () => {
      const govde = JSON.parse(ham) as unknown;
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/send") {
        const iletiler = govde as { to: string }[];
        gonderim.push({ yetkili: req.headers.authorization === `Bearer ${EXPO_BELIRTECI}`, to: iletiler.map((i) => i.to) });
        res.end(JSON.stringify({ data: iletiler.map(() => ({ status: "ok", id: `bilet-${++n}` })) }));
      } else {
        const ids = (govde as { ids: string[] }).ids;
        makbuz.push(ids);
        res.end(JSON.stringify({ data: Object.fromEntries(ids.map((id) => [id, olu.has(id) ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" }])) }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const adres = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { adres, gonderim, makbuz, olu, kapat: () => new Promise<void>((r) => server.close(() => r())) };
}

function kapiTablosu(): void {
  console.log("\n§1 kapı tablosu");
  const satirlar: string[] = [];
  let altKume = true;
  for (const kip of ["kapali", "sahte", "gercek"] as const) {
    for (const bayrak of ["kapali", "acik"] as const) {
      for (const tok of [undefined, EXPO_BELIRTECI]) {
        const c = { BILDIRIM_KIPI: kip, BILDIRIM_NATIVE_PUSH: bayrak, EXPO_ERISIM_BELIRTECI: tok } as CloudConfig;
        const k = bridgeGateState(c).kip;
        if (nativePushState(c).acik && k !== "gercek") altKume = false;
        satirlar.push(`${kip}/${bayrak}/${tok ? "B" : "-"}=${k}`);
      }
    }
  }
  const beklenen = ["kapali/kapali/-=kapali", "kapali/kapali/B=kapali", "kapali/acik/-=kapali", "kapali/acik/B=gercek", "sahte/kapali/-=sahte", "sahte/kapali/B=sahte",
    "sahte/acik/-=sahte", "sahte/acik/B=sahte", "gercek/kapali/-=kapali", "gercek/kapali/B=kapali", "gercek/acik/-=kapali", "gercek/acik/B=gercek"];
  kontrol("§1a ⭐ köprü kapısı: `acik` + belirteç → gerçek (kip `kapali` dahil); `sahte` kip → sahte; eksikse kapalı", JSON.stringify(satirlar) === JSON.stringify(beklenen), satirlar.join(" "));
  kontrol("§1b bulut kipi kapısı açıksa köprü de açık; bulut kapısı kip `kapali`da KAPALI", altKume && !nativePushState({ BILDIRIM_KIPI: "kapali", BILDIRIM_NATIVE_PUSH: "acik", EXPO_ERISIM_BELIRTECI: EXPO_BELIRTECI } as CloudConfig).acik);

  console.log("\n§2 açılış satırı");
  const satir = bridgeGateSummary({ BILDIRIM_KIPI: "kapali", BILDIRIM_NATIVE_PUSH: "acik", EXPO_ERISIM_BELIRTECI: EXPO_BELIRTECI } as CloudConfig);
  const eksik = bridgeGateSummary({ BILDIRIM_KIPI: "kapali", BILDIRIM_NATIVE_PUSH: "acik", EXPO_ERISIM_BELIRTECI: undefined } as CloudConfig);
  kontrol("§2a birleşim adlandırılır: `gonderim=gercek kip=kapali birlesim=yalniz-kopru`; eksik belirteçte ad + kapalı", satir === `PATRON_KOPRU gonderim=gercek kip=kapali birlesim=${BRIDGE_ONLY}` && eksik === "PATRON_KOPRU gonderim=kapali kip=kapali (EXPO_ERISIM_BELIRTECI yok)", `${satir} | ${eksik}`);
  kontrol("§2b sır değeri satırda yok", !satir.includes(EXPO_BELIRTECI));
}

function acilisBaglantisi(): void {
  console.log("\n§9 açılış bağlantısı");
  const kaynak = readFileSync(path.join(PATRON_KOKU, "src", "server.ts"), "utf8");
  const dongu = /const (\w+) = new BridgeReceiptScheduler\(ctx\);\s*\1\.start\(\);/.exec(kaynak);
  kontrol("§9a server.ts köprü makbuz döngüsünü kipten bağımsız başlatır, durdurur ve `bridgeGateSummary(config)` satırını basar",
    !!dongu && kaynak.includes(`${dongu[1]}.stop()`) && kaynak.includes("console.log(bridgeGateSummary(config))") && !/if \([^)]*\)\s*\{?\s*const \w+ = new BridgeReceiptScheduler/.test(kaynak));
}

async function main(): Promise<void> {
  kapiTablosu();
  acilisBaglantisi();
  const expo = await sahteExpo();
  const EXPO = { EXPO_PUSH_URL: `${expo.adres}/send`, EXPO_MAKBUZ_URL: `${expo.adres}/receipts` };
  const acikKopru = { ...SATICI_ORTAMI, ...EXPO, BILDIRIM_NATIVE_PUSH: "acik", EXPO_ERISIM_BELIRTECI: EXPO_BELIRTECI };
  const yk = await ortamKur({ ...acikKopru, BILDIRIM_KIPI: "kapali" }, sahteFetch);
  const goc = new Client({ connectionString: process.env.GOC_DATABASE_URL, options: "-c timezone=UTC" });
  await goc.connect();
  const baglar = async (id: string) => (await goc.query<{ invalidated_at: Date | null }>("SELECT invalidated_at FROM push_bridge_links WHERE kurulum_id = $1", [id])).rows;
  const kurulumlar: SahteKurulum[] = [];
  const yeni = () => (kurulumlar.push(kurulum()), kurulumlar.at(-1)!);
  const ortamlar = [yk];
  const tesis = await tesisKur(yk);
  try {
    console.log("\n§3 kip kapali + acik + belirteç (yalniz-kopru)");
    const hesap = await hesapKur(yk, tesis.tesisId, ["bulut:ozet:oku"]);
    const cihazTok = await cihazKaydet(yk, hesap);
    const k = yeni();
    const tok = belirtec();
    await kaydet(yk, k, [tokenDigestOf(tok)]);
    const r = await durt(yk, k, [tok]);
    const giden = expo.gonderim.at(-1);
    kontrol("§3a ⭐ dürt gerçek taşıyıcıya gider: `gonderim:acik`, GONDERILDI, sahte Expo yetki başlıklı isteği aldı",
      r.status === 200 && veri(r).gonderim === "acik" && veri(r).sonuclar[0]?.sonuc === "GONDERILDI" && expo.gonderim.length === 1 && giden?.yetkili === true && giden.to[0] === tok,
      `${JSON.stringify(veri(r).sonuclar)} expo=${expo.gonderim.length}`);
    kontrol("§3b ⭐ bulut bildirim işi KURULMAZ (çalışma zamanı null), köprü kendi ExpoTransport'u", yk.ctx.notifications === null && createNotificationRuntime(yk.ctx.config) === null && bridgeTransport(yk.ctx) instanceof ExpoTransport);
    const ayar = await api(yk, "GET", "/api/bildirim/ayarlar", { belirtec: hesap.belirtec });
    kontrol("§3c ⭐ web push ayar ucu kapalı der (`webPushAnahtari: null`)", ayar.status === 200 && (ayar.json.data as { webPushAnahtari?: unknown } | undefined)?.webPushAnahtari === null, `${ayar.status}`);
    kontrol("§3d ⭐ bulut kipi telefon hedefi (kayıtlı cihaz) Expo'ya gitmez; bulut kapısı kapalı",
      !nativePushState(yk.ctx.config).acik && expo.gonderim.every((g) => !g.to.includes(cihazTok)), `${expo.gonderim.length} istek`);

    console.log("\n§4 makbuz döngüsü (kip kapali)");
    const makbuzOnce = expo.makbuz.length;
    expo.olu.add(`bilet-1`);
    await new BridgeReceiptScheduler(yk.ctx).runOnce(yk.saat.simdi() + 16 * 60_000);
    const isaret = (await baglar(k.kurulumId))[0];
    kontrol("§4a ⭐ makbuz turu kip `kapali` iken koştu (sahte Expo makbuz isteği aldı), bağ geçersiz işaretlendi",
      expo.makbuz.length === makbuzOnce + 1 && isaret?.invalidated_at instanceof Date, `makbuz=${expo.makbuz.length - makbuzOnce}`);
    const gonderimOnce = expo.gonderim.length;
    const sonra = await durt(yk, k, [tok]);
    kontrol("§4b sonraki dürt `gecersiz`te döner, Expo'ya gitmez, bağ silinir",
      veri(sonra).gecersiz.includes(tokenDigestOf(tok)) && expo.gonderim.length === gonderimOnce && (await baglar(k.kurulumId)).length === 0, JSON.stringify(veri(sonra)));

    console.log("\n§5 kapalı birleşimler");
    for (const [ad, ek] of [["bayrak kapalı", { BILDIRIM_NATIVE_PUSH: "kapali" }], ["belirteç yok", { EXPO_ERISIM_BELIRTECI: "" }]] as const) {
      const env: Record<string, string> = { ...acikKopru, BILDIRIM_KIPI: "kapali", ...ek };
      if (env.EXPO_ERISIM_BELIRTECI === "") delete env.EXPO_ERISIM_BELIRTECI;
      const o = await ortamKur(env, sahteFetch);
      ortamlar.push(o);
      const kk = yeni();
      const t = belirtec();
      await kaydet(o, kk, [tokenDigestOf(t)]);
      const once = expo.gonderim.length;
      const d = await durt(o, kk, [t]);
      kontrol(`§5 ⭐ kip kapali + ${ad} → \`gonderim:kapali\`, KAPALI, Expo'ya istek yok`, d.status === 200 && veri(d).gonderim === "kapali" && veri(d).sonuclar[0]?.sonuc === "KAPALI" && expo.gonderim.length === once, JSON.stringify(veri(d)));
    }

    console.log("\n§6 sahte kip");
    const sh = await ortamKur({ ...acikKopru, BILDIRIM_KIPI: "sahte" }, sahteFetch);
    ortamlar.push(sh);
    const ks = yeni();
    const ts = belirtec();
    await kaydet(sh, ks, [tokenDigestOf(ts)]);
    const onceS = expo.gonderim.length;
    const ds = await durt(sh, ks, [ts]);
    const kayitli = sh.ctx.notifications?.transport;
    kontrol("§6a ⭐ `sahte` kip (+ acik + belirteç) → köprü kayıtlı sahte taşıyıcı, Expo'ya istek yok",
      kayitli instanceof RecordingTransport && bridgeTransport(sh.ctx) === kayitli && kayitli.bridgeSent.some((x) => x.token === ts) && veri(ds).gonderim === "acik" && expo.gonderim.length === onceS);

    console.log("\n§7 gercek kip (bugünkü davranış)");
    const gr = await ortamKur({ ...acikKopru, BILDIRIM_KIPI: "gercek", BILDIRIM_VAPID_KONU: "mailto:bekci@ornek.invalid" }, sahteFetch);
    const grKapali = await ortamKur({ ...acikKopru, BILDIRIM_KIPI: "gercek", BILDIRIM_VAPID_KONU: "mailto:bekci@ornek.invalid", BILDIRIM_NATIVE_PUSH: "kapali" }, sahteFetch);
    ortamlar.push(gr, grKapali);
    kontrol("§7a `gercek` + acik + belirteç → bulut işi kurulur (web push anahtarı var), bulut kapısı + köprü Expo",
      !!gr.ctx.notifications?.webPushKey && nativePushState(gr.ctx.config).acik && bridgeTransport(gr.ctx) instanceof ExpoTransport);
    kontrol("§7b `gercek` + bayrak kapalı → köprü kapalı (bugünkü gibi)", bridgeTransport(grKapali.ctx) === null && !nativePushState(grKapali.ctx.config).acik);

    console.log("\n§8 günlük");
    const sizinti = gunluk.filter((l) => l.includes(SENTINEL) || l.includes(EXPO_BELIRTECI) || uretilenBelirtecler.some((b) => l.includes(b)));
    kontrol("§8a ⭐ sentinel, ham belirteç ve Expo erişim belirteci süreç günlüğünde yok", sizinti.length === 0, `${gunluk.length} satır tarandı`);
    kontrol("§8b ✓K sonda: günlük yakalama çalışıyor (köprü yolu günlükte)", gunluk.some((l) => l.includes("/v1/bildirim/durt")));
  } finally {
    for (const t of ["push_bridge_links", "push_bridge_tickets", "push_bridge_nonces"]) {
      for (const k of kurulumlar) await goc.query(`DELETE FROM ${t} WHERE kurulum_id = $1`, [k.kurulumId]).catch(() => undefined);
    }
    await temizleTesis(yk, tesis.tesisId).catch(() => undefined);
    await goc.end();
    for (const o of ortamlar) await o.kapat();
    await expo.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
