// =============================================================================
// PUSH KÖPRÜSÜ SERTLİK BEKÇİSİ (inceleme düzeltmeleri 2026-11-13) — `test_bildirim_koprusu`nun tamamlayıcısı.
// Satıcı kipi (sahte iç API) + sahte taşıyıcılar; gerçek Expo/satıcı çağrısı YOK.
//   §1 ⭐ `yol` ZORUNLU: yolsuz imza 401 ISTEK_YOL · başka uca imza 401 ISTEK_YOL · ikisi de nonce YAZMAZ
//   §2 saat sapması > 10 dk → 401 ISTEK_ZAMAN + `details.sunucuSaati`
//   §3 ⭐ eşzamanlı replay: aynı imzalı istek iki paralel → yalnız biri 200, öteki 409 ISTEK_TEKRAR
//   §4 ⭐ sıra hak → hız → nonce: 403 ve 429 merkez nonce tablosuna satır yazmaz
//   §5 nonce budaması dakikalık tikte (günlük tur aynı gün tekrar koşmasa da)
//   §6 ⭐ bağ tavanı yarışı: 190 bağ + iki paralel 10'luk kaydet → biri 409, toplam 200
//   §7 ⭐ köprü satıcı bütçesi ayrı: dolunca 503 TEKRAR_DENEYIN (401 değil); eşitleme bütçesi etkilenmez, eşitleme
//      bütçe davranışı aynen (dolunca satıcıya sorulmaz, kayıt yok)
//   §8 ⭐ bayat bellek: satıcı erişilemezken ≤ KOPRU_BAYAT_AZAMI_SAAT kullanılır, aşılınca 503
//   §9 ⭐ süre tavanı (sıralı taşıyıcı): süre dolunca kalan belirteç GECICI SURE_DOLDU; geç biten gönderim yinelemede
//      ikinci kez gitmez
//   §10 toplu taşıyıcı: tek istekte gönderim (kayıtlı + Expo sahte fetch, sonuç sırası korunur)
//   §11 ⭐ yineleme: aynı (kurulum, bildirimId, belirteç) ikinci dürtte GÖNDERİLMEZ → GONDERILDI
//   §12 rota `safeRoute` deseni: `//` · `..` · `%2F` · şema · ters bölü · sorgu → 400; `/bolum/kimlik` → 200
//   §13 metin: U+2028/2029 · U+200B–200D · U+061C · U+FEFF · U+202A–202E · U+2066–2069 silinir
//   §14 TASARIM SINIRI (bilinçli, belge §1): ham belirteci bilen BAŞKA kurulum onu kendine bağlar ve dürter → GONDERILDI.
//       Bağ sahiplik kanıtı değildir; güvence ham belirtecin gizliliğidir (fabrika P2'de şifreli saklar). Davranış sabittir.
//   §15 ⭐ ham belirteç ve metin merkez DB'sinde ve süreç günlüğünde YOK
// Koşum: npx tsx scripts/test_bildirim_koprusu_sertlik.ts   (kendi *_test DB'si)
// NEGATİF SONDA (2026-11-13, dosya kopyasıyla birebir geri alındı):
//   N1 yol denetimi kalktı ⇒ §1a · §1c · N2 hız nonce'tan sonra ⇒ §4b · N2b nonce haktan önce ⇒ §4a · N3 FOR UPDATE kalktı ⇒ §6a
//   N4 bütçe dolu → `yok` ⇒ §7a · N5 köprü eşitleme bütçesini kullandı ⇒ §7b · §7c · N6 bayat yaş denetimi kalktı ⇒ §8a
//   N7 yineleme belleği kalktı ⇒ §9b · §11a · N8 eski rota deseni ⇒ §12a · N9 U+2028/2029 süzülmedi ⇒ §13a
//   N10 tikte nonce budaması kalktı ⇒ §5a · N11 süre yarışı kalktı ⇒ §9a · N12 ham belirteç günlüğe ⇒ §15a (eski bekçide §9d)
// =============================================================================
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { CLOUD_TABLES, MERKEZ_TABLES } from "../src/lib/db-grants";
import { ExpoTransport, RecordingTransport, type BridgeMessage, type BridgeTransport, type PushOutcome } from "../src/push/transports";
import { MaintenanceScheduler } from "../src/services/maintenance-scheduler";
import { tokenDigestOf } from "../src/services/push-bridge";
import { signRequest } from "../src/lisans-protokol";
import { PUSH_BRIDGE_PATHS } from "../src/wire/esitleme";
import { SATICI_ORTAMI, SENTINEL, belirtec, durt, durtGovdesi, gunlukYakala, istek, kaydet, kod, kurulum, saticiDurumu, sahteFetch, uretilenBelirtecler, veri, yabanciKurulum, type SahteKurulum } from "./lib/kopru-ortam";
import { kontrol, ortamKur, sonuc } from "./lib/test-ortam";

const gunluk = gunlukYakala();
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bilet vermeyen, her gönderimi `gecikme` ms süren SIRALI taşıyıcı (toplu gönderimi yok). */
class YavasTasiyici implements BridgeTransport {
  readonly giden: string[] = [];
  constructor(private readonly gecikme: number) {}
  async sendBridge(token: string, _msg: BridgeMessage): Promise<PushOutcome> {
    await bekle(this.gecikme);
    this.giden.push(token);
    return { kind: "OK" };
  }
}

async function main(): Promise<void> {
  const tasiyici = new RecordingTransport({ tickets: true });
  const yavas = new YavasTasiyici(400);
  const o = await ortamKur({ ...SATICI_ORTAMI, BILDIRIM_KIPI: "sahte", KOPRU_DURT_DK: "3" }, sahteFetch, undefined, { pushBridge: tasiyici });
  const y = await ortamKur({ ...SATICI_ORTAMI, BILDIRIM_KIPI: "sahte", KOPRU_DURT_SURE_SN: "1" }, sahteFetch, undefined, { pushBridge: yavas });
  const bt = await ortamKur({ ...SATICI_ORTAMI, BILDIRIM_KIPI: "kapali", KOPRU_SORGU_BUTCE_DK: "2", KURULUM_SORGU_BUTCE_DK: "2" }, sahteFetch);
  const goc = new Client({ connectionString: process.env.GOC_DATABASE_URL, options: "-c timezone=UTC" });
  await goc.connect();
  const nonceSayisi = async (k: SahteKurulum) => (await goc.query<{ n: number }>("SELECT count(*)::int AS n FROM push_bridge_nonces WHERE kurulum_id = $1", [k.kurulumId])).rows[0]!.n;
  const bagSayisi = async (k: SahteKurulum) => (await goc.query<{ n: number }>("SELECT count(*)::int AS n FROM push_bridge_links WHERE kurulum_id = $1", [k.kurulumId])).rows[0]!.n;
  const kurulumlar: SahteKurulum[] = [];
  const yeni = (g?: Parameters<typeof kurulum>[0]) => {
    const k = kurulum(g);
    kurulumlar.push(k);
    return k;
  };
  try {
    console.log("\n§1 yol bağı zorunlu");
    const a = yeni();
    const ozetA = tokenDigestOf(belirtec());
    const yolsuz = await istek(o, a, PUSH_BRIDGE_PATHS.REGISTER, { v: 1, ozetler: [ozetA] }, { imzaYolu: null });
    kontrol("§1a yolsuz imza → 401 ISTEK_YOL", yolsuz.status === 401 && kod(yolsuz) === "ISTEK_YOL", `${yolsuz.status} ${kod(yolsuz)}`);
    const yanlis = await istek(o, a, PUSH_BRIDGE_PATHS.RELEASE, { v: 1, ozetler: [ozetA] }, { imzaYolu: PUSH_BRIDGE_PATHS.REGISTER });
    kontrol("§1b kaydet'e imzalı istek bırak'a → 401 ISTEK_YOL", yanlis.status === 401 && kod(yanlis) === "ISTEK_YOL", `${yanlis.status} ${kod(yanlis)}`);
    kontrol("§1c reddedilen yol istekleri nonce yazmadı", (await nonceSayisi(a)) === 0);

    console.log("\n§2 saat sapması");
    const eski = await istek(o, a, PUSH_BRIDGE_PATHS.REGISTER, { v: 1, ozetler: [ozetA] }, { imzaSaati: o.saat.simdi() - 11 * 60_000 });
    kontrol("§2a 11 dk eski imza → 401 ISTEK_ZAMAN + sunucuSaati", eski.status === 401 && kod(eski) === "ISTEK_ZAMAN" && typeof (eski.json.details as { sunucuSaati?: unknown } | undefined)?.sunucuSaati === "string", `${eski.status} ${kod(eski)}`);

    console.log("\n§3 eşzamanlı replay");
    const imzali = await kaydet(o, a, [ozetA]);
    const govde = { v: 1, ozetler: [tokenDigestOf(belirtec())] };
    // Yeni imza üretilir ama tek başına GÖNDERİLMEZ: aynı başlıkla iki paralel istek.
    const ham = Buffer.from(JSON.stringify(govde), "utf8");
    const baslik = signRequest({ installationId: a.kurulumId, purpose: "bildir", body: ham, key: { privateKey: a.privateKey, nowMs: o.saat.simdi() }, path: PUSH_BRIDGE_PATHS.REGISTER });
    const paralel = await Promise.all([1, 2].map(() => istek(o, a, PUSH_BRIDGE_PATHS.REGISTER, govde, { baslik })));
    const durumlar = paralel.map((r) => r.status).sort();
    kontrol("§3a aynı nonce iki paralel → [200, 409 ISTEK_TEKRAR]", imzali.status === 200 && durumlar.join(",") === "200,409" && paralel.some((r) => kod(r) === "ISTEK_TEKRAR"), durumlar.join(","));

    console.log("\n§4 sıra: hak → hız → nonce");
    const iptal = yeni({ durum: "IPTAL" });
    const red = await kaydet(o, iptal, [ozetA]);
    kontrol("§4a lisans geçersiz 403 → nonce YOK", red.status === 403 && (await nonceSayisi(iptal)) === 0, `${red.status}`);
    const h = yeni();
    const tokH = belirtec();
    await kaydet(o, h, [tokenDigestOf(tokH)]);
    const hiz: number[] = [];
    for (let i = 0; i < 5; i++) hiz.push((await durt(o, h, [tokH])).status);
    kontrol("§4b KOPRU_DURT_DK=3: 4. ve 5. dürt 429, nonce = 1 kaydet + 3 dürt", hiz.join(",") === "200,200,200,429,429" && (await nonceSayisi(h)) === 4, `${hiz.join(",")} nonce ${await nonceSayisi(h)}`);

    console.log("\n§5 nonce budaması dakikalık tikte");
    const bakim = new MaintenanceScheduler(o.ctx);
    await bakim.runOnce(o.saat.simdi());
    await goc.query("INSERT INTO push_bridge_nonces (id, kurulum_id, nonce, expires_at, created_at, updated_at) VALUES ($1, $2, $3, now() - interval '1 minute', now(), now())", [randomUUID(), h.kurulumId, `budama-${randomUUID()}`]);
    const onceBudama = await nonceSayisi(h);
    await bakim.runOnce(o.saat.simdi() + 60_000);
    kontrol("§5a aynı gün ikinci tik süresi geçen nonce'u budar", onceBudama >= 1 && (await goc.query("SELECT 1 FROM push_bridge_nonces WHERE nonce LIKE 'budama-%'")).rowCount === 0, `${onceBudama}`);

    console.log("\n§6 bağ tavanı yarışı");
    const t = yeni();
    await goc.query("INSERT INTO push_bridge_links (id, kurulum_id, token_digest, created_at, updated_at) SELECT gen_random_uuid(), $1, encode(sha256(convert_to(g::text || $2, 'UTF8')), 'hex'), now(), now() FROM generate_series(1, 190) g", [t.kurulumId, randomUUID()]);
    const on = () => Array.from({ length: 10 }, () => randomBytes(32).toString("hex"));
    const yaris = await Promise.all([kaydet(o, t, on()), kaydet(o, t, on())]);
    const yd = yaris.map((r) => r.status).sort();
    kontrol("§6a 190 + paralel 10 + 10 → biri 200 biri 409 BAG_TAVANI, toplam 200", yd.join(",") === "200,409" && (await bagSayisi(t)) === 200, `${yd.join(",")} bağ ${await bagSayisi(t)}`);

    console.log("\n§7 köprü satıcı bütçesi");
    saticiDurumu.cagri = 0;
    const b1 = await kaydet(bt, yabanciKurulum(), [ozetA]);
    const b2 = await kaydet(bt, yabanciKurulum(), [ozetA]);
    const b3 = await kaydet(bt, yeni(), [ozetA]);
    kontrol("§7a bütçe 2: iki bilinmeyen 401, üçüncü (geçerli kurulum) 503 TEKRAR_DENEYIN, satıcıya 2 soru", b1.status === 401 && b2.status === 401 && b3.status === 503 && kod(b3) === "TEKRAR_DENEYIN" && saticiDurumu.cagri === 2, `${b1.status}/${b2.status}/${b3.status} soru ${saticiDurumu.cagri}`);
    const esitleKayit = yeni();
    const e1 = await bt.ctx.directory.lookup(esitleKayit.kurulumId, bt.saat.simdi());
    kontrol("§7b köprü bütçesi dolu iken eşitleme araması satıcıya sorar (ayrı bütçe)", e1.pending?.kurulumId === esitleKayit.kurulumId && saticiDurumu.cagri === 3, `soru ${saticiDurumu.cagri}`);
    await bt.ctx.directory.lookup(randomUUID(), bt.saat.simdi());
    const e3 = await bt.ctx.directory.lookup(yeni().kurulumId, bt.saat.simdi());
    kontrol("§7c eşitleme bütçesi (2) dolunca davranış AYNEN: satıcıya sorulmaz, kayıt yok", e3.record === null && e3.pending === null && saticiDurumu.cagri === 4, `soru ${saticiDurumu.cagri}`);

    console.log("\n§8 bayat bellek azami yaşı");
    const s = yeni();
    const s0 = await kaydet(o, s, [ozetA]);
    saticiDurumu.kapali = true;
    o.saat.ilerlet(6 * 60_000);
    const s1 = await kaydet(o, s, [ozetA]);
    o.saat.ilerlet(24 * 3_600_000);
    const s2 = await kaydet(o, s, [ozetA]);
    saticiDurumu.kapali = false;
    kontrol("§8a tazelik geçti + satıcı kapalı: ≤ 24 sa bayat bellek 200, > 24 sa 503 TEKRAR_DENEYIN", s0.status === 200 && s1.status === 200 && s2.status === 503 && kod(s2) === "TEKRAR_DENEYIN", `${s0.status}/${s1.status}/${s2.status}`);

    console.log("\n§9 süre tavanı (sıralı taşıyıcı)");
    const d = yeni();
    const dTok = [belirtec(), belirtec(), belirtec(), belirtec()];
    await kaydet(y, d, dTok.map(tokenDigestOf));
    const bildirimId = randomUUID();
    const t0 = Date.now();
    const sure = await durt(y, d, dTok, { bildirimId });
    const gecen = Date.now() - t0;
    const sonuclar = veri(sure).sonuclar.map((r) => `${r.sonuc}${r.kod ? `:${r.kod}` : ""}`);
    kontrol("§9a 4 × 400 ms, tavan 1 sn → ilk ikisi GONDERILDI, kalanlar GECICI:SURE_DOLDU, yanıt < 1,5 sn", sonuclar.join(",") === "GONDERILDI,GONDERILDI,GECICI:SURE_DOLDU,GECICI:SURE_DOLDU" && gecen < 1500, `${sonuclar.join(",")} ${gecen} ms`);
    await bekle(600);
    const yineSure = await durt(y, d, dTok, { bildirimId });
    const gidenSay = (tok: string) => yavas.giden.filter((x) => x === tok).length;
    kontrol(
      "§9b yineleme: geç biten 3. belirteç ve ilk ikisi yeniden GİTMEZ (GONDERILDI), 4. şimdi gider",
      veri(yineSure).sonuclar.every((r) => r.sonuc === "GONDERILDI") && gidenSay(dTok[0]!) === 1 && gidenSay(dTok[2]!) === 1 && gidenSay(dTok[3]!) === 1,
      JSON.stringify(veri(yineSure).sonuclar.map((r) => r.sonuc)),
    );

    console.log("\n§10 toplu gönderim");
    o.saat.ilerlet(61_000);
    const c = yeni();
    const cTok = [belirtec(), belirtec(), belirtec()];
    await kaydet(o, c, cTok.map(tokenDigestOf));
    const topluOnce = tasiyici.bridgeBatches.length;
    const toplu = await durt(o, c, cTok);
    kontrol("§10a kayıtlı taşıyıcı: 3 belirteç TEK toplu çağrıda", toplu.status === 200 && tasiyici.bridgeBatches.length === topluOnce + 1 && tasiyici.bridgeBatches.at(-1) === 3);
    const cagrilar: unknown[][] = [];
    const expo = new ExpoTransport({ EXPO_PUSH_URL: "https://expo.bekci.invalid/send", EXPO_MAKBUZ_URL: "https://expo.bekci.invalid/r", EXPO_ERISIM_BELIRTECI: undefined }, async (_u, init) => {
      cagrilar.push(JSON.parse(String(init?.body)) as unknown[]);
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "b-1" }, { status: "error", details: { error: "DeviceNotRegistered" } }, { status: "ok", id: "b-3" }] }), { status: 200 });
    });
    const eo = await expo.sendBridgeBatch(cTok, { title: "t", body: "b", bildirimId: randomUUID(), rota: null });
    kontrol("§10b Expo: tek istek, 3 yük, sonuç sırası korunur", cagrilar.length === 1 && cagrilar[0]!.length === 3 && eo.map((x) => x.kind).join(",") === "OK,GECERSIZ_CIHAZ,OK", eo.map((x) => x.kind).join(","));

    console.log("\n§11 yineleme belleği");
    const tekrarId = randomUUID();
    const r1 = await durt(o, c, [cTok[0]!], { bildirimId: tekrarId });
    const gidenOnce = tasiyici.bridgeSent.length;
    const r2 = await durt(o, c, [cTok[0]!], { bildirimId: tekrarId });
    kontrol("§11a aynı bildirimId + belirteç ikinci kez → GONDERILDI, taşıyıcıya GİTMEZ", veri(r1).sonuclar[0]?.sonuc === "GONDERILDI" && veri(r2).sonuclar[0]?.sonuc === "GONDERILDI" && tasiyici.bridgeSent.length === gidenOnce);

    console.log("\n§12 rota deseni");
    o.saat.ilerlet(61_000);
    const kotu = ["//kotu.example", "/siparisler/../hesaplar", "/a%2Fb", "https://kotu.example/x", "/a\\b", "javascript:alert(1)", "/siparisler?x=1", "/Siparisler"];
    const kotuDurum: number[] = [];
    for (const rota of kotu) {
      o.saat.ilerlet(61_000); // dakikalık dürt tavanı 3 (gövdesi bozuk istek de tavandan düşer)
      kotuDurum.push((await istek(o, c, PUSH_BRIDGE_PATHS.NUDGE, durtGovdesi([cTok[1]!], { rota }))).status);
    }
    o.saat.ilerlet(61_000);
    const iyi = await istek(o, c, PUSH_BRIDGE_PATHS.NUDGE, durtGovdesi([cTok[1]!], { rota: `/gelen-kutusu/${randomUUID()}` }));
    kontrol("§12a kötü rotalar 400 · `/bolum/kimlik` 200", kotuDurum.every((x) => x === 400) && iyi.status === 200, `${kotuDurum.join(",")} / ${iyi.status}`);

    console.log("\n§13 metin süzgeci");
    o.saat.ilerlet(61_000);
    const gizli = "  ​‌‍؜﻿‪‫‬‭‮⁦⁧⁨⁩";
    await durt(o, c, [cTok[2]!], { baslik: `A${gizli}B`, govde: `C${gizli}D` });
    const son = tasiyici.bridgeSent.at(-1);
    kontrol("§13a görünmez/yön/ayırıcı karakterler silindi", son?.msg.title === "AB" && son.msg.body === "CD", JSON.stringify(son?.msg.title));

    console.log("\n§14 tasarım sınırı: bağ sahiplik kanıtı değil");
    o.saat.ilerlet(61_000);
    const sahip = yeni();
    const baskasi = yeni();
    const tokS = belirtec();
    await kaydet(o, sahip, [tokenDigestOf(tokS)]);
    const sb = await kaydet(o, baskasi, [tokenDigestOf(tokS)]);
    const sd = await durt(o, baskasi, [tokS]);
    kontrol(
      "§14a ham belirteci bilen başka kurulum bağlar + dürter → GONDERILDI (BİLİNÇLİ sınır; güvence belirtecin gizliliği, belge §1)",
      sb.status === 200 && veri(sd).sonuclar[0]?.sonuc === "GONDERILDI",
      JSON.stringify(veri(sd).sonuclar),
    );

    console.log("\n§15 ham belirteç ve metin saklanmaz, günlüğe girmez");
    const merkez = CLOUD_TABLES.filter((x) => MERKEZ_TABLES.includes(x));
    const aranan = [SENTINEL, ...uretilenBelirtecler].map((x) => `%${x}%`);
    const izli: string[] = [];
    for (const tb of merkez) if (((await goc.query(`SELECT 1 FROM ${tb} x WHERE x::text LIKE ANY($1::text[]) LIMIT 1`, [aranan])).rowCount ?? 0) > 0) izli.push(tb);
    const gunlukte = gunluk.filter((l) => l.includes(SENTINEL) || uretilenBelirtecler.some((b) => l.includes(b)));
    kontrol(`§15a ${uretilenBelirtecler.length} ham belirteç + sentinel: ${merkez.length} merkez tablosunda ve günlükte YOK`, izli.length === 0 && gunlukte.length === 0, izli.join(",") || `${gunlukte.length} satır`);
    kontrol("§15b ✓K sonda: günlük yakalama çalışıyor", gunluk.some((l) => l.includes("/v1/bildirim/durt")));
  } finally {
    for (const k of kurulumlar) for (const tb of ["push_bridge_links", "push_bridge_tickets", "push_bridge_nonces"]) await goc.query(`DELETE FROM ${tb} WHERE kurulum_id = $1`, [k.kurulumId]).catch(() => undefined);
    await goc.end();
    await o.kapat();
    await y.kapat();
    await bt.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
