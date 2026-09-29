// =============================================================================
// PATRON BULUTU — ŞEMA ÖLÇÜMÜ (SALT OKUNUR)
// Çalıştır: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/olcum/patron-sema-olcumu.ts [--json]
// =============================================================================
// Projeksiyon kataloğunu (`patron-katalog.ts`) CANLI ŞEMAYA karşı ölçer — şema
// `prisma migrate deploy` sonrası DB'dedir, `schema.prisma` metni ham SQL ile
// eklenen indeksleri göstermez. Sorular:
//   ① katalogdaki her OPT-IN kaynak kolon var mı (yoksa çıkış 1)
//   ② her bağımlılık tablosunda filigran kolonu var mı, onunla BAŞLAYAN (KISMİ olmayan) indeks
//      var mı, `(filigran, id|PK)` bileşik indeksi var mı → migration önerisi (düz
//      `CREATE INDEX` — Prisma migration tek tx içinde koşar, CONCURRENTLY yazılmaz [DB-26])
//   ③ kök tablolara ON DELETE CASCADE ile bağlanan FK'lar (dolaylı hard delete)
//   ④ kökte OPT-IN DIŞINDA kalan kolonlar (gözden geçirme için)
//   ⑤ şemadaki hangi tablo ne katalogda ne `BILINCLI_DISARIDA`da (sınıflanmamış)
//   ⑥ güvenli ufuk için `pg_stat_activity.xact_start` bu rolden görünüyor mu
// HİÇBİR ŞEY YAZMAZ. Fabrika verisine koşulmaz: hedef `_test` kalıbında değilse
// ya da fabrika ölçeğinde top taşıyorsa DURUR (`hedef-db-kapisi`).
// =============================================================================
import { pool } from "../../src/lib/prisma";
import { fixtureHedefEngeli, hacimHedefEngeli, hedefDbAdi } from "../lib/hedef-db-kapisi";
import { BILINCLI_DISARIDA, KAYIT_PROJEKSIYONLARI, PROJEKSIYONLAR, YARDIMCI_OKUMALAR } from "./patron-katalog";

const JSON_CIKTI = process.argv.includes("--json");

/** `kismi`: WHERE'li indeks tablonun tamamını taramaz — filigran taraması için SAYILMAZ. */
interface IndeksBilgisi { ad: string; tanim: string; kolonlar: string[]; kismi: boolean; birincil: boolean }

async function kolonlar(): Promise<Map<string, Map<string, string>>> {
  const r = await pool.query<{ t: string; c: string; u: string }>(
    `SELECT table_name AS t, column_name AS c, udt_name AS u
       FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const m = new Map<string, Map<string, string>>();
  for (const row of r.rows) {
    if (!m.has(row.t)) m.set(row.t, new Map());
    m.get(row.t)!.set(row.c, row.u);
  }
  return m;
}

async function indeksler(): Promise<Map<string, IndeksBilgisi[]>> {
  // Kolon sırası pg_index.indkey'den; ifade indeksinde kolon adı null gelir (atlanır).
  const r = await pool.query<{ t: string; ad: string; tanim: string; kolonlar: string[]; kismi: boolean; birincil: boolean }>(
    `SELECT c.relname AS t, i.relname AS ad, pg_get_indexdef(x.indexrelid) AS tanim,
            (x.indpred IS NOT NULL) AS kismi, x.indisprimary AS birincil,
            ARRAY(SELECT a.attname FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
                   ORDER BY k.ord)::text[] AS kolonlar
       FROM pg_index x
       JOIN pg_class c ON c.oid = x.indrelid
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'`,
  );
  const m = new Map<string, IndeksBilgisi[]>();
  for (const row of r.rows) {
    if (!m.has(row.t)) m.set(row.t, []);
    m.get(row.t)!.push({ ad: row.ad, tanim: row.tanim, kolonlar: row.kolonlar, kismi: row.kismi, birincil: row.birincil });
  }
  return m;
}

async function kaskadlar(tablolar: string[]): Promise<Array<{ cocuk: string; kolon: string; ebeveyn: string }>> {
  const r = await pool.query<{ cocuk: string; kolon: string; ebeveyn: string }>(
    `SELECT cc.relname AS cocuk, a.attname AS kolon, pc.relname AS ebeveyn
       FROM pg_constraint k
       JOIN pg_class cc ON cc.oid = k.conrelid
       JOIN pg_class pc ON pc.oid = k.confrelid
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND k.confdeltype = 'c' AND (cc.relname = ANY($1) OR pc.relname = ANY($1))
      ORDER BY 1, 2`,
    [tablolar],
  );
  return r.rows;
}

async function main(): Promise<void> {
  const engel = fixtureHedefEngeli();
  if (engel) { console.error(`DURDU: ${engel}`); process.exit(2); }
  const hacim = await hacimHedefEngeli();
  if (hacim.engel) { console.error(`DURDU: ${hacim.engel}`); process.exit(2); }

  const sema = await kolonlar();
  const idx = await indeksler();
  const hatalar: string[] = [];

  // ① OPT-IN kolonlar var mı + ④ dışarıda kalanlar
  const kokRaporu = KAYIT_PROJEKSIYONLARI.map((p) => {
    const t = sema.get(p.kok.tablo);
    if (!t) { hatalar.push(`${p.ad}: kök tablo YOK (${p.kok.tablo})`); return null; }
    const eksik = p.kolonlar.filter((c) => !t.has(c.kaynak)).map((c) => c.kaynak);
    for (const e of eksik) hatalar.push(`${p.ad}: opt-in kolon şemada YOK → ${p.kok.tablo}.${e}`);
    const alinan = new Set(p.kolonlar.map((c) => c.kaynak));
    const disarida = [...t.keys()].filter((c) => !alinan.has(c));
    return { projeksiyon: p.ad, tablo: p.kok.tablo, optIn: p.kolonlar.length, toplam: t.size, disarida };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  // ② filigran + indeks
  const bagTablolari = new Map<string, Set<string>>();
  for (const p of KAYIT_PROJEKSIYONLARI) {
    for (const b of p.bagimliliklar) {
      if (!bagTablolari.has(b.tablo)) bagTablolari.set(b.tablo, new Set());
      bagTablolari.get(b.tablo)!.add(b.filigran);
    }
  }
  const filigranRaporu: Array<{
    tablo: string; filigran: string; kolonVar: boolean; basIndeks: string | null; bilesikIndeks: string | null;
    oneri: string | null;
  }> = [];
  for (const [tablo, filigranlar] of [...bagTablolari].sort(([a], [b]) => a.localeCompare(b))) {
    for (const f of filigranlar) {
      // Tetikleyiciyle işaretlenen tabloda filigran kolonu aranmaz (tasarım §4.3–4.4).
      if (f === "isaret") {
        filigranRaporu.push({ tablo, filigran: f, kolonVar: false, basIndeks: null, bilesikIndeks: null,
          oneri: "filigran YOK — INSERT/UPDATE/DELETE tetikleyicisi kök kimliğini sync_marks tablosuna KIRLI yazar (YENİ)" });
        continue;
      }
      const kolonVar = sema.get(tablo)?.has(f) ?? false;
      const tIdx = (idx.get(tablo) ?? []).filter((i) => !i.kismi);
      // Eşitlik bozucu: `id` varsa o, yoksa birincil anahtarın kolonları (ör. cari_balances (cariId, currency)).
      const pk = (idx.get(tablo) ?? []).find((i) => i.birincil)?.kolonlar ?? [];
      const bozucu = sema.get(tablo)?.has("id") ? ["id"] : pk;
      const bas = tIdx.find((i) => i.kolonlar[0] === f) ?? null;
      const bilesik = tIdx.find((i) => i.kolonlar[0] === f && bozucu.every((c, n) => i.kolonlar[n + 1] === c)) ?? null;
      const kismiVar = (idx.get(tablo) ?? []).find((i) => i.kismi && i.kolonlar[0] === f) ?? null;
      let oneri: string | null = null;
      if (!kolonVar) {
        oneri = `KOLON YOK: '${f}' eklenmeli (@updatedAt, DEFAULT now()) ya da değişiklik ebeveyn dokunuşuyla/uzlaştırmayla yakalanmalı`;
        hatalar.push(`${tablo}: filigran kolonu '${f}' YOK`);
      } else if (!bilesik) {
        const kol = [f, ...bozucu].map((c) => `"${c}"`).join(", ");
        oneri = `CREATE INDEX IF NOT EXISTS "${tablo}_${f}_esitleme_idx" ON "${tablo}" (${kol})` +
          (kismiVar ? ` — mevcut ${kismiVar.ad} KISMİ (WHERE'li), tam tarama için sayılmadı` : "");
      }
      filigranRaporu.push({ tablo, filigran: f, kolonVar, basIndeks: bas?.ad ?? null, bilesikIndeks: bilesik?.ad ?? null, oneri });
    }
  }
  // Yardımcı okumalar (birleştirme defteri, silme damgası): tablo tasarımda YENİ ise yokluğu hata değildir.
  for (const y of YARDIMCI_OKUMALAR) {
    const tabloVar = sema.has(y.tablo);
    const kolonVar = sema.get(y.tablo)?.has(y.filigran) ?? false;
    const bas = (idx.get(y.tablo) ?? []).find((i) => !i.kismi && i.kolonlar[0] === y.filigran) ?? null;
    let oneri: string | null = null;
    if (!tabloVar) {
      if (!y.neden.startsWith("YENİ")) hatalar.push(`${y.tablo}: yardımcı okuma tablosu YOK`);
      oneri = `bugün yok — ${y.neden}`;
    } else if (!kolonVar) {
      hatalar.push(`${y.tablo}: yardımcı filigran '${y.filigran}' YOK`);
    } else if (!bas) {
      oneri = `CREATE INDEX IF NOT EXISTS "${y.tablo}_${y.filigran}_esitleme_idx" ON "${y.tablo}" ("${y.filigran}")`;
    }
    filigranRaporu.push({ tablo: `${y.tablo} (yardımcı)`, filigran: y.filigran, kolonVar, basIndeks: bas?.ad ?? null, bilesikIndeks: null, oneri });
  }

  // ③ kaskadlar
  const kokTablolari = KAYIT_PROJEKSIYONLARI.map((p) => p.kok.tablo);
  const kaskad = await kaskadlar(kokTablolari);

  // ⑤ sınıflanmamış tablolar
  const katalogTablolari = new Set<string>([...kokTablolari, ...bagTablolari.keys()]);
  for (const p of PROJEKSIYONLAR) if (p.tur === "ANLIK") for (const t of p.okudugu) katalogTablolari.add(t);
  for (const y of YARDIMCI_OKUMALAR) katalogTablolari.add(y.tablo);
  const siniflanmamis = [...sema.keys()]
    .filter((t) => t !== "_prisma_migrations" && !katalogTablolari.has(t) && !(t in BILINCLI_DISARIDA))
    .sort();

  // ⑥ güvenli ufuk ön koşulu: xact_start bu rolden görünüyor mu
  const ufuk = await pool.query<{ rol: string; super: boolean; statsOkur: boolean; oturum: number; gorunur: number }>(
    `SELECT current_user AS rol,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super,
            pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER') AS "statsOkur",
            count(*)::int AS oturum,
            count(*) FILTER (WHERE xact_start IS NOT NULL OR state IS NOT NULL)::int AS gorunur
       FROM pg_stat_activity WHERE datname = current_database()`,
  );

  const sonuc = {
    hedef: hedefDbAdi(),
    projeksiyonSayisi: { toplam: PROJEKSIYONLAR.length, kayit: KAYIT_PROJEKSIYONLARI.length },
    kokRaporu, filigranRaporu, kaskad, siniflanmamis, ufuk: ufuk.rows[0], hatalar,
  };

  if (JSON_CIKTI) {
    console.log(JSON.stringify(sonuc, null, 2));
  } else {
    console.log(`# Patron bulutu şema ölçümü — hedef ${sonuc.hedef}`);
    console.log(`Projeksiyon: ${sonuc.projeksiyonSayisi.toplam} (kayıt ${sonuc.projeksiyonSayisi.kayit})\n`);
    console.log("## ① Kök tablolar — opt-in / toplam kolon");
    for (const r of kokRaporu) console.log(`- ${r.projeksiyon} (${r.tablo}): ${r.optIn}/${r.toplam} · dışarıda: ${r.disarida.join(", ")}`);
    console.log("\n## ② Filigran ve indeks");
    for (const r of filigranRaporu) {
      console.log(`- ${r.tablo}.${r.filigran}: kolon ${r.kolonVar ? "VAR" : "YOK"} · baş indeks ${r.basIndeks ?? "YOK"} · (f,id) ${r.bilesikIndeks ?? "YOK"}`);
      if (r.oneri) console.log(`    öneri: ${r.oneri}`);
    }
    console.log("\n## ③ ON DELETE CASCADE (kök tablo taraflı)");
    for (const r of kaskad) console.log(`- ${r.ebeveyn} silinirse → ${r.cocuk}.${r.kolon}`);
    console.log(`\n## ⑤ v1 dışında kalan, gerekçesi beyan edilmemiş tablo (${siniflanmamis.length}) — opt-in gereği gitmez: ${siniflanmamis.join(", ")}`);
    const u = sonuc.ufuk;
    console.log(`\n## ⑥ Ufuk ön koşulu: rol ${u.rol} · süper ${u.super} · pg_read_all_stats ${u.statsOkur} · oturum ${u.oturum}`);
    console.log(`\n## Hatalar (${hatalar.length})`);
    for (const h of hatalar) console.log(`- ${h}`);
  }
  await pool.end();
  process.exit(hatalar.length > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(3);
});
