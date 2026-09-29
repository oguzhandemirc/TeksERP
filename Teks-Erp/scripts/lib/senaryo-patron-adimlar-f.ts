// SENARYO P — adımlar P21…P25 (ESITLEME §13: güvenli ufuk, zincir kopukluğu, zorlama+KISITLI gelen kutusu,
// RLS alan izni, ANLIK opt-in). `test_` öneki yok.
import { randomUUID } from "node:crypto";
import { bekleKosul, type AdimGrubu } from "./senaryo-patron-adim";
import { bulutSayisi, bulutVeri, fabrikaSayisi, turlaBekle } from "./senaryo-patron-adimlar-a";
import { bulutIstek } from "./senaryo-patron-bulut";
import type { Duzenek } from "./senaryo-patron-duzenek";

const ms = (x: unknown): number => (typeof x === "string" || x instanceof Date ? new Date(x).getTime() : NaN);

async function uygulananKademe(d: Duzenek): Promise<string> {
  return (await d.istemci.detay()).durum.uygulananKademe;
}

export const adimlarF: AdimGrubu = async (d, adim) => {
  await adim("P21", "güvenli ufuk — açık tx'in satırı ATLANMAZ; uzun açık tx'te ufuk takılır, filigran ilerlemez", async (a) => {
    const il = `UFUK ${randomUUID().slice(0, 6).toUpperCase()}`;
    const c = await d.fdb.connect();
    let acik = true;
    try {
      await c.query("BEGIN");
      const tx0 = ms((await c.query<{ t: Date }>(`SELECT now() AS t`)).rows[0]?.t);
      await c.query(`UPDATE customers SET city = $1, "updatedAt" = now() WHERE id = $2`, [il, d.ortak.cariId]);
      await new Promise((r) => setTimeout(r, 3000));
      const s1 = await d.tur();
      await new Promise((r) => setTimeout(r, 2500));
      const s2 = await d.tur();
      const h1 = ms(s1.lastOutcome?.horizon);
      const h2 = ms(s2.lastOutcome?.horizon);
      // Ufuk = en eski açık tx − pay; pay saat kayması ölçümünü içerdiğinden ms düzeyinde oynar (ilerleme değil).
      a.kontrol("açık tx sürerken iki turun ufku tx başlangıcının GERİSİNDE, ilerlemedi (5,5 sn sonra bile)", h1 < tx0 && h2 < tx0 && Math.abs(h2 - h1) < 100, `tx ${new Date(tx0).toISOString()} · ufuk ${s1.lastOutcome?.horizon} → ${s2.lastOutcome?.horizon}`);
      const kart = await bulutVeri(d, "cari-kart", d.ortak.cariId);
      a.kontrol("bulut: commit'lenmemiş değişiklik yok", kart?.il !== il, String(kart?.il));
      await d.bdb.query(`UPDATE sync_state SET horizon_changed_at = now() - interval '16 minutes' WHERE tesis_id = $1`, [d.tesisId]);
      const o = await bulutIstek(d.patron.url, "GET", "/oturum", undefined, d.yonetici.belirtec);
      const es = (o.veri.esitleme ?? {}) as { ufukTakildi?: boolean };
      a.kontrol("bulut /oturum: ufuk 15 dk'dan uzun sabit → 'ufuk takıldı' (tur sürüyor)", es.ufukTakildi === true, JSON.stringify(es));
      await c.query("COMMIT");
      acik = false;
    } finally {
      if (acik) await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
    const t = await turlaBekle(d, async () => (await bulutVeri(d, "cari-kart", d.ortak.cariId))?.il === il);
    a.kontrol("commit sonrası tur: satır ATLANMADI, bulutta", t !== null, `${t ?? "-"} ms`);
    const o2 = await bulutIstek(d.patron.url, "GET", "/oturum", undefined, d.yonetici.belirtec);
    a.kontrol("bulut: ufuk ilerleyince 'takıldı' kalktı", ((o2.veri.esitleme ?? {}) as { ufukTakildi?: boolean }).ufukTakildi === false);
  });

  await adim("P22", "zincir kopukluğu — bulut filigranı geri alınınca `istenen: TAM`, TAM sonrası küme eşit", async (a) => {
    const say = async (): Promise<number> =>
      Number((await d.bdb.query<{ n: string }>(`SELECT count(*) AS n FROM full_sync_runs WHERE tesis_id = $1 AND projection = 'cari-kart' AND completed_at IS NOT NULL`, [d.tesisId])).rows[0]?.n);
    const once = await say();
    const g = await d.bdb.query(`UPDATE sync_watermarks SET watermark_t = '2000-01-01T00:00:00Z', updated_at = now() WHERE tesis_id = $1 AND projection = 'cari-kart'`, [d.tesisId]);
    a.kontrol("bulut: cari-kart filigranı elle geri alındı", g.rowCount === 1);
    const p = await d.istemci.istek("PATCH", `/api/customers/${d.ortak.cariId}`, { notes: `Senaryo P zincir ${randomUUID().slice(0, 6)}` });
    a.kontrol("fabrika: kart değişti (artımlı girdi doğsun)", p.status === 200, `${p.status} ${p.kod ?? ""}`);
    const t = await turlaBekle(d, async () => (await say()) > once && (await bulutSayisi(d, "cari-kart")) === (await fabrikaSayisi(d, "customers")), 40_000);
    a.kontrol("bulut: FILIGRAN_KOPUK → TAM koşumu tamamlandı, küme fabrikaya eşit", t !== null, `${t ?? "-"} ms · TAM ${once}→${await say()} · ${await bulutSayisi(d, "cari-kart")}/${await fabrikaSayisi(d, "customers")}`);
  });

  await adim("P23", "gelen kutusu `zorla` + KISITLI → kayıt BEKLIYOR kalır; NORMAL'e dönünce işlenir", async (a) => {
    d.satici.kiraEk = { ...d.satici.kiraEk, zorlama: true, yaptirim: { kademe: "K4", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false } };
    await d.istemci.yokla();
    const k = await uygulananKademe(d);
    a.kontrol("fabrika: uygulanan kademe KISITLI (K4, zorlama)", k === "KISITLI", k);
    const mesajId = randomUUID();
    const y = await bulutIstek(d.patron.url, "POST", "/gelen-kutusu", { mesajId, tur: "SIPARIS", govde: { cariKartId: d.ortak.cariId, doviz: "TRY", kalemler: [{ urunId: d.ortak.urunId, miktar: "4" }] } }, d.yonetici.belirtec);
    a.kontrol("bulut: sipariş mesajı yazıldı (zil çaldı)", y.status === 201, `${y.status}`);
    await new Promise((r) => setTimeout(r, 6000));
    const run = await d.gelenKutusu();
    const durum = async (): Promise<string> => String((await bulutIstek(d.patron.url, "GET", `/gelen-kutusu/${mesajId}`, undefined, d.yonetici.belirtec)).veri.durum);
    a.kontrol("KISITLI'da zil + koşum sonrası kayıt BEKLIYOR (al çağrılmadı)", (await durum()) === "BEKLIYOR", `${await durum()} · koşum ${JSON.stringify(run).slice(0, 120)}`);
    // HAK sürümü (P8'de 3) kirada korunur — yalnız zorlama ve yaptırım geri alınır.
    d.satici.kiraEk = { ...d.satici.kiraEk, zorlama: false, yaptirim: { kademe: null, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false } };
    // KISITLI'da panelin yokla POST'u da kapıdadır — satıcı `lisans` zili çalar, fabrika kendisi yoklar.
    d.satici.zil("lisans");
    await bekleKosul(async () => (await uygulananKademe(d)) !== "KISITLI", 15_000, 300);
    const k2 = await uygulananKademe(d);
    const run2 = await d.gelenKutusu();
    const t = await bekleKosul(async () => (await durum()) === "ISLENDI", 15_000, 300);
    a.kontrol("NORMAL'e dönünce işlendi", k2 !== "KISITLI" && t !== null, `kademe ${k2} · ${await durum()} · ${JSON.stringify(run2).slice(0, 100)}`);
  });

  await adim("P24", "RLS alan izni — sipariş okuma var, fiyat yok → `siparis` görünür, `siparis.finans` SQL'le de 0", async (a) => {
    const id = d.ortak.p5SiparisId ?? "";
    const goc = Number((await d.bdb.query<{ n: string }>(`SELECT count(*) AS n FROM projection_rows WHERE tesis_id = $1 AND projection = 'siparis.finans' AND record_id = $2`, [d.tesisId, id])).rows[0]?.n);
    a.kontrol("bulutta siparis.finans alt satırı VAR (göç rolü)", goc === 1, `${goc}`);
    const c = await d.adb.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.tesis_id', $1, true), set_config('app.projeksiyonlar', $2, true)`, [d.tesisId, d.ortak.satisProj ?? ""]);
      const r = await c.query<{ p: string; n: string }>(`SELECT projection AS p, count(*) AS n FROM projection_rows WHERE record_id = $1 GROUP BY projection`, [id]);
      const m = Object.fromEntries(r.rows.map((x) => [x.p, Number(x.n)]));
      a.kontrol("SQL (uygulama rolü, satış izinleri): siparis 1, siparis.finans 0", m.siparis === 1 && !m["siparis.finans"], JSON.stringify(m));
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
    const satis = await bulutIstek(d.patron.url, "GET", `/veri/siparis/${id}`, undefined, d.ortak.satisBelirtec);
    const patron = await bulutIstek(d.patron.url, "GET", `/veri/siparis/${id}`, undefined, d.yonetici.belirtec);
    a.kontrol("API: satış hesabı siparişi görür, finans alt kaydı YOK; patron görür", satis.status === 200 && !JSON.stringify(satis.veri).includes("finans") && JSON.stringify(patron.veri).includes("finans"), `satış ${satis.status} ${Object.keys(satis.veri).join(",")} · patron ${Object.keys(patron.veri).join(",")}`);
  });

  await adim("P25", "ANLIK opt-in — `uretim-akisi` yalnız izinli alanları taşır, operatör/kullanıcı adı yok", async (a) => {
    const r = await d.bdb.query<{ data: { istasyonlar?: Array<Record<string, unknown>> } }>(`SELECT data FROM projection_rows WHERE tesis_id = $1 AND projection = 'uretim-akisi' AND deleted_at IS NULL`, [d.tesisId]);
    const veri = r.rows[0]?.data;
    a.kontrol("bulutta uretim-akisi anlık kaydı var", !!veri, `${r.rowCount}`);
    const beklenen = ["ad", "aktif", "bugunSevk", "bugunTamamlanan", "id", "kod", "kuyruk", "tur"];
    const anahtarlar = [...new Set((veri?.istasyonlar ?? []).flatMap((s) => Object.keys(s)))].sort();
    a.kontrol("istasyon satırı anahtarları TAM olarak izinli küme", (veri?.istasyonlar?.length ?? 0) > 0 && JSON.stringify(anahtarlar) === JSON.stringify(beklenen), anahtarlar.join(","));
    const kaynak = await d.istemci.istek("GET", "/api/dashboard/stations/live-state");
    const kaynakAnahtar = Object.keys(((kaynak.json.data as Array<Record<string, unknown>> | undefined) ?? [])[0] ?? {});
    a.not(`kaynak (fabrika API) satır anahtarları: ${kaynakAnahtar.join(",")} — buluta yalnız eşlenen alt küme gider`);
    const adlar = (await d.fdb.query<{ u: string; f: string | null }>(`SELECT username AS u, "fullName" AS f FROM users`)).rows.flatMap((x) => [x.u, x.f]).filter((x): x is string => !!x && x.length >= 4);
    const metin = JSON.stringify(veri ?? {});
    const sizan = adlar.filter((x) => metin.includes(x));
    a.kontrol("bulut çıktısında hiçbir fabrika kullanıcı adı yok", sizan.length === 0 && !/operat|kullanici|personel/i.test(metin), sizan.join(",") || `${adlar.length} ad tarandı`);
  });
};
