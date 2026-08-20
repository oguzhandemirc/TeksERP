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
  async function renderFor(where: Prisma.RollWhereInput): Promise<string | null> {
    const roll = await prisma.roll.findFirst({
      where: { ...where, barcode: { not: null } },
      select: { id: true },
    });
    if (!roll) return null;
    const out = await svc.getRollLabelNative(roll.id, LabelKind.ROLL_FINISHED, {
      machineId: machine?.id ?? null,
    });
    return out.data.content;
  }

  const fireLabel = await renderFor({ qualityGradeRef: { skipLabel: true } });
  const goodLabel = await renderFor({ qualityGradeRef: { skipLabel: false } });

  if (fireLabel == null) {
    check("§5 fire etiketi render edilebildi", false, "skipLabel'lı barkodlu top yok — atlandı");
  } else {
    check("§5 fire etiketinde uyarı metni VAR", fireLabel.includes("SATILAMAZ"), fireLabel.slice(0, 200));
    check(
      "§5b fire etiketinde 'FIRE' TEK KEZ geçiyor (mükerrer kalite elemanı bastırıldı)",
      (fireLabel.match(/"FIRE"/g) ?? []).length === 1,
      `bulunan: ${(fireLabel.match(/"FIRE"/g) ?? []).length}`,
    );
  }
  if (goodLabel == null) {
    check("§5c normal etiket render edilebildi", false, "skipLabel'sız barkodlu top yok — atlandı");
  } else {
    // EN ÖNEMLİ KONTROL: koşullu eleman sızarsa HER etikete "SATILAMAZ" basılır.
    check("§5c normal etikete fire işareti SIZMIYOR", !goodLabel.includes("SATILAMAZ"));
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
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
