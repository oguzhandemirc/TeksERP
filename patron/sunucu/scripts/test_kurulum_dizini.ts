// =============================================================================
// KURULUM DİZİNİ BEKÇİSİ — `KURULUM_KAYNAGI=satici` (satıcı iç API'si + önbellek), SAHTE satıcıya karşı:
//   §1 önbellek HİÇ dolmadı + satıcıya ulaşılamıyor → RED (401 KURULUM_BILINMIYOR; fail-closed)
//   §2 satıcı yanıtı → yönlendirme bağı + tesis DB isteği (hazır değilken 503) → kurulum + tesis önbelleğe yazılır (kaynak SATICI), istek 200; iç API belirteci taşınır
//   §3 TTL içinde satıcı sorulmaz · §4 TTL doldu + satıcı yok → BAYAT kayıtla devam (tazelik ≠ geçerlilik)
//   §5 satıcı yanıtı sözleşme dışı → bayat kayıt (yanıt kaydı EZMEZ) · §6 satıcı 404 → kayıt pasif, RED
//   §7 satıcı sınıfı TEST derse 403 SINIF_GONDEREMEZ (hak satıcıdan)
//   §8 zil: gelen kutusu yazımı satıcı iç API'sine {tesisId, konu} bildirir (içerik TAŞIMAZ)
//   §9 B5s sıra imza → hak → DB: yabancı imza ya da hakkı olmayan kurulum yönlendirme bağı / tesis DB isteği DOĞURMAZ;
//      satıcının "yok"u hatırlanır (aynı kimlik ikinci kez sorulmaz); önbellekte olmayan kimliğe soru dakikalık bütçeyle sınırlı
// Koşum: npx tsx scripts/test_kurulum_dizini.ts
// =============================================================================
import { generateKeyPairSync, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { publicKeyX } from "../src/lisans-protokol";
import { withCentral, withTesis } from "../src/lib/tenant";
import { VendorDoorbell } from "../src/services/doorbell";
import { InstallationDirectory } from "../src/services/installation-directory";
import { api, hesapKur, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisDbHazirla } from "./lib/test-ortam";

const BELIRTEC = "bekci-ic-api-belirteci-" + "x".repeat(24);

interface Sahte {
  mod: "kapali" | "acik" | "yok" | "bozuk" | "yansit";
  /** `yansit` kipi: istenen kimliği bu tesis/anahtar/modüllerle tanır. */
  yansit: { tesisId: string; x: string; moduller: string[] };
  sinif: string;
  cagri: number;
  zil: { tesisId?: string; konu?: string; yetki?: string }[];
  yetkiler: string[];
}

async function main(): Promise<void> {
  const tesisId = randomUUID();
  const kurulumId = randomUUID();
  const { privateKey } = generateKeyPairSync("ed25519");
  const x = publicKeyX(privateKey);
  const ikinci = generateKeyPairSync("ed25519").privateKey;
  const s: Sahte = { mod: "kapali", yansit: { tesisId: randomUUID(), x: publicKeyX(ikinci), moduller: [] }, sinif: "URETIM", cagri: 0, zil: [], yetkiler: [] };
  const sunucu = http.createServer((req, res) => {
    let govde = "";
    req.on("data", (d: Buffer) => (govde += d.toString()));
    req.on("end", () => {
      if (req.url === "/ic/v1/zil") {
        s.zil.push({ ...(JSON.parse(govde) as { tesisId: string; konu: string }), yetki: req.headers.authorization });
        res.writeHead(204).end();
        return;
      }
      s.cagri++;
      s.yetkiler.push(req.headers.authorization ?? "");
      if (s.mod === "kapali") return void res.writeHead(502).end();
      if (s.mod === "yok") return void res.writeHead(404).end();
      if (s.mod === "yansit") {
        const id = decodeURIComponent((req.url ?? "").split("/").at(-1) ?? "");
        const y = { v: 1, kurulumId: id, tesis: { id: s.yansit.tesisId, ad: "Yansıtılan Tesis" }, acikAnahtar: s.yansit.x, sinif: "URETIM", moduller: s.yansit.moduller, patronBulutBitis: new Date(Date.now() + 86_400_000).toISOString(), devredildi: false, aktif: true };
        return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(y));
      }
      if (s.mod === "bozuk") return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ v: 1, kurulumId }));
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          v: 1,
          kurulumId,
          tesis: { id: tesisId, ad: "Satıcıdan Gelen Tesis" },
          acikAnahtar: x,
          sinif: s.sinif,
          moduller: ["production.enabled", "patron-bulut"],
          patronBulutBitis: new Date(Date.now() + 90 * 86_400_000).toISOString(),
          devredildi: false,
          aktif: true,
          saklamaAy: 25,
        }),
      );
    });
  });
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`;
  const o = await ortamKur({ KURULUM_KAYNAGI: "satici", SATICI_IC_API_URL: url, SATICI_IC_API_BELIRTECI: BELIRTEC, KURULUM_ONBELLEK_DK: "5" }, undefined, new VendorDoorbell(url, BELIRTEC));
  const k = { kurulumId, privateKey };
  const gonder = () => imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(o.saat.simdi() - 5_000) }) });
  try {
    console.log("\n§1 önbellek hiç dolmadı + satıcı yok");
    const r1 = await gonder();
    kontrol("§1a RED 401 KURULUM_BILINMIYOR (fail-closed)", r1.status === 401 && r1.json.details?.code === "KURULUM_BILINMIYOR", `${r1.status}`);

    console.log("\n§2 satıcı yanıt veriyor");
    s.mod = "acik";
    // Bilinmeyen tesis: satıcı yanıtı yönlendirmeyi bağlar + tesis DB'sini İSTER; hazırlanana dek 503 (merkeze düşmez).
    const r2a = await gonder();
    const istek = await withCentral(o.goc, {}, (tx) => tx.facilityDatabase.findUnique({ where: { tesisId } }));
    const bag = await withCentral(o.goc, {}, (tx) => tx.installationRoute.findUnique({ where: { installationId: kurulumId } }));
    kontrol("§2-a tesis DB'si yokken 503 TEKRAR_DENEYIN · hazırlık isteği ISTENDI · kurulum → tesis bağı merkezde", r2a.status === 503 && r2a.json.details?.code === "TEKRAR_DENEYIN" && istek?.status === "ISTENDI" && bag?.tesisId === tesisId, `${r2a.status} ${istek?.status ?? "-"}`);
    await tesisDbHazirla(o, tesisId);
    const r2 = await gonder();
    const kayit = await withTesis(o.goc, { tesisId }, async (tx) => ({
      kurulum: await tx.installation.findUnique({ where: { installationId: kurulumId } }),
      tesis: await tx.facility.findUnique({ where: { tesisId } }),
    }));
    kontrol("§2a istek 200", r2.status === 200, `${r2.status} ${r2.json.message ?? ""}`);
    kontrol("§2b kurulum önbellekte (kaynak SATICI) + tesis adı/saklama satıcıdan", kayit.kurulum?.source === "SATICI" && kayit.tesis?.name === "Satıcıdan Gelen Tesis" && kayit.tesis?.retentionMonths === 25);
    kontrol("§2c iç API isteği Bearer belirteç taşır", s.yetkiler.at(-1) === `Bearer ${BELIRTEC}`);

    console.log("\n§3 TTL içinde satıcı sorulmaz");
    s.mod = "kapali";
    const once = s.cagri;
    o.saat.ilerlet(60_000);
    const r3 = await gonder();
    kontrol("§3a satıcı kapalıyken TTL içinde 200 ve satıcıya ÇAĞRI YOK", r3.status === 200 && s.cagri === once);

    console.log("\n§4 TTL doldu + satıcı yok → bayat kayıt");
    o.saat.ilerlet(6 * 60_000);
    const r4 = await gonder();
    kontrol("§4a bayat kayıtla 200 (satıcı soruldu, ulaşılamadı)", r4.status === 200 && s.cagri === once + 1);

    console.log("\n§5 sözleşme dışı satıcı yanıtı");
    s.mod = "bozuk";
    o.saat.ilerlet(6 * 60_000);
    const r5 = await gonder();
    const hala = await withTesis(o.goc, { tesisId }, (tx) => tx.installation.findUnique({ where: { installationId: kurulumId } }));
    kontrol("§5a biçimsiz yanıt kaydı EZMEZ; bayat kayıtla 200", r5.status === 200 && hala?.publicKeyX === x);

    console.log("\n§7 satıcı sınıfı TEST");
    s.mod = "acik";
    s.sinif = "TEST";
    o.saat.ilerlet(6 * 60_000);
    const r7 = await gonder();
    kontrol("§7a hak satıcıdan: TEST → 403 SINIF_GONDEREMEZ", r7.status === 403 && r7.json.details?.code === "SINIF_GONDEREMEZ");
    s.sinif = "URETIM";
    o.saat.ilerlet(6 * 60_000);
    await gonder();

    console.log("\n§8 zil satıcı iç API'sine");
    const h = await hesapKur(o, tesisId, ["bulut:siparis:yaz"]);
    const y = await api(o, "POST", "/api/gelen-kutusu", { belirtec: h.belirtec, govde: { mesajId: randomUUID(), tur: "SIPARIS", govde: { cariKartId: randomUUID(), doviz: "TRY", kalemler: [{ urunId: randomUUID(), miktar: "1" }] } } });
    await new Promise((r) => setTimeout(r, 300));
    const zil = s.zil.at(-1);
    kontrol("§8a gelen kutusu yazımı 201 ve zil {tesisId, konu} satıcıya gitti", y.status === 201 && zil?.tesisId === tesisId && zil?.konu === "gelen-kutusu" && zil?.yetki === `Bearer ${BELIRTEC}`);
    kontrol("§8b zil gövdesi İÇERİK taşımaz (yalnız v · tesisId · konu)", zil !== undefined && Object.keys(zil).filter((a) => a !== "yetki").sort().join(",") === "konu,tesisId,v");

    console.log("\n§6 satıcı 404 → kayıt pasif");
    s.mod = "yok";
    o.saat.ilerlet(6 * 60_000);
    const r6 = await gonder();
    const pasif = await withTesis(o.goc, { tesisId }, (tx) => tx.installation.findUnique({ where: { installationId: kurulumId } }));
    kontrol("§6a satıcı kurulumu tanımıyor → 401 ve kayıt pasif", r6.status === 401 && pasif?.active === false);

    console.log("\n§9 B5s sıra imza → hak → DB");
    const izler = async (id: string) => ({
      istek: await withCentral(o.goc, {}, (tx) => tx.facilityDatabase.findUnique({ where: { tesisId: s.yansit.tesisId } })),
      bag: await withCentral(o.goc, {}, (tx) => tx.installationRoute.findUnique({ where: { installationId: id } })),
    });
    const yeniGonder = (id: string, anahtar: typeof privateKey) => imzali(o, { kurulumId: id, privateKey: anahtar }, "/v1/esitle", { govde: paket({ kurulumId: id }, { ufuk: new Date(o.saat.simdi() - 5_000) }) });
    s.mod = "yansit";
    s.yansit.moduller = ["production.enabled", "patron-bulut"];
    const hakli = randomUUID();
    const yabanciImza = await yeniGonder(hakli, privateKey);
    const i1 = await izler(hakli);
    kontrol("§9a yabancı imza (hakkı OLAN kurulum) → 401, yönlendirme bağı ve tesis DB isteği YOK", yabanciImza.status === 401 && i1.istek === null && i1.bag === null, `${yabanciImza.status} ${yabanciImza.json.details?.code} · istek ${i1.istek?.status ?? "yok"} · bağ ${i1.bag ? "VAR" : "yok"}`);
    s.yansit.moduller = ["production.enabled"];
    const haksiz = randomUUID();
    const dogruImzaHaksiz = await yeniGonder(haksiz, ikinci);
    const i2 = await izler(haksiz);
    kontrol("§9b doğru imza ama patron-bulut hakkı YOK → 403, yönlendirme bağı ve tesis DB isteği YOK", dogruImzaHaksiz.status === 403 && dogruImzaHaksiz.json.details?.code === "PATRON_BULUT_KAPALI" && i2.istek === null && i2.bag === null, `${dogruImzaHaksiz.status} ${dogruImzaHaksiz.json.details?.code} · istek ${i2.istek?.status ?? "yok"} · bağ ${i2.bag ? "VAR" : "yok"}`);
    s.yansit.moduller = ["production.enabled", "patron-bulut"];
    const dogruImzaHakli = await yeniGonder(hakli, ikinci);
    const i3 = await izler(hakli);
    kontrol("§9c ✓K doğru imza + hak → tesis DB isteği ISTENDI + bağ (503, hazırlık bekleniyor)", dogruImzaHakli.status === 503 && i3.istek?.status === "ISTENDI" && i3.bag !== null, `${dogruImzaHakli.status} · ${i3.istek?.status ?? "yok"}`);
    await temizleTesis(o, s.yansit.tesisId);
    s.mod = "yok";
    const hayalet = randomUUID();
    const onceY = s.cagri;
    const yokCevap = await yeniGonder(hayalet, privateKey);
    kontrol("§9g B5 var/yok kâhini yok: bilinmeyen kurulum = bilinen kurulumun yabancı anahtarı (aynı 401 kodu + ileti)", yokCevap.status === 401 && yokCevap.json.details?.code === yabanciImza.json.details?.code && yokCevap.json.message === yabanciImza.json.message, `${yokCevap.json.details?.code} / ${yabanciImza.json.details?.code}`);
    await yeniGonder(hayalet, privateKey);
    kontrol("§9d satıcının \"yok\"u hatırlanır: aynı bilinmeyen kimlik ikinci kez SORULMAZ", s.cagri - onceY === 1, `${s.cagri - onceY} çağrı`);
    const butceli = new InstallationDirectory(o.sync, { ...o.ctx.config, KURULUM_SORGU_BUTCE_DK: 5 });
    const sabit = Date.UTC(2026, 0, 1, 12, 0, 30);
    const onceB = s.cagri;
    for (let i = 0; i < 25; i++) await butceli.lookup(randomUUID(), sabit);
    kontrol("§9e rastgele kimlik seli: önbellekte olmayan kimliğe soru dakikalık bütçeyle sınırlı (25 kimlik → 5 çağrı)", s.cagri - onceB === 5, `${s.cagri - onceB} çağrı`);
    await butceli.lookup(randomUUID(), sabit + 60_000);
    kontrol("§9f ✓K bütçe dakika penceresinde yenilenir", s.cagri - onceB === 6, `${s.cagri - onceB}`);
  } finally {
    await temizleTesis(o, tesisId);
    await o.kapat();
    await new Promise<void>((r) => sunucu.close(() => r()));
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
