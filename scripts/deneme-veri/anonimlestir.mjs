#!/usr/bin/env node
// =============================================================================
// deneme-veri/anonimlestir — deneme kurulumundaki AKTARILMIŞ fabrika verisini kalıcı olarak anonimleştirir.
//
// Veri düzeltme betiğidir (defter.md): varsayılan PLAN (salt okuma), `--apply` önce planı basar, sonra TEK tx'te
// yazar ve aynı süreçte DOĞRULAR (yeniden tarama = 0 değişim · eski adlardan iz = 0 · iletişim deseni taraması).
// Tutar/miktar/tarih/numara DEĞİŞMEZ; yalnız kimlik taşıyan metin (unvan, kişi adı, iletişim, vergi, IBAN, adres,
// serbest not) ve bu metnin kopyası olan anlık görüntüler (JSON) değişir.
//
// Kolon kümesi KODDAN türetilir, elle liste yok:
//   • tablo sınıfı   — scripts/lib/dump-aktar-siniflar.mjs (İŞ + users/devices + iş ayarları; KİMLİK/AUDIT tabloları
//                      yazılmaz, yalnız iz taraması yapılır). Sınıfsız tablo → DUR.
//   • kişisel kolon  — şemadaki kolon ADI (lib/anonim.mjs kisiselKolonTuru) ∪ bulut kataloğunun KISISEL kolonları
//   • bulut tazeleme — projeksiyon kataloğunun kök tablo + kolonları (Teks-Erp/src/cloud-sync); değişen kolon
//                      projeksiyondaysa satırın updatedAt'i ilerletilir ⇒ eşitleme turu yeni adı buluta taşır.
//
//   node scripts/deneme-veri/anonimlestir.mjs --db <ad>            (plan)
//   node scripts/deneme-veri/anonimlestir.mjs --db <ad> --apply
// psql komutu DENEME_VERI_PSQL (JSON dizi); varsayılan yerel test konteyneri. Deneme için:
//   DENEME_VERI_PSQL='["ssh","tekserp-bulut-deneme","docker","exec","-i","tekserp-test-musteri-postgres-1","psql","-U","tekserp"]'
// ÇIKTI DEĞER BASMAZ: yalnız tablo/kolon adı, sayı ve uzunluk.
// =============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IS_TABLOLARI, OZEL_TABLOLAR, SINIF, KURULUM_AYAR_ONEKLERI, KURULUM_AYAR_TAM } from "../lib/dump-aktar-siniflar.mjs";
import {
  GENEL_KELIMELER, havuzdanMi, ifadeSec, jsonDegistir, katla, kelimeler, kisiselKolonTuru, metniDegistir, sahteDeger,
  havuzCakismalari, serbestMetinKarari, sozlukKur, telefonlar,
} from "./lib/anonim.mjs";
import { projeksiyonKolonlari, kolonRolu, KULLANICI_DESENI, CIHAZ_DESENI } from "./lib/kolonlar.mjs";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PSQL = JSON.parse(process.env.DENEME_VERI_PSQL || '["docker","exec","-i","tekserp-local-db","psql","-U","tekserp"]');
const args = process.argv.slice(2);
const dbArg = args[args.indexOf("--db") + 1];
const APPLY = args.includes("--apply");
if (!args.includes("--db") || !/^[a-z][a-z0-9_]{1,62}$/.test(dbArg ?? "")) {
  console.error("kullanım: anonimlestir.mjs --db <ad> [--apply]");
  process.exit(1);
}

function psql(sql, { tx = false } = {}) {
  const r = spawnSync(PSQL[0], [...PSQL.slice(1), "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", ...(tx ? ["-1"] : []), "-d", dbArg], {
    input: sql, encoding: "utf8", maxBuffer: 1 << 30,
  });
  if (r.error) throw new Error(`psql çalıştırılamadı: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`psql hata: ${(r.stderr || "").trim().split("\n").slice(0, 3).join(" | ")}`);
  return r.stdout || "";
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const id = (s) => `"${String(s).replace(/"/g, '""')}"`;
const jsonSatirlar = (sql) => psql(sql).split("\n").filter(Boolean).map((l) => JSON.parse(l));

// ── 1) Şema ve sınıflar ─────────────────────────────────────────────────────────────────────────
function semaOku() {
  const kolonlar = jsonSatirlar(`SELECT json_build_object('t', c.table_name, 'c', c.column_name, 'tip', c.data_type, 'gen', c.is_generated)
    FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema='public' AND t.table_type='BASE TABLE' ORDER BY 1::text;`);
  const pk = jsonSatirlar(`SELECT json_build_object('t', tc.table_name, 'c', array_agg(k.column_name::text ORDER BY k.ordinal_position))
    FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k USING (constraint_schema, constraint_name)
    WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY' GROUP BY tc.table_name;`);
  const tablolar = new Map();
  for (const k of kolonlar) {
    if (!tablolar.has(k.t)) tablolar.set(k.t, { ad: k.t, kolonlar: [], pk: [] });
    tablolar.get(k.t).kolonlar.push(k);
  }
  for (const p of pk) if (tablolar.has(p.t)) tablolar.get(p.t).pk = p.c;
  const sinifsiz = [...tablolar.keys()].filter((t) => !IS_TABLOLARI.includes(t) && !OZEL_TABLOLAR[t]);
  if (sinifsiz.length) throw new Error(`sınıfsız tablo (dump-aktar-siniflar.mjs'e ekle): ${sinifsiz.join(", ")}`);
  return tablolar;
}
/** Yazılacak tablolar: İŞ + users/devices (BİRLEŞİM) + system_settings (yalnız iş ayarı anahtarları). */
const yazilirMi = (t) => IS_TABLOLARI.includes(t) || OZEL_TABLOLAR[t]?.[0] === SINIF.BIRLESIM || t === "system_settings";
const kurulumAyari = (k) => KURULUM_AYAR_TAM.includes(k) || KURULUM_AYAR_ONEKLERI.some((o) => k.startsWith(o)) || /\.enabled$|Enabled$/.test(k);

// ── 2) Varlık adları → sözlük ───────────────────────────────────────────────────────────────────
function varliklariOku() {
  const tek = (sql) => jsonSatirlar(sql).map((x) => x.v).filter((v) => typeof v === "string" && v.trim());
  const firma = [
    ...tek(`SELECT json_build_object('v', name) FROM customers`),
    ...tek(`SELECT json_build_object('v', name) FROM subcontractors`),
    ...tek(`SELECT json_build_object('v', name) FROM customer_branches`),
    // Kurulumun antet/kart başlığındaki firma adı (iş ayarı JSON'unda `companyName` anahtarı)
    ...tek(`SELECT json_build_object('v', m[1]) FROM system_settings s, regexp_matches(s.value::text, '"companyName": "([^"]+)"', 'g') m`),
  ];
  const kisi = [
    ...tek(`SELECT json_build_object('v', "fullName") FROM users WHERE username LIKE 'as.%'`),
  ];
  // Kişisel ad kolonlarının (contactName, drawerName …) değerleri de kişi adıdır — serbest metinde de aranır.
  return { firma, kisi };
}
/** Rol adı (tümü genel kelime: "Sistem Bakımı", "Ham Giriş", "Kursun1") kişi adı değildir. */
const rolAdiMi = (ad) => kelimeler(ad.replace(/\d+/g, " ")).every((k) => GENEL_KELIMELER.has(katla(k)));

// ── 3) Satır dönüşümü ──────────────────────────────────────────────────────────────────────────
function donusturucuKur({ sozluk, katalog, kullaniciAdlari }) {
  const serbestEsleme = new Map(); // eski serbest metin → yeni (JSON kopyalarında birebir uygulanır)
  const metin = (s) => {
    if (typeof s !== "string") return s;
    if (kullaniciAdlari.has(s)) return kullaniciAdlari.get(s);
    if (serbestEsleme.has(s)) return serbestEsleme.get(s);
    return metniDegistir(s, sozluk);
  };
  return { serbestEsleme, metin, katalog };
}

function main() {
  const tablolar = semaOku();
  const projeksiyon = projeksiyonKolonlari(KOK);
  const { firma, kisi } = varliklariOku();
  const kisiAdlari = kisi.filter((a) => !rolAdiMi(a));
  // Kişisel ad kolonlarının dolu değerleri (şemadan türetilen KISI_ADI kolonları)
  for (const t of tablolar.values()) {
    if (!yazilirMi(t.ad)) continue;
    for (const k of t.kolonlar) {
      if (kisiselKolonTuru(k.c) !== "KISI_ADI" || !["text", "character varying"].includes(k.tip)) continue;
      for (const r of jsonSatirlar(`SELECT json_build_object('v', ${id(k.c)}) FROM ${id(t.ad)} WHERE ${id(k.c)} <> ''`)) kisiAdlari.push(r.v);
    }
  }
  const sozluk = sozlukKur({ kisiAdlari, firmaAdlari: firma });
  const havuzCakisma = havuzCakismalari([...firma, ...kisiAdlari]);

  // Katalog sözlüğü — serbest metnin "kimliksiz" sayılması için (bizim kataloglar + ürün/renk/istasyon adları)
  const katalog = new Set();
  for (const sql of [
    `SELECT json_build_object('v', concat_ws(' ', label, "fullText")) FROM reason_presets`,
    `SELECT json_build_object('v', name) FROM return_reasons`, `SELECT json_build_object('v', name) FROM defect_types`,
    `SELECT json_build_object('v', name) FROM stations`, `SELECT json_build_object('v', name) FROM items`,
    `SELECT json_build_object('v', name) FROM colors`, `SELECT json_build_object('v', name) FROM quality_grades`,
    `SELECT json_build_object('v', name) FROM fabric_properties`, `SELECT json_build_object('v', name) FROM machines`,
    `SELECT json_build_object('v', name) FROM warehouses`, `SELECT json_build_object('v', name) FROM routes`,
    `SELECT json_build_object('v', name) FROM subcontractor_categories`,
  ]) for (const r of jsonSatirlar(sql)) for (const k of kelimeler(r.v)) katalog.add(katla(k));
  for (const k of katalog) if (sozluk.kelime.has(k)) katalog.delete(k); // ad parçası katalogda olsa da "kimliksiz" sayılmaz

  // Kullanıcı adları: as.* → as.kullaniciN (del_ öneki korunur); eski ad → yeni ad (JSON/metin kopyaları için)
  const kullaniciAdlari = new Map();
  const asKullanicilar = jsonSatirlar(`SELECT json_build_object('id', id, 'u', username) FROM users WHERE username LIKE 'as.%' ORDER BY "createdAt", id`);
  asKullanicilar.forEach((u, i) => {
    const del = /^as\.(del_[0-9a-f]{6}_)/.exec(u.u)?.[1] ?? "";
    const yeni = KULLANICI_DESENI.test(u.u) ? u.u : `as.${del}kullanici${i + 1}`;
    if (yeni !== u.u) kullaniciAdlari.set(u.u, yeni);
  });

  const d = donusturucuKur({ sozluk, katalog, kullaniciAdlari });
  const degisim = []; // { t, pk, set: {kolon: değer}, bulut: bool }
  const sayac = new Map(); // "tablo.kolon|rol" → n
  const say = (anahtar) => sayac.set(anahtar, (sayac.get(anahtar) ?? 0) + 1);
  const serbestToplam = new Map();
  const ornek = [];

  // İki geçiş: önce düz metin kolonları (serbest metin eşlemesi dolar), sonra JSON kolonları (eşlemeyi kullanır).
  for (const gecis of ["METIN", "JSON"]) {
    for (const t of tablolar.values()) {
      if (!yazilirMi(t.ad) || t.pk.length === 0) continue;
      const roller = t.kolonlar
        .map((k) => ({ ...k, rol: kolonRolu(t.ad, k) }))
        .filter((k) => k.rol && (gecis === "JSON" ? k.rol === "JSON" : k.rol !== "JSON"));
      if (roller.length === 0) continue;
      const secim = [...t.pk.map((p) => `'pk_${p}', ${id(p)}`), ...roller.map((k) => `${lit("v_" + k.c)}, ${id(k.c)}`)];
      if (t.ad === "system_settings") secim.push("'v_key', key");
      if (t.ad === "devices" || t.ad === "users" || t.ad === "subcontractors") secim.push(`'sira', row_number() OVER (ORDER BY "createdAt", id)`);
      const satirlar = jsonSatirlar(`SELECT json_build_object(${secim.join(", ")}) FROM ${id(t.ad)};`);
      const cihazSira = new Map();
      for (const s of satirlar) {
        if (t.ad === "system_settings" && kurulumAyari(s.v_key)) continue;
        const pk = Object.fromEntries(t.pk.map((p) => [p, s["pk_" + p]]));
        const tohum = `${t.ad}:${t.pk.map((p) => s["pk_" + p]).join(":")}`;
        const set = {};
        for (const k of roller) {
          const eski = s["v_" + k.c];
          if (eski === null || eski === undefined || eski === "") continue;
          let yeni = eski;
          switch (k.rol) {
            case "KISISEL": yeni = sahteDeger(kisiselKolonTuru(k.c), tohum, eski, sozluk); break;
            case "KULLANICI_ADI": yeni = kullaniciAdlari.get(eski) ?? eski; break;
            case "CIHAZ_ADI": {
              if (!eski.startsWith("as. ") || CIHAZ_DESENI.test(eski)) break;
              const tur = /tablet/i.test(eski) ? "Tablet" : /masaüstü|desktop|darwin|win32|linux/i.test(eski) ? "Masaüstü" : "Cihaz";
              cihazSira.set(tur, (cihazSira.get(tur) ?? 0) + 1);
              yeni = `as. ${tur} ${String(cihazSira.get(tur)).padStart(2, "0")}`;
              break;
            }
            case "ESKI_KOD": if (!/\d/.test(eski)) yeni = `ESKI-${String(s.sira).padStart(2, "0")}`; break;
            case "SERBEST": case "ETIKET": {
              const ara = d.metin(eski);
              const anahtar = `${t.ad}.${k.c}`;
              const st = serbestToplam.get(anahtar) ?? { dolu: 0, korunan: 0, degisen: 0 };
              st.dolu++;
              const onEk = serbestMetinKarari(ara, katalog);
              if (onEk === null) { yeni = ara; if (ara === eski) st.korunan++; else st.degisen++; }
              else {
                st.degisen++;
                yeni = k.rol === "ETIKET" ? `${ifadeSec(k.c, eski)} ${String(st.degisen).padStart(2, "0")}` : onEk + ifadeSec(k.c, eski);
                if (!d.serbestEsleme.has(eski)) d.serbestEsleme.set(eski, yeni);
              }
              serbestToplam.set(anahtar, st);
              break;
            }
            case "AD": case "METIN": yeni = d.metin(eski); break;
            case "JSON": {
              const j = jsonDegistir(eski, d.metin);
              yeni = JSON.stringify(j) === JSON.stringify(eski) ? eski : j;
              break;
            }
            default: throw new Error(`bilinmeyen rol ${k.rol}`);
          }
          if (yeni !== eski) {
            set[k.c] = { deger: yeni, json: k.rol === "JSON" };
            say(`${t.ad}.${k.c}|${k.rol}`);
            if (ornek.length < 12 && typeof eski === "string") ornek.push(`${t.ad}.${k.c}: uzunluk ${eski.length}→${String(yeni).length}`);
          }
        }
        if (Object.keys(set).length) {
          const bulut = projeksiyon.get(t.ad);
          degisim.push({ t: t.ad, pk, set, bulut: !!bulut && Object.keys(set).some((c) => bulut.has(c)), updatedAt: t.kolonlar.some((k) => k.c === "updatedAt") });
        }
      }
    }
  }
  return { tablolar, sozluk, degisim, sayac, serbestToplam, ornek, havuzCakisma, kullaniciAdlari, kisiAdlari, firma };
}

function birlesik(degisim) {
  // Aynı satır iki geçişte ayrı değişim üretebilir → tek UPDATE.
  const m = new Map();
  for (const x of degisim) {
    const k = x.t + "|" + JSON.stringify(x.pk);
    if (!m.has(k)) m.set(k, { ...x, set: { ...x.set } });
    else { const y = m.get(k); Object.assign(y.set, x.set); y.bulut ||= x.bulut; }
  }
  return [...m.values()];
}

function sqlKur(degisim) {
  const satir = ["SET LOCAL session_replication_role = replica;"]; // defter seddi + eşitleme işaretçisi tetikleri bu tx'te susar
  for (const x of birlesik(degisim)) {
    const set = Object.entries(x.set).map(([c, v]) => `${id(c)} = ${v.json ? `${lit(JSON.stringify(v.deger))}::jsonb` : lit(v.deger)}`);
    if (x.bulut && x.updatedAt) set.push(`"updatedAt" = now()`);
    const where = Object.entries(x.pk).map(([c, v]) => `${id(c)}::text = ${lit(v)}`).join(" AND ");
    satir.push(`UPDATE ${id(x.t)} SET ${set.join(", ")} WHERE ${where};`);
  }
  return satir.join("\n");
}

/** Eski ad parçalarının (sözlük anahtarları + eski kullanıcı adları) TÜM tablolarda iz taraması — yalnız sayı. */
function izTaramasi(tablolar, sozluk, kullaniciAdlari) {
  const iz = new Map();
  for (const t of tablolar.values()) {
    const kol = t.kolonlar.filter((k) => ["text", "character varying", "jsonb", "json"].includes(k.tip) && k.gen !== "ALWAYS");
    if (kol.length === 0) continue;
    const satirlar = psql(`SELECT concat_ws(' ', ${kol.map((k) => `${id(k.c)}::text`).join(", ")}) FROM ${id(t.ad)};`).split("\n");
    let n = 0;
    for (const s of satirlar) {
      if (!s) continue;
      const kelime = s.match(/[\p{L}\p{N}]+/gu) ?? [];
      if (kelime.some((w) => sozluk.kelime.has(katla(w))) || [...sozluk.ifade.keys()].some((a) => s.includes(a)) || [...kullaniciAdlari.keys()].some((u) => s.includes(u))) n++;
    }
    if (n) iz.set(t.ad, n);
  }
  return iz;
}
/** İletişim/kimlik desenleri (e-posta · TR cep/sabit telefon · TR IBAN · 10–11 haneli vergi/TC) — sahte biçimlerimiz hariç. */
function desenTaramasi(tablolar) {
  const D = { eposta: /[\w.+-]+@[\w-]+\.[\w.]+/g, iban: /TR\d{2}[ ]?\d{4}/g };
  const sahte = /ornek-firma\.example|^TR\d{2}00099/;
  const out = new Map();
  for (const t of tablolar.values()) {
    if (!yazilirMi(t.ad)) continue;
    const kol = t.kolonlar.filter((k) => ["text", "character varying", "jsonb"].includes(k.tip) && k.gen !== "ALWAYS" && !/Hash$|Digest$|^chainHash$|^barcode$/.test(k.c));
    if (!kol.length) continue;
    const metin = psql(`SELECT concat_ws(' ', ${kol.map((k) => `${id(k.c)}::text`).join(", ")}) FROM ${id(t.ad)};`);
    const tel = telefonlar(metin).length;
    if (tel) out.set(`${t.ad}:telefon`, tel);
    for (const [ad, re] of Object.entries(D)) {
      const n = (metin.match(re) ?? []).filter((x) => !sahte.test(x)).length;
      if (n) out.set(`${t.ad}:${ad}`, n);
    }
  }
  return out;
}

function rapor(p, baslik) {
  console.log(`\n== ${baslik} — hedef DB ${dbArg}`);
  console.log(`sözlük: ${p.sozluk.kelime.size} ad parçası · ${p.sozluk.ifade.size} tam ad · ${p.kullaniciAdlari.size} kullanıcı adı · kaynak ${p.firma.length} firma + ${p.kisiAdlari.length} kişi adı`);
  if (p.havuzCakisma.length) console.log(`⚠ havuz kelimesiyle çakışan gerçek ad parçası: ${p.havuzCakisma.length} (bunlar takma ad sayılıp KORUNUR — havuzu değiştir)`);
  const satirlar = [...p.sayac].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, n] of satirlar) console.log(`  ${k.padEnd(58)} ${n}`);
  console.log(`değişecek satır: ${birlesik(p.degisim).length} · bulut tazelemesi (updatedAt) ${birlesik(p.degisim).filter((x) => x.bulut && x.updatedAt).length}`);
  console.log("serbest metin kolonları (dolu · korunan · değişen):");
  for (const [k, s] of [...p.serbestToplam].sort()) console.log(`  ${k.padEnd(48)} ${s.dolu} · ${s.korunan} · ${s.degisen}`);
  if (p.ornek.length) console.log("örnek (değer yok): " + p.ornek.join(" | "));
}

const p = main();
rapor(p, APPLY ? "UYGULANACAK PLAN" : "PLAN (kuru — yazmak için --apply)");
if (!APPLY) process.exit(0);

const dir = mkdtempSync(join(tmpdir(), "anonim-"));
try {
  const f = join(dir, "u.sql");
  writeFileSync(f, sqlKur(p.degisim), { mode: 0o600 });
  psql(readFileSync(f, "utf8"), { tx: true });
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`\n✅ yazıldı: ${birlesik(p.degisim).length} satır`);

// Doğrulama — yeniden plan 0 değişim (idempotent) + eski ad izi + iletişim deseni
const p2 = main();
const iz = izTaramasi(p.tablolar, p.sozluk, p.kullaniciAdlari);
const desen = desenTaramasi(p.tablolar);
console.log(`\n== DOĞRULAMA\nyeniden tarama değişimi: ${birlesik(p2.degisim).length} (beklenen 0)`);
console.log(`eski ad izi (tablo → satır): ${iz.size ? [...iz].map(([t, n]) => `${t}=${n}`).join(" ") : "YOK"}`);
console.log(`iletişim deseni (tablo:tür → adet): ${desen.size ? [...desen].map(([t, n]) => `${t}=${n}`).join(" ") : "YOK"}`);
const kimlikIzi = [...iz.keys()].filter((t) => !yazilirMi(t));
if (birlesik(p2.degisim).length || [...iz.keys()].some(yazilirMi)) { console.error("❌ doğrulama kırmızı"); process.exit(1); }
if (kimlikIzi.length) console.log(`⚠ yazılmayan (KİMLİK/AUDIT) tablolarda iz: ${kimlikIzi.join(", ")} — hash zinciri/kimlik verisi; ELLE incele`);
console.log("✅ doğrulama yeşil");
