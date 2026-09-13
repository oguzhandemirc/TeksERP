// =============================================================================
// GRANDFATHERING DAMGASI — modül anahtarları mevcut kuruluma DOĞRU değerle mi
// yazıldı? Ve damga yalnız GEÇMİŞİ OLAN kuruluma mı atıldı?
// =============================================================================
// `requireTicaretEnabled` yazıldığı ANDA `ticaret.enabled`in DEĞERİ kodun
// sözleşmesinin parçası olur. Fabrikaya ulaşan tek otomatik yol migration'dır
// (`kur.ps1` seed KOŞMAZ, yalnız `prisma migrate deploy`) — bu yüzden damga
// `20260902230000_modul_anahtarlari_grandfathering` ile atılıyor.
//
// BEKÇİ İKİ AYRI ŞEYİ SORAR:
//   §1 MIGRATION METNİ — koşul · idempotentlik · zaman damgası · veri türevi.
//      (Metin kontrolü, çünkü dosya uygulandıktan sonra IMMUTABLE'dır ve
//      canlıda değeri üreten şey odur.)
//   §2 CANLI DB — satırlar var mı, değerleri ne?
//
// ⚠️ §2'nin yüklemi migration'ınkiyle AYNI: `rolls` boşsa damga BEKLENMEZ
// (grandfathering tanımı gereği yalnız geçmişi olan kuruluma aittir; taze
// kurulum, kurulum profilinin işidir). Bu bekçi bu yüzden HEM fabrika
// kopyasında HEM boş bir prova veritabanında koşar ve ikisinde de FARKLI ama
// DOĞRU şeyi ölçer.
//
// ⚠️ DEĞER KONTROLLERİ YALNIZ DOKUNULMAMIŞ SATIRLAR İÇİN KATIDIR. Migration
// `createdAt = updatedAt = now()` yazar; panelden (ya da `setFeatureFlags` ile)
// yapılan her değişiklik `updatedAt`i ileri alır. Yani "damga değeri" ile
// "fabrikanın sonraki kararı" MEKANİK olarak ayrılabilir. Katı yazılsaydı,
// modülü meşru şekilde AÇAN her fabrikada bekçi kırmızıya döner ve ekip
// kırmızı bekçiyi görmezden gelmeyi öğrenirdi.
//
// ⚠️ BİLİNEN ETKİLEŞİM: `test_module_flag_off` HTTP ayağı bayrakları açıp
// kapatır ve BULDUĞU değere geri yazar — ama `updatedAt` ileri gider, yani o
// satırlar bundan sonra "dokunulmuş" sayılır ve §2d onları bilgi olarak basar.
// Değerler doğru kalır; zayıflayan şey §2d'nin KAPSAMIDIR. §2e tam bu yüzden
// var: TÜM satırlar dokunulmuş hâle gelirse §2d vakumen yeşile düşerdi ve
// bekçi bunu söylemek zorunda. Temiz ölçüm istiyorsan bekçiyi `migrate deploy`
// sonrası, bayrak yazan testlerden ÖNCE koştur.
//
// Koşum: npx tsx scripts/test_module_grandfathering.ts
//
// NEGATİF SONDALAR — 2026-09-02'de koşuldu (`git checkout` ile geri alındı):
//   ① koşul silinirse (taze kurulum da damgalanır):
//      sed -i '' 's/ WHERE EXISTS (SELECT 1 FROM "rolls" LIMIT 1)//' \
//        prisma/migrations/20260902230000_*/migration.sql            → SONDA-16
//   ② idempotentlik silinirse (ikinci koşumda P2002):
//      sed -i '' 's/ON CONFLICT ("key") DO NOTHING/;/' …             → SONDA-17
//   ③ `AT TIME ZONE` kalıbı geri gelirse (damga 3 saat geriye yazılır):
//      sed -i '' 's/now(), now()/now() AT TIME ZONE UTC, now()/' …   → SONDA-18
//   ④ damga DEĞERLERİ ters çevrilirse (D2'nin ölçtüğü kör nokta — eskiden
//      HİÇBİR bekçi görmüyordu): production→`'false'::jsonb`,
//      ticaret→sabit `'true'::jsonb`                                  → SONDA-23
//   ⑤ çoklu depo damgasının GENİŞ koşulu (`OR aktif depo > 1`) geri alınırsa
//      (topsuz + iki depolu kurulumda yüzeyler kaybolur)              → SONDA-26
// SONDA TABLOSU (ölçüldü — cp+md5 ile birebir geri alındı; taban 21/0, çıkış 0):
//   SONDA-16 → çıkış 1 · 1 ❌ · §1b (koşul silindi)
//   SONDA-17 → çıkış 1 · 1 ❌ · §1c (ON CONFLICT silindi)
//   SONDA-18 → çıkış 1 · 1 ❌ · §1d (`now() AT TIME ZONE 'UTC'` geri geldi)
//   SONDA-23 → çıkış 1 · 2 ❌ · §1h(production) + §1h(ticaret) — 2026-09-03
//   SONDA-26 → çıkış 1 · 1 ❌ · §1f2 — 2026-09-03
// ⚠️ SONDA-23 test_module_flags'i KIRMIZI YAPMAZ (41/0 kaldı) ve bu doğrudur:
//    orada damgalanan ANAHTARLAR ve açıklamalar ölçülür, DEĞERLER burada.
// ⚠️ §1d ilk yazımda YORUM yüzünden yanlış kırmızı verdi (migration başlığı
//    kaçınılan kalıbı örnek olarak yazıyor) → SQL yorumları artık sökülüyor (§1a2).
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { migrationDamgaDegerleri } from "./lib/regime-gate-scan";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const KOK = path.resolve(__dirname, "..");
/**
 * DAMGA MIGRATION'LARI — LİSTE (2026-09-12).
 *
 * ⚠️ `20260902230000` uygulanmıştır, değiştirilemez. O tarihten SONRA doğan
 * modüller (ilki `devere.enabled`) kendi dosyalarında damgalanır; bekçi metinleri
 * BİRLEŞTİREREK okur. Tek dosyaya sabit kalsaydı yeni modül ya ölçüsüz kalırdı
 * ya da muaf listesine yazılırdı.
 */
const MIG_DIZINLERI: string[] = [
  "20260902230000_modul_anahtarlari_grandfathering",
  "20260912120000_devere_modul_anahtari",
  "20260913260000_dokuma_modul_anahtari",
];
const MIGLER: string[] = MIG_DIZINLERI.map((d) =>
  path.join(KOK, "prisma/migrations", d, "migration.sql"),
);

/**
 * Damganın yazdığı anahtarlar, CANLI DB'de beklenen değerleri ve MIGRATION
 * METNİNDE beklenen değer İFADESİ.
 *
 * ⚠️ İFADE KONTROLÜ (`sqlIcerir`) 2026-09-02'de eklendi ve ölçülmüş bir kör
 * noktayı kapatır: eskiden §1 yalnız anahtarın VARLIĞINI arıyordu, §2 ise
 * canlı DB'ye bakıyordu — `ON CONFLICT DO NOTHING` yüzünden migration bir kez
 * koştuktan sonra satırlar donuyor, yani bekçi KENDİ bozulmasını göremiyordu.
 * Sonda: `production.enabled` değeri `'false'`e çevrildi, `ticaret.enabled`
 * `'true'` yapıldı → üç bekçi de 14/14 YEŞİL kaldı. Metin ayrıştırması
 * DB'den bağımsızdır ve migration immutable olduğu için kırılgan değildir.
 *
 * `deger` = canlı DB beklentisi; `"veriden"` = aktif depo sayısından türer,
 * `"gecmisten"` = dünkü davranıştan (`finance.enabled`) türer — ikisi de
 * kuruluma göre değişir, o yüzden CANLI değer bekçide sabitlenmez.
 */
const BEKLENEN: Array<{
  key: string;
  deger: boolean | "veriden" | "gecmisten";
  /** Migration metninde bu anahtarın DEĞER ifadesinde geçmesi gereken parçalar. */
  sqlIcerir: string[];
  /** Değer ifadesinde geçmemesi gereken parçalar (ters damga sondası). */
  sqlIcermez?: string[];
}> = [
  { key: "production.enabled", deger: true, sqlIcerir: ["'true'::jsonb"], sqlIcermez: ["'false'"] },
  { key: "ticaret.enabled", deger: "gecmisten", sqlIcerir: ["finance.enabled", "to_jsonb("] },
  { key: "iplik.enabled", deger: "gecmisten", sqlIcerir: ["finance.enabled", "to_jsonb("] },
  { key: "kumasTeknik.enabled", deger: false, sqlIcerir: ["'false'::jsonb"], sqlIcermez: ["'true'"] },
  { key: "tezgah.enabled", deger: false, sqlIcerir: ["'false'::jsonb"], sqlIcermez: ["'true'"] },
  // 2026-09-12 — damgadan SONRA doğan ilk modül; kendi dosyasında (20260912120000).
  // Dünkü davranışı YOK (ne yüzey ne veri) → sabit `false` MEŞRU, türetilecek
  // bir veri de yok. Kural satırı aynı gün bu ayrımla daraltıldı.
  { key: "devere.enabled", deger: false, sqlIcerir: ["'false'::jsonb"], sqlIcermez: ["'true'"] },
  // 2026-09-13 — dokuma işi, ekran dilimiyle doğdu (20260913260000). Dünkü davranış
  // ÖLÇÜLDÜ (hiçbir istemci dokuma uçlarını çağırmıyordu) → sabit `false` meşru.
  { key: "dokuma.enabled", deger: false, sqlIcerir: ["'false'::jsonb"], sqlIcermez: ["'true'"] },
  {
    key: "depo.multiEnabled",
    deger: "veriden",
    sqlIcerir: ['"warehouses"', '"isActive"', "to_jsonb("],
    sqlIcermez: ["'true'::jsonb", "'false'::jsonb"],
  },
];

async function main(): Promise<void> {
  console.log("=== GRANDFATHERING DAMGASI (modül anahtarları) ===\n");

  // ── §1 MIGRATION METNİ ───────────────────────────────────────────────────
  const migEksik = MIGLER.filter((p) => !fs.existsSync(p));
  check(
    "§1 Körlük zemini: damga migration'larının hepsi okunabildi",
    migEksik.length === 0,
    migEksik.length === 0 ? MIGLER.join(", ") : `EKSİK: ${migEksik.join(", ")}`,
  );
  const ham = MIGLER.map((p) => fs.readFileSync(p, "utf8")).join("\n");
  check("§1a Körlük zemini: dosya dolu", ham.length > 1000, `${ham.length} karakter`);
  // ⚠️ SQL YORUMLARI SÖKÜLÜR — `test_item_price` §7'nin dersinin birebir ikizi:
  // bu migration'ın BAŞLIĞI, kaçınılan kalıbı (`now() AT TIME ZONE 'UTC'`)
  // örnek olarak YAZIYOR. Sökülmeseydi §1d yorumda eşleşip kırmızı verirdi
  // (ölçüldü: ilk yazımda tam bu oldu) ve daha kötüsü, gerçek bir ihlalde
  // yorum silinerek "düzeltilmiş" sanılırdı.
  const sql = ham.replace(/--.*$/gm, "");
  check(
    "§1a2 Körlük zemini: yorum ayıklamadan sonra SQL gövdesi duruyor",
    sql.includes("INSERT INTO") && sql.length > 500,
    `${sql.length} karakter (ham ${ham.length})`,
  );

  const kosul = (sql.match(/WHERE EXISTS \(SELECT 1 FROM "rolls" LIMIT 1\)/g) ?? []).length;
  check(
    "§1b ⭐ Damga KOŞULLU — yalnız geçmişi olan kuruluma (`WHERE EXISTS … rolls`)",
    kosul >= 2,
    kosul >= 2
      ? `${kosul} INSERT koşullu`
      : "koşulsuz INSERT taze DB'yi de damgalar ve kurulum profilini kalıcı no-op'a çevirir",
  );
  const conflict = (sql.match(/ON CONFLICT \("key"\) DO NOTHING/g) ?? []).length;
  check(
    "§1c ⭐ İDEMPOTENT (`ON CONFLICT (\"key\") DO NOTHING`)",
    conflict >= 2,
    conflict >= 2
      ? `${conflict} INSERT korumalı`
      : "satır zaten varsa (panelden açılmışsa) migration DÜŞER ya da fabrikanın kararını EZER",
  );
  check(
    "§1d ⭐ `AT TIME ZONE` YOK — kolonlar timestamptz, kalıp damgayı 3 saat GERİYE yazardı",
    !/AT TIME ZONE/i.test(sql),
    // Bu satır yasağın KENDİSİNİ anlatan teşhis metnidir (migration SQL'inde
    // kalıbı ARAYAN check'in başarısızlık cümlesi) — kalıbı kullanmıyor, adını koyuyor.
    // eslint-disable-next-line no-restricted-syntax
    "20260801040000 dönüşümünden sonra `now() AT TIME ZONE 'UTC'` kalıbı YANLIŞTIR",
  );
  check(
    "§1e `\"updatedAt\"` elle veriliyor (Prisma `@updatedAt` uygulama katmanında, DB default'u YOK)",
    /"updatedAt"/.test(sql) && /now\(\)/.test(sql),
    "verilmezse migration NOT NULL ihlaliyle düşer",
  );
  check(
    "§1f ⭐ `depo.multiEnabled` değeri VERİDEN türetiliyor (aktif depo > 1)",
    /to_jsonb\(/.test(sql) &&
      /FROM "warehouses"/.test(sql) &&
      /"isActive"\s*=\s*true/.test(sql),
    "sabit false yazmak, iki depolu bir kurulumda depo seçicilerini SESSİZCE kaybettirirdi",
  );
  check(
    "§1f2 ⭐ Çoklu depo damgası TOPSUZ ama İKİ DEPOLU kurulumu da kapsıyor (koşul genişletildi)",
    /OR\s*\(SELECT count\(\*\) FROM "warehouses" WHERE "isActive" = true\)\s*>\s*1/.test(sql),
    "yalnız `rolls` koşuluyla: tanımlarını girmiş ama üretime başlamamış iki depolu " +
      "kurulumda satır hiç yazılmaz → depo seçici · kolon · transfer yüzeyi KAYBOLUR " +
      "(panel artık veri türevine düşemiyor, bayrağı okuyor)",
  );

  // ── §1g/§1h ⭐ DAMGALANAN ANAHTARLAR ve DEĞER İFADELERİ ───────────────────
  // ⚠️ "Damgalanan" = VALUES demetinin ilk elemanı. Bir anahtarın metinde başka
  // bir yerde geçmesi (ticaret/iplik değerini üreten `WHERE "key" =
  // 'finance.enabled'` okuması) damga SAYILMAZ.
  const damga = migrationDamgaDegerleri(ham);
  const eksikAnahtar = BEKLENEN.filter((b) => !damga.has(b.key)).map((b) => b.key);
  check(
    "§1g Damga altı modül anahtarını da içeriyor",
    eksikAnahtar.length === 0,
    eksikAnahtar.join(", "),
  );
  for (const b of BEKLENEN) {
    const ifade = damga.get(b.key);
    if (ifade === undefined) continue;
    const eksikParca = b.sqlIcerir.filter((p) => !ifade.includes(p));
    const yasakParca = (b.sqlIcermez ?? []).filter((p) => ifade.includes(p));
    check(
      `§1h ⭐ ${b.key} DEĞER ifadesi doğru`,
      eksikParca.length === 0 && yasakParca.length === 0,
      eksikParca.length || yasakParca.length
        ? `ifade="${ifade}"` +
          (eksikParca.length ? ` · EKSİK: ${eksikParca.join(", ")}` : "") +
          (yasakParca.length ? ` · OLMAMALI: ${yasakParca.join(", ")}` : "") +
          " — yanlış damga sahaya çıkar: production=false TÜM üretim router'larını " +
          "403'e düşürür, ticaret=true kullanılmayan yüzeyleri AÇAR"
        : `ifade="${ifade}"`,
    );
  }

  // ── §2 CANLI DB ──────────────────────────────────────────────────────────
  const uygulanmayan: string[] = [];
  for (const dizin of MIG_DIZINLERI) {
    const uygulandi = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "_prisma_migrations" WHERE migration_name = $1`,
      dizin,
    );
    if (Number(uygulandi[0]?.n ?? 0) === 0) uygulanmayan.push(dizin);
  }
  const migVar = uygulanmayan.length === 0;
  check(
    "§2a Damga migration'larının HEPSİ bu veritabanına uygulanmış (`_prisma_migrations`)",
    migVar,
    migVar
      ? MIG_DIZINLERI.join(", ")
      : `UYGULANMAMIŞ: ${uygulanmayan.join(", ")} — \`npx prisma migrate deploy\` koşulmamış, §2 sonuçları anlamsız olurdu`,
  );

  const topVar = (await prisma.roll.count({ take: 1 })) > 0;
  const aktifDepo = await prisma.warehouse.count({ where: { isActive: true } });
  // ⚠️ ticaret/iplik damgası DÜNKÜ DAVRANIŞTAN türer: o dört yüzey (alış
  // siparişi · fiyat · sayım · iplik) bu paketten önce `finance.enabled`
  // arkasındaydı. Beklenen değeri bu yüzden bekçi de aynı satırdan okur.
  const financeSatiri = await prisma.systemSetting.findUnique({
    where: { key: "finance.enabled" },
    select: { value: true },
  });
  const gecmisDeger = financeSatiri?.value === true || financeSatiri?.value === "true";
  const satirlar = await prisma.systemSetting.findMany({
    where: { key: { in: BEKLENEN.map((b) => b.key) } },
    select: { key: true, value: true, createdAt: true, updatedAt: true },
  });
  const harita = new Map(satirlar.map((s) => [s.key, s]));
  console.log(
    `\n   Ortam: top=${topVar ? "VAR" : "YOK"} · aktif depo=${aktifDepo} · ` +
      `modül satırı=${satirlar.length}/${BEKLENEN.length}\n`,
  );

  if (!topVar) {
    // BOŞ KURULUM — MİGRATION damgası beklenmez. Bu, §1b'nin canlı kanıtıdır.
    // ⚠️ AMA PROFİL JOB'U AYRI BİR YAZARDIR: `TEKSERP_PROFIL` verilmiş taze bir
    //    kurulumda boot job'u yedi satırı yazar ve `system.profile` damgasını
    //    atar — bu DOĞRU davranıştır, migration'ın koşulunu çürütmez. Damgayı
    //    sormadan "satır YOK" demek, ilk gerçek yeni müşteri kurulumunda bu
    //    bekçiyi kırmızı açardı (Dilim 1 kabul provası ölçtü). İki yazar iki
    //    ayrı soru: migration GEÇMİŞİ olan kurulumu damgalar, job HİÇ anahtarı
    //    olmayan kuruluma profil uygular.
    const profilDamgasi = await prisma.systemSetting.findUnique({
      where: { key: "system.profile" },
      select: { value: true },
    });
    if (profilDamgasi) {
      check(
        "§2b ⭐ Satırlar PROFİL job'undan (damga var) — migration koşulu ÇÜRÜMEDİ",
        satirlar.length > 0,
        `system.profile=${JSON.stringify(profilDamgasi.value).slice(0, 90)}`,
      );
    } else {
      check(
        "§2b ⭐ Geçmişi olmayan kurulumda modül satırı YOK (koşulun canlı kanıtı)",
        satirlar.length === 0,
        satirlar.length ? `beklenmedik satır: ${satirlar.map((s) => s.key).join(", ")}` : "",
      );
    }
  } else {
    const eksik = BEKLENEN.filter((b) => !harita.has(b.key)).map((b) => b.key);
    check(
      "§2b ⭐ Geçmişi olan kurulumda ALTI modül anahtarının satırı VAR",
      eksik.length === 0,
      eksik.length ? `satırsız: ${eksik.join(", ")}` : `${satirlar.length} satır`,
    );

    // Tip kontrolü KOŞULSUZ katıdır: ham ayar ucundan `"true"` (string) yazılmış
    // bir satır okuyucularda `asBoolean` sayesinde çalışır ama Modüller ekranı
    // ve bu bekçi için "boolean" sözleşmesi bozulmuş olur.
    const tipBozuk = satirlar.filter((s) => typeof s.value !== "boolean").map((s) => s.key);
    check(
      "§2c Değerler jsonb BOOLEAN (düz metin `\"true\"` değil)",
      tipBozuk.length === 0,
      tipBozuk.length ? `metin değerli: ${tipBozuk.join(", ")}` : "",
    );

    // ⚠️ Değer kontrolü YALNIZ dokunulmamış satırlar için (updatedAt == createdAt).
    const dokunulmus: string[] = [];
    const sapan: string[] = [];
    for (const b of BEKLENEN) {
      const s = harita.get(b.key);
      if (!s) continue;
      const beklenenDeger =
        b.deger === "veriden" ? aktifDepo > 1 : b.deger === "gecmisten" ? gecmisDeger : b.deger;
      if (s.updatedAt.getTime() !== s.createdAt.getTime()) {
        dokunulmus.push(`${b.key}=${JSON.stringify(s.value)} (damga: ${beklenenDeger})`);
        continue;
      }
      if (s.value !== beklenenDeger) sapan.push(`${b.key}: ${JSON.stringify(s.value)} ≠ ${beklenenDeger}`);
    }
    check(
      "§2d ⭐ Dokunulmamış her satır damganın öngördüğü değeri taşıyor",
      sapan.length === 0,
      sapan.length
        ? `SAPAN: ${sapan.join(" · ")} — damga yanlış değer yazmış ya da satır SQL ile ezilmiş`
        : `${BEKLENEN.length - dokunulmus.length} satır damga değerinde`,
    );
    // ⭐ §2e — KAPSAM BİLGİ BANDI + OPSİYONEL SIKI MOD.
    // Ölçüldü: §2d'nin kapsamı bir `test_module_flag_off` koşumundan sonra
    // 6/6'dan 2/6'ya, oturum sonunda 1/6'ya düştü — yani bekçi %17 kapsamla
    // YEŞİL kalıyordu ve eski "≥1 satır" zemini bunu asla söylemiyordu.
    // Kapsamı KATI yapmak da yanlış olurdu: modülü meşru şekilde AÇAN her
    // fabrikada bekçi kalıcı kırmızıya döner. Doğru cevap: sayıyı HER ZAMAN
    // RAPORLA, katılığı `BEKCI_GRANDFATHERING_SIKI=1` ile İSTEYENE ver — dump
    // provası (`migrate deploy` sonrası, bayrak yazan testlerden ÖNCE) tam
    // olarak o modda koşar ve 6/6 bekler.
    const olculen = BEKLENEN.length - dokunulmus.length;
    const siki = process.env.BEKCI_GRANDFATHERING_SIKI === "1";
    console.log(
      `\n   ℹ️  §2d KAPSAMI: ${olculen}/${BEKLENEN.length} satır damga izini koruyor ` +
        `(kalan ${dokunulmus.length} satır damgadan sonra yazılmış — kapsam dışı).` +
        (siki ? " [SIKI MOD]" : " (BEKCI_GRANDFATHERING_SIKI=1 ile 6/6 istenebilir)"),
    );
    check(
      siki
        ? "§2e ⭐ SIKI MOD: HER satır damga izini koruyor (taze `migrate deploy` beklentisi)"
        : "§2e Körlük zemini: en az bir satır damga değerinde ölçülebildi",
      siki ? olculen === BEKLENEN.length : olculen > 0,
      siki
        ? olculen === BEKLENEN.length
          ? `${olculen}/${BEKLENEN.length}`
          : `yalnız ${olculen}/${BEKLENEN.length} satır ölçülebildi — sıkı mod TAZE bir damga ` +
            "bekler; bayrak yazan bir bekçi (test_module_flag_off) ÖNCE koşmuş olabilir"
        : olculen === 0
          ? "TÜM satırlar damgadan sonra değişmiş — §2d vakumen yeşil kaldı"
          : `${olculen}/${BEKLENEN.length}`,
    );
    if (dokunulmus.length) {
      console.log("\n   ℹ️  Damgadan SONRA değiştirilmiş satırlar (fabrikanın kararı, ihlal değil):");
      for (const d of dokunulmus) console.log(`     · ${d}`);
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
