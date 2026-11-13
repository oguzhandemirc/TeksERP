// =============================================================================
// PUSH KÖPRÜSÜ BEKÇİSİ (ERP kipi, P1) — fabrika → bulut imzalı istek (amaç `bildir`), `/v1/bildirim/kaydet|birak|durt`.
// Satıcı kipi (`KURULUM_KAYNAGI=satici`, sahte iç API) + kayıtlı sahte taşıyıcı; gerçek Expo çağrısı YOK.
//   §1 ⭐ kapı: imzasız 401 · `esitle` amaçlı imza 401 ISTEK_AMAC · bilinmeyen/yabancı anahtar 401 · lisans geçersiz
//      (IPTAL · DEVREDILDI · ETKINLESMEDI · pasif) 403 LISANS_GECERSIZ · sınıf TEST 403 · satıcıya ulaşılamıyor 503
//   §2 ⭐ nonce tekrarı 409 ISTEK_TEKRAR; nonce MERKEZ tablosunda
//   §3 ⭐ bulut aboneliği YOK, lisans geçerli → 200; tesis DB'si, yönlendirme bağı, hazırlık isteği DOĞMAZ
//   §4 kaydet idempotent (iki kez → tek satır, aynı yanıt) · bağ tavanı
//   §5 ⭐ yabancı kurulumun belirteci dürtülemez (BAGSIZ, taşıyıcıya gitmez)
//   §6 gönderim: metin temizlenir + kırpılır; yük anahtarları izinli kümede (`BRIDGE_PAYLOAD_KEYS`, data {bildirimId, rota})
//   §7 ⭐ bilette `DeviceNotRegistered` → yanıtta `gecersiz`, bağ silinir
//   §8 ⭐ makbuzda `DeviceNotRegistered` → bağ `invalidated_at`; sonraki dürt `gecersiz` + bağ silinir
//   §9 ⭐ metin (sentinel) merkez DB'sinin hiçbir tablosunda ve süreç günlüğünde YOK (başarı + hata yolları)
//   §10 hız sınırı 429 HIZ_SINIRI · belirteç tavanı 400 · sıkıştırılmış gövde 400
//   §11 ⭐ gönderim kapalı (`BILDIRIM_KIPI=kapali`) → 200, `gonderim:"kapali"`, sonuç KAPALI (hata değil)
//   §12 bırak → bağ silinir, sonraki dürt BAGSIZ
// Koşum: npx tsx scripts/test_bildirim_koprusu.ts   (kendi *_test DB'si)
// NEGATİF SONDA (2026-11-13, dosya kopyasıyla birebir geri alındı):
//   N1 bağsız belirteç de gönderildi ⇒ §5a · §11a · N2 başlık günlüğe yazıldı ⇒ §9b · N3 `durum` denetimi kalktı ⇒ §1e ×2
//   N4 merkez nonce yazılmadı ⇒ §2a · §2b · N5 yüke `tesisId` eklendi ⇒ §6d · §6e · N6 geçersiz bağ silinmedi ⇒ §7a · §8c
//   N7 başlık bilet satırına yazıldı ⇒ §9a
// =============================================================================
import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Client } from "pg";
import { CLOUD_TABLES, MERKEZ_TABLES } from "../src/lib/db-grants";
import { databaseOf, facilityDbName } from "../src/lib/tesis-db-ad";
import { REQUEST_HEADER, publicKeyX, signRequest } from "../src/lisans-protokol";
import { BRIDGE_DATA_KEYS, BRIDGE_PAYLOAD_KEYS, ExpoTransport, RecordingTransport, bridgePushPayload } from "../src/push/transports";
import { checkBridgeReceipts, tokenDigestOf } from "../src/services/push-bridge";
import { PUSH_BRIDGE_PATHS, PUSH_TITLE_MAX } from "../src/wire/esitleme";
import { kontrol, ortamKur, sonuc, type Ortam, type Yanit } from "./lib/test-ortam";

// ---------------------------------------------------------------- günlük yakalama (sunucu süreç içinde)
const gunluk: string[] = [];
for (const akis of [process.stdout, process.stderr]) {
  const asil = akis.write.bind(akis) as (c: string | Uint8Array, ...r: unknown[]) => boolean;
  akis.write = ((c: string | Uint8Array, ...r: unknown[]) => {
    gunluk.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return asil(c, ...r);
  }) as typeof akis.write;
}

const BELIRTEC = "bekci-satici-ic-api-belirteci-0123456789abcdef";
const SATICI = "http://satici.bekci.invalid";

interface SahteKurulum {
  readonly kurulumId: string;
  readonly tesisId: string;
  readonly privateKey: KeyObject;
  gorunum: Record<string, unknown>;
}

const satici = new Map<string, SahteKurulum>();
let saticiKapali = false;

const sahteFetch: typeof fetch = async (input) => {
  if (saticiKapali) throw new TypeError("fetch failed");
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const id = decodeURIComponent(url.pathname.replace("/ic/v1/kurulum/", ""));
  const k = satici.get(id);
  if (!k) return new Response(JSON.stringify({ success: false }), { status: 404 });
  return new Response(JSON.stringify(k.gorunum), { status: 200, headers: { "Content-Type": "application/json" } });
};

function kurulum(g: Partial<{ durum: string; aktif: boolean; sinif: string; abonelik: boolean }> = {}): SahteKurulum {
  const kurulumId = randomUUID();
  const tesisId = randomUUID();
  const { privateKey } = generateKeyPairSync("ed25519");
  const k: SahteKurulum = {
    kurulumId,
    tesisId,
    privateKey,
    gorunum: {
      v: 1,
      kurulumId,
      tesis: { id: tesisId, ad: `Köprü Bekçi ${tesisId.slice(0, 6)}` },
      acikAnahtar: publicKeyX(privateKey),
      anahtarKimligi: null,
      durum: g.durum ?? "ETKIN",
      sinif: g.sinif ?? "URETIM",
      moduller: g.abonelik ? ["patron-bulut"] : [],
      patronBulutBitis: g.abonelik ? new Date(Date.now() + 86_400_000).toISOString() : null,
      devredildi: g.durum === "DEVREDILDI",
      aktif: g.aktif ?? true,
      saklamaAy: 13,
    },
  };
  satici.set(kurulumId, k);
  return k;
}

const SENTINEL = `GIZLI-METIN-${randomUUID()}`;
const belirtec = (): string => `ExponentPushToken[${randomUUID().replace(/-/g, "").slice(0, 22)}]`;

async function istek(
  o: Ortam,
  k: Pick<SahteKurulum, "kurulumId" | "privateKey">,
  yol: string,
  govde: unknown,
  g: { amac?: "bildir" | "esitle"; baslik?: string; ham?: Buffer; gzip?: boolean } = {},
): Promise<Yanit & { baslik: string }> {
  const ham = g.ham ?? Buffer.from(JSON.stringify(govde), "utf8");
  const tel = g.gzip ? gzipSync(ham) : ham;
  const baslik = g.baslik ?? signRequest({ installationId: k.kurulumId, purpose: g.amac ?? "bildir", body: tel, key: { privateKey: k.privateKey, nowMs: o.saat.simdi() }, path: yol });
  const res = await fetch(`${o.adres}${yol}`, {
    method: "POST",
    headers: { [REQUEST_HEADER]: baslik, "Content-Type": "application/json", ...(g.gzip ? { "Content-Encoding": "gzip" } : {}) },
    body: new Uint8Array(tel),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Yanit["json"]) : { success: false }, headers: res.headers, baslik };
}

const kaydet = (o: Ortam, k: SahteKurulum, ozetler: string[]) => istek(o, k, PUSH_BRIDGE_PATHS.REGISTER, { v: 1, ozetler });
const birak = (o: Ortam, k: SahteKurulum, ozetler: string[]) => istek(o, k, PUSH_BRIDGE_PATHS.RELEASE, { v: 1, ozetler });
const durt = (o: Ortam, k: SahteKurulum, belirtecler: string[], g: { baslik?: string; govde?: string } = {}) =>
  istek(o, k, PUSH_BRIDGE_PATHS.NUDGE, { v: 1, belirtecler, baslik: g.baslik ?? `${SENTINEL} başlık`, govde: g.govde ?? `${SENTINEL} gövde`, data: { bildirimId: randomUUID(), rota: "/bildirimler" } });

type DurtVeri = { gonderim: string; sonuclar: { ozet: string; sonuc: string; kod?: string }[]; gecersiz: string[] };
const veri = (r: Yanit): DurtVeri => r.json as unknown as DurtVeri;
const kod = (r: Yanit): string | undefined => r.json.details?.code;

async function main(): Promise<void> {
  const ortam = { KURULUM_KAYNAGI: "satici", SATICI_IC_API_URL: SATICI, SATICI_IC_API_BELIRTECI: BELIRTEC, KURULUM_ONBELLEK_DK: "5", KOPRU_DURT_DK: "6" };
  const tasiyici = new RecordingTransport({ tickets: true });
  const o = await ortamKur({ ...ortam, BILDIRIM_KIPI: "sahte" }, sahteFetch, undefined, { pushBridge: tasiyici });
  const kapali = await ortamKur({ ...ortam, BILDIRIM_KIPI: "kapali" }, sahteFetch);
  const goc = new Client({ connectionString: process.env.GOC_DATABASE_URL, options: "-c timezone=UTC" });
  await goc.connect();
  const baglar = async (kurulumId: string) => (await goc.query<{ token_digest: string; invalidated_at: Date | null }>("SELECT token_digest, invalidated_at FROM push_bridge_links WHERE kurulum_id = $1", [kurulumId])).rows;
  const kurulumlar: SahteKurulum[] = [];
  const yeni = (g?: Parameters<typeof kurulum>[0]) => {
    const k = kurulum(g);
    kurulumlar.push(k);
    return k;
  };
  try {
    console.log("\n§1 kapı");
    const a = yeni();
    const ozetA = tokenDigestOf(belirtec());
    const imzasiz = await fetch(`${o.adres}${PUSH_BRIDGE_PATHS.REGISTER}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, ozetler: [ozetA] }) });
    kontrol("§1a imzasız → 401 ISTEK_GECERSIZ", imzasiz.status === 401 && ((await imzasiz.json()) as Yanit["json"]).details?.code === "ISTEK_GECERSIZ");
    const esitle = await istek(o, a, PUSH_BRIDGE_PATHS.REGISTER, { v: 1, ozetler: [ozetA] }, { amac: "esitle" });
    kontrol("§1b `esitle` amaçlı imza → 401 ISTEK_AMAC", esitle.status === 401 && kod(esitle) === "ISTEK_AMAC", `${esitle.status} ${kod(esitle)}`);
    const bilinmeyen = await kaydet(o, { kurulumId: randomUUID(), tesisId: randomUUID(), privateKey: generateKeyPairSync("ed25519").privateKey, gorunum: {} }, [ozetA]);
    kontrol("§1c satıcının bilmediği kurulum → 401 KURULUM_BILINMIYOR", bilinmeyen.status === 401 && kod(bilinmeyen) === "KURULUM_BILINMIYOR", `${bilinmeyen.status}`);
    const yabanci = await kaydet(o, { ...a, privateKey: generateKeyPairSync("ed25519").privateKey }, [ozetA]);
    kontrol("§1d yabancı anahtarla imza → 401 KURULUM_BILINMIYOR", yabanci.status === 401 && kod(yabanci) === "KURULUM_BILINMIYOR", `${yabanci.status}`);
    for (const [ad, g] of [
      ["IPTAL", { durum: "IPTAL" }],
      ["DEVREDILDI", { durum: "DEVREDILDI" }],
      ["ETKINLESMEDI", { durum: "ETKINLESMEDI" }],
      ["pasif", { aktif: false }],
    ] as const) {
      const r = await kaydet(o, yeni(g), [ozetA]);
      kontrol(`§1e lisans geçersiz (${ad}) → 403 LISANS_GECERSIZ`, r.status === 403 && kod(r) === "LISANS_GECERSIZ", `${r.status} ${kod(r)}`);
    }
    const test = await kaydet(o, yeni({ sinif: "TEST" }), [ozetA]);
    kontrol("§1f sınıf TEST → 403 SINIF_GONDEREMEZ", test.status === 403 && kod(test) === "SINIF_GONDEREMEZ", `${test.status} ${kod(test)}`);
    saticiKapali = true;
    const ulasilamaz = await kaydet(o, yeni(), [ozetA]);
    saticiKapali = false;
    kontrol("§1g satıcıya ulaşılamıyor + önbellek yok → 503 TEKRAR_DENEYIN (fail-closed)", ulasilamaz.status === 503 && kod(ulasilamaz) === "TEKRAR_DENEYIN", `${ulasilamaz.status}`);

    console.log("\n§2 nonce");
    const ilk = await kaydet(o, a, [ozetA]);
    const tekrar = await istek(o, a, PUSH_BRIDGE_PATHS.REGISTER, { v: 1, ozetler: [ozetA] }, { baslik: ilk.baslik });
    kontrol("§2a aynı imzalı istek ikinci kez → 409 ISTEK_TEKRAR", ilk.status === 200 && tekrar.status === 409 && kod(tekrar) === "ISTEK_TEKRAR", `${ilk.status}/${tekrar.status}`);
    const nonce = await goc.query("SELECT 1 FROM push_bridge_nonces WHERE kurulum_id = $1", [a.kurulumId]);
    kontrol("§2b nonce MERKEZ tablosunda (push_bridge_nonces)", (nonce.rowCount ?? 0) >= 1, `${nonce.rowCount}`);

    console.log("\n§3 bulut aboneliği yok — tesis DB'si doğmaz");
    const fd = await goc.query("SELECT 1 FROM facility_databases WHERE tesis_id = $1", [a.tesisId]);
    const ir = await goc.query("SELECT 1 FROM installation_routes WHERE kurulum_id = $1", [a.kurulumId]);
    const pd = await goc.query("SELECT 1 FROM pg_database WHERE datname = $1", [facilityDbName(databaseOf(process.env.GOC_DATABASE_URL!), a.tesisId)]);
    kontrol("§3a abonesiz kurulum kaydetti (200) — facility_databases · installation_routes · tesis DB'si YOK", ilk.status === 200 && fd.rowCount === 0 && ir.rowCount === 0 && pd.rowCount === 0, `${fd.rowCount}/${ir.rowCount}/${pd.rowCount}`);

    console.log("\n§4 kaydet idempotent");
    const ikinci = await kaydet(o, a, [ozetA, ozetA]);
    const satirlar = await baglar(a.kurulumId);
    kontrol("§4a aynı özet iki kez (ve tekrarlı) → tek satır, aynı yanıt", ikinci.status === 200 && satirlar.length === 1 && JSON.stringify(ikinci.json) === JSON.stringify(ilk.json), `${satirlar.length}`);
    const ham = await goc.query("SELECT count(*)::int AS n FROM push_bridge_links WHERE token_digest LIKE 'Expo%'");
    kontrol("§4b ham belirteç merkez tablosunda YOK (yalnız 64 hex özet)", ham.rows[0].n === 0 && satirlar.every((s) => /^[0-9a-f]{64}$/.test(s.token_digest)));

    console.log("\n§5 yabancı kurulumun belirteci");
    const b = yeni();
    const tokB = belirtec();
    await kaydet(o, b, [tokenDigestOf(tokB)]);
    const onceki = tasiyici.bridgeSent.length;
    const yabanciDurt = await durt(o, a, [tokB]);
    kontrol("§5a A, B'nin belirtecini dürtemez → BAGSIZ, taşıyıcıya gitmez", yabanciDurt.status === 200 && veri(yabanciDurt).sonuclar[0]?.sonuc === "BAGSIZ" && tasiyici.bridgeSent.length === onceki, JSON.stringify(veri(yabanciDurt).sonuclar));

    console.log("\n§6 gönderim + yük");
    const tokA = belirtec();
    await kaydet(o, a, [tokenDigestOf(tokA)]);
    const uzun = `${SENTINEL}\u0007‮ters\r\n${"x".repeat(200)}`;
    const ok = await durt(o, a, [tokA], { baslik: uzun, govde: `${SENTINEL}\u0000 gövde\n\n\n\nson` });
    const giden = tasiyici.bridgeSent.at(-1);
    kontrol("§6a bağlı belirteç → GONDERILDI, `gonderim:acik`", ok.status === 200 && veri(ok).gonderim === "acik" && veri(ok).sonuclar[0]?.sonuc === "GONDERILDI" && giden?.token === tokA, JSON.stringify(veri(ok)));
    const baslik = giden?.msg.title ?? "";
    kontrol("§6b başlık denetim/yön karakterinden temiz, tek satır, ≤ PUSH_TITLE_MAX kod noktası, kırpma işareti", !/[\u0000-\u001F‮]/.test(baslik) && Array.from(baslik).length <= PUSH_TITLE_MAX && baslik.endsWith("…"), `${Array.from(baslik).length} kod noktası`);
    kontrol("§6c gövde: NUL yok, en çok çift boş satır", giden?.msg.body === `${SENTINEL} gövde\n\nson`, `${giden?.msg.body.length ?? 0} karakter`);
    const yuk = bridgePushPayload(tokA, { title: "t", body: "b", bildirimId: randomUUID(), rota: null });
    kontrol("§6d yük anahtarları = BRIDGE_PAYLOAD_KEYS, data = BRIDGE_DATA_KEYS", JSON.stringify(Object.keys(yuk)) === JSON.stringify(BRIDGE_PAYLOAD_KEYS) && JSON.stringify(Object.keys(yuk.data)) === JSON.stringify(BRIDGE_DATA_KEYS));
    let agaGiden: unknown = null;
    const expo = new ExpoTransport({ EXPO_PUSH_URL: "https://expo.bekci.invalid/send", EXPO_MAKBUZ_URL: "https://expo.bekci.invalid/r", EXPO_ERISIM_BELIRTECI: undefined }, async (_u, init) => {
      agaGiden = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "bilet-1" }] }), { status: 200 });
    });
    const eo = await expo.sendBridge(tokA, { title: "Başlık", body: "Gövde", bildirimId: randomUUID(), rota: "/x" });
    const tel = (agaGiden as Record<string, unknown>[] | null)?.[0] ?? {};
    kontrol("§6e Expo taşıyıcısının ağa yazdığı tek yük izinli anahtarlarla (sahte fetch)", eo.kind === "OK" && JSON.stringify(Object.keys(tel)) === JSON.stringify(BRIDGE_PAYLOAD_KEYS) && JSON.stringify(Object.keys((tel.data ?? {}) as object)) === JSON.stringify(BRIDGE_DATA_KEYS));
    const fazlaAnahtar = await istek(o, a, PUSH_BRIDGE_PATHS.NUDGE, { v: 1, belirtecler: [tokA], baslik: "x", govde: "y", data: { bildirimId: randomUUID(), rota: null, tutar: SENTINEL } });
    const disRota = await istek(o, a, PUSH_BRIDGE_PATHS.NUDGE, { v: 1, belirtecler: [tokA], baslik: "x", govde: "y", data: { bildirimId: randomUUID(), rota: "//kotu.example" } });
    kontrol("§6f data'da izinsiz anahtar · dış rota → 400 GOVDE_GECERSIZ", fazlaAnahtar.status === 400 && disRota.status === 400 && kod(fazlaAnahtar) === "GOVDE_GECERSIZ", `${fazlaAnahtar.status}/${disRota.status}`);

    console.log("\n§7 bilette DeviceNotRegistered");
    const tokOlu = belirtec();
    await kaydet(o, a, [tokenDigestOf(tokOlu)]);
    tasiyici.forced.set(tokOlu, { kind: "GECERSIZ_CIHAZ", code: "EXPO_CIHAZ_KAYITSIZ" });
    const olu = await durt(o, a, [tokOlu, tokA]);
    const kalanOlu = (await baglar(a.kurulumId)).filter((s) => s.token_digest === tokenDigestOf(tokOlu));
    kontrol("§7a geçersiz özet yanıtın `gecersiz`inde, bağ silindi, öteki belirteç gitti", JSON.stringify(veri(olu).gecersiz) === JSON.stringify([tokenDigestOf(tokOlu)]) && kalanOlu.length === 0 && veri(olu).sonuclar[1]?.sonuc === "GONDERILDI", JSON.stringify(veri(olu)));

    console.log("\n§8 makbuzda DeviceNotRegistered");
    const tokMak = belirtec();
    await kaydet(o, a, [tokenDigestOf(tokMak)]);
    await durt(o, a, [tokMak]);
    const makGonderim = () => tasiyici.bridgeSent.filter((x) => x.token === tokMak).length;
    const makOnce = makGonderim();
    const bilet = (await goc.query<{ ticket: string }>("SELECT ticket FROM push_bridge_tickets WHERE kurulum_id = $1 AND token_digest = $2", [a.kurulumId, tokenDigestOf(tokMak)])).rows[0]?.ticket;
    kontrol("§8a bilet merkezde (makbuz yoklaması için)", typeof bilet === "string");
    tasiyici.forcedReceipts.set(bilet ?? "-", { kind: "GECERSIZ_CIHAZ", code: "EXPO_CIHAZ_KAYITSIZ" });
    const tur = await checkBridgeReceipts(o.ctx, tasiyici, o.saat.simdi() + 16 * 60_000);
    const isaret = (await baglar(a.kurulumId)).find((s) => s.token_digest === tokenDigestOf(tokMak));
    kontrol("§8b makbuz turu bağı geçersiz işaretler (silmez)", tur.invalid >= 1 && isaret?.invalidated_at instanceof Date, JSON.stringify(tur));
    const sonra = await durt(o, a, [tokMak]);
    const kalanMak = (await baglar(a.kurulumId)).filter((s) => s.token_digest === tokenDigestOf(tokMak));
    kontrol("§8c sonraki dürt: `gecersiz`te döner, gönderilmez, bağ silinir", veri(sonra).gecersiz.includes(tokenDigestOf(tokMak)) && kalanMak.length === 0 && makGonderim() === makOnce, JSON.stringify(veri(sonra)));

    console.log("\n§10 hız sınırı ve tavanlar");
    const h = yeni();
    const tokH = belirtec();
    await kaydet(o, h, [tokenDigestOf(tokH)]);
    const durumlar: number[] = [];
    for (let i = 0; i < 7; i++) durumlar.push((await durt(o, h, [tokH])).status);
    const son = await durt(o, h, [tokH]);
    kontrol("§10a KOPRU_DURT_DK=6 → 7. dürt 429 HIZ_SINIRI (kurulum başına)", durumlar.slice(0, 6).every((s) => s === 200) && durumlar[6] === 429 && kod(son) === "HIZ_SINIRI", durumlar.join(","));
    const baska = await durt(o, a, [tokA]);
    kontrol("§10b öteki kurulum etkilenmez", baska.status === 200);
    const cok = await durt(o, yeni(), Array.from({ length: 21 }, belirtec));
    kontrol("§10c 21 belirteç (tavan 20) → 400", cok.status === 400 && kod(cok) === "GOVDE_GECERSIZ", `${cok.status}`);
    const gz = await istek(o, a, PUSH_BRIDGE_PATHS.REGISTER, { v: 1, ozetler: [ozetA] }, { gzip: true });
    kontrol("§10d sıkıştırılmış gövde → 400", gz.status === 400, `${gz.status}`);
    const asiri = await durt(o, a, [tokA], { govde: `${SENTINEL}${"y".repeat(5000)}` });
    kontrol("§10e ham sınırı aşan gövde → 400 (hata yolu)", asiri.status === 400, `${asiri.status}`);

    console.log("\n§11 gönderim kapalı");
    const kk = yeni();
    const tokK = belirtec();
    const kkKayit = await kaydet(kapali, kk, [tokenDigestOf(tokK)]);
    const kkDurt = await durt(kapali, kk, [tokK, belirtec()]);
    kontrol(
      "§11a kip kapalı: kayıt çalışır, dürt 200 `gonderim:kapali`, bağlı → KAPALI, bağsız → BAGSIZ, bağ silinmez",
      kkKayit.status === 200 && kkDurt.status === 200 && veri(kkDurt).gonderim === "kapali" && veri(kkDurt).sonuclar[0]?.sonuc === "KAPALI" && veri(kkDurt).sonuclar[1]?.sonuc === "BAGSIZ" && (await baglar(kk.kurulumId)).length === 1,
      JSON.stringify(kkDurt.json),
    );

    console.log("\n§12 bırak");
    o.saat.ilerlet(61_000); // `a` bu dakikanın dürt tavanını yukarıda doldurdu
    const br = await birak(o, a, [tokenDigestOf(tokA)]);
    const brTekrar = await birak(o, a, [tokenDigestOf(tokA)]);
    const brDurt = await durt(o, a, [tokA]);
    kontrol("§12a bırak siler (1), tekrarı 0; sonraki dürt BAGSIZ", (br.json as { birakilan?: number }).birakilan === 1 && (brTekrar.json as { birakilan?: number }).birakilan === 0 && veri(brDurt).sonuclar[0]?.sonuc === "BAGSIZ");

    console.log("\n§9 metin saklanmaz, günlüğe girmez");
    const merkez = CLOUD_TABLES.filter((t) => MERKEZ_TABLES.includes(t));
    const izli: string[] = [];
    for (const t of merkez) {
      const r = await goc.query(`SELECT 1 FROM ${t} x WHERE x::text LIKE $1 LIMIT 1`, [`%${SENTINEL}%`]);
      if ((r.rowCount ?? 0) > 0) izli.push(t);
    }
    kontrol(`§9a sentinel ${merkez.length} merkez tablosunun hiçbirinde yok`, izli.length === 0, izli.join(",") || "temiz");
    const gunlukte = gunluk.filter((l) => l.includes(SENTINEL));
    kontrol("§9b sentinel süreç günlüğünde yok (başarı · 400 · 429 · kapalı yolları koşuldu)", gunlukte.length === 0, `${gunluk.length} satır tarandı`);
    kontrol("§9c ✓K sonda: günlük yakalama çalışıyor (erişim günlüğü köprü yolunu yazdı)", gunluk.some((l) => l.includes("/v1/bildirim/durt")));
  } finally {
    for (const k of kurulumlar) await goc.query("DELETE FROM push_bridge_links WHERE kurulum_id = $1", [k.kurulumId]).catch(() => undefined);
    for (const k of kurulumlar) await goc.query("DELETE FROM push_bridge_tickets WHERE kurulum_id = $1", [k.kurulumId]).catch(() => undefined);
    for (const k of kurulumlar) await goc.query("DELETE FROM push_bridge_nonces WHERE kurulum_id = $1", [k.kurulumId]).catch(() => undefined);
    await goc.end();
    await o.kapat();
    await kapali.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
