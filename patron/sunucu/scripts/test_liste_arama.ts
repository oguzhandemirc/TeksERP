// =============================================================================
// LİSTE ARAMASI BEKÇİSİ — seçicilerin sunucu araması (`GET /api/veri/:p?ara=&suzgec=`), gerçek HTTP:
//   §1 ⭐ katlama JS ↔ SQL birebir (Türkçe harf tablosu + ASCII küçültme; canlı DB'de)
//   §2 ⭐ ad/kod parça eşleşme Türkçe katlamalı; LIKE jokeri (`%`, `_`, `!`) desen yazamaz
//   §3 tek süzgeç: cari rolü · ürün türü · renk durumu; tanınmayan süzgeç 400
//   §4 ⭐ imleç aynı terimle tutarlı: sayfalar kesişmez, eşleşmeyen sızmaz, hepsi gelir
//   §5 kapılar: aranmayan liste 400 · uzun terim 400 · başka tesisin kaydı görünmez (RLS) · oturumsuz 401
// Koşum: npx tsx scripts/test_liste_arama.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { ROLE_TEMPLATES } from "../src/catalog/permissions";
import { FOLD_FROM, FOLD_TO, foldTerm, likePattern } from "../src/lib/search";
import { ARAMA_AZAMI, LIST_SEARCH } from "../src/wire/api";
import { api, girdi, hesapKur, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, type Ortam, type TestHesabi, type TestKurulumu } from "./lib/test-ortam";

type Liste = { kayitlar: { id: string; kayit: Record<string, unknown> }[]; sonraki: string | null };

async function katlamaEsitligi(o: Ortam): Promise<void> {
  console.log("\n§1 katlama JS ↔ SQL");
  const ornekler = [FOLD_FROM, FOLD_TO, "ÇAĞRI TEKSTİL", "ığüşöç IĞÜŞÖÇ", "ABCXYZ abcxyz 0123", "Émile Ø ß Жара", "%_!\\'\"", "İstanbul IŞIK", ""];
  const c = new Client({ connectionString: o.ctx.config.DATABASE_URL });
  await c.connect();
  try {
    const bozuk: string[] = [];
    for (const x of ornekler) {
      const r = await c.query<{ f: string }>(`SELECT lower(translate($1::text, $2::text, $3::text) COLLATE "C") AS f`, [x, FOLD_FROM, FOLD_TO]);
      if (r.rows[0]!.f !== foldTerm(x)) bozuk.push(`${x} → SQL ${r.rows[0]!.f} ≠ JS ${foldTerm(x)}`);
    }
    kontrol("§1a ⭐ her örnekte SQL katlaması = JS katlaması", bozuk.length === 0, bozuk.join(" | "));
  } finally {
    await c.end();
  }
  kontrol("§1b harf tablosu iki yanda eşit uzunluk", [...FOLD_FROM].length === [...FOLD_TO].length);
  kontrol("§1c jokerler kaçırılır", likePattern("a%b_c!d") === "%a!%b!_c!!d%", likePattern("a%b_c!d"));
}

interface Ids {
  readonly cari: Record<string, string>;
  readonly urun: Record<string, string>;
  readonly renk: Record<string, string>;
}

async function fikstur(o: Ortam, k: TestKurulumu, ek = ""): Promise<Ids> {
  const w = { t: new Date(o.saat.simdi() - 60_000).toISOString(), k: "000000000001" };
  const cari = { cagri: randomUUID(), cagriT: randomUUID(), yuzde: randomUUID(), alt: randomUUID(), fason: randomUUID(), ...Object.fromEntries(Array.from({ length: 5 }, (_x, i) => [`seri${i}`, randomUUID()])) };
  const urun = { kumas: randomUUID(), iplik: randomUUID() };
  const renk = { lacivert: randomUUID(), eski: randomUUID() };
  const cariSatir = (id: string, kod: string, ad: string, rol: [boolean, boolean, boolean]) => ({ id, kod, ad: ad + ek, musteriRolu: rol[0], tedarikciRolu: rol[1], fasonRolu: rol[2], aktif: true });
  const kayitlar = [
    girdi("cari-kart", {
      yaz: [
        cariSatir(cari.cagri, "C-17", "ÇAĞRI TEKSTİL", [true, false, false]),
        cariSatir(cari.cagriT, "C-18", "Çağrı İplik", [false, true, false]),
        cariSatir(cari.yuzde, "C-19", "YÜZDE %50 KUMAŞ", [true, false, false]),
        cariSatir(cari.alt, "C_20", "ALT_CIZGI", [true, false, false]),
        cariSatir(cari.fason, "C-21", "IŞIK BOYA", [false, false, true]),
        ...Array.from({ length: 5 }, (_x, i) => cariSatir(cari[`seri${i}` as keyof typeof cari]!, `S-${i}`, `SERİ FİRMA ${i}`, [true, false, false])),
      ],
      yeni: w,
    }),
    girdi("urun", { yaz: [{ id: urun.kumas, kod: "K-1", ad: "PENYE ÖRME", tur: "FABRIC", aktif: true }, { id: urun.iplik, kod: "I-1", ad: "PENYE İPLİĞİ", tur: "YARN", aktif: true }], yeni: w }),
    girdi("renk", { yaz: [{ id: renk.lacivert, kod: "R-1", ad: "LACİVERT", aktif: true }, { id: renk.eski, kod: "R-2", ad: "LACİVERT ESKİ", aktif: false }], yeni: w }),
  ];
  const r = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(o.saat.simdi() - 60_000), kayitlar }) });
  if (r.status !== 200 || (r.json as unknown as { ret: unknown[] }).ret.length > 0) throw new Error(`fikstür: ${r.status} ${JSON.stringify(r.json)}`);
  return { cari, urun, renk };
}

async function ara(o: Ortam, h: TestHesabi, p: string, sorgu: Record<string, string>) {
  const qs = new URLSearchParams(sorgu).toString();
  const r = await api(o, "GET", `/api/veri/${p}?${qs}`, { belirtec: h.belirtec });
  return { status: r.status, kod: r.json.details?.code, ids: new Set(((r.json.data as Liste | undefined)?.kayitlar ?? []).map((x) => x.id)), sonraki: (r.json.data as Liste | undefined)?.sonraki ?? null };
}

const ayni = (a: Set<string>, b: readonly string[]): boolean => a.size === b.length && b.every((x) => a.has(x));

async function eslesme(o: Ortam, h: TestHesabi, ids: Ids): Promise<void> {
  console.log("\n§2 parça eşleşme");
  for (const t of ["cagri", "ÇAĞRI", "çağrı", "CAGRI"]) {
    const r = await ara(o, h, "cari-kart", { ara: t });
    kontrol(`§2a ⭐ "${t}" iki Çağrı kaydını bulur (Türkçe katlama, büyük/küçük)`, r.status === 200 && ayni(r.ids, [ids.cari.cagri!, ids.cari.cagriT!]), `${r.status} ${r.ids.size}`);
  }
  const tekstil = await ara(o, h, "cari-kart", { ara: "tekstil" });
  kontrol("§2b \"tekstil\" → yalnız ÇAĞRI TEKSTİL (İ katlanır)", ayni(tekstil.ids, [ids.cari.cagri!]), `${tekstil.ids.size}`);
  const isik = await ara(o, h, "cari-kart", { ara: "ışık" });
  kontrol("§2c \"ışık\" → IŞIK BOYA (ı ↔ I)", ayni(isik.ids, [ids.cari.fason!]), `${isik.ids.size}`);
  const kod = await ara(o, h, "cari-kart", { ara: "c-17" });
  kontrol("§2d kod da aranır (c-17)", ayni(kod.ids, [ids.cari.cagri!]), `${kod.ids.size}`);
  const yuzde = await ara(o, h, "cari-kart", { ara: "%" });
  kontrol("§2e ⭐ \"%\" joker DEĞİL: yalnız adında % geçen kayıt", ayni(yuzde.ids, [ids.cari.yuzde!]), `${yuzde.ids.size}`);
  const alt = await ara(o, h, "cari-kart", { ara: "_" });
  kontrol("§2f ⭐ \"_\" joker DEĞİL: yalnız alt çizgili kayıt", ayni(alt.ids, [ids.cari.alt!]), `${alt.ids.size}`);
  const unlem = await ara(o, h, "cari-kart", { ara: "!" });
  kontrol("§2g kaçış karakteri (!) düz karakter: eşleşme yok", unlem.status === 200 && unlem.ids.size === 0, `${unlem.status} ${unlem.ids.size}`);
  const iplik = await ara(o, h, "urun", { ara: "ipligi" });
  kontrol("§2h ürün: \"ipligi\" → PENYE İPLİĞİ", ayni(iplik.ids, [ids.urun.iplik!]), `${iplik.ids.size}`);
}

async function suzgec(o: Ortam, h: TestHesabi, ids: Ids): Promise<void> {
  console.log("\n§3 tek süzgeç");
  const tedarik = await ara(o, h, "cari-kart", { ara: "cagri", suzgec: "TEDARIKCI" });
  kontrol("§3a ara + rol=TEDARIKCI → yalnız Çağrı İplik", ayni(tedarik.ids, [ids.cari.cagriT!]), `${tedarik.ids.size}`);
  const fason = await ara(o, h, "cari-kart", { suzgec: "FASON" });
  kontrol("§3b yalnız süzgeç (rol=FASON)", ayni(fason.ids, [ids.cari.fason!]), `${fason.ids.size}`);
  const kumas = await ara(o, h, "urun", { ara: "penye", suzgec: "FABRIC" });
  kontrol("§3c ürün türü=FABRIC", ayni(kumas.ids, [ids.urun.kumas!]), `${kumas.ids.size}`);
  const aktif = await ara(o, h, "renk", { ara: "lacivert", suzgec: "AKTIF" });
  const pasif = await ara(o, h, "renk", { ara: "lacivert", suzgec: "PASIF" });
  kontrol("§3d renk durum süzgeci (boolean jsonb eşitliği) iki yönde", ayni(aktif.ids, [ids.renk.lacivert!]) && ayni(pasif.ids, [ids.renk.eski!]), `${aktif.ids.size}/${pasif.ids.size}`);
  const bilinmez = await ara(o, h, "cari-kart", { suzgec: "FABRIC" });
  kontrol("§3e başka listenin süzgeci → 400", bilinmez.status === 400 && bilinmez.kod !== undefined, `${bilinmez.status}`);
  const bayrak = Object.values(LIST_SEARCH).every((s) => s.suzgec === null || s.suzgec.varsayilan === null || s.suzgec.secenekler.some((x) => x.deger === s.suzgec!.varsayilan));
  kontrol("§3f her varsayılan süzgeç kendi seçeneklerinde", bayrak);
}

async function imlec(o: Ortam, h: TestHesabi, ids: Ids): Promise<void> {
  console.log("\n§4 imleç");
  const beklenen = Array.from({ length: 5 }, (_x, i) => ids.cari[`seri${i}`]!);
  const gorulen: string[] = [];
  let sonraki: string | null = null;
  let sayfa = 0;
  do {
    const r = await ara(o, h, "cari-kart", { ara: "seri firma", limit: "2", ...(sonraki ? { imlec: sonraki } : {}) });
    if (r.status !== 200) break;
    gorulen.push(...r.ids);
    sonraki = r.sonraki;
    sayfa += 1;
  } while (sonraki && sayfa < 10);
  kontrol("§4a ⭐ 3 sayfada tam 5 kayıt, tekrar yok, eşleşmeyen yok", sayfa === 3 && gorulen.length === 5 && ayni(new Set(gorulen), beklenen), `sayfa ${sayfa} · ${gorulen.length}`);
}

async function kapilar(o: Ortam, h: TestHesabi, yabanci: Ids): Promise<void> {
  console.log("\n§5 kapılar");
  const sip = await ara(o, h, "siparis", { ara: "x" });
  kontrol("§5a aranmayan liste (siparis) → 400", sip.status === 400, `${sip.status}`);
  const uzun = await ara(o, h, "cari-kart", { ara: "a".repeat(ARAMA_AZAMI + 1) });
  kontrol("§5b azamiden uzun terim → 400", uzun.status === 400, `${uzun.status}`);
  const sinir = await ara(o, h, "cari-kart", { ara: "a".repeat(ARAMA_AZAMI) });
  kontrol("§5c azami uzunluk kabul", sinir.status === 200, `${sinir.status}`);
  const rls = await ara(o, h, "cari-kart", { ara: "cagri" });
  kontrol("§5d ⭐ başka tesisin aynı adlı kaydı görünmez", ![...rls.ids].some((x) => Object.values(yabanci.cari).includes(x)) && rls.ids.size === 2, `${rls.ids.size}`);
  const anon = await api(o, "GET", "/api/veri/cari-kart?ara=cagri");
  kontrol("§5e oturumsuz → 401", anon.status === 401, `${anon.status}`);
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const k = await tesisKur(o);
  const k2 = await tesisKur(o);
  try {
    await katlamaEsitligi(o);
    const ids = await fikstur(o, k);
    const yabanci = await fikstur(o, k2);
    const h = await hesapKur(o, k.tesisId, ROLE_TEMPLATES.PATRON);
    await eslesme(o, h, ids);
    await suzgec(o, h, ids);
    await imlec(o, h, ids);
    await kapilar(o, h, yabanci);
  } finally {
    await temizleTesis(o, k.tesisId);
    await temizleTesis(o, k2.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
