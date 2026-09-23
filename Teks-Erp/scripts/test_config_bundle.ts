// =============================================================================
// BEKÇİ — YAPILANDIRMA PAKETİ (kurulumlar arası tanım taşıma)
// =============================================================================
// Doğrulanan invariant'lar:
//   1. Zarf doğrulaması FAIL-CLOSED (yabancı dosya / sürüm / bilinmeyen tür)
//   2. Pakette UUID TAŞINMAZ — kimlik iş anahtarıdır
//   3. Önizleme HİÇBİR ŞEY YAZMAZ
//   4. Çakışma stratejileri: rename / skip / overwrite
//   5. Rol şablonunda izin KODLARI taşınır; hedefte olmayan kod HATA verir
//   6. Rol şablonu ATAMALARI taşınmaz
//   7. `isDefault` taşınmaz (hedefin varsayılanı sessizce değişmesin)
//   8. Tür → izin haritası katalogda TANIMLI kodlar kullanır
//   9. NUMARA SERİSİ (D6): kimlik KATALOGDA olduğu için `rename` anlamsızdır;
//      sayaç TAŞINMAZ ve bu BEYANLIDIR; önizleme ÖNCESİ → SONRASI gösterir;
//      kapılar KURU koşar (kilitli seri HATA verir, yazma denenmez); ayar
//      şifresi kapısı UCA değil İÇERİĞE takılıdır ve yalnız `/apply`tadır
//
// Salt-okunur bölümler DB'ye yazmaz; yazan bölüm kendi fixture'ını temizler.
//
// ⭐ §9 NEGATİF SONDALARI (2026-09-23, D6; her biri geri alınıp `cmp`lendi):
//   ⑬ pakete `startValue` sızdırıldı → §9a ❌ (izinli alan KÜMESİ ölçülüyor,
//      tek tek alan adı değil — yarın eklenen bir alan da yakalanır)
//   ⑭ `excluded` beyanı kaldırıldı → §9a ❌
//   ⑮ `rename` kolu kaldırıldı → §9b ❌
//   ⑯ kuru koşumdan `assertSeriesFormatWritable` çıkarıldı → §9c ❌ (C0b kolu)
//   ⑰ `/apply`ten şifre kapısı kaldırıldı → §9d ❌
//   ⑱ `writeItem` ham `prisma.update` yaptı → §9e ❌ (zaman çizgisi satırı yok)
//
// ⚠️ İKİ SONDA ÖNCE ISIRMADI ve İKİSİ DE BULGUYDU:
//   • ⑯ ilk hâlinde KİLİTLİ seriyle koşuluyordu; o seriyi
//     `assertSeriesFormatAllowed` DA reddediyor, yani iddia yazılabilirlik
//     kapısını İZOLE ETMİYORDU. C0b'yi izole eden şey OKUTULAN ama kilitli
//     OLMAYAN bir seridir (§9c ikinci kol).
//   • ⑱ hiç ısırmıyordu çünkü bütün kollar HATA veren serilerdi ⇒ `writeItem`a
//     HİÇ GİRİLMİYORDU. Kapıları ölçmek, YAZMA YOLUNU ölçmek değildir; §9e
//     gerçekten yazar ve yazmanın GÖZLENEBİLİR SONUCUNU (zaman çizgisi satırı)
//     ölçer — kodun ne çağırdığını okumak yerine ne BIRAKTIĞINI.

import prisma from "../src/lib/prisma";
import {
  BUNDLE_KINDS,
  BUNDLE_PERMISSIONS,
  applyBundle,
  exportBundle,
  planBundle,
  validateEnvelope,
  type BundleEnvelope,
} from "../src/services/import/config-bundle.service";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { NUMBER_SERIES_CATALOG } from "../src/constants/number-series-catalog";
import { SCANNED_CLIENT_BREAKING_AXES } from "../src/config/client-version-policy";
import { refreshNumberSeriesCache, resolveSeriesFormat } from "../src/services/number-series.service";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const TEST_NAME = "TEST-BUNDLE-PROFIL";

async function main(): Promise<void> {
  console.log("=== Yapılandırma paketi bekçisi ===\n");

  // --- 8. İzin haritası ------------------------------------------------------
  const catalog = new Set<string>(PERMISSION_CATALOG.map((p) => p.code as string));
  let permOk = true;
  for (const k of BUNDLE_KINDS) {
    const perm = BUNDLE_PERMISSIONS[k];
    if (!catalog.has(perm.read) || !catalog.has(perm.write)) {
      permOk = false;
      console.log(`   ↳ ${k}: ${perm.read}/${perm.write} katalogda YOK`);
    }
  }
  check("tür → izin haritası katalogda tanımlı kodlar kullanır", permOk);
  check("körlük zemini: en az 5 tür", BUNDLE_KINDS.length >= 5, String(BUNDLE_KINDS.length));
  // Rol şablonu belge tasarımıyla AYNI kapıdan geçmemeli — biri yetki nesnesi,
  // diğeri baskı görünümü. Karıştırılırsa şablon düzenleyen büro personeli rol
  // yazabilir hale gelir.
  check(
    "rol şablonu izni belge tasarımından AYRI",
    BUNDLE_PERMISSIONS.PERMISSION_TEMPLATE.write !== BUNDLE_PERMISSIONS.DOCUMENT_PROFILE.write,
  );

  // --- 1. Zarf doğrulaması FAIL-CLOSED --------------------------------------
  const rejects = (raw: unknown): boolean => {
    try {
      validateEnvelope(raw);
      return false;
    } catch {
      return true;
    }
  };
  check("yabancı dosya reddedilir", rejects({ app: "BaskaUygulama", schemaVersion: 1, items: [] }));
  check("desteklenmeyen sürüm reddedilir", rejects({ app: "TeksERP", schemaVersion: 2, items: [] }));
  check("items yoksa reddedilir", rejects({ app: "TeksERP", schemaVersion: 1 }));
  check(
    "bilinmeyen tür reddedilir",
    rejects({ app: "TeksERP", schemaVersion: 1, items: [{ kind: "UYDURMA", key: "x", payload: {} }] }),
  );
  check(
    "anahtarsız öğe reddedilir",
    rejects({ app: "TeksERP", schemaVersion: 1, items: [{ kind: "DOCUMENT_PROFILE", payload: {} }] }),
  );
  check(
    "geçerli zarf kabul edilir",
    !rejects({ app: "TeksERP", schemaVersion: 1, exportedAt: "x", items: [] }),
  );

  const createdProfiles: string[] = [];
  try {
    // --- 2. Dışa aktarımda UUID yok -----------------------------------------
    const exported = await exportBundle([...BUNDLE_KINDS]);
    const asText = JSON.stringify(exported);
    const uuidHit = /"id"\s*:\s*"[0-9a-f]{8}-[0-9a-f]{4}-/i.test(asText);
    check("pakette kayıt UUID'si TAŞINMAZ (kimlik iş anahtarıdır)", !uuidHit);
    check("zarf sürüm + uygulama damgası taşır", exported.schemaVersion === 1 && exported.app === "TeksERP");
    check("dışa aktarım kendi doğrulamasından geçer", (() => {
      try {
        validateEnvelope(exported);
        return true;
      } catch {
        return false;
      }
    })());

    // --- 3. Önizleme yazmaz --------------------------------------------------
    const env: BundleEnvelope = {
      schemaVersion: 1,
      app: "TeksERP",
      exportedAt: new Date().toISOString(),
      items: [
        {
          kind: "DOCUMENT_PROFILE",
          key: TEST_NAME,
          payload: { name: TEST_NAME, description: "bekçi", config: {}, isActive: true },
        },
      ],
    };
    const plan = await planBundle(env, "rename");
    check("önizleme yeni kayıt der", plan.rows[0]?.action === "CREATE", JSON.stringify(plan.rows[0]));
    const afterPreview = await prisma.documentProfile.count({ where: { name: TEST_NAME } });
    check("ÖNİZLEME HİÇBİR ŞEY YAZMAZ", afterPreview === 0, `bulunan=${afterPreview}`);

    // --- 4. Uygulama + çakışma stratejileri ---------------------------------
    const applied = await applyBundle(env, "rename");
    check("uygulama kaydı oluşturur", applied.applied === 1, JSON.stringify(applied.summary));
    const p1 = await prisma.documentProfile.findFirst({ where: { name: TEST_NAME } });
    if (p1) createdProfiles.push(p1.id);
    check("kayıt DB'de", Boolean(p1));

    const skipPlan = await planBundle(env, "skip");
    check("çakışmada SKIP", skipPlan.rows[0]?.action === "SKIP");

    const renamePlan = await planBundle(env, "rename");
    check("çakışmada RENAME yeni ad üretir", renamePlan.rows[0]?.action === "RENAME" && Boolean(renamePlan.rows[0]?.newKey), JSON.stringify(renamePlan.rows[0]));

    const overwritePlan = await planBundle(env, "overwrite");
    check("çakışmada OVERWRITE", overwritePlan.rows[0]?.action === "OVERWRITE");

    const applied2 = await applyBundle(
      { ...env, items: [{ ...env.items[0]!, payload: { ...env.items[0]!.payload, description: "güncellendi" } }] },
      "overwrite",
    );
    check("OVERWRITE mevcut kaydı günceller (yeni kayıt açmaz)", applied2.applied === 1);
    const afterOverwrite = await prisma.documentProfile.findMany({ where: { name: TEST_NAME } });
    check("aynı adla İKİNCİ kayıt oluşmadı", afterOverwrite.length === 1, `bulunan=${afterOverwrite.length}`);
    check("içerik güncellendi", afterOverwrite[0]?.description === "güncellendi", afterOverwrite[0]?.description ?? "yok");

    // --- 5. Rol şablonu: bilinmeyen izin kodu HATA ---------------------------
    const badRole: BundleEnvelope = {
      schemaVersion: 1,
      app: "TeksERP",
      exportedAt: new Date().toISOString(),
      items: [
        {
          kind: "PERMISSION_TEMPLATE",
          key: "TEST-BUNDLE-ROL",
          payload: { name: "TEST-BUNDLE-ROL", permissionCodes: ["olmayan:izin"] },
        },
      ],
    };
    const badResult = await applyBundle(badRole, "rename");
    check("hedefte olmayan izin kodu HATA verir (sessizce atlanmaz)", badResult.failed === 1, JSON.stringify(badResult.rows[0]));
    check(
      "hata mesajı eksik kodu SÖYLER",
      String(badResult.rows[0]?.message ?? "").includes("olmayan:izin"),
      badResult.rows[0]?.message ?? "yok",
    );
    const roleCount = await prisma.permissionTemplate.count({ where: { name: "TEST-BUNDLE-ROL" } });
    check("hatalı rol şablonu YAZILMADI", roleCount === 0, `bulunan=${roleCount}`);

    // --- 6/7. Taşınmayanlar ---------------------------------------------------
    check(
      "rol şablonu paketinde ATAMA (kullanıcı) alanı yok",
      !asText.includes('"users"') && !asText.includes('"userId"'),
    );
    const travelerItems = exported.items.filter((i) => i.kind === "TRAVELER_TEMPLATE");
    check(
      "refakat kartı şablonu paketinde isDefault=true TAŞINMAZ (uygulama tarafında sıfırlanır)",
      travelerItems.every((i) => i.payload.isDefault === undefined || typeof i.payload.isDefault === "boolean"),
    );

  // --- 9. NUMARA SERİSİ (D6) -------------------------------------------------
  const nsPaket = await exportBundle(["NUMBER_SERIES"]);
  const nsItems = nsPaket.items.filter((i) => i.kind === "NUMBER_SERIES");
  check(
    "§9a numara serisi paketi KATALOĞUN tamamını taşıyor",
    nsItems.length === NUMBER_SERIES_CATALOG.length,
    `${nsItems.length} / ${NUMBER_SERIES_CATALOG.length}`,
  );
  // ⚠️ SAYAÇ ALANLARI PAYLOAD'DA OLMAMALI ve bu iddia ANAHTAR KÜMESİNİ ölçer,
  // tek tek alan adı aramaz: "startValue yok mu" diye sormak, yarın eklenen
  // `resetPeriod` gibi bir alanı sessizce geçirirdi.
  const izinliAlanlar = new Set([
    "label", "prefix", "dateSegment", "digits", "separator", "separator2", "numberSource",
  ]);
  const fazlaAlan = [
    ...new Set(nsItems.flatMap((i) => Object.keys(i.payload)).filter((k) => !izinliAlanlar.has(k))),
  ];
  check(
    "§9a ⭐ paket YALNIZ biçim + numara kaynağı taşıyor (sayaç DIŞARIDA)",
    fazlaAlan.length === 0,
    fazlaAlan.join(", ") || `${izinliAlanlar.size} alan`,
  );
  check(
    "§9a ⭐ taşınmayanlar BEYANLI (`excluded`) — 'yok' ile 'bilerek dışarıda' aynı şey değil",
    Array.isArray(nsPaket.excluded) && nsPaket.excluded.length >= 3,
    `${nsPaket.excluded?.length ?? 0} beyan`,
  );

  // Düzenlenebilir bir seri seç — kilitli/kapalı olanlar ayrı kolu ölçer.
  const duzenlenebilir = NUMBER_SERIES_CATALOG.find(
    (e) => !e.lockedReason && e.scopedCounter && !e.kind,
  );
  const kilitli = NUMBER_SERIES_CATALOG.find((e) => e.lockedReason);
  // ⚠️ AYRI BİR SERİ ŞART: kilitli seriyi `assertSeriesFormatAllowed` DA
  // reddediyor, yani o kol "yazılabilirlik kapısı kuru koşuyor mu" sorusunu
  // İZOLE ETMİYOR (ölçüldü: kapıyı kuru koşumdan çıkardım, iddia yeşil kaldı).
  // C0b'yi izole eden şey OKUTULAN ama kilitli OLMAYAN bir seridir — ve bu,
  // paket için en kritik kapı: başka bir kurulumdan gelen bir biçim, sahadaki
  // okuyucuları sessizce kör edebilir.
  // ⚠️ HEDEF (SERİ, EKSEN) ÇİFTİDİR, yalnız seri DEĞİL — ve bu ölçülerek öğrenildi
  // (2026-09-23): C0b kilidi artık EKSEN düzeyinde. İddia iş emrinin HANE
  // değişikliğiyle kuruluyordu; hane ekseni açıldığı gün paket onu doğru olarak
  // UYGULADI ve kapı, korunan şey bozulmadığı hâlde kırmızı verdi. Hedef, kilidi
  // GERÇEKTEN kıran bir eksen taşıyan seriden seçilir.
  const taranan = NUMBER_SERIES_CATALOG.find(
    (e) => e.kind && !e.lockedReason && e.scopedCounter &&
      (SCANNED_CLIENT_BREAKING_AXES[e.key]?.length ?? 0) > 0,
  );
  const kiranEksen = taranan ? SCANNED_CLIENT_BREAKING_AXES[taranan.key]![0]! : null;
  check("§9 körlük zemini: düzenlenebilir · kilitli · OKUTULAN seri GERÇEKTEN var",
    duzenlenebilir !== undefined && kilitli !== undefined && taranan !== undefined,
    `${duzenlenebilir?.key ?? "-"} / ${kilitli?.key ?? "-"} / ${taranan?.key ?? "-"}`);

  function nsKalem(key: string, over: Record<string, unknown> = {}): BundleEnvelope {
    const f = resolveSeriesFormat(key);
    return {
      schemaVersion: 1,
      app: "TeksERP",
      exportedAt: new Date().toISOString(),
      items: [{
        kind: "NUMBER_SERIES",
        key,
        payload: {
          prefix: f.prefix, dateSegment: f.dateSegment, digits: f.digits,
          separator: f.separator, separator2: f.separator2 ?? null,
          numberSource: f.numberSource ?? "FREE",
          ...over,
        },
      }],
    };
  }

  if (duzenlenebilir && kilitli) {
    const ayniPlan = await planBundle(nsKalem(duzenlenebilir.key), "overwrite");
    check("§9b aynı ayar → SKIP (gereksiz yazma yok)",
      ayniPlan.rows[0]?.action === "SKIP", ayniPlan.rows[0]?.message);

    const renamePlan = await planBundle(nsKalem(duzenlenebilir.key, { digits: 5 }), "rename");
    check("§9b ⭐ `rename` bu türde ANLAMSIZ — SKIP ve SEBEBİNİ SÖYLÜYOR",
      renamePlan.rows[0]?.action === "SKIP" &&
        (renamePlan.rows[0]?.message ?? "").includes("yeniden adlandırılamaz"),
      renamePlan.rows[0]?.message);

    const degisimPlan = await planBundle(nsKalem(duzenlenebilir.key, { digits: 5 }), "overwrite");
    check("§9b ⭐ farklı biçim → OVERWRITE ve önizleme ÖNCESİ → SONRASI gösteriyor",
      degisimPlan.rows[0]?.action === "OVERWRITE" && (degisimPlan.rows[0]?.message ?? "").includes("→"),
      degisimPlan.rows[0]?.message);

    const kilitPlan = await planBundle(nsKalem(kilitli.key, { digits: 5 }), "overwrite");
    check("§9c ⭐ KİLİTLİ seri önizlemede HATA verir (kapı KURU koşuyor, yazma denenmiyor)",
      kilitPlan.rows[0]?.action === "ERROR", kilitPlan.rows[0]?.message);
    const kilitliOnce = resolveSeriesFormat(kilitli.key);
    const kilitSonuc = await applyBundle(nsKalem(kilitli.key, { digits: 5 }), "overwrite");
    const kilitliSonra = resolveSeriesFormat(kilitli.key);
    check("§9c ⭐ HATA veren kalem UYGULANMIYOR ve DB değişmiyor",
      kilitSonuc.applied === 0 && kilitliOnce.digits === kilitliSonra.digits,
      `applied=${kilitSonuc.applied} · hane ${kilitliOnce.digits} → ${kilitliSonra.digits}`);
  }

  if (!taranan || !kiranEksen) {
    console.log(
      "⏭️  §9c C0b kolu ÖLÇÜLEMEDİ — eski istemcinin kırıldığı ekseni kalan " +
        "okutulan seri yok; kilit bu ağaçta gözlemlenemiyor.",
    );
  } else {
    // Kilitli EKSENİ oynatan bir yük kurulur; hangi alan olduğu keşiften gelir.
    const tarananFmt = resolveSeriesFormat(taranan.key);
    const kiranYuk: Record<string, unknown> =
      kiranEksen === "prefix" ? { prefix: `${tarananFmt.prefix}Z`.slice(0, 6) }
      : kiranEksen === "dateSegment" ? { dateSegment: tarananFmt.dateSegment === "NONE" ? "DDMMYY" : "NONE" }
      : kiranEksen === "digits" ? { digits: tarananFmt.digits === 5 ? 4 : 5 }
      : kiranEksen === "separator" ? { separator: tarananFmt.separator === "-" ? "_" : "-" }
      : { separator2: (tarananFmt.separator2 ?? "") === "/" ? "." : "/" };
    // ⚠️ GERİ ALMA, REDDEDİLMESİ BEKLENEN BİR KALEM İÇİN DE ŞART (1e dersi
    // 2026-09-23): bu iddia `applyBundle` çağırıyor, yani SONUCU UYGULAYAN bir
    // iddia. Kapı sağlamken hiçbir şey yazılmaz — ama kapı bozulduğunda (ölçülen
    // durum tam olarak budur) kalem UYGULANIR ve test DB'sinde KALICI artık
    // bırakır. Bayat §9c bunu iki ayrı DB'de yaptı: iş emri serisi 5 haneye
    // kaydı ve zaman çizgisine satır düştü. *Yazan bir bekçi, yazdığını yalnız
    // "yazmamam gerekiyordu" diyerek geri alamaz.*
    const c0bOncekiKolon = await prisma.numberSeries.findUnique({
      where: { key: taranan.key },
      select: { prefix: true, dateSegment: true, digits: true, separator: true, separator2: true, formatChangedAt: true },
    });
    const c0bOncekiSatirlar = await prisma.numberSeriesLine.findMany({
      where: { seriesKey: taranan.key }, select: { id: true },
    });
    const c0bPlan = await planBundle(nsKalem(taranan.key, kiranYuk), "overwrite");
    check(`§9c ⭐ OKUTULAN seri C0b kilidine takılıyor — paket bu kapının ETRAFINDAN DOLANAMAZ (${taranan.key} · ${kiranEksen})`,
      // ⚠️ YÜKLEM METNE DEĞİL C0b'NİN AYIRT EDİCİ ÖĞESİNE bakar: "güncellenmeden"
      // SERİ düzeyindeki cümlenin sözcüğüydü, EKSEN düzeyindeki cümlede yok
      // (ölçüldü 2026-09-23). İki cümlenin ortak ve ayırt edici yanı SAHADAKİ
      // İSTEMCİYİ anmalarıdır — sayaç ve yapısal kilitler tabletten hiç söz etmez.
      c0bPlan.rows[0]?.action === "ERROR" &&
        (c0bPlan.rows[0]?.message ?? "").includes("tablet"),
      c0bPlan.rows[0]?.message);
    const tarananOnce = resolveSeriesFormat(taranan.key);
    const c0bSonuc = await applyBundle(nsKalem(taranan.key, kiranYuk), "overwrite");
    const tarananSonra = resolveSeriesFormat(taranan.key);
    check("§9c ⭐ C0b'ye takılan kalem UYGULANMIYOR (okutulan biçim sahada bozulmuyor)",
      c0bSonuc.applied === 0 &&
        tarananSonra.prefix === tarananOnce.prefix &&
        tarananSonra.dateSegment === tarananOnce.dateSegment &&
        tarananSonra.digits === tarananOnce.digits &&
        tarananSonra.separator === tarananOnce.separator &&
        (tarananSonra.separator2 ?? null) === (tarananOnce.separator2 ?? null),
      `applied=${c0bSonuc.applied}`);
    // Kapı bozukken yazılmış olabilecek her şeyi ID İLE geri al (§9e deseni).
    const c0bKalanlar = await prisma.numberSeriesLine.findMany({
      where: { seriesKey: taranan.key }, select: { id: true },
    });
    const c0bEskiIdler = new Set(c0bOncekiSatirlar.map((x) => x.id));
    const c0bYeniler = c0bKalanlar.filter((x) => !c0bEskiIdler.has(x.id)).map((x) => x.id);
    if (c0bYeniler.length > 0) {
      await prisma.numberSeriesLine.deleteMany({ where: { id: { in: c0bYeniler } } });
    }
    if (c0bOncekiKolon) {
      await prisma.numberSeries.update({ where: { key: taranan.key }, data: c0bOncekiKolon });
    }
    await refreshNumberSeriesCache();
    const c0bGeri = resolveSeriesFormat(taranan.key);
    check("§9c geri alma ÖLÇÜLDÜ: seri sondadan önceki hâlinde (kapı bozuksa bile artık yok)",
      c0bGeri.prefix === tarananOnce.prefix && c0bGeri.digits === tarananOnce.digits &&
        c0bYeniler.length === 0,
      `${c0bGeri.prefix}/${c0bGeri.digits} · artık satır ${c0bYeniler.length}`);
  }

  // ⭐ §9e BAŞARILI İÇE AKTARIM — ve bu bölüm bir SONDA BULGUSUNDAN doğdu:
  // `writeItem`daki `updateSeriesFormat` çağrısını ham bir `prisma.update` ile
  // değiştirdim ve HİÇBİR iddia kırmızı vermedi. Sebep: yukarıdaki bütün
  // kollar HATA veren serilerdi, yani `writeItem`a HİÇ GİRİLMİYORDU. Kapıların
  // ölçülmesi, yazma yolunun ölçüldüğü anlamına gelmiyordu.
  // ⇒ Burada gerçekten YAZILIR ve yazmanın GÖZLENEBİLİR SONUCU ölçülür: ham
  // bir kolon güncellemesi biçimi değiştirir ama ZAMAN ÇİZGİSİNE SATIR YAZMAZ
  // (ve emekli ön eki de taşımaz). Kodun ne çağırdığını okumak yerine, ne
  // BIRAKTIĞINI ölçüyoruz.
  if (duzenlenebilir) {
    const oncekiFmt = resolveSeriesFormat(duzenlenebilir.key);
    const oncekiSatirlar = await prisma.numberSeriesLine.findMany({
      where: { seriesKey: duzenlenebilir.key },
    });
    const oncekiKolon = await prisma.numberSeries.findUnique({
      where: { key: duzenlenebilir.key },
      select: { prefix: true, dateSegment: true, digits: true, separator: true,
        separator2: true, retiredPrefixes: true, formatChangedAt: true },
    });
    try {
      const sonuc = await applyBundle(
        nsKalem(duzenlenebilir.key, { digits: oncekiFmt.digits + 1 }),
        "overwrite",
      );
      check("§9e ⭐ geçerli kalem GERÇEKTEN uygulanıyor",
        sonuc.applied === 1 && resolveSeriesFormat(duzenlenebilir.key).digits === oncekiFmt.digits + 1,
        `applied=${sonuc.applied} · hane ${oncekiFmt.digits} → ${resolveSeriesFormat(duzenlenebilir.key).digits}`);
      const sonrakiSatirlar = await prisma.numberSeriesLine.findMany({
        where: { seriesKey: duzenlenebilir.key },
      });
      check("§9e ⭐ içe aktarım ZAMAN ÇİZGİSİNE SATIR YAZIYOR (panelin yazarından geçti)",
        sonrakiSatirlar.length === oncekiSatirlar.length + 1,
        `${oncekiSatirlar.length} → ${sonrakiSatirlar.length} satır`);
    } finally {
      // Geri alma: sondadan ÖNCEKİ ana. Yeni satır silinir, kolonlar birebir
      // geri yazılır — `updateSeriesFormat` ile geri almak İKİNCİ bir satır
      // doğururdu ve defter gerçekte olmayan iki geçiş gösterirdi.
      const kalanlar = await prisma.numberSeriesLine.findMany({
        where: { seriesKey: duzenlenebilir.key }, select: { id: true },
      });
      const eskiIdler = new Set(oncekiSatirlar.map((x) => x.id));
      await prisma.numberSeriesLine.deleteMany({
        where: { id: { in: kalanlar.filter((x) => !eskiIdler.has(x.id)).map((x) => x.id) } },
      });
      if (oncekiKolon) {
        await prisma.numberSeries.update({ where: { key: duzenlenebilir.key }, data: oncekiKolon });
      }
      await refreshNumberSeriesCache();
    }
    check("§9e sonda GERİ ALINDI: biçim sondadan önceki hâlinde",
      resolveSeriesFormat(duzenlenebilir.key).digits === oncekiFmt.digits,
      `hane ${resolveSeriesFormat(duzenlenebilir.key).digits}`);
  }

  // ⚠️ KAPI BAĞLANTISI METİNDEN ÖLÇÜLÜYOR ve SINIRI BEYANLI: burada sorulan
  // "kapı DOĞRU UCA TAKILI MI"dır; kapının davranışı (şifre yoksa uyur, yanlış
  // şifre 403 …) `test_settings_password`ın HTTP ayaklı bölümlerinin işidir ve
  // sunucu yoksa ORASI atlanır. İki soru ayrı; bu iddia ötekinin yerine geçmez.
  const rotaKodu = readFileSync(join(__dirname, "..", "src", "routes", "config-bundle.routes.ts"), "utf-8")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const applyBloku = rotaKodu.slice(rotaKodu.indexOf('router.post(\n  "/apply"'));
  const previewBloku = rotaKodu.slice(
    rotaKodu.indexOf('router.post(\n  "/preview"'),
    rotaKodu.indexOf('router.post(\n  "/apply"'),
  );
  check("§9d ⭐ ayar şifresi kapısı `/apply`e TAKILI",
    applyBloku.includes("requirePasswordForGatedKinds"));
  check("§9d ⭐ `/preview`te YOK (önizleme hiçbir şey yazmaz; panelin önizlemesi de şifresiz)",
    previewBloku.length > 0 && !previewBloku.includes("requirePasswordForGatedKinds"),
    `preview bloğu ${previewBloku.length} karakter`);

  } finally {
    await prisma.documentProfile.deleteMany({ where: { name: { startsWith: "TEST-BUNDLE" } } });
    await prisma.permissionTemplate.deleteMany({ where: { name: { startsWith: "TEST-BUNDLE" } } });
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
