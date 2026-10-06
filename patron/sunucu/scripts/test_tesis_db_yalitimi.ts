// =============================================================================
// TESİS DB YALITIMI BEKÇİSİ (PATRON-TESIS-DB §12) — tesis A'nın hiçbir isteği tesis B'nin DB'sine ULAŞAMAZ:
//   §1 bağlantı: A'nın rolleri B'nin DB'sine ve merkeze bağlanamaz (CONNECT yok), B'ninkiler A'ya; parolalar ayrı
//   §2 DB bağı: A'nın kapsamı B'nin DB'sinde ve merkezde AÇILAMAZ (ilk ifade işareti okur → DatabaseBindingError)
//   §3 yönlendirme: A'nın oturum/davet belirteci, kurulumu, e-postası yalnız A'ya çıkar; ön eki B'ye çevrilen
//      belirteç hiçbir satırla eşleşmez; kurulum başka tesise bağlanamaz; A'nın paketi yalnız A'nın DB'sine düşer
//   §4 çözülemeyen tesis merkeze DÜŞMEZ: dizinde olmayan tesis 404 · uydurma ön ekli belirteç 401 · bilinmeyen
//      kurulum/e-posta null/401
//   §5 merkezde kiracı tablosu, tesiste yönlendirme tablosu: BOŞ ve YETKİSİZ
//   §N negatif sondalar: A'nın rolüne B'de CONNECT verilince §1 KIRMIZI · B'nin işareti A'ya çevrilince §2 KIRMIZI
//      (ölçüm gerçekten ısırıyor); sondalar `finally`de geri alınır.
// Koşum: npx tsx scripts/test_tesis_db_yalitimi.ts   (kendi *_test merkezi; tesis DB'leri koşumda açılır/düşer)
// =============================================================================
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { PrismaClient } from "@prisma/client";
import { tokenDigest } from "../src/auth/session.service";
import { MERKEZ_TABLES, ROUTING_TABLES, TESIS_TABLES } from "../src/lib/db-grants";
import { ident, markDatabase } from "../src/lib/db-roles";
import { CloudError } from "../src/lib/errors";
import { DatabaseBindingError, withLookup, withTesis } from "../src/lib/tenant";
import { TesisDbRouter } from "../src/lib/tesis-db";
import { databaseOf, facilityDbName } from "../src/lib/tesis-db-ad";
import { expectedSchemaVersion } from "../src/lib/tesis-goc";
import { registerInstallation } from "../src/services/vendor-admin.service";
import { bindInstallationRoute } from "../src/services/installation-directory";
import { api, girdi, girisYap, hesapKur, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, tesisUrl, type Ortam, type TestKurulumu } from "./lib/test-ortam";

const GOC = (): string => process.env.GOC_DATABASE_URL!;

async function baglanir(url: string): Promise<boolean> {
  const c = new Client({ connectionString: url, options: "-c timezone=UTC", connectionTimeoutMillis: 5_000 });
  try {
    await c.connect();
    await c.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

/** URL'in kimliğiyle başka DB'ye: kullanıcı/parola aynı, yalnız DB adı değişir. */
function baskaDb(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** §1 ölçümü: sızan bağlantıların listesi (boş = yalıtım sağlam). */
async function baglantiSizintilari(o: Ortam, a: TestKurulumu, b: TestKurulumu): Promise<string[]> {
  const merkez = databaseOf(GOC());
  const dbA = facilityDbName(merkez, a.tesisId);
  const dbB = facilityDbName(merkez, b.tesisId);
  const sizinti: string[] = [];
  for (const rol of ["uygulama", "esitleme"] as const) {
    const aUrl = tesisUrl(o, a.tesisId, rol);
    const bUrl = tesisUrl(o, b.tesisId, rol);
    if (await baglanir(baskaDb(aUrl, dbB))) sizinti.push(`A.${rol}→B`);
    if (await baglanir(baskaDb(bUrl, dbA))) sizinti.push(`B.${rol}→A`);
    if (await baglanir(baskaDb(aUrl, merkez))) sizinti.push(`A.${rol}→merkez`);
    const merkezUrl = rol === "uygulama" ? o.ctx.config.DATABASE_URL : o.ctx.config.ESITLEME_DATABASE_URL;
    if (await baglanir(baskaDb(merkezUrl, dbA))) sizinti.push(`merkez.${rol}→A`);
    // B'nin rol adıyla A'nın türetilmiş parolası: parola rol başınadır, başka tesisin rolünü açmaz.
    const ua = new URL(aUrl);
    const ub = new URL(bUrl);
    ub.password = ua.password;
    if (await baglanir(ub.toString())) sizinti.push(`A.parola→B.${rol}`);
  }
  return sizinti;
}

/** Yönlendirmesi BOZUK yönlendirici: `from` kapsamını `hedef`in istemcisinde açar (dizin/önbellek bozulması benzetimi). */
class BozukYonlendirici extends TesisDbRouter {
  constructor(
    o: Ortam,
    private readonly hedef: { tesisId: string } | "merkez",
  ) {
    super({ role: "uygulama", centralUrl: o.ctx.config.DATABASE_URL, key: o.anahtar, schemaVersion: expectedSchemaVersion(), cacheSeconds: 0 });
  }

  override async withFacilityClient<T>(_tesisId: string, fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    if (this.hedef === "merkez") return fn(this.centralClient);
    return super.withFacilityClient(this.hedef.tesisId, fn);
  }
}

/** §2 ölçümü: A'nın kapsamı `hedef`te açılırsa "ACILDI", bağ denetimi reddederse "RED". */
async function bagOlcumu(o: Ortam, from: string, hedef: { tesisId: string } | "merkez"): Promise<"RED" | "ACILDI" | string> {
  const r = new BozukYonlendirici(o, hedef);
  try {
    await withTesis(r, { tesisId: from }, (tx) => tx.facility.findMany({ take: 1 }));
    return "ACILDI";
  } catch (err) {
    return err instanceof DatabaseBindingError ? "RED" : `${(err as Error).name}: ${(err as Error).message.slice(0, 80)}`;
  } finally {
    await r.close();
  }
}

function onekDegistir(token: string, tesisId: string): string {
  const prefix = Buffer.from(tesisId.replace(/-/g, ""), "hex").toString("base64url");
  return `${prefix}.${token.split(".")[1]}`;
}

async function tabloSayilari(url: string, tablolar: readonly string[]): Promise<Record<string, number>> {
  const c = new Client({ connectionString: url, options: "-c timezone=UTC" });
  await c.connect();
  try {
    const out: Record<string, number> = {};
    for (const t of tablolar) {
      const n = (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${ident(t)}`)).rows[0]!.n;
      if (n > 0) out[t] = n;
    }
    return out;
  } finally {
    await c.end();
  }
}

async function yetkiliTablolar(url: string, roller: readonly string[], tablolar: readonly string[]): Promise<string[]> {
  const c = new Client({ connectionString: url, options: "-c timezone=UTC" });
  await c.connect();
  try {
    const r = await c.query<{ r: string; t: string }>(
      `SELECT r, t FROM unnest($1::text[]) r, unnest($2::text[]) t
        WHERE has_table_privilege(r, t, 'SELECT') OR has_table_privilege(r, t, 'INSERT') OR has_table_privilege(r, t, 'UPDATE') OR has_table_privilege(r, t, 'DELETE')`,
      [roller, tablolar],
    );
    return r.rows.map((x) => `${x.r}:${x.t}`);
  } finally {
    await c.end();
  }
}

const kullanici = (url: string): string => decodeURIComponent(new URL(url).username);

async function main(): Promise<void> {
  const o = await ortamKur();
  const a = await tesisKur(o);
  const b = await tesisKur(o);
  const merkez = databaseOf(GOC());
  const dbB = facilityDbName(merkez, b.tesisId);
  const sondaGeriAl: (() => Promise<void>)[] = [];
  try {
    const hA = await hesapKur(o, a.tesisId, ["bulut:siparis:oku", "bulut:hesap:yonet"]);
    const hB = await hesapKur(o, b.tesisId, ["bulut:siparis:oku"]);
    const ufuk = new Date(o.saat.simdi() - 60_000);
    const siparisA = randomUUID();
    const p = paket(a, { ufuk, kayitlar: [girdi("siparis", { yaz: [{ id: siparisA, siparisNo: "S-A", durum: "ACIK" }], yeni: { t: ufuk.toISOString(), k: "000000000001" } })] });
    const esitle = await imzali(o, a, "/v1/esitle", { govde: p });
    if (esitle.status !== 200) throw new Error(`fikstür paketi: ${esitle.status} ${JSON.stringify(esitle.json)}`);

    console.log("\n§1 bağlantı: tesis rolleri yalnız kendi DB'sine");
    const s1 = await baglantiSizintilari(o, a, b);
    kontrol("§1a ⭐ A'nın rolleri B'ye/merkeze, B'ninkiler A'ya, merkez rolleri tesise bağlanamaz; A'nın parolası B'nin rolünü açmaz", s1.length === 0, s1.join(",") || "temiz");
    kontrol("§1b kendi DB'sine bağlanır (ölçüm kör değil)", (await baglanir(tesisUrl(o, a.tesisId, "uygulama"))) && (await baglanir(tesisUrl(o, b.tesisId, "esitleme"))));

    console.log("\n§2 DB bağı: kapsam başka DB'de açılamaz");
    kontrol("§2a ⭐ A'nın kapsamı B'nin DB'sinde açılmaz (DatabaseBindingError, sorgusuz)", (await bagOlcumu(o, a.tesisId, b)) === "RED");
    kontrol("§2b A'nın kapsamı merkezde açılmaz", (await bagOlcumu(o, a.tesisId, "merkez")) === "RED");
    kontrol("§2c doğru yönlendirmede kapsam açılır (ölçüm kör değil)", (await bagOlcumu(o, a.tesisId, a)) === "ACILDI");
    const adSeddi = await o.goc.centralClient.$executeRaw`UPDATE facility_databases SET database_name = ${dbB} WHERE tesis_id = ${a.tesisId}::uuid`.then(() => "gecti", (e: Error) => (/facility_databases_database_name_key|unique/i.test(e.message) ? "RED" : e.message.slice(0, 80)));
    kontrol("§2d dizinde A'nın satırı B'nin DB adını gösteremez (UNIQUE seddi)", adSeddi === "RED", adSeddi);

    console.log("\n§3 yönlendirme: kimlik yalnız kendi tesisine");
    const tA = await girisYap(o, hA);
    const tB = await girisYap(o, hB);
    const benA = await api(o, "GET", "/api/oturum", { belirtec: tA });
    const benB = await api(o, "GET", "/api/oturum", { belirtec: tB });
    const tesisOf = (y: typeof benA) => (y.json.data as { tesis?: { id?: string } } | undefined)?.tesis?.id;
    kontrol("§3a A'nın oturumu A'ya, B'ninki B'ye çıkar", benA.status === 200 && tesisOf(benA) === a.tesisId && benB.status === 200 && tesisOf(benB) === b.tesisId);
    const sahte = await api(o, "GET", "/api/oturum", { belirtec: onekDegistir(tA, b.tesisId) });
    kontrol("§3b ⭐ A'nın belirtecinin ön eki B'ye çevrilince 401 (B'de eşleşen satır yok)", sahte.status === 401, `${sahte.status}`);
    const davet = await api(o, "POST", "/api/hesaplar", { belirtec: tA, govde: { clientToken: randomUUID(), eposta: `davetli-${randomUUID().slice(0, 8)}@ornek.test`, ad: "Davetli", sablon: "SATIS" } });
    const davetToken = (davet.json.data as { davet?: string } | undefined)?.davet ?? "";
    const davetGercek = await api(o, "POST", "/api/davet/incele", { govde: { davet: davetToken } });
    const davetSahte = await api(o, "POST", "/api/davet/incele", { govde: { davet: onekDegistir(davetToken, b.tesisId) } });
    kontrol("§3c A'nın daveti A'da incelenir; ön eki B'ye çevrilince 4xx", davet.status === 201 && davetGercek.status === 200 && davetSahte.status >= 400 && davetSahte.status < 500, `${davet.status}/${davetGercek.status}/${davetSahte.status}`);
    const giris = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: hA.eposta, parola: "yanlis-parola-uzun-2026", totp: "000000" } });
    kontrol("§3d A'nın e-postası merkez dizininden yalnız A'ya çözülür (yanlış parola → 401, B'ye sorulmaz)", giris.status === 401 && (await o.app.routeOfEmail(hA.eposta))?.tesisId === a.tesisId);
    const tasima = await registerInstallation(o.goc, { tesisId: b.tesisId, installationId: a.kurulumId, publicKeyX: a.acikAnahtar, licenseClass: "URETIM", modules: ["patron-bulut"], cloudUntil: null }, o.saat.simdi()).then(
      () => "gecti",
      (e: Error) => (e instanceof CloudError ? e.code : e.message.slice(0, 80)),
    );
    kontrol("§3e ⭐ A'nın kurulumu B'ye kaydedilemez (409 KURULUM_BASKA_TESISTE) · satıcı kipi bağı da RED", tasima === "KURULUM_BASKA_TESISTE" && !(await bindInstallationRoute(o.sync, a.kurulumId, b.tesisId)), tasima);
    const projA = await tabloSayilari(tesisUrl(o, a.tesisId, "goc"), ["projection_rows"]);
    const projB = await tabloSayilari(tesisUrl(o, b.tesisId, "goc"), ["projection_rows"]);
    const projM = await tabloSayilari(GOC(), ["projection_rows"]);
    kontrol("§3f A'nın eşitleme paketi yalnız A'nın DB'sine düştü (B ve merkez 0)", (projA.projection_rows ?? 0) >= 1 && !projB.projection_rows && !projM.projection_rows, JSON.stringify({ projA, projB, projM }));

    console.log("\n§4 çözülemeyen tesis merkeze düşmez");
    const yok = randomUUID();
    const yokSonuc = await withTesis(o.app, { tesisId: yok }, async () => "acildi").then(
      (x) => x,
      (e: Error) => (e instanceof CloudError ? `${e.status}` : e.message.slice(0, 60)),
    );
    kontrol("§4a dizinde olmayan tesis kapsamı 404 (merkezde açılmaz)", yokSonuc === "404", yokSonuc);
    const uydurma = await api(o, "GET", "/api/oturum", { belirtec: onekDegistir(tA, yok) });
    kontrol("§4b uydurma tesis ön ekli belirteç 401", uydurma.status === 401, `${uydurma.status}`);
    const arama = await withLookup(o.app, { kind: "oturum", value: tokenDigest(tA), tesisId: yok }, async () => "acildi");
    const kurulum = await withLookup(o.sync, { kind: "kurulum", value: randomUUID() }, async () => "acildi");
    const eposta = await withLookup(o.app, { kind: "eposta", value: `yok-${randomUUID().slice(0, 8)}@ornek.test` }, async () => "acildi");
    kontrol("§4c çözülemeyen oturum/kurulum/e-posta araması sorgusuz null", arama === null && kurulum === null && eposta === null);

    console.log("\n§5 tablolar doğru DB'de: boş ve yetkisiz");
    const kiraci = TESIS_TABLES.filter((t) => !MERKEZ_TABLES.includes(t));
    const merkezDolu = await tabloSayilari(GOC(), kiraci);
    const tesisDolu = await tabloSayilari(tesisUrl(o, a.tesisId, "goc"), ROUTING_TABLES);
    kontrol("§5a merkezde kiracı tablosu BOŞ · tesis DB'sinde yönlendirme tablosu BOŞ", Object.keys(merkezDolu).length === 0 && Object.keys(tesisDolu).length === 0, JSON.stringify({ merkezDolu, tesisDolu }));
    const merkezYetki = await yetkiliTablolar(GOC(), [kullanici(o.ctx.config.DATABASE_URL), kullanici(o.ctx.config.ESITLEME_DATABASE_URL)], kiraci);
    const tesisYetki = await yetkiliTablolar(tesisUrl(o, a.tesisId, "goc"), [kullanici(tesisUrl(o, a.tesisId, "uygulama")), kullanici(tesisUrl(o, a.tesisId, "esitleme"))], ROUTING_TABLES);
    kontrol("§5b merkez rolleri kiracı tablosunda, tesis rolleri yönlendirme tablosunda YETKİSİZ", merkezYetki.length === 0 && tesisYetki.length === 0, [...merkezYetki, ...tesisYetki].join(",") || "temiz");

    console.log("\n§N negatif sondalar (ölçüm ısırıyor mu)");
    const goc = new Client({ connectionString: GOC(), options: "-c timezone=UTC" });
    await goc.connect();
    sondaGeriAl.push(async () => {
      await goc.end().catch(() => undefined);
    });
    const aUyg = kullanici(tesisUrl(o, a.tesisId, "uygulama"));
    await goc.query(`GRANT CONNECT ON DATABASE ${ident(dbB)} TO ${ident(aUyg)}`);
    sondaGeriAl.unshift(async () => {
      await goc.query(`REVOKE CONNECT ON DATABASE ${ident(dbB)} FROM ${ident(aUyg)}`);
    });
    const n1 = await baglantiSizintilari(o, a, b);
    kontrol("§N1 ⭐ A'nın rolüne B'de CONNECT verilince §1 KIRMIZI (A.uygulama→B yakalandı)", n1.includes("A.uygulama→B"), n1.join(",") || "yakalanmadı");
    await goc.query(`REVOKE CONNECT ON DATABASE ${ident(dbB)} FROM ${ident(aUyg)}`);
    kontrol("§N1b sonda geri alındı → §1 yeniden temiz", (await baglantiSizintilari(o, a, b)).length === 0);
    await markDatabase(goc, dbB, a.tesisId);
    sondaGeriAl.unshift(async () => {
      await markDatabase(goc, dbB, b.tesisId);
    });
    const n2 = await bagOlcumu(o, a.tesisId, b);
    kontrol("§N2 ⭐ B'nin DB bağı işareti A'ya çevrilince (bağ denetimi körleşince) §2 KIRMIZI (kapsam açıldı)", n2 === "ACILDI", n2);
    await markDatabase(goc, dbB, b.tesisId);
    kontrol("§N2b sonda geri alındı → §2 yeniden RED", (await bagOlcumu(o, a.tesisId, b)) === "RED");
  } finally {
    for (const f of sondaGeriAl) await f().catch((e: Error) => console.error(`sonda geri alınamadı: ${e.message}`));
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
