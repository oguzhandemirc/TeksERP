// =============================================================================
// DEĞİŞİM SAYACI + UZUN YOKLAMA BEKÇİSİ (patron v2 K1 · P3) — `sync_state.change_counter` ve `GET /api/degisim`:
//   §1 kabul edilen paket → sayaç +1, `changed_projections` = kabul adları + yazılan anlıklar · makbuz tekrarı artırmaz
//   §2 yalnız-ret paket ve ufku eski anlık → sayaç ARTMAZ
//   §3 `since = şimdiki` bekler, paket gelince < 1 sn döner · `bekle=0` hemen · süre dolunca boş döner · tesis
//      yalıtımı · istemci koparsa bekleyen bırakılır · biçimsiz parametre 400 (TR) · oturumsuz 401
//   §4 `degisenler` hesabın okuyabildiğiyle süzülür (fiyat/cari-bakiye izni yoksa finans adları düşer)
//   §5 halka dışı `since` → tüm okunabilir adlar · tek adımlık fark DB'deki son adlarla · `since` ileride → hepsi
//   §6 eski istemci: `/api/oturum` ve `/v1/esitle` yanıt gövdelerinin alan kümesi DEĞİŞMEDİ
// Koşum: npx tsx scripts/test_degisim_sayaci.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withTesis } from "../src/lib/tenant";
import { ALL_CHANGED, CHANGE_RING_SIZE, ChangeHub, MAX_WAIT_SECONDS, changeHub } from "../src/services/change-feed";
import { api, girdi, hesapKur, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, type Ortam, type TestHesabi, type TestKurulumu } from "./lib/test-ortam";

type Feed = { sayac: number; degisenler: string[]; fabrikaDamgasi: string | null };
const BOS_OZET = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const iso = (ms: number) => new Date(ms).toISOString();
const bekle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let tur = 0;
const anahtarlar = (v: unknown) => (v && typeof v === "object" ? Object.keys(v).sort().join(",") : String(v));

async function durum(o: Ortam, tesisId: string): Promise<{ sayac: number; adlar: string[] }> {
  const row = await withTesis(o.goc, { tesisId }, (tx) => tx.syncState.findUnique({ where: { tesisId } }));
  return { sayac: Number(row?.changeCounter ?? 0n), adlar: (row?.changedProjections as string[] | undefined) ?? [] };
}

async function yokla(o: Ortam, h: TestHesabi, sorgu: string): Promise<{ status: number; feed: Feed; ms: number; message?: string }> {
  const t0 = Date.now();
  const r = await api(o, "GET", `/api/degisim?${sorgu}`, { belirtec: h.belirtec });
  return { status: r.status, feed: r.json.data as Feed, ms: Date.now() - t0, message: r.json.message };
}

function kayitPaketi(o: Ortam, k: TestKurulumu, g: { siparis?: boolean; anlik?: string; ufukGeri?: number } = {}) {
  const ufuk = o.saat.simdi() - (g.ufukGeri ?? 30_000);
  const w = { t: iso(ufuk), k: String(++tur).padStart(12, "0") };
  const id = randomUUID();
  const kayitlar = g.siparis
    ? [girdi("siparis", { yaz: [{ id, siparisNo: "S-1", durum: "ACIK", siparisTarihi: iso(ufuk) }], yeni: w }), girdi("siparis.finans", { yaz: [{ id, tutar: "10.00" }], yeni: w })]
    : [girdi("urun", { yaz: [{ id, kod: "U1", ad: "Kumaş" }], yeni: w })];
  const anliklar = g.anlik ? [{ projeksiyon: g.anlik, icerikOzeti: BOS_OZET, veri: { deger: id } }] : [];
  return paket(k, { ufuk: new Date(ufuk), kayitlar, anliklar });
}

async function gonder(o: Ortam, k: TestKurulumu, govde: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await imzali(o, k, "/v1/esitle", { govde });
  return { status: r.status, json: r.json as unknown as Record<string, unknown> };
}

async function sayacArtisi(o: Ortam, k: TestKurulumu, h: TestHesabi): Promise<void> {
  console.log("\n§1 kabul → sayaç +1 ve adlar");
  const once = await durum(o, k.tesisId);
  const p = kayitPaketi(o, k, { anlik: "ozet.stok" });
  const r = await gonder(o, k, p);
  const sonra = await durum(o, k.tesisId);
  kontrol("§1a kabul edilen paket → sayaç tam +1", r.status === 200 && sonra.sayac === once.sayac + 1, `${once.sayac} → ${sonra.sayac}`);
  kontrol("§1b changed_projections = kabul adları + yazılan anlık (tekil)", [...sonra.adlar].sort().join(",") === "ozet.stok,urun", JSON.stringify(sonra.adlar));
  const y = await yokla(o, h, `since=${once.sayac}&bekle=0`);
  kontrol("§1c uç yeni sayacı ve adları döner; damga = paketin ufku", y.status === 200 && y.feed.sayac === sonra.sayac && y.feed.degisenler.includes("urun") && y.feed.fabrikaDamgasi === p.ufuk, JSON.stringify(y.feed));
  const tekrar = await gonder(o, k, p);
  kontrol("§1d aynı paket (makbuz tekrarı) sayacı artırmaz", tekrar.status === 200 && (await durum(o, k.tesisId)).sayac === sonra.sayac);
}

async function retArtirmaz(o: Ortam, k: TestKurulumu): Promise<void> {
  console.log("\n§2 yalnız-ret / eski anlık artırmaz");
  const once = await durum(o, k.tesisId);
  const ufuk = o.saat.simdi() - 20_000;
  const ret = paket(k, { ufuk: new Date(ufuk), kayitlar: [girdi("boyle-bir-projeksiyon-yok", { yaz: [{ id: randomUUID() }], yeni: { t: iso(ufuk), k: "000000000001" } })] });
  const r = await gonder(o, k, ret);
  kontrol("§2a yalnız-ret paket → 200 + ret, sayaç AYNI", r.status === 200 && (r.json.ret as unknown[]).length === 1 && (await durum(o, k.tesisId)).sayac === once.sayac);
  const eski = kayitPaketi(o, k, { ufukGeri: 3_600_000 });
  const eskiAnlik = { ...eski, kayitlar: [], anliklar: [{ projeksiyon: "ozet.stok", icerikOzeti: BOS_OZET, veri: { eski: true } }] };
  const r2 = await gonder(o, k, eskiAnlik);
  kontrol("§2b ufku eski anlık (yazılmadı) → sayaç AYNI", r2.status === 200 && (await durum(o, k.tesisId)).sayac === once.sayac);
}

async function uzunYoklama(o: Ortam, a: TestKurulumu, ha: TestHesabi, b: TestKurulumu): Promise<void> {
  console.log("\n§3 uzun yoklama");
  const c = (await durum(o, a.tesisId)).sayac;
  const hemen = await yokla(o, ha, `since=${c}&bekle=0`);
  kontrol("§3a bekle=0 → hemen döner, sayaç aynı, değişen yok", hemen.status === 200 && hemen.ms < 1_000 && hemen.feed.sayac === c && hemen.feed.degisenler.length === 0, `${hemen.ms} ms`);
  const bekleyen = yokla(o, ha, `since=${c}&bekle=3`);
  await bekle(300);
  const kayitli = changeHub.waiting(a.tesisId);
  const t0 = Date.now();
  await gonder(o, a, kayitPaketi(o, a));
  const y = await bekleyen;
  const dt = Date.now() - t0;
  kontrol("§3b bekleyen kayıtlı; paket gelince < 1 sn içinde yeni sayaçla döner", kayitli === 1 && y.status === 200 && dt < 1_000 && y.feed.sayac === c + 1 && y.feed.degisenler.includes("urun"), `bekleyen ${kayitli} · ${dt} ms · ${JSON.stringify(y.feed)}`);
  const c2 = c + 1;
  const bYoklama = yokla(o, ha, `since=${c2}&bekle=1`);
  await bekle(200);
  await gonder(o, b, kayitPaketi(o, b));
  const yb = await bYoklama;
  kontrol("§3c başka tesisin paketi A'yı uyandırmaz; süre dolunca boş döner", yb.status === 200 && yb.ms >= 950 && yb.feed.sayac === c2 && yb.feed.degisenler.length === 0, `${yb.ms} ms`);
  const iptal = new AbortController();
  const kopan = fetch(`${o.adres}/api/degisim?since=${c2}&bekle=25`, { headers: { Authorization: `Bearer ${ha.belirtec}` }, signal: iptal.signal }).catch(() => null);
  await bekle(200);
  const once = changeHub.waiting(a.tesisId);
  iptal.abort();
  await kopan;
  await bekle(200);
  kontrol("§3d istemci koparsa bekleyen bırakılır (hub sızmaz)", once === 1 && changeHub.waiting(a.tesisId) === 0, `${once} → ${changeHub.waiting(a.tesisId)}`);
  const kotu = await Promise.all(["since=-1", "since=abc", "bekle=1.5", "since=1&since=2"].map((q) => yokla(o, ha, q)));
  kontrol("§3e biçimsiz since/bekle → 400, ileti TR", kotu.every((r) => r.status === 400 && /tamsayı/.test(r.message ?? "")), kotu.map((r) => r.status).join(","));
  const anon = await api(o, "GET", "/api/degisim?since=0&bekle=0");
  kontrol("§3f oturumsuz → 401; üst sınır 25 sn", anon.status === 401 && MAX_WAIT_SECONDS === 25, `${anon.status}`);
}

async function izinSuzmesi(o: Ortam, k: TestKurulumu, patron: TestHesabi, satis: TestHesabi): Promise<void> {
  console.log("\n§4 izin süzmesi");
  const c = (await durum(o, k.tesisId)).sayac;
  const ufuk = o.saat.simdi() - 10_000;
  const p = kayitPaketi(o, k, { siparis: true, ufukGeri: 10_000 });
  const r = await gonder(o, k, { ...p, anliklar: [{ projeksiyon: "ozet-finans", icerikOzeti: BOS_OZET, veri: { kasa: String(ufuk) } }] });
  const sp = await yokla(o, patron, `since=${c}&bekle=0`);
  const ss = await yokla(o, satis, `since=${c}&bekle=0`);
  kontrol("§4a izinli hesap: siparis + siparis.finans + ozet-finans", r.status === 200 && ["siparis", "siparis.finans", "ozet-finans"].every((n) => sp.feed.degisenler.includes(n)), JSON.stringify(sp.feed.degisenler));
  kontrol("§4b fiyat/cari-bakiye izni yok: finans adları DÜŞER, siparis kalır", ss.feed.degisenler.includes("siparis") && !ss.feed.degisenler.includes("siparis.finans") && !ss.feed.degisenler.includes("ozet-finans"), JSON.stringify(ss.feed.degisenler));
}

async function halka(o: Ortam, k: TestKurulumu, satis: TestHesabi): Promise<void> {
  console.log("\n§5 halka dışı since");
  const hub = new ChangeHub();
  for (let n = 1; n <= CHANGE_RING_SIZE + 6; n++) hub.notify(k.tesisId, n, [`p${n}`]);
  kontrol("§5a halka son 64'ü tutar: kapsanan aralık birleşim, eskisi `*`", String(hub.changedBetween(k.tesisId, CHANGE_RING_SIZE + 4, CHANGE_RING_SIZE + 6)) === "p69,p70" && hub.changedBetween(k.tesisId, 2, CHANGE_RING_SIZE + 6) === ALL_CHANGED);
  const c = (await durum(o, k.tesisId)).sayac;
  // Süreç yeniden başlamış gibi: sayaç DB'de hub'a haber verilmeden ilerler (halka bu adımları bilmez).
  await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.syncState.update({ where: { tesisId: k.tesisId }, data: { changeCounter: BigInt(c + 3), changedProjections: ["urun"] } }));
  const hepsi = await yokla(o, satis, `since=${c}&bekle=0`);
  const okunur = [...hepsi.feed.degisenler].sort().join(",");
  kontrol("§5b halka dışı since → hesabın okuyabildiği TÜM adlar (finans yok)", hepsi.feed.sayac === c + 3 && hepsi.feed.degisenler.includes("ozet.siparis") && hepsi.feed.degisenler.includes("siparis") && !hepsi.feed.degisenler.includes("siparis.finans"), okunur);
  const tek = await yokla(o, satis, `since=${c + 2}&bekle=0`);
  kontrol("§5c tek adımlık fark (halka boş) → DB'deki son adlar", tek.feed.degisenler.join(",") === "urun", JSON.stringify(tek.feed.degisenler));
  const ileri = await yokla(o, satis, `since=${c + 50}&bekle=5`);
  kontrol("§5d since sayaçtan ileride → beklemeden hepsi", ileri.ms < 1_000 && ileri.feed.sayac === c + 3 && [...ileri.feed.degisenler].sort().join(",") === okunur, `${ileri.ms} ms`);
}

async function eskiIstemci(o: Ortam, k: TestKurulumu, h: TestHesabi): Promise<void> {
  console.log("\n§6 eski istemci: yanıt gövdeleri aynı");
  const r = await api(o, "GET", "/api/oturum", { belirtec: h.belirtec });
  const d = r.json.data as Record<string, unknown>;
  // `liste` (liste yetenekleri, P6) bilinçli EK alandır — opsiyonel, eski istemci yok sayar; sayaç alanı yine yok.
  kontrol("§6a /api/oturum alan kümesi aynı (+ P6 `liste`)", anahtarlar(d) === "esitleme,hesap,hizmet,liste,projeksiyonlar,tesis", anahtarlar(d));
  kontrol("§6b /api/oturum esitleme alan kümesi aynı (sayaç SIZMAZ)", anahtarlar(d.esitleme) === "fabrikaSurumu,sonEsitleme,sozlesmeUyarisi,ufuk,ufukTakildi", anahtarlar(d.esitleme));
  const s = await gonder(o, k, kayitPaketi(o, k));
  kontrol("§6c /v1/esitle makbuz alan kümesi aynı", anahtarlar(s.json) === "istenen,kabul,paketId,ret,sozlesmeUyarisi,ufukTarihi,v", anahtarlar(s.json));
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const a = await tesisKur(o);
  const b = await tesisKur(o);
  try {
    const patron = await hesapKur(o, a.tesisId, ["bulut:siparis:oku", "bulut:fiyat:oku", "bulut:ozet:oku", "bulut:stok:oku", "bulut:cari-bakiye:oku"]);
    const satis = await hesapKur(o, a.tesisId, ["bulut:siparis:oku", "bulut:ozet:oku", "bulut:stok:oku"]);
    await sayacArtisi(o, a, patron);
    await retArtirmaz(o, a);
    await uzunYoklama(o, a, patron, b);
    await izinSuzmesi(o, a, patron, satis);
    await halka(o, a, satis);
    await eskiIstemci(o, a, patron);
  } finally {
    await temizleTesis(o, a.tesisId);
    await temizleTesis(o, b.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
