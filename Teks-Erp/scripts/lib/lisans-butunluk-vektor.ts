// Bütünlük vektörleri (kâhin + `cargo test` ortak dosyası): imzalı yük + liste dosyası +
// kapsam yürüyüşü. Her vektör kendi dosya ağacını taşır (`dosyalar`); liste dosyası da onlardan biri.
import { createHash, randomUUID } from "node:crypto";
import { TYP, b64uEncode, msToIso } from "../../src/lib/license/protocol";
import { INTEGRITY_TYP, type PackageKey } from "../../src/lib/license/integrity";
import { INTEGRITY_LIST_FILE, formatIntegrityList, type IntegrityListEntry } from "../../src/lib/license/integrity-list";
import { anahtarUret, hamImzala, type Fikstur, type TestAnahtari } from "./lisans-fikstur";
import type { DosyaGirdisi, Vektor } from "./lisans-cekirdek-vektor";

interface Dosya {
  readonly yol: string;
  readonly icerik: Buffer;
}

const sha = (b: Buffer): string => b64uEncode(createHash("sha256").update(b).digest());
const girdi = (d: Dosya): DosyaGirdisi => ({ yol: d.yol, icerik: b64uEncode(d.icerik) });
const liste = (dosyalar: readonly Dosya[]): IntegrityListEntry[] => dosyalar.map((d) => ({ yol: d.yol, sha256: sha(d.icerik), boyut: d.icerik.length }));

/** Kapsamdaki dosyalar (liste bunları taşır) + kapsam DIŞINDAKİ bir dosya (liste taşımaz). */
const KAPSAMDA: readonly Dosya[] = [
  { yol: "dist/server.jsc", icerik: Buffer.from("bayt kodu yerine örnek içerik — ş ğ ü") },
  { yol: "native/@ek+x_1.node", icerik: Buffer.alloc(3000, 9) },
  { yol: "node_modules/paket/Quick Start/ilk adim.md", icerik: Buffer.from("# boşluklu ad (gerçek node_modules'te var)\n") },
  { yol: "prisma/migrations/20260929000000_ilk/migration.sql", icerik: Buffer.from("CREATE TABLE x (id uuid);\n") },
  { yol: "bos.txt", icerik: Buffer.alloc(0) },
];
const KAPSAM_DISI: Dosya = { yol: "logs/out.log", icerik: Buffer.from("log\n") };
const KAPSAM = { dizinler: ["dist", "native", "node_modules", "prisma/migrations"], dosyalar: ["bos.txt", "package.json"] };

export function butunlukVektorleri(f: Fikstur): Vektor[] {
  const paket = anahtarUret("paket-2026");
  const keys: PackageKey[] = [{ kid: paket.kid, x: paket.x }];
  const dogruListe = formatIntegrityList(liste(KAPSAMDA));

  /** İmzalı yük: `baytlar` liste dosyasının özeti/boyu, `sayi` satır sayısı (verilmezse listeninki). */
  const yuk = (baytlar: Buffer, ek: Record<string, unknown> = {}, sayi?: number) => ({
    v: 1,
    paketId: randomUUID(),
    urun: "backend",
    surum: "2.12.0",
    derlemeTarihi: msToIso(f.simdi),
    musteri: "testfabrika",
    liste: { sha256: sha(baytlar), boyut: baytlar.length, dosyaSayisi: sayi ?? baytlar.toString("latin1").split("\n").length - 1 },
    kapsam: KAPSAM,
    ...ek,
  });
  const imzali = (ek: Record<string, unknown> = {}, o: { baytlar?: Buffer; sayi?: number; imzalayan?: TestAnahtari; typ?: string } = {}) =>
    hamImzala(o.typ ?? INTEGRITY_TYP, o.imzalayan ?? paket, yuk(o.baytlar ?? dogruListe, ek, o.sayi));

  /** Disk: kapsamdaki dosyalar (değiştirilmiş olabilir) + kapsam dışı + liste dosyası. */
  const disk = (o: { degis?: (d: Dosya) => DosyaGirdisi | null; ek?: DosyaGirdisi[]; listeBaytlari?: Buffer | null } = {}): DosyaGirdisi[] => {
    const kapsamda = KAPSAMDA.map(o.degis ?? girdi).filter((d): d is DosyaGirdisi => d !== null);
    const lst = o.listeBaytlari === null ? [] : [{ yol: INTEGRITY_LIST_FILE, icerik: b64uEncode(o.listeBaytlari ?? dogruListe) }];
    return [...kapsamda, girdi(KAPSAM_DISI), ...lst, ...(o.ek ?? [])];
  };
  const v = (ad: string, manifest: unknown, g: { keys?: PackageKey[] | null; dosyalar?: DosyaGirdisi[]; kok?: "var" | "yok" } = {}): Vektor => ({
    tur: "butunluk",
    ad,
    manifest,
    keys: g.keys === undefined ? keys : g.keys,
    dosyalar: g.dosyalar ?? disk(),
    kok: g.kok ?? "var",
  });
  /** Liste baytları elle (dilbilgisi vektörleri): imzalı özet DOĞRU, biçim bozuk. */
  const hamListe = (ad: string, metin: string | Buffer, sayi?: number): Vektor => {
    const b = typeof metin === "string" ? Buffer.from(metin, "latin1") : metin;
    return v(ad, imzali({}, { baytlar: b, sayi: sayi ?? 1 }), { dosyalar: disk({ listeBaytlari: b }) });
  };
  const s0 = sha(Buffer.from("x"));
  const satir = (yol: string, boyut = "1") => `${s0}\t${boyut}\t${yol}\n`;
  const degisik = (yol: string, icerik: Buffer | null) => (d: Dosya): DosyaGirdisi | null => (d.yol === yol ? (icerik === null ? null : { yol, icerik: b64uEncode(icerik) }) : girdi(d));

  const cokEksik = formatIntegrityList([...liste(KAPSAMDA), ...Array.from({ length: 55 }, (_, i) => ({ yol: `dist/eksik/d${String(i).padStart(2, "0")}.js`, sha256: s0, boyut: 1 }))]);
  const cokFazla = Array.from({ length: 55 }, (_, i) => ({ yol: `dist/yama/f${String(i).padStart(2, "0")}.js`, icerik: b64uEncode(Buffer.from("evil()")) }));
  return [
    v("geçerli", imzali()),
    v("müşteri null", imzali({ musteri: null })),
    v("tanınmayan üst alan atılır", imzali({ fazla: 1, kurulumId: randomUUID() })),
    v("kapsam dışında yeni dosya sorulmaz", imzali(), { dosyalar: disk({ ek: [{ yol: "logs/yeni.log", icerik: b64uEncode(Buffer.from("x")) }] }) }),
    v("kapsamda boş dizin sorulmaz", imzali(), { dosyalar: disk({ ek: [{ yol: "dist/bos-dizin", icerik: null }] }) }),
    v("içerik değişmiş (aynı boy)", imzali(), { dosyalar: disk({ degis: degisik("native/@ek+x_1.node", Buffer.alloc(3000, 8)) }) }),
    v("boyut farklı", imzali(), { dosyalar: disk({ degis: degisik("bos.txt", Buffer.from("x")) }) }),
    v("dosya eksik (migration SQL)", imzali(), { dosyalar: disk({ degis: degisik("prisma/migrations/20260929000000_ilk/migration.sql", null) }) }),
    v("dosya yerine dizin", imzali(), { dosyalar: disk({ degis: (d) => (d.yol === "dist/server.jsc" ? { yol: d.yol, icerik: null } : girdi(d)) }) }),
    v("55 eksik (liste 50'de kesilir)", imzali({}, { baytlar: cokEksik }), { dosyalar: disk({ listeBaytlari: cokEksik }) }),
    v("FAZLA dosya (dist)", imzali(), { dosyalar: disk({ ek: [{ yol: "dist/yama.js", icerik: b64uEncode(Buffer.from("evil()")) }] }) }),
    v("FAZLA dosya (node_modules, isteğe bağlı bağımlılık gölgesi)", imzali(), { dosyalar: disk({ ek: [{ yol: "node_modules/opsiyonel/index.js", icerik: b64uEncode(Buffer.from("evil()")) }] }) }),
    v("FAZLA kapsam dosyası (listede yokken belirdi)", imzali(), { dosyalar: disk({ ek: [{ yol: "package.json", icerik: b64uEncode(Buffer.from("{}")) }] }) }),
    v("55 FAZLA (liste 50'de kesilir)", imzali(), { dosyalar: disk({ ek: cokFazla }) }),
    v("eksik + FAZLA birlikte → UYUSMAZ önce", imzali(), { dosyalar: disk({ degis: degisik("bos.txt", null), ek: [{ yol: "dist/yama.js", icerik: b64uEncode(Buffer.from("evil()")) }] }) }),
    v("liste dosyası yok", imzali(), { dosyalar: disk({ listeBaytlari: null }) }),
    v("liste dosyası yerine dizin", imzali(), { dosyalar: [...disk({ listeBaytlari: null }), { yol: INTEGRITY_LIST_FILE, icerik: null }] }),
    v("liste dosyası değişmiş (aynı boy)", imzali(), { dosyalar: disk({ listeBaytlari: Buffer.from(dogruListe.toString("latin1").replace("dist/server.jsc", "dist/server.jsx"), "latin1") }) }),
    v("liste dosyası boyu farklı", imzali(), { dosyalar: disk({ listeBaytlari: Buffer.concat([dogruListe, Buffer.from(satir("zz/ek.js"))]) }) }),
    v("imzalı satır sayısı listeden farklı", imzali({}, { sayi: 4 })),
    hamListe("liste: sırasız", satir("dist/b.js") + satir("dist/a.js"), 2),
    hamListe("liste: tekrarlı yol", satir("dist/a.js") + satir("dist/a.js"), 2),
    hamListe("liste: CRLF", `${s0}\t1\tdist/a.js\r\n`),
    hamListe("liste: son LF yok", `${s0}\t1\tdist/a.js`),
    hamListe("liste: boş satır", `${satir("dist/a.js")}\n`, 2),
    hamListe("liste: yol `..`", satir("dist/../a.js")),
    hamListe("liste: yol ters eğik çizgi", satir("dist\\a.js")),
    hamListe("liste: yol mutlak", satir("/etc/passwd")),
    hamListe("liste: yol iki nokta (sürücü/ADS)", satir("C:/x")),
    hamListe("liste: boyut baştaki sıfır", satir("dist/a.js", "01")),
    hamListe("liste: boyut 2^53", satir("dist/a.js", "9007199254740992")),
    hamListe("liste: sha256 kısa", `abc\t1\tdist/a.js\n`),
    hamListe("liste: ASCII dışı bayt", Buffer.concat([Buffer.from(`${s0}\t1\tdist/`), Buffer.from([0xc5, 0x9f]), Buffer.from(".js\n")])),
    hamListe("liste: fazla sütun", `${s0}\t1\tdist/a.js\tx\n`),
    v("kök dizin yok", imzali(), { kok: "yok" }),
    v("çapa boş", imzali(), { keys: [] }),
    // Kid üretim/hazırlık biçiminde DEĞİL (test_lisans_butunluk §2a): çapaya giren gerçek anahtar bu vektörü kaydıramaz.
    v("gömülü çapa: test paket anahtarı tanınmıyor", imzali({}, { imzalayan: anahtarUret("paket-fikstur") }), { keys: null }),
    v("çapa kid biçimsiz", imzali(), { keys: [{ kid: "PAKET-1", x: paket.x }] }),
    v("çapa kid tekrarlı", imzali(), { keys: [...keys, ...keys] }),
    v("çapa anahtarı biçimsiz", imzali(), { keys: [{ kid: paket.kid, x: "abc" }] }),
    v("başka paket anahtarı", imzali({}, { imzalayan: anahtarUret("paket-2027") })),
    v("aynı kid başka anahtar", imzali({}, { imzalayan: anahtarUret("paket-2026") })),
    v("typ farklı", imzali({}, { typ: TYP.HAK })),
    v("eski biçim (yükte dosyalar, liste yok)", hamImzala(INTEGRITY_TYP, paket, { ...yuk(dogruListe), liste: undefined, dosyalar: liste(KAPSAMDA) })),
    v("liste nesnesinde fazla alan (katı)", imzali({ liste: { ...yuk(dogruListe).liste, bicim: 2 } })),
    v("liste boyu 0", imzali({ liste: { ...yuk(dogruListe).liste, boyut: 0 } })),
    v("dosya sayısı azami üstü", imzali({ liste: { ...yuk(dogruListe).liste, dosyaSayisi: 200_001 } })),
    v("liste özeti kısa", imzali({ liste: { ...yuk(dogruListe).liste, sha256: "abc" } })),
    v("kapsam eksik", imzali({ kapsam: undefined })),
    v("kapsamda fazla alan (katı)", imzali({ kapsam: { ...KAPSAM, haric: [] } })),
    v("kapsam dizini `..`", imzali({ kapsam: { ...KAPSAM, dizinler: ["../dist"] } })),
    v("kapsam dizini boşluklu (kapsam katı yol)", imzali({ kapsam: { ...KAPSAM, dizinler: ["a b"] } })),
    v("kapsam tekrarlı", imzali({ kapsam: { ...KAPSAM, dizinler: ["dist", "dist"] } })),
    v("kapsam 33 dizin", imzali({ kapsam: { ...KAPSAM, dizinler: Array.from({ length: 33 }, (_, i) => `d${i}`) } })),
    v("sürüm biçimsiz", imzali({ surum: "2.12" })),
    v("derleme tarihi ofsetli", imzali({ derlemeTarihi: "2026-09-29T00:00:00+03:00" })),
    v("v:2", imzali({ v: 2 })),
    v("biçimsiz metin", "a.b"),
  ];
}
