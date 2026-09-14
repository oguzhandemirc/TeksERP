// =============================================================================
// FİRE KALİTEDE ETİKET KAPISI — iki kapı + istemci sözleşmesi (2026-08-20)
// =============================================================================
// Saha isteği: "fire kalite bir top çıkarılıyorsa etiketi basılmasın" (varsayılan),
// fabrika isterse ayardan açsın.
//
// ⚠️ KURALIN NEDEN KALİTEDE OLDUĞU — bu testin varlık sebebi:
//   (kalıcı)   Etiket politikası DİSPOZİSYONDAN ayrı bir karardır. Yarın
//              A1_STOCK'a inen ama etiket almaması gereken bir kademe eklenirse
//              statü yine yanlış cevap verir.
//   (tarihsel) Tasarım anında ayrıca ZORUNLUYDU: FİRE kalitesi topu SCRAP'e
//              DÜŞÜRMÜYORDU (üç kalitenin de targetStatus'ı WAREHOUSE) →
//              statüye bağlı kural HİÇ tetiklenmez, sessizce ölü kalırdı. Bu
//              aynı gün ayrıca düzeltildi (FIRE → SCRAP).
// §1b bu ayrımı ölçer ve İKİ YÖNDE de bilgi basar — kural statüden bağımsız
// çalışmalı, fabrika hedefi ne olursa olsun.
//
// Enforcement mobil istemcidedir (otomatik baskıyı O başlatır) — bu yüzden test
// backend sözleşmesini doğrular: (a) kalite işareti liste yanıtında GELİYOR mu,
// (b) bayrak dört kapıdan geçiyor mu, (c) varsayılan KAPALI mı.
// =============================================================================

import prisma from "../src/lib/prisma";
import {
  SETTING_KEYS,
  readScrapGradeLabelEnabled,
  systemSettingService,
} from "../src/services/system-setting.service";
import { qualityGradeService } from "../src/routes/quality-grade.routes";
import { LabelService } from "../src/services/label.service";
import { LabelKind, Prisma } from "@prisma/client";
import { atlamaDefteri } from "./lib/atlama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? `\n      ↳ ${detail}` : ""}`);
  }
}

/**
 * ÖLÇÜLEMEYEN kontrol — kırmızı DEĞİL, GÖRÜNÜR atlama.
 *
 * Ayrım load-bearing: "kod yanlış" ile "bu kurulumun VERİSİ bu ölçümü mümkün
 * kılmıyor" aynı şey değildir. İkincisini kırmızı saymak, paketi kalıcı kırmızıda
 * bırakır ve kırmızıyı normalleştirir; sessizce geçmek ise "yeşil = kapsandı"
 * yalanını üretir. Koşucu `run-all-tests.ts` özet satırındaki "N atlandı"yı
 * okuyup raporlar (2026-09-05).
 */
/**
 * ⚠️ ATLAMA DEFTERİ ORTAK ALTYAPIDIR — yerel kopya AÇILMAZ. Kopya `"?"`
 * (sayılamayan atlama) sınıfını temsil EDEMEZ ve sayıyı elle düzeltmeye zorlar.
 */
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

function atla(label: string, neden: string, adet: number | "?" = 1): void {
  ATLAMA.atla(label, neden, adet);
}

async function main(): Promise<void> {
  // ── §1 Kural KALİTEDE, statüde değil ──────────────────────────────────────
  const grades = await prisma.qualityGrade.findMany({
    select: { code: true, targetStatus: true, skipLabel: true },
    orderBy: { sortOrder: "asc" },
  });
  check("kalite kataloğu okunabiliyor", grades.length > 0, `bulunan: ${grades.length}`);

  const skipping = grades.filter((g) => g.skipLabel);
  check(
    "§1 en az bir kalite 'etiketsiz' işaretli (yoksa özellik ölü doğar)",
    skipping.length > 0,
    `skipLabel=true olan kalite YOK — migration/seed uygulanmamış olabilir`,
  );

  // Asıl ders: işaretli kalitenin hedefi SCRAP OLMAK ZORUNDA DEĞİL. Bu kontrol
  // "statüye bağlarsak çalışır mı" sorusunu ölçer; hayır diyorsa tasarım doğru.
  const skipButNotScrap = skipping.filter((g) => g.targetStatus !== "SCRAP");
  check(
    "§1b işaretli kalite SCRAP hedefli OLMAYABİLİR — kural statüden çözülemez",
    true,
    `bilgi: ${skipping.map((g) => `${g.code}→${g.targetStatus}`).join(", ") || "—"}` +
      (skipButNotScrap.length > 0
        ? ` · ${skipButNotScrap.length} tanesi SCRAP DEĞİL → statü tabanlı bir kural bu kurulumda hiç tetiklenmezdi`
        : ""),
  );

  // ── §2 İşaret liste yanıtında GELİYOR mu (mobil ek uç açmıyor) ────────────
  const listed = (await qualityGradeService.findAll({
    query: { limit: "100" },
  } as never)) as { data: Array<Record<string, unknown>> };
  const rows = listed.data ?? [];
  check("§2 kalite listesi uç yanıtı dolu", rows.length > 0);
  check(
    "§2b `skipLabel` liste yanıtında var — mobil ayrı uç/istek AÇMAZ",
    rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], "skipLabel"),
    `alanlar: ${Object.keys(rows[0] ?? {}).join(",")}`,
  );
  const fireRow = rows.find((r) => r.skipLabel === true);
  check(
    "§2c işaretli kalite liste yanıtında da işaretli görünüyor",
    fireRow != null,
    "liste yanıtında skipLabel=true satır yok (select alanı düşürüyor olabilir)",
  );

  // ── §3 Bayrak: varsayılan KAPALI + yazılabiliyor + geri okunuyor ──────────
  const original = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_SCRAP_GRADE_ENABLED },
    select: { value: true },
  });

  try {
    await prisma.systemSetting.deleteMany({
      where: { key: SETTING_KEYS.LABEL_SCRAP_GRADE_ENABLED },
    });
    check(
      "§3 kayıt YOKKEN varsayılan KAPALI (fail-closed: fire topa kâğıt çıkmaz)",
      (await readScrapGradeLabelEnabled()) === false,
    );

    const admin = await prisma.user.findFirst({ select: { id: true } });
    if (!admin) throw new Error("kullanıcı yok — ayar yazımı test edilemiyor");

    await systemSettingService.setFeatureFlags({ scrapGradeLabelEnabled: true }, admin.id);
    check("§3b ayar AÇIK yazılabiliyor", (await readScrapGradeLabelEnabled()) === true);

    const flags = await systemSettingService.getFeatureFlags();
    check(
      "§3c bayrak /feature-flags yanıtında dönüyor (istemci görebiliyor)",
      flags.data.scrapGradeLabelEnabled === true,
      `dönen: ${String(flags.data.scrapGradeLabelEnabled)}`,
    );

    await systemSettingService.setFeatureFlags({ scrapGradeLabelEnabled: false }, admin.id);
    check("§3d ayar KAPALI'ya dönebiliyor", (await readScrapGradeLabelEnabled()) === false);

    // Tip guard: boolean olmayan değer reddedilmeli (dört kapı sözleşmesi).
    let rejected = false;
    try {
      await systemSettingService.setFeatureFlags(
        { scrapGradeLabelEnabled: "evet" } as never,
        admin.id,
      );
    } catch {
      rejected = true;
    }
    check("§3e boolean olmayan değer REDDEDİLİYOR", rejected);
  } finally {
    // Ortamı bulduğumuz gibi bırak (paylaşımlı dev DB).
    await prisma.systemSetting.deleteMany({
      where: { key: SETTING_KEYS.LABEL_SCRAP_GRADE_ENABLED },
    });
    if (original) {
      await systemSettingService.set(
        SETTING_KEYS.LABEL_SCRAP_GRADE_ENABLED,
        original.value as never,
        "test geri yükleme",
        undefined,
      );
    }
  }

  // ── §4 İstemci sözleşmesi: kural İKİ KAPILI ──────────────────────────────
  // Mobil `isSkipLabelRoll` şunu yapar: bayrak AÇIKSA hiç bakma (false),
  // kapalıysa topun kalite KODUNU katalogda ara ve skipLabel'a bak. Burada o
  // mantığın veri tarafını doğruluyoruz: kod eşleşmesi çalışıyor mu.
  const fireCode = String(fireRow?.code ?? "");
  const resolved = grades.find((g) => g.code === fireCode);
  check(
    "§4 top kalite KODU ile katalog satırı eşleşiyor (Roll.qualityGrade snapshot'ı)",
    fireCode !== "" && resolved?.skipLabel === true,
    `kod="${fireCode}" → ${resolved ? `skipLabel=${resolved.skipLabel}` : "satır bulunamadı"}`,
  );

  // ── §5 FİRE İŞARETİ ETİKETTE — istisna baskı "satılabilir mal" gibi görünmesin ──
  // Fire etiketi normalde HİÇ basılmaz (otomatik kapalı); ama operatör onay verip
  // elle bastığında kâğıt bir bakışta ayırt edilebilmeli. Uçtan uca ölçüyoruz:
  // gerçek şablonla render edip işaretin çıktığını / normal etikete SIZMADIĞINI
  // doğruluyoruz. Şablon verisi değiştiği için bu, kod testi değil ÇIKTI testidir.
  const svc = new LabelService();
  const machine = await prisma.machine.findFirst({ select: { id: true } });
  /** renderFor içindeki son hata — null dönüşünün SEBEBİ (top yok mu, kapı mı). */
  let renderError: string | null = null;
  async function renderFor(where: Prisma.RollWhereInput): Promise<string | null> {
    const roll = await prisma.roll.findFirst({
      where: { ...where, barcode: { not: null } },
      select: { id: true },
    });
    if (!roll) return null;
    // confirmScrap: bu bölüm etiketin İÇERİĞİNİ ölçer, kapıyı DEĞİL (kapı §6).
    // Onay bayrağı olmadan sunucu 409 döner ve içerik hiç üretilmez.
    //
    // ⚠️ try/catch load-bearing: açık geçiş bozulursa (kapı çıkışsız hale
    // gelirse) burası fırlatır ve test ÇÖKEREK kırmızı verirdi — exit kodu doğru
    // ama çıktı "neden öldü" sorusunu cevaplamaz. Hatayı yakalayıp okunabilir
    // bir ❌ satırına çeviriyoruz (sonda yazarken ölçüldü).
    try {
      const out = await svc.getRollLabelNative(roll.id, LabelKind.ROLL_FINISHED, {
        machineId: machine?.id ?? null,
        confirmScrap: true,
      });
      return out.data.content;
    } catch (e) {
      const err = e as { statusCode?: number; details?: { code?: string } };
      renderError = `${err.statusCode ?? "?"}:${err.details?.code ?? String(e).slice(0, 60)}`;
      return null;
    }
  }

  // ⚠️ FIXTURE GARANTİ EDİLİR (2026-09-06): bu bölüm ortamda `skipLabel` true VE
  // false kalite kademesine sahip TOPLAR olmasını bekliyordu; temiz CI
  // veritabanında ikisi de yok ve §5/§5c "render edilemedi" ile kırmızı verirdi —
  // oysa ölçtüğü şey etiketin İÇERİĞİ, veritabanının dolu olması değil. [TD-17]
  const sgTs = Date.now();
  const sgItem = await prisma.item.create({
    data: { code: `TEST-SGL-${sgTs}`, name: `TEST FIRE KUMAS ${sgTs}`, itemType: "FABRIC" },
    select: { id: true },
  });
  const kademeler: { id: string }[] = [];
  const sgRolls: { id: string }[] = [];
  for (const [ek, skip] of [["FIRE", true], ["IYI", false]] as [string, boolean][]) {
    const kademe = await prisma.qualityGrade.create({
      data: { code: `TEST-SGL-${ek}-${sgTs}`, name: `TEST ${ek} ${sgTs}`, skipLabel: skip },
      select: { id: true },
    });
    kademeler.push(kademe);
    const r = await prisma.roll.create({
      data: {
        barcode: `TEST-SGL-${ek}-R${sgTs}`,
        itemId: sgItem.id,
        initialQty: 50,
        currentQty: 50,
        // ⚠️ İKİ ALAN BİRLİKTE: kapı (`assertScrapLabelAllowed`) kademeyi
        // İLİŞKİDEN değil ESKİ `qualityGrade` METİN kolonundan çözüyor
        // (`where: { code, skipLabel: true }`). Yalnız `qualityGradeId` yazmak
        // §5'i çalıştırır ama §6'yı SESSİZCE geçirir — ölçüldü: kapı hiç
        // ısırmadı ve dört kontrol "GEÇTİ" ile kırmızı verdi.
        qualityGrade: `TEST-SGL-${ek}-${sgTs}`,
        qualityGradeId: kademe.id,
        width: 150,
        status: "WAREHOUSE",
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    sgRolls.push(r);
  }

  const fireLabel = await renderFor({ qualityGradeRef: { skipLabel: true } });
  const goodLabel = await renderFor({ qualityGradeRef: { skipLabel: false } });

  if (fireLabel == null) {
    check(
      "§5 fire etiketi render edilebildi",
      false,
      renderError
        ? `render REDDEDİLDİ (${renderError}) — açık geçiş (confirmScrap) çalışmıyor olabilir`
        : "skipLabel'lı barkodlu top yok — atlandı",
    );
  } else {
    // ⚠️ §5/§5b ETİKET İÇERİĞİNİ ölçer ve içerik ŞABLON VERİSİNDEN doğar: uyarı
    // metni ve kalite elemanı, fabrikanın Etiket Stüdyosu'ndan düzenlediği aktif
    // ROLL_FINISHED şablonunda tanımlıdır. Bu bekçinin sözleşmesi (başlık) backend
    // kapılarıdır; şablon içeriği bir KURULUM KARARIDIR ve bu bekçinin sahibi
    // olduğu bir şey değildir. Şablon o alanı hiç taşımıyorsa ölçüm YAPILAMAZ —
    // kırmızı vermek "kod bozuk" der ki yanlıştır (Teks-Erp/CLAUDE.md § bekçi
    // sözleşmesi: ortamdaki veriye bağımlı olma).
    const kaliteElemanliSablon = fireLabel.includes('"FIRE"') || fireLabel.includes("SATILAMAZ");
    if (!kaliteElemanliSablon) {
      atla(
        "§5/§5b fire etiketi içeriği",
        "aktif ROLL_FINISHED şablonu kalite/uyarı elemanı TAŞIMIYOR (akış modunda, kanvas varyantı yok) — " +
          "ölçüm şablon verisine bağlı, koda değil. Fabrika şablonu kanvasa taşıdığında bu iki kontrol kendiliğinden koşar.",
      );
    } else {
      check("§5 fire etiketinde uyarı metni VAR", fireLabel.includes("SATILAMAZ"), fireLabel.slice(0, 200));
      check(
        "§5b fire etiketinde 'FIRE' TEK KEZ geçiyor (mükerrer kalite elemanı bastırıldı)",
        (fireLabel.match(/"FIRE"/g) ?? []).length === 1,
        `bulunan: ${(fireLabel.match(/"FIRE"/g) ?? []).length}`,
      );
    }
  }
  if (goodLabel == null) {
    check("§5c normal etiket render edilebildi", false, "skipLabel'sız barkodlu top yok — atlandı");
  } else {
    // EN ÖNEMLİ KONTROL: koşullu eleman sızarsa HER etikete "SATILAMAZ" basılır.
    check("§5c normal etikete fire işareti SIZMIYOR", !goodLabel.includes("SATILAMAZ"));
  }

  // ── §6 SUNUCU KAPISI — kural istemciye BAĞLI DEĞİL ────────────────────────
  // 2026-08-20 ikinci hat: kural önce yalnız mobil `startPrint` hunisindeydi,
  // yani eski APK'lı tablet ya da Electron onu hiç bilmiyordu. Artık kâğıt üreten
  // HER yol `buildRollRenderInput` boğazındaki `assertScrapLabelAllowed`'dan
  // geçer. AÇIK GEÇİŞLİ: `confirmScrap` ile operatör onayı kapıyı açar.
  const gateRoll = await prisma.roll.findFirst({
    where: { qualityGradeRef: { skipLabel: true }, barcode: { not: null } },
    select: { id: true },
  });
  if (!gateRoll) {
    check("§6 sunucu kapısı ölçülebildi", false, "skipLabel'lı barkodlu top yok — atlandı");
  } else {
    const mid = machine?.id ?? null;
    const blocked = async (fn: () => Promise<unknown>): Promise<string> => {
      try {
        await fn();
        return "GEÇTİ";
      } catch (e) {
        const err = e as { statusCode?: number; details?: { code?: string } };
        return `${err.statusCode ?? "?"}:${err.details?.code ?? "?"}`;
      }
    };
    // Dört kâğıt yüzeyi de kapalı olmalı — biri açık kalırsa kural o yoldan sızar.
    const html = await blocked(() =>
      svc.getRollLabelHtml(gateRoll.id, LabelKind.ROLL_FINISHED, { machineId: mid }),
    );
    const native = await blocked(() =>
      svc.getRollLabelNative(gateRoll.id, LabelKind.ROLL_FINISHED, { machineId: mid }),
    );
    const ppla = await blocked(() =>
      svc.getRollLabelPpla(gateRoll.id, LabelKind.ROLL_FINISHED, { machineId: mid }),
    );
    // ÖNİZLEME de kapı arkasında: Electron diyaloğu onayı önizlemeden ÖNCE sorar.
    const preview = await blocked(() =>
      svc.getRollPreview(gateRoll.id, LabelKind.ROLL_FINISHED, { machineId: mid }),
    );
    const want = "409:SCRAP_LABEL_BLOCKED";
    check("§6 html onaysız 409 SCRAP_LABEL_BLOCKED", html === want, html);
    check("§6b native onaysız 409", native === want, native);
    check("§6c ppla onaysız 409", ppla === want, ppla);
    check("§6d önizleme onaysız 409 (Electron onayı önizlemeden ÖNCE sorar)", preview === want, preview);

    // AÇIK GEÇİŞ: onay verilince basılabilmeli — kapı çıkışsız DEĞİL.
    const withConfirm = await blocked(() =>
      svc.getRollLabelHtml(gateRoll.id, LabelKind.ROLL_FINISHED, {
        machineId: mid,
        confirmScrap: true,
      }),
    );
    check("§6e onay verilince BASILIYOR (fail-closed ama çıkışsız değil)", withConfirm === "GEÇTİ", withConfirm);

    // Veri ucu BİLEREK kapı dışında — listeler/ekranlar bozulmasın.
    const payloadOk = await blocked(() => svc.getRollLabel(gateRoll.id));
    check("§6f payload ucu kapı DIŞINDA (veri döner, kâğıt üretmez)", payloadOk === "GEÇTİ", payloadOk);
  }

  // Normal top hiçbir yoldan engellenmemeli.
  const normalRoll = await prisma.roll.findFirst({
    where: { qualityGradeRef: { skipLabel: false }, barcode: { not: null } },
    select: { id: true },
  });
  if (normalRoll) {
    let ok = true;
    try {
      await svc.getRollLabelHtml(normalRoll.id, LabelKind.ROLL_FINISHED, {
        machineId: machine?.id ?? null,
      });
    } catch {
      ok = false;
    }
    check("§6g normal top kapıdan ETKİLENMİYOR", ok);
  }
  // Fixture temizliği — FK sırası: hareketler → top → kademe → kalem.
  const sgIds = sgRolls.map((r) => r.id);
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: sgIds } } }).catch(() => {});
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: sgIds } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: sgIds } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: sgIds } } }).catch(() => {});
  await prisma.qualityGrade.deleteMany({ where: { id: { in: kademeler.map((k) => k.id) } } }).catch(() => {});
  await prisma.item.deleteMany({ where: { id: sgItem.id } }).catch(() => {});


  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
