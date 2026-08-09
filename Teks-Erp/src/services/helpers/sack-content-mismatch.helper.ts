// =============================================================================
// ÇUVAL İÇERİĞİ UYUŞMAZLIK UYARILARI (2026-08-09)
// =============================================================================
// Saha isteği: *"çuvalın müşterisi ile içindeki topların müşterisi aynı değilse
// uyar ama ENGEL OLMA."*
//
// ⚠️ DÜZ MÜŞTERİ KARŞILAŞTIRMASI YAPILMAZ — ve bu, işin çekirdeğidir.
// Kullanıcının kendi ifadesiyle: *"X firması için üretilmiş bir top Y firmasına
// gönderilebilir; müşteriye özel etiketi olmadığı sürece etiket bile değişmeden
// gönderilir."* Yani "basıldığı müşteri ≠ gideceği müşteri" ÇOĞU ZAMAN MEŞRUDUR.
// O kuralla uyarsaydık neredeyse her çuvalda yanardı ve operatör uyarıya KÖR
// olurdu — `Sack.labelDirty` şema notundaki yazılı kuralın aynısı:
//   *"tetikleyici 'müşteri değişti' DEĞİL — eski ve yeni müşteri AYNI şablona
//    çözülüyorsa etiket geçerli kalır ve işaretlenmez; gereksiz 'yeniden bas'
//    uyarısı operatörü körleştirir."*
//
// DOĞRU SORU: **"bu topun etiketi, gideceği müşteri için BUGÜN basılsaydı
// İÇERİĞİ farklı çıkar mıydı?"** Üç şey bunu değiştirir ve üçü de etiket
// basımında zaten çözülüyor:
//   ① `CustomerTemplateRoute` — müşteriye özel etiket ŞABLONU
//   ② `CustomerItemAlias` / `CustomerColorAlias` — müşteriye özel kumaş/renk ADI
//   ③ etikete basılan MÜŞTERİ ADININ kendisi
//
// Kural KENDİLİĞİNDEN SESSİZDİR: etiket müşteriye özel hiçbir şey basmıyorsa
// (ikisi de rotasız + alias'sız) fark yok, uyarı yok.
//
// ⚠️ HİÇBİRİ ENGEL DEĞİLDİR. Sevk yolu hiçbir koşulda kapanmaz; müşterisiz
// çuval meşrudur (`Sack.customerId` opsiyonel). Bu dosya YALNIZ okur.
// =============================================================================

import prisma from "../../lib/prisma";
import { LabelKind, RollStatus } from "@prisma/client";
import { collectBoundKeys } from "./label-context-fit";

export type MismatchKind =
  /** 🔴 Etiket hedef müşteri için FARKLI çıkardı — aksiyon: etiketi yenile. */
  | "LABEL_DIFFERS"
  /** ⚪ Başka müşteri için üretilmişti — BİLGİ, aksiyon gerekmez. */
  | "OTHER_CUSTOMER"
  /** 🔴 2. kalite (A1) top müşteri çuvalında — çoğu zaman kaza. */
  | "SECOND_QUALITY";

export interface MismatchSignal {
  kind: MismatchKind;
  /** `warning` = aksiyon gerekir · `info` = yalnız bilgi. */
  severity: "warning" | "info";
  rollId: string;
  barcode: string | null;
  /** Operatöre gösterilecek tek cümle. */
  message: string;
}

interface RollRow {
  id: string;
  barcode: string | null;
  status: RollStatus;
  qualityGrade: string | null;
  itemId: string;
  colorId: string | null;
  labelCustomerId: string | null;
  lastLabelSnapshot: unknown;
}

/** Etiketin MÜŞTERİYE BAĞLI parçaları — ikisi farklıysa içerik farklı çıkar. */
interface LabelIdentity {
  templateId: string | null;
  itemAlias: string | null;
  colorAlias: string | null;
  customerName: string | null;
}

/**
 * Etikette MÜŞTERİ ADI basılıyor mu — `customerName` farkının GÖRÜNÜR olup
 * olmadığını belirler.
 *
 * ⚠️ BU KOŞUL OLMADAN KURAL İŞE YARAMAZ. Müşteri adları tanım gereği her zaman
 * farklıdır; adı koşulsuz karşılaştırmak "farklı müşteriye giden HER topta"
 * kırmızı yakardı — yani tam da önlenmek istenen körleşme. (İlk yazımda böyleydi
 * ve bekçi `test_sack_mismatch` §1 bunu YAKALADI.)
 *
 * Kullanıcının ifadesi net: *"müşteriye özel etiketi olmadığı sürece etiket bile
 * DEĞİŞMEDEN gönderilir."* Yani standart etikette müşteri adı ya basılmıyor ya
 * da önemsenmiyor; kırmızı yalnız kâğıdın gerçekten yanlış çıkacağı durumda.
 *
 * `collectBoundKeys` koşullu (`showIf`) elemanları SAYMAZ — o zaten "şablon bu
 * bağlamın kimliğini basar mı" sorusunun cevabıdır ve burada da doğru olan odur.
 */
const CUSTOMER_BOUND_KEYS = ["customerName", "customerCode", "orderNumber"];

function sameIdentity(a: LabelIdentity, b: LabelIdentity, customerNameVisible: boolean): boolean {
  if (a.templateId !== b.templateId) return false;
  if (a.itemAlias !== b.itemAlias) return false;
  if (a.colorAlias !== b.colorAlias) return false;
  // Müşteri adı YALNIZ etikette basılıyorsa fark yaratır.
  if (customerNameVisible && a.customerName !== b.customerName) return false;
  return true;
}

/** Toplu çözülen sözlükler — çuval başına DEĞİL, çağrı başına bir kez yüklenir. */
interface MismatchLookups {
  /** ⚠️ Değer NULLABLE: `CustomerTemplateRoute.templateId` şemada opsiyonel. */
  routeBy: Map<string, string | null>;
  itemAliasBy: Map<string, string>;
  /** ⚠️ Değer NULLABLE: `CustomerColorAlias.alias` şemada opsiyonel. */
  colorAliasBy: Map<string, string | null>;
  nameBy: Map<string, string>;
  /** templateId → bu şablon müşteriye bağlı bir alan basıyor mu. */
  nameVisibleByTemplate: Map<string, boolean>;
}

/**
 * Karşılaştırma sözlüklerini TEK seferde yükler.
 *
 * ⚠️ Ayrı bir fonksiyon olmasının sebebi perf: `detectMismatchesForSacks` 200
 * çuvala kadar çağrılabiliyor (`checkSackMismatches` tavanı) ve yükleme çuval
 * döngüsünün İÇİNDE kalsaydı 200 × 5 = 1000 seri gidiş-dönüş olurdu — üstelik
 * biri etiket `elements` JSON'larını çeker (perf kuralı 13). Bugünkü sevkiyatlar
 * 1-2 çuval olduğu için sahada henüz acıtmıyor; tavan 200 olduğu sürece bu
 * "sonra bakarız" değil, kapatılmış bir açıktır.
 */
async function loadLookups(
  rolls: RollRow[],
  targetCustomerIds: Array<string | null>,
): Promise<MismatchLookups> {
  const customerIds = [
    ...new Set(
      [
        ...targetCustomerIds.filter((c): c is string => !!c),
        ...rolls.map((r) => r.labelCustomerId).filter((c): c is string => !!c),
      ],
    ),
  ];
  const itemIds = [...new Set(rolls.map((r) => r.itemId))];
  const colorIds = [...new Set(rolls.map((r) => r.colorId).filter((c): c is string => !!c))];

  const empty: MismatchLookups = {
    routeBy: new Map(),
    itemAliasBy: new Map(),
    colorAliasBy: new Map(),
    nameBy: new Map(),
    nameVisibleByTemplate: new Map(),
  };
  if (customerIds.length === 0) return empty;

  const [routes, itemAliases, colorAliases, customers] = await Promise.all([
    prisma.customerTemplateRoute.findMany({
      where: { customerId: { in: customerIds }, kind: LabelKind.ROLL_FINISHED },
      select: { customerId: true, templateId: true },
    }),
    itemIds.length
      ? prisma.customerItemAlias.findMany({
          where: { customerId: { in: customerIds }, itemId: { in: itemIds } },
          select: { customerId: true, itemId: true, alias: true },
        })
      : Promise.resolve([]),
    colorIds.length
      ? prisma.customerColorAlias.findMany({
          where: { customerId: { in: customerIds }, colorId: { in: colorIds } },
          select: { customerId: true, colorId: true, alias: true },
        })
      : Promise.resolve([]),
    prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true },
    }),
  ]);

  // ŞABLON BAZINDA görünürlük — global bir bayrak DEĞİL (aşağıdaki nota bak).
  const nameVisibleByTemplate = new Map<string, boolean>();
  const routeTemplateIds = [...new Set(routes.map((r) => r.templateId))];
  if (routeTemplateIds.length) {
    const tpls = await prisma.labelTemplate.findMany({
      // `name` yalnız `collectBoundKeys`in `TemplateLike` sözleşmesi için —
      // `as unknown as` ile kırpmak yerine alanı vermek, sözleşme değişirse
      // derlemede düşmemizi sağlar.
      where: { id: { in: routeTemplateIds.filter((t): t is string => t != null) } },
      select: { id: true, name: true, variants: { select: { elements: true } } },
    });
    for (const t of tpls) {
      const keys = collectBoundKeys(t as Parameters<typeof collectBoundKeys>[0]);
      nameVisibleByTemplate.set(t.id, CUSTOMER_BOUND_KEYS.some((k) => keys.has(k)));
    }
  }

  return {
    routeBy: new Map(routes.map((r) => [r.customerId, r.templateId])),
    itemAliasBy: new Map(itemAliases.map((a) => [`${a.customerId}|${a.itemId}`, a.alias])),
    colorAliasBy: new Map(colorAliases.map((a) => [`${a.customerId}|${a.colorId}`, a.alias])),
    nameBy: new Map(customers.map((c) => [c.id, c.name])),
    nameVisibleByTemplate,
  };
}

/**
 * Bir çuvalın içeriğini hedef müşteriye göre denetler.
 *
 * ⚠️ TEK KAYNAK: önizleme (Electron kartı) ve toplu özet (sevkiyat kurma) AYNI
 * fonksiyonu çağırır. Kopyalansaydı ekran "uygun" derken diğer yüzey "uyumsuz"
 * derdi ve operatör hangisine güveneceğini bilemezdi.
 *
 * `targetCustomerId` null (müşterisiz çuval) → **hiç sinyal üretilmez**: karşı-
 * laştırılacak bir hedef yoktur ve müşterisiz çuval meşrudur.
 */
export async function detectSackMismatches(
  rolls: RollRow[],
  targetCustomerId: string | null,
): Promise<MismatchSignal[]> {
  if (rolls.length === 0) return [];
  const lk = await loadLookups(rolls, [targetCustomerId]);
  return evaluateSack(rolls, targetCustomerId, lk);
}

/** Saf değerlendirme — sorgu YOK. Sözlükler `loadLookups` ile önden çözülür. */
function evaluateSack(
  rolls: RollRow[],
  targetCustomerId: string | null,
  lk: MismatchLookups,
): MismatchSignal[] {
  const out: MismatchSignal[] = [];
  if (rolls.length === 0) return out;

  // ── 2. KALİTE — hedef müşteriden BAĞIMSIZ (müşterisiz çuvalda da geçerli).
  // `A1_STOCK` statüsü VE `A1` kalite kodu ayrı ayrı bakılır: top çuvala
  // girerken statüsü değişebiliyor ama kalite kodu topun üstünde kalıcıdır.
  for (const r of rolls) {
    if (r.status === RollStatus.A1_STOCK || r.qualityGrade === "A1") {
      out.push({
        kind: "SECOND_QUALITY",
        severity: "warning",
        rollId: r.id,
        barcode: r.barcode,
        message: "2. kalite (A1) top — müşteri çuvalına kazara girmiş olabilir",
      });
    }
  }

  if (!targetCustomerId) return out;

  const identityFor = (customerId: string | null, r: RollRow): LabelIdentity => ({
    templateId: customerId ? (lk.routeBy.get(customerId) ?? null) : null,
    itemAlias: customerId ? (lk.itemAliasBy.get(`${customerId}|${r.itemId}`) ?? null) : null,
    colorAlias:
      customerId && r.colorId ? (lk.colorAliasBy.get(`${customerId}|${r.colorId}`) ?? null) : null,
    customerName: customerId ? (lk.nameBy.get(customerId) ?? null) : null,
  });

  /**
   * MÜŞTERİ ADI BU KARŞILAŞTIRMADA GÖRÜNÜR MÜ — **çift başına**, global DEĞİL.
   *
   * ⚠️ Eskiden tek bir global bayraktı ("kümedeki HERHANGİ bir rota şablonu adı
   * basıyor mu") ve bu YANLIŞ POZİTİF üretiyordu: karışık bir çuvalda müşteri
   * C'nin özel şablonu adı bastığı için bayrak açılıyor, sonra STANDART şablon
   * kullanan D → hedef karşılaştırmasında da "müşteri adı farklı" diye KIRMIZI
   * yanıyordu — oysa o iki tarafın etiketi birebir aynı çıkardı. Tam da bu
   * dosyanın engellemek için var olduğu körleşme.
   *
   * ⚠️ İki taraf da VARSAYILAN şablondaysa (templateId null) ad KARŞILAŞTIRILMAZ.
   * Bilinçli ve muhafazakâr sınır: varsayılan şablonun elemanlarına bakmıyoruz,
   * dolayısıyla adı basıp basmadığını bilmiyoruz. Bilmediğimiz yerde SUSMAK,
   * yanlış kırmızı yakmaktan iyidir (kullanıcının kuralı: *"müşteriye özel
   * etiketi olmadığı sürece etiket değişmeden gönderilir"*). Varsayılan şablon
   * gerçekten müşteri adı basmaya başlarsa burası genişletilmeli.
   */
  const nameVisibleFor = (a: LabelIdentity, b: LabelIdentity): boolean =>
    (a.templateId != null && lk.nameVisibleByTemplate.get(a.templateId) === true) ||
    (b.templateId != null && lk.nameVisibleByTemplate.get(b.templateId) === true);

  for (const r of rolls) {
    const printedFor = r.labelCustomerId;
    if (printedFor === targetCustomerId) continue; // aynı müşteri → fark yok

    const printedIdentity = identityFor(printedFor, r);
    const targetIdentity = identityFor(targetCustomerId, r);
    const customerNameVisible = nameVisibleFor(printedIdentity, targetIdentity);

    if (!sameIdentity(printedIdentity, targetIdentity, customerNameVisible)) {
      // 🔴 Etiket gerçekten farklı çıkardı — somut sebebi söyle.
      const reasons: string[] = [];
      if (printedIdentity.templateId !== targetIdentity.templateId) reasons.push("şablon");
      if (printedIdentity.itemAlias !== targetIdentity.itemAlias) reasons.push("kumaş adı");
      if (printedIdentity.colorAlias !== targetIdentity.colorAlias) reasons.push("renk adı");
      if (customerNameVisible && printedIdentity.customerName !== targetIdentity.customerName)
        reasons.push("müşteri adı");
      out.push({
        kind: "LABEL_DIFFERS",
        severity: "warning",
        rollId: r.id,
        barcode: r.barcode,
        message:
          `Etiket bu müşteri için farklı çıkardı (${reasons.join(" · ")}) — ` +
          (printedFor
            ? `${printedIdentity.customerName ?? "başka müşteri"} için basılmış`
            : "stok etiketiyle basılmış"),
      });
    } else if (printedFor) {
      // ⚪ İçerik AYNI ama başka müşteri için üretilmiş — yalnız bilgi.
      // Bu satır özellikle önemli: uyarı DEĞİL, çünkü etiket geçerli ve
      // gönderim meşru. Kırmızıya çevirmek operatörü körleştirirdi.
      out.push({
        kind: "OTHER_CUSTOMER",
        severity: "info",
        rollId: r.id,
        barcode: r.barcode,
        message: `${printedIdentity.customerName ?? "Başka müşteri"} için üretilmişti — etiket geçerli`,
      });
    }
  }

  return out;
}

/** Çuval id'lerinden toplu denetim — sevkiyat kurma özeti için. */
export async function detectMismatchesForSacks(
  sackIds: string[],
): Promise<Map<string, MismatchSignal[]>> {
  const result = new Map<string, MismatchSignal[]>();
  if (sackIds.length === 0) return result;

  const sacks = await prisma.sack.findMany({
    where: { id: { in: sackIds } },
    select: {
      id: true,
      customerId: true,
      rolls: {
        select: {
          id: true,
          barcode: true,
          status: true,
          qualityGrade: true,
          itemId: true,
          colorId: true,
          labelCustomerId: true,
          // ⚠️ `lastLabelSnapshot` BİLEREK ÇEKİLMEZ: karşılaştırma `labelCustomerId`
          // kolonundan yürüyor, snapshot JSON'una hiç bakılmıyor. Liste sorgusunda
          // snapshot çekmek perf kuralı 13'ün ihlalidir (200 çuval × N top).
        },
      },
    },
  });

  // ⚠️ SÖZLÜKLER TEK SEFERDE — çuval döngüsünün İÇİNDE yüklenirse 200 çuvalda
  // 1000 seri sorgu olur (uç tavanı `checkSackMismatches`'te 200).
  const allRolls = sacks.flatMap((s) => s.rolls as RollRow[]);
  const lk = await loadLookups(
    allRolls,
    sacks.map((s) => s.customerId),
  );

  for (const s of sacks) {
    const signals = evaluateSack(s.rolls as RollRow[], s.customerId, lk);
    if (signals.length) result.set(s.id, signals);
  }
  return result;
}
