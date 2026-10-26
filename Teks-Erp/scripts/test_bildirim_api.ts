// =============================================================================
// BEKÇİ — BİLDİRİM GELEN KUTUSU API'si (`/api/bildirim/*` okuma + işaretleme, N1-ZIL)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_api
// =============================================================================
// NEDEN: liste, cursor ve sayılar ayrı where'den doğarsa zil sayısı tabloyla çelişir; görme süzgeci
// istemciye kayarsa izni gitmiş türün satırı (ve sayısı) sızar; okundu yarışında iki "değişti" ya da
// başkasının satırına yazım olur. Süreç içi sunucu (127.0.0.1:0) + kendi kullanıcıları; bayrağı
// bulduğu değere döndürür.
//   §0 bayrak kapalı: özet 200 {enabled:false}, diğer uçlar 409 BILDIRIM_KAPALI
//   §1 tek where: özet okunmamış = liste `sayi` = cursor yürüyüşünün satır sayısı; gizli tür hiçbirinde yok
//   §2 cursor: limit 2 ile bütün görünür satırlar bir kez, lastAt↓ sırada
//   §3 okundu atomik (paralel iki istek → tek `degisti:true`), okunmadı geri döner
//   §4 başkasının satırı / gizli tür / bozuk id → 404 BILDIRIM_YOK
//   §5 ertele: ertelenen sekmesine geçer, okunmamıştan çıkar; bozuk süre 400
//   §6 tümünü okundu → ids; geri al yalnız kendi satırlarını döndürür
//   §7 süzgeç: filter[tur] görme kümesiyle kesişir; çıplak `tur` ve bilinmeyen tür 400
//   §8 katalog: yalnız görülebilir türler
//   §9 satır süzgeçleri (N4-TABLET): filter[ozet] / filter[tablet] / filter[kanal] SUNUCUDA; `sayi` aynı where'den;
//      satırda `ozet`, `kanalTablet`, `sesli` (= kanalTablet ∧ kişinin ses ayarı); bozuk değer 400
//   Sonda (2026-10-26, N4-TABLET): `rowFlagWhere` boş dizi döndürdü (istemci süzmek zorunda kalırdı) →
//      40 ✅ / 4 ❌ (§9a, §9b, §9c, §9f); geri alındı (md5 eşit).
//
// NEGATİF SONDA (2026-10-24, md5 ile birebir geri alındı):
//   (a) `inboxSummary` okunmamış sayımı `buildInboxWhere` yerine `{userId, readAt:null}` (özet ↔ liste where
//       ayrıştı) → 32 ✅ / 4 ❌ (§1a özet 7 · beklenen 5, §1b, §6b, §6e)
//   (b) `buildInboxWhere` base'inden `kind: {in: gorunen}` kaldırıldı (görme süzgeci sunucudan düştü) →
//       28 ✅ / 8 ❌ (§1a, §1c, §2a 8/6, §2b, §6c, §6d, §6e, §7a)
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { BildirimFikstur, type FiksturKullanici } from "./lib/bildirim-http-fikstur";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const TAG = `bapi-${Date.now().toString(36)}`;
const fx = new BildirimFikstur(TAG);
const T0 = Date.now();

async function satir(userId: string, kind: string, dkOnce: number, ek: Partial<{ klass: string; readAt: Date; ozet: boolean; kanalTablet: boolean }> = {}): Promise<string> {
  const an = new Date(T0 - dkOnce * 60_000);
  const r = await prisma.notificationInbox.create({
    data: {
      userId, kind, klass: ek.klass ?? "BILDIRIM", subjectType: "order", subjectId: null,
      groupKey: `${TAG}:${randomUUID()}`, count: 1, firstAt: an, lastAt: an, lastOutboxId: randomUUID(),
      payload: { belgeNo: `S-${dkOnce}`, musteri: "Deneme" }, reason: "IZIN", readAt: ek.readAt ?? null,
      ozet: ek.ozet ?? false, kanalTablet: ek.kanalTablet ?? false,
    },
    select: { id: true },
  });
  return r.id;
}

async function yuru(u: FiksturKullanici, sekme: string, limit: number): Promise<{ ids: string[]; sayilar: number[]; sirali: boolean }> {
  const ids: string[] = [];
  const sayilar: number[] = [];
  let cursor: string | null = null;
  let onceki = Infinity;
  let sirali = true;
  for (let i = 0; i < 50; i++) {
    const q = `/api/bildirim?sekme=${sekme}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await fx.istek(u.token, "GET", q);
    const d = r.json?.data;
    if (r.status !== 200 || !d) break;
    sayilar.push(d.sayi);
    for (const it of d.items as Array<{ id: string; sonAn: string }>) {
      const t = new Date(it.sonAn).getTime();
      if (t > onceki) sirali = false;
      onceki = t;
      ids.push(it.id);
    }
    cursor = d.nextCursor;
    if (!cursor) break;
  }
  return { ids, sayilar, sirali };
}

async function govde(): Promise<void> {
  await fx.ac();
  const a = await fx.kullanici("a", ["order:read", "license:view"]);
  const b = await fx.kullanici("b", ["order:read"]);

  // A: 5 görünür okunmamış (sipariş + lisans), 1 görünür okunmuş, 2 GİZLİ (yedek: system:backups yok).
  const gorunen = [
    await satir(a.id, "siparis.patron-siparisi", 1),
    await satir(a.id, "sistem.yedek-basarisiz", 2), // gizli — araya serpiştirilmiş
    await satir(a.id, "siparis.patron-siparisi", 3),
    await satir(a.id, "sistem.lisans-uyarisi", 4),
    await satir(a.id, "sistem.yedek-basarisiz", 5), // gizli
    await satir(a.id, "siparis.termin-gecti", 6),
    await satir(a.id, "siparis.patron-siparisi", 7),
  ];
  const gizli = [gorunen[1]!, gorunen[4]!];
  const gorunenOkunmamis = gorunen.filter((id) => !gizli.includes(id));
  const okunmus = await satir(a.id, "siparis.patron-siparisi", 8, { readAt: new Date(T0 - 60_000) });
  const bSatir = await satir(b.id, "siparis.patron-siparisi", 1);

  // §0 bayrak kapalı
  await fx.bayrak(false);
  const oz0 = await fx.istek(a.token, "GET", "/api/bildirim/ozet");
  check("§0a bayrak kapalı: özet 200 {enabled:false}", oz0.status === 200 && oz0.json?.data?.enabled === false && Object.keys(oz0.json.data).length === 1, JSON.stringify(oz0.json?.data));
  const kapali = [
    await fx.istek(a.token, "GET", "/api/bildirim"),
    await fx.istek(a.token, "POST", `/api/bildirim/${gorunen[0]}/okundu`),
    await fx.istek(a.token, "GET", "/api/bildirim/katalog"),
    await fx.istek(a.token, "POST", "/api/bildirim/tumunu-okundu"),
    await fx.istek(a.token, "GET", "/api/bildirim/bekle?rev=0"),
  ];
  check("§0b bayrak kapalı: liste/okundu/katalog/tümü/bekle 409 BILDIRIM_KAPALI", kapali.every((r) => r.status === 409 && r.json?.details?.code === "BILDIRIM_KAPALI"), kapali.map((r) => `${r.status}:${r.json?.details?.code}`).join(" "));
  const yaz0 = await prisma.notificationInbox.count({ where: { id: gorunen[0]!, readAt: { not: null } } });
  check("§0c bayrak kapalıyken okundu yazmadı", yaz0 === 0);
  check("§0d oturumsuz özet 401", (await fx.istek(null, "GET", "/api/bildirim/ozet")).status === 401);

  await fx.bayrak(true);

  // §1 tek where
  const oz = (await fx.istek(a.token, "GET", "/api/bildirim/ozet")).json?.data;
  const yOk = await yuru(a, "okunmamis", 100);
  check("§1a özet okunmamış = görünür okunmamış satır sayısı (gizli tür sayılmaz)", oz?.enabled === true && oz.okunmamis === gorunenOkunmamis.length, `özet ${oz?.okunmamis} · beklenen ${gorunenOkunmamis.length}`);
  check("§1b liste `sayi` = özet okunmamış = yürüyüş satırı", yOk.sayilar[0] === oz?.okunmamis && yOk.ids.length === oz?.okunmamis, `sayi ${yOk.sayilar[0]} · satır ${yOk.ids.length}`);
  check("§1c gizli tür listede yok", gizli.every((id) => !yOk.ids.includes(id)));
  check("§1d özet zil sürümünü taşır (epoch, rev)", typeof oz?.epoch === "number" && typeof oz?.rev === "number");

  // §2 cursor
  const yTum = await yuru(a, "tumu", 2);
  const beklenenTum = [...gorunenOkunmamis, okunmus];
  check("§2a cursor: limit 2 ile bütün görünür satırlar TAM bir kez", yTum.ids.length === beklenenTum.length && new Set(yTum.ids).size === yTum.ids.length && beklenenTum.every((id) => yTum.ids.includes(id)), `${yTum.ids.length}/${beklenenTum.length}`);
  check("§2b her sayfanın `sayi`sı aynı ve satır sayısına eşit (cursor where'i daraltmaz)", yTum.sayilar.every((s) => s === beklenenTum.length), yTum.sayilar.join(","));
  check("§2c sıra lastAt↓", yTum.sirali);
  check("§2d bozuk imleç 400", (await fx.istek(a.token, "GET", "/api/bildirim?cursor=bozuk")).status === 400);
  check("§2e tanınmayan sekme 400", (await fx.istek(a.token, "GET", "/api/bildirim?sekme=hepsi")).status === 400);

  // §3 okundu atomik
  const hedef = gorunenOkunmamis[0]!;
  const [r1, r2] = await Promise.all([
    fx.istek(a.token, "POST", `/api/bildirim/${hedef}/okundu`),
    fx.istek(a.token, "POST", `/api/bildirim/${hedef}/okundu`),
  ]);
  const degisen = [r1, r2].filter((r) => r.json?.data?.degisti === true).length;
  check("§3a paralel iki okundu → ikisi 200, TEK `degisti:true`", r1.status === 200 && r2.status === 200 && degisen === 1, `${r1.json?.data?.degisti}/${r2.json?.data?.degisti}`);
  const tekrar = await fx.istek(a.token, "POST", `/api/bildirim/${hedef}/okundu`);
  check("§3b zaten okunmuş → 200 {degisti:false}", tekrar.status === 200 && tekrar.json?.data?.degisti === false);
  const geri = await fx.istek(a.token, "POST", `/api/bildirim/${hedef}/okunmadi`);
  const satirGeri = await prisma.notificationInbox.findUnique({ where: { id: hedef }, select: { readAt: true } });
  check("§3c okunmadı → readAt null", geri.json?.data?.degisti === true && satirGeri?.readAt === null);

  // §4 kapsam
  const baskasi = await fx.istek(a.token, "POST", `/api/bildirim/${bSatir}/okundu`);
  const bDurum = await prisma.notificationInbox.findUnique({ where: { id: bSatir }, select: { readAt: true } });
  check("§4a başkasının satırı 404 BILDIRIM_YOK ve dokunulmadı", baskasi.status === 404 && baskasi.json?.details?.code === "BILDIRIM_YOK" && bDurum?.readAt === null);
  const gizliOk = await fx.istek(a.token, "POST", `/api/bildirim/${gizli[0]}/okundu`);
  check("§4b izni olmayan türdeki KENDİ satırı 404 (varlığı sızmaz)", gizliOk.status === 404);
  check("§4c bozuk id 404", (await fx.istek(a.token, "POST", "/api/bildirim/xyz/okundu")).status === 404);
  check("§4d başkasının satırını erteleme 404", (await fx.istek(a.token, "POST", `/api/bildirim/${bSatir}/ertele`, { sure: "1s" })).status === 404);

  // §5 ertele
  const ert = gorunenOkunmamis[1]!;
  const e1 = await fx.istek(a.token, "POST", `/api/bildirim/${ert}/ertele`, { sure: "1s" });
  const bitis = new Date(e1.json?.data?.erteleBitis ?? 0).getTime();
  check("§5a ertele 1s → ~1 saat sonrası", e1.status === 200 && Math.abs(bitis - Date.now() - 3_600_000) < 60_000);
  const ertListe = await yuru(a, "ertelenen", 50);
  const okListe = await yuru(a, "okunmamis", 50);
  check("§5b ertelenen sekmesinde var, okunmamışta yok", ertListe.ids.includes(ert) && !okListe.ids.includes(ert));
  const ys = await fx.istek(a.token, "POST", `/api/bildirim/${ert}/ertele`, { sure: "yarin-sabah" });
  check("§5c yarın sabah → gelecekte", ys.status === 200 && new Date(ys.json?.data?.erteleBitis).getTime() > Date.now());
  check("§5d bozuk süre 400", (await fx.istek(a.token, "POST", `/api/bildirim/${ert}/ertele`, { sure: "2gun" })).status === 400);
  await prisma.notificationInbox.update({ where: { id: ert }, data: { snoozedUntil: null } });

  // §6 tümü + geri al
  const once = await yuru(a, "okunmamis", 100);
  const tum = await fx.istek(a.token, "POST", "/api/bildirim/tumunu-okundu");
  const ids: string[] = tum.json?.data?.ids ?? [];
  check("§6a tümünü okundu → okunmamış sekmesinin TAM kümesi", tum.status === 200 && ids.length === once.ids.length && once.ids.every((id) => ids.includes(id)), `${ids.length}/${once.ids.length}`);
  const ozSonra = (await fx.istek(a.token, "GET", "/api/bildirim/ozet")).json?.data;
  check("§6b sonra özet okunmamış 0", ozSonra?.okunmamis === 0);
  const gizliDurum = await prisma.notificationInbox.count({ where: { id: { in: gizli }, readAt: null } });
  check("§6c gizli türün satırı işaretlenmedi", gizliDurum === gizli.length);
  const ga = await fx.istek(a.token, "POST", "/api/bildirim/geri-al-okundu", { ids: [...ids, bSatir] });
  const gaIds: string[] = ga.json?.data?.ids ?? [];
  check("§6d geri al: yalnız kendi satırları döner (başkasınınki yok)", ga.status === 200 && gaIds.length === ids.length && !gaIds.includes(bSatir));
  const ozGeri = (await fx.istek(a.token, "GET", "/api/bildirim/ozet")).json?.data;
  check("§6e geri alınca okunmamış eski sayıya döner", ozGeri?.okunmamis === once.ids.length);
  check("§6f geri al boş liste 400", (await fx.istek(a.token, "POST", "/api/bildirim/geri-al-okundu", { ids: [] })).status === 400);

  // §7 süzgeç
  const sz = await fx.istek(a.token, "GET", "/api/bildirim?filter[tur]=sistem.lisans-uyarisi,sistem.yedek-basarisiz");
  const szTurler = new Set((sz.json?.data?.items ?? []).map((i: { tur: string }) => i.tur));
  check("§7a filter[tur] görme kümesiyle kesişir (gizli tür istense de gelmez)", sz.status === 200 && szTurler.size === 1 && szTurler.has("sistem.lisans-uyarisi") && sz.json.data.sayi === 1, [...szTurler].join(","));
  check("§7b çıplak `tur` 400 BARE_FILTER_PARAM", (await fx.istek(a.token, "GET", "/api/bildirim?tur=sistem.lisans-uyarisi")).json?.details?.code === "BARE_FILTER_PARAM");
  check("§7c bilinmeyen tür 400 UNKNOWN_KIND", (await fx.istek(a.token, "GET", "/api/bildirim?filter[tur]=yok.boyle")).json?.details?.code === "UNKNOWN_KIND");
  check("§7d tanınmayan süzgeç adı 400", (await fx.istek(a.token, "GET", "/api/bildirim?filter[userId]=x")).status === 400);

  // §8 katalog
  const kat = await fx.istek(a.token, "GET", "/api/bildirim/katalog");
  const kodlar: string[] = (kat.json?.data?.turler ?? []).map((t: { kod: string }) => t.kod);
  check("§8a katalog görülebilir türleri verir, gizliyi vermez", kat.status === 200 && kodlar.includes("sistem.lisans-uyarisi") && kodlar.includes("siparis.patron-siparisi") && !kodlar.includes("sistem.yedek-basarisiz"), kodlar.join(","));
  const katB: string[] = ((await fx.istek(b.token, "GET", "/api/bildirim/katalog")).json?.data?.turler ?? []).map((t: { kod: string }) => t.kod);
  check("§8b B (yalnız order:read) lisans türünü görmez", !katB.includes("sistem.lisans-uyarisi") && katB.includes("siparis.patron-siparisi"));

  await satirSuzgecleri();
}

/** §9 — ayrı kullanıcı: önceki bölümlerin sayımlarını bozmaz. */
async function satirSuzgecleri(): Promise<void> {
  const c = await fx.kullanici("c", ["order:read"]);
  const ozetId = await satir(c.id, "siparis.patron-siparisi", 1, { ozet: true });
  const tabletId = await satir(c.id, "siparis.termin-gecti", 2, { kanalTablet: true });
  const duz = await satir(c.id, "siparis.patron-siparisi", 3);
  const liste = async (q: string) => (await fx.istek(c.token, "GET", `/api/bildirim?${q}`)).json?.data;
  const ids = (d: { items?: { id: string }[] } | undefined) => (d?.items ?? []).map((i) => i.id);

  const oz = await liste("filter[ozet]=true");
  check("§9a filter[ozet]=true yalnız özet satırı; sayi aynı where'den", ids(oz).join() === ozetId && oz?.sayi === 1, ids(oz).join());
  const ozYok = await liste("filter[ozet]=false");
  check("§9b filter[ozet]=false özet satırını dışlar", ids(ozYok).length === 2 && !ids(ozYok).includes(ozetId) && ozYok?.sayi === 2);
  const tb = await liste("sekme=okunmamis&filter[tablet]=true");
  check("§9c filter[tablet]=true yalnız tablet kanalı açık satır", ids(tb).join() === tabletId && tb?.sayi === 1, ids(tb).join());
  const kn = await liste("filter[kanal]=TABLET_SES");
  check("§9d filter[kanal]=TABLET_SES: tablet kanalı olmayan türler dışarıda", kn?.sayi === 0 && ids(kn).length === 0, String(kn?.sayi));
  const hepsi = await liste("sekme=tumu");
  const tbSatir = (hepsi?.items ?? []).find((i: { id: string }) => i.id === tabletId);
  const duzSatir = (hepsi?.items ?? []).find((i: { id: string }) => i.id === duz);
  check("§9e satırda ozet/kanalTablet/sesli alanları", tbSatir?.kanalTablet === true && tbSatir?.sesli === true && duzSatir?.sesli === false && typeof duzSatir?.ozet === "boolean");
  await prisma.notificationUserSetting.upsert({ where: { userId: c.id }, create: { userId: c.id, sound: false }, update: { sound: false } });
  const sessiz = (await liste("filter[tablet]=true"))?.items?.[0];
  check("§9f kişinin ses ayarı kapalı → sesli=false (kanalTablet aynen)", sessiz?.kanalTablet === true && sessiz?.sesli === false);
  check("§9g bozuk filter[ozet] değeri 400", (await fx.istek(c.token, "GET", "/api/bildirim?filter[ozet]=evet")).status === 400);
  check("§9h tanınmayan filter[kanal] 400", (await fx.istek(c.token, "GET", "/api/bildirim?filter[kanal]=MASAUSTU")).status === 400);
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim gelen kutusu API'si ===\n");
  try {
    await govde();
  } finally {
    try {
      await fx.kapat();
    } catch (err) {
      fail++;
      console.error("❌ temizlik başarısız", err);
    }
  }
}

main()
  .catch((err) => {
    fail++;
    console.error("❌ beklenmeyen hata", err);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
