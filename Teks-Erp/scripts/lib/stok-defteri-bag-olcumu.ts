// =============================================================================
// "SEVKİYAT (ve kardeşleri) STOK DEFTERİNE BAĞLI MI?" — MEKANİK ÖLÇÜM
// =============================================================================
// Açılış fotoğrafının SIKI modu bu soruya "evet" alamadan `--apply`yi reddeder.
// Cevap bir bayrak ya da beyan DEĞİL, iki bağımsız araçla ölçülür:
//
//   K — KOD YOLU (bu ağaç): konum defteri kapısı `writeWarehouseMovement(s)`
//       from/to STATÜ yazmaz; helper dışında onu çağıran her yol (sevk · storno ·
//       iade · transfer) statüsüz satır üretir. AST ile sayılır, yorum/import
//       sayılmaz. Pozitif kontrol: helper dosyasında iki tanım da BULUNMALI —
//       bulunamazsa araç bozuk/eski demektir ve sonuç "0 çağıran" sayılmaz.
//
//   V — VERİ (hedef DB): eski kapıdan yazılmış (iki ucu statüsüz) en yeni satırın
//       tarihi ile stok defteri kapısından yazılmış (statülü) en yeni satırın
//       tarihi karşılaştırılır. Statüsüz satır statülüden YENİYSE, sahadaki
//       backend'in yeni kapıyı kullandığına dair kanıt yoktur (bu ağaç taşınmış
//       olsa bile sahada eski sürüm koşuyor olabilir). Aile bazında son satır
//       durumu BİLGİ olarak da döner.
//
// Sıkı mod geçer ⇔ K = 0 ∧ V "kanıt var / eski satır yok".
//
// ⚠️ K İKİ KÜMENİN TOPLAMIDIR ve sayı KAPSADIĞI KÜMEYİ de basar. Tek kümeyle
// ölçmek körlüktü: eski kapıyı çağırmayan ama hiçbir kapıya da bağlı olmayan bir
// yol (kartela sevki) sayıya HİÇ girmiyordu, yani "6" bir ölçüm değil eksik bir
// paydaydı. Bugünkü kümeler:
//   (i)  eski kapı çağıranları — AST ile bulunur, kendini ilan eder.
//   (ii) BİLİNEN KAPISIZ YOLLAR — kendini ilan ETMEZ, bu yüzden elle adlandırılır
//        (`BILINEN_KAPISIZ_YOLLAR`) ve gövdesinde yeni kapı çağrısı ARANIR.
// (ii)'nin bedeli: liste elle tutulur. Bedeli ödeyen sed ise POZİTİF KONTROL —
// listedeki fonksiyon dosyada bulunamazsa araç "bozuk" der, "0 kapısız yol" DEMEZ
// (çift terimli tripwire'da tek terimin yeniden adlandırılmasıyla bekçinin yeşil
// kalıp korumayı bırakması sınıfı).
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as ts from "typescript";
import type { PrismaClient, RollStatus } from "@prisma/client";
import { Prisma, WarehouseEventType } from "@prisma/client";

/** Konum defteri kapısı — statüsüz satır yazan iki fonksiyon. */
export const ESKI_KAPI_FONKSIYONLARI: readonly string[] = ["writeWarehouseMovement", "writeWarehouseMovements"];
export const ESKI_KAPI_HELPER = "src/services/helpers/warehouse-ledger.helper.ts";

/**
 * Stok defteri kapısı — bir yolun "bağlı" sayılması için gövdesinde bunlardan
 * BİRİ bulunmalı. Ters yazıcılar da listededir: yalnız geri alma yapan bir yol
 * (kartela sevk iptali) ileri satır yazmaz ama deftere bağlıdır.
 */
/**
 * Yeni kapı ÜÇ dosyada yaşar: yazma kapısı + ters kayıt kapısı + üretime çıkış
 * kapısı (`postProductionIssuesTx`, 1c 2026-09-13 — elle taşıma · elle top ·
 * redye · attachRolls tek yazıcıdan geçer). Üyeler listeden DÜŞÜRÜLMEZ: kapı
 * çağrısı kalkarsa yol yeniden "kapısız" sayılır ve K artar.
 */
export const YENI_KAPI_HELPERLARI: readonly string[] = [
  ESKI_KAPI_HELPER,
  "src/services/helpers/warehouse-ledger-reverse.helper.ts",
  "src/services/helpers/production-issue-ledger.helper.ts",
];

export const YENI_KAPI_FONKSIYONLARI: readonly string[] = [
  "postStockMove",
  "postStockMoves",
  "reverseStockMove",
  "reverseLegacyStockMove",
  "reverseLatestScopedStockMove",
  "reverseAllRollStockMoves",
  "postProductionIssuesTx",
];

/**
 * Topu stok kümesine sokan/çıkaran ama HİÇBİR defter kapısını çağırmayan yol.
 * Kendini ilan etmediği için elle adlandırılır; `fonksiyon` dosyada bulunamazsa
 * ölçüm GEÇERSİZdir (araç bozuk), "kapısız yol yok" değil.
 */
export interface KapisizYol {
  dosya: string;
  /** Metot ya da fonksiyon adı — gövdesinde yeni kapı çağrısı aranır. */
  fonksiyon: string;
  /** Sayacın bastığı kümede görünen ad. */
  ad: string;
}

/**
 * ⚠️ Bu yollar hiçbir kayıt bırakmıyor — ne eski ne yeni kapıyla. Bu yüzden AST
 * "eski kapı çağıranı" taramasına GÖRÜNMEZLER ve K'yı eksik gösterirler.
 * `receive`/`cancelReceipt` burada YOK: kartela tüketimi (`AT_KARTELA →
 * KARTELA_CONSUMED`) stok dışından stok dışınadır ve satır yazmaz (tasarım §64).
 *
 * 🔴 BU LİSTE ELLE TUTULUYOR VE EKSİK OLABİLİR — İKİ kez eksik çıktı:
 * **fason sevki** (2026-09-13) aylarca listede yoktu, yani K onu HİÇ saymadı; aynı
 * gece **beş yol** daha (1c ölçtü) — ve reçete ① onları buluyordu, uygulanmamıştı.
 *
 * ⚠️ YENİ ÜYE NASIL ARANIR (eksik üyeyi bulan ölçüm, tekrarlanabilir olsun diye):
 *   ① KOD: servis dosyasında defter yazan çağrı sayısını say —
 *      `grep -c "postStockMove\|writeWarehouseMovement" <servis>`; stok kümesinden
 *      ÇIKARAN bir yol varken sayı 0 ise o yol kapısızdır.
 *      (Fasonda tüm serviste TEK çağrı vardı: kabul. Sevk hiç yazmıyordu.)
 *   ② VERİ: stok kümesi DIŞI statüdeki topun defterde ÇIKIŞ ucu var mı —
 *      `AT_SUBCONTRACTOR` 187 topun **187**'sinde yoktu (fabrika kopyası, 2026-09-13).
 *
 * ⚠️ ②'NİN TEK BAŞINA KULLANILMASI YANILTIR — kendi hatam (2026-09-13): "187/187
 * çıkışsız" sayısını *"187 top defterden kaçtı"* diye okudum. Ayrıştırınca çıktı:
 *      stok kümesine GİRİŞ ucu olan            :   0
 *      girişi olup çıkışı olmayan (ASİMETRİ)   :   0
 *      hiç defter satırı olmayan               : 105
 * ⇒ O topların girişi de YOK; eksik çıkış bir ASİMETRİ değil, defter-öncesi
 * MİRAS. Kod boşluğu (fason sevki satır yazmıyor) yine gerçekti, ama veri sayısı
 * onun KANITI değildi. ⇒ Doğru ölçüt **asimetri**dir: `girişi var ∧ çıkışı yok`.
 * Çıplak "çıkışı yok" sayısı epoch öncesini de toplar ve ihlali büyütür.
 * ⇒ ②, ①'den güçlüdür (kod yolundan bağımsız) ama ASİMETRİ olarak kurulmalıdır.
 * `test_consistency`in "stok dışı + çıkış satırı yok" bölümü bu ölçünün kalıcı hâli.
 */
export const BILINEN_KAPISIZ_YOLLAR: readonly KapisizYol[] = [
  {
    dosya: "src/services/subcontractor.service.ts",
    fonksiyon: "dispatch",
    ad: "fason sevki (WAREHOUSE → AT_SUBCONTRACTOR)",
  },
  {
    dosya: "src/services/kartela.service.ts",
    fonksiyon: "dispatch",
    ad: "kartela sevki (WAREHOUSE → AT_KARTELA)",
  },
  {
    dosya: "src/services/kartela.service.ts",
    fonksiyon: "cancelDispatch",
    ad: "kartela sevk iptali (AT_KARTELA → WAREHOUSE)",
  },
  // ── 2026-09-13 gece (1c ölçtü, 6e ekledi): liste İKİNCİ kez eksik çıktı — beş yol.
  //    Reçete ① üçünü buluyor (üç serviste postStockMove/writeWarehouseMovement = 0,
  //    hepsi stok kümesinden ÇIKARIYOR ya da stok kümesine SOKUYOR). K=0 iddiası
  //    (2026-09-13 öğle) bu yüzden KÖRDÜ. Çıkış üçlüsü aynı gece 1c'nin tek yazıcısına
  //    bağlandı (`postProductionIssuesTx`, listede KALIR — `bagli: true` sayılır);
  //    giriş ikilisi 01'de (doff sonrası) ⇒ K = 2, cırcır tabanı (`test_… §4e`).
  {
    dosya: "src/services/workorder-manual-move.service.ts",
    fonksiyon: "manualMove",
    ad: "elle taşıma (WAREHOUSE/STOCK → adım, IN_PRODUCTION) — ÇIKIŞ",
  },
  {
    dosya: "src/services/tambur-manual.service.ts",
    fonksiyon: "createManualRoll",
    ad: "elle top 'buraya al' (STOCK/WAREHOUSE → adım) — ÇIKIŞ",
  },
  {
    dosya: "src/services/workorder-split.service.ts",
    fonksiyon: "newColorRedye",
    ad: "redye (STOCK/WAREHOUSE → yeni iş emri adımı) — ÇIKIŞ",
  },
  {
    dosya: "src/services/inventory.service.ts",
    fonksiyon: "rescueStuckRoll",
    ad: "takılı top kurtarma (IN_PRODUCTION → WAREHOUSE) — GİRİŞ",
  },
  {
    dosya: "src/services/tambur.service.ts",
    fonksiyon: "cutOpenFabric",
    ad: "üretim kesimi çocuğu (WAREHOUSE doğar, satır yok) — GİRİŞ",
  },
];
/** Eski kapının bugün yazdığı olay aileleri (V'nin aile bazlı bilgi satırı). */
export const ESKI_KAPI_AILELERI: readonly WarehouseEventType[] = [
  WarehouseEventType.SHIPMENT,
  WarehouseEventType.SHIPMENT_REVERSAL,
  WarehouseEventType.RETURN,
  WarehouseEventType.TRANSFER,
  WarehouseEventType.TRANSFER_REVERSAL,
];

export interface KodCagirani {
  dosya: string;
  satir: number;
  fonksiyon: string;
}

export interface KodOlcumu {
  /** Helper dosyasında iki tanım da bulundu — araç bir şeye BAKIYOR. */
  aracSaglam: boolean;
  aracNotu: string | null;
  taranan: number;
  cagiranlar: KodCagirani[];
  /** Ağacın kimliği — sahadaki backend'in ağacıyla karşılaştırmak için (best-effort). */
  agac: string;
}

function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  const yigin = [dizin];
  while (yigin.length) {
    const d = yigin.pop() as string;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        yigin.push(p);
      } else if (e.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
    }
  }
  return out.sort();
}

/** Çağrılan ifadenin son tanımlayıcısı: `foo(` → foo, `x.foo(` → foo. */
function callee(node: ts.CallExpression): string | null {
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function agacKimligi(kok: string): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: kok, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const kirli = execSync("git status --porcelain -- src", { cwd: kok, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
    return `${sha}${kirli ? " (src'de commit edilmemiş değişiklik var)" : ""}`;
  } catch {
    return "(git okunamadı)";
  }
}

/**
 * K — bu ağaçta eski kapıyı çağıran yollar. `kok` backend kökü (package.json'un dizini).
 * Helper'ın kendisi muaf (tanımlar orada); testler ve `.d.ts` taranmaz.
 */
export function eskiKapiCagiranlari(kok: string): KodOlcumu {
  const helperYolu = path.join(kok, ESKI_KAPI_HELPER);
  const agac = agacKimligi(kok);
  if (!fs.existsSync(helperYolu)) {
    return { aracSaglam: false, aracNotu: `helper bulunamadı: ${ESKI_KAPI_HELPER}`, taranan: 0, cagiranlar: [], agac };
  }
  const helperSf = ts.createSourceFile(helperYolu, fs.readFileSync(helperYolu, "utf8"), ts.ScriptTarget.Latest, true);
  const tanimlar = new Set<string>();
  helperSf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name) tanimlar.add(n.name.text);
  });
  const eksik = ESKI_KAPI_FONKSIYONLARI.filter((f) => !tanimlar.has(f));
  if (eksik.length > 0) {
    return {
      aracSaglam: false,
      aracNotu: `helper'da tanım yok: ${eksik.join(", ")} — araç eski ya da kapı yeniden adlandırıldı; "0 çağıran" sonucu GEÇERSİZ`,
      taranan: 0,
      cagiranlar: [],
      agac,
    };
  }
  const cagiranlar: KodCagirani[] = [];
  const dosyalar = tsDosyalari(path.join(kok, "src")).filter((d) => path.relative(kok, d) !== ESKI_KAPI_HELPER);
  for (const dosya of dosyalar) {
    const sf = ts.createSourceFile(dosya, fs.readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const ad = callee(n);
        if (ad && ESKI_KAPI_FONKSIYONLARI.includes(ad)) {
          cagiranlar.push({ dosya: path.relative(kok, dosya), satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, fonksiyon: ad });
        }
      }
      n.forEachChild(gez);
    };
    sf.forEachChild(gez);
  }
  return { aracSaglam: true, aracNotu: null, taranan: dosyalar.length, cagiranlar, agac };
}

export interface KapisizYolBulgusu extends KapisizYol {
  /** Gövdede yeni kapı çağrısı bulundu mu — bulunduysa yol BAĞLI, sayılmaz. */
  bagli: boolean;
  /** Bağlıysa hangi kapıyla (gerekçe satırına basılır). */
  bulunanKapi: string | null;
}

export interface KapisizYolOlcumu {
  /** Listedeki her fonksiyon dosyasında BULUNDU — araç bir şeye bakıyor. */
  aracSaglam: boolean;
  aracNotu: string | null;
  yollar: KapisizYolBulgusu[];
}

/** Adı verilen metot/fonksiyon bildirimini bul (sınıf metodu da dâhil). */
function govdeBul(sf: ts.SourceFile, ad: string): ts.Node | null {
  let bulunan: ts.Node | null = null;
  const gez = (n: ts.Node): void => {
    if (bulunan) return;
    const isimli =
      (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ad) ||
      (ts.isFunctionDeclaration(n) && n.name?.text === ad) ||
      (ts.isPropertyDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === ad &&
        n.initializer !== undefined &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)));
    if (isimli) {
      bulunan = n;
      return;
    }
    n.forEachChild(gez);
  };
  sf.forEachChild(gez);
  return bulunan;
}

/**
 * K'nın İKİNCİ kümesi — kendini ilan etmeyen kapısız yollar. Her yolun gövdesinde
 * yeni kapı çağrısı aranır; yoksa yol SAYILIR.
 *
 * ⚠️ POZİTİF KONTROL: listedeki fonksiyon dosyada bulunamazsa sonuç "0 kapısız
 * yol" DEĞİL "araç bozuk"tur. Fonksiyon yeniden adlandırıldığında sessizce yeşile
 * dönen bir bekçi, korumadığı şeyi koruduğunu söyler.
 */
export function kapisizYolOlcumu(kok: string): KapisizYolOlcumu {
  const yollar: KapisizYolBulgusu[] = [];
  const sorunlar: string[] = [];
  // Pozitif kontrolün ilk yarısı: "bağlı" kararını veren kapı adları GERÇEK mi.
  // Hepsi tanımlı olmalı, yoksa her yol sessizce "kapısız" görünür. Yazma ve ters
  // kayıt kapıları AYRI dosyalarda yaşıyor; ikisi birden taranır.
  const tanimli = new Set<string>();
  let okunan = 0;
  for (const rel of YENI_KAPI_HELPERLARI) {
    const p = path.join(kok, rel);
    if (!fs.existsSync(p)) {
      sorunlar.push(`helper bulunamadı: ${rel}`);
      continue;
    }
    okunan++;
    const sf = ts.createSourceFile(p, fs.readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true);
    sf.forEachChild((n) => {
      if (ts.isFunctionDeclaration(n) && n.name) tanimli.add(n.name.text);
    });
  }
  if (okunan > 0) {
    const eksik = YENI_KAPI_FONKSIYONLARI.filter((f) => !tanimli.has(f));
    if (eksik.length > 0) {
      sorunlar.push(`yeni kapı tanımı yok: ${eksik.join(", ")} — "kapısız" kararı GEÇERSİZ`);
    }
  }
  for (const yol of BILINEN_KAPISIZ_YOLLAR) {
    const tamYol = path.join(kok, yol.dosya);
    if (!fs.existsSync(tamYol)) {
      sorunlar.push(`${yol.dosya} bulunamadı (yol: ${yol.ad})`);
      continue;
    }
    const sf = ts.createSourceFile(tamYol, fs.readFileSync(tamYol, "utf8"), ts.ScriptTarget.Latest, true);
    const govde = govdeBul(sf, yol.fonksiyon);
    if (!govde) {
      sorunlar.push(`${yol.dosya} içinde \`${yol.fonksiyon}\` yok — yeniden adlandırılmış ya da taşınmış (yol: ${yol.ad})`);
      continue;
    }
    let bulunanKapi: string | null = null;
    const gez = (n: ts.Node): void => {
      if (bulunanKapi) return;
      if (ts.isCallExpression(n)) {
        const ad = callee(n);
        if (ad && YENI_KAPI_FONKSIYONLARI.includes(ad)) bulunanKapi = ad;
      }
      n.forEachChild(gez);
    };
    govde.forEachChild(gez);
    yollar.push({ ...yol, bagli: bulunanKapi !== null, bulunanKapi });
  }
  if (sorunlar.length > 0) {
    return { aracSaglam: false, aracNotu: sorunlar.join(" · "), yollar };
  }
  return { aracSaglam: true, aracNotu: null, yollar };
}

export interface AileSonSatiri {
  aile: WarehouseEventType;
  /** Ailede hiç satır yoksa null. */
  sonCreatedAt: Date | null;
  sonStatulu: boolean | null;
  statusuzToplam: number;
}

export interface VeriOlcumu {
  /** Pozitif kontrol: defterde hiç satır yoksa V bir şey ölçemez. */
  toplamSatir: number;
  enYeniStatusuz: Date | null;
  enYeniStatulu: Date | null;
  /** Statüsüz satır yok YA DA en yeni statülü satır en yeni statüsüzden yeni. */
  kanitVar: boolean;
  aileler: AileSonSatiri[];
}

type OkuyanClient = Pick<PrismaClient, "warehouseMovement">;

/** V — hedef DB'de eski kapı izi. Yalnız OKUR. */
export async function eskiKapiVeriIzi(prisma: OkuyanClient): Promise<VeriOlcumu> {
  const statusuzWhere = { fromStatus: null, toStatus: null } as const;
  const statuluWhere: Prisma.WarehouseMovementWhereInput = { OR: [{ fromStatus: { not: null } }, { toStatus: { not: null } }] };
  const sec = { createdAt: true, fromStatus: true, toStatus: true } as const;
  const toplamSatir = await prisma.warehouseMovement.count();
  const sonStatusuz = await prisma.warehouseMovement.findFirst({ where: statusuzWhere, orderBy: { createdAt: "desc" }, select: sec });
  const sonStatulu = await prisma.warehouseMovement.findFirst({ where: statuluWhere, orderBy: { createdAt: "desc" }, select: sec });
  const aileler: AileSonSatiri[] = [];
  for (const aile of ESKI_KAPI_AILELERI) {
    const son = await prisma.warehouseMovement.findFirst({ where: { eventType: aile }, orderBy: { createdAt: "desc" }, select: sec });
    const statusuzToplam = await prisma.warehouseMovement.count({ where: { eventType: aile, ...statusuzWhere } });
    aileler.push({
      aile,
      sonCreatedAt: son?.createdAt ?? null,
      sonStatulu: son ? statulu(son.fromStatus, son.toStatus) : null,
      statusuzToplam,
    });
  }
  const enYeniStatusuz = sonStatusuz?.createdAt ?? null;
  const enYeniStatulu = sonStatulu?.createdAt ?? null;
  const kanitVar = enYeniStatusuz === null || (enYeniStatulu !== null && enYeniStatulu.getTime() > enYeniStatusuz.getTime());
  return { toplamSatir, enYeniStatusuz, enYeniStatulu, kanitVar, aileler };
}

function statulu(from: RollStatus | null, to: RollStatus | null): boolean {
  return from !== null || to !== null;
}

export interface BagKarari {
  bagli: boolean;
  /** Türkçe, satır satır — kuru koşum bunları basar. */
  gerekceler: string[];
}

/**
 * K ∧ V → sıkı modun kapısı. Sıralı gerekçe üretir; karar fail-closed.
 *
 * ⚠️ K iki kümenin TOPLAMIDIR ve gerekçe her iki kümeyi AYRI basar: "K = 8" tek
 * başına hangi yolların sayıldığını söylemez, ve söylemeyen bir sayı bir sonraki
 * okuyucuda eksik paydaya döner.
 */
/**
 * K'NIN TEK MEŞRU OKUMA YOLU — bozuk araçta `null` döner, yani TOPLANAMAZ.
 *
 * ⚠️ NEDEN TİPTE (ölçüldü 2026-09-13, acı deneyim): araç yanlış kökle çağrılınca
 * `aracSaglam: false` döndü — yani DOĞRU davrandı, bozuk olduğunu söyledi. Ama
 * okuyan `aracSaglam`ı okumadan `kod.cagiranlar.length + sayilanKapisiz` topladı
 * ve **`K = 0 + 0 = 0`** okudu: *fail-closed bir ARIZA, yeşil bir SONUÇ gibi
 * göründü* ve runbook'a "SIKI mod serbest" yazılmasına bir adım kaldı.
 *
 * ⇒ Ders: **fail-closed'ı okuyana bırakma, TİPE koy.** `.cagiranlar.length` K
 * DEĞİLDİR ve tek başına K yerine kullanılamaz; `null` dönüşü çağıranı
 * `?? 0`'a değil DURMAYA zorlar (yönetici kararı: 1e, 2026-09-13).
 */
export function kToplam(kod: KodOlcumu, kapisiz: KapisizYolOlcumu): number | null {
  if (!kod.aracSaglam || !kapisiz.aracSaglam) return null;
  return kod.cagiranlar.length + kapisiz.yollar.filter((y) => !y.bagli).length;
}

export function sevkBagiKarari(kod: KodOlcumu, kapisiz: KapisizYolOlcumu, veri: VeriOlcumu): BagKarari {
  const g: string[] = [];
  let bagli = true;
  const sayilanKapisiz = kapisiz.yollar.filter((y) => !y.bagli);
  // ⚠️ TEK KAYNAK: toplama `kToplam`dadır ve bozuk araçta `null` döner. Burada
  // ikinci bir toplama yazılsaydı ikisi ayrışabilirdi; `?? -1` yalnız aşağıdaki
  // fail-closed dalları ÇALIŞTIKTAN SONRA okunur (o dallarda `kTotal` basılmaz).
  const kTotal = kToplam(kod, kapisiz) ?? -1;

  if (!kod.aracSaglam) {
    bagli = false;
    g.push(`K ARAÇ BOZUK (eski kapı ayağı): ${kod.aracNotu} — ölçüm yapılamadı, fail-closed.`);
  } else if (!kapisiz.aracSaglam) {
    bagli = false;
    g.push(`K ARAÇ BOZUK (kapısız yol ayağı): ${kapisiz.aracNotu} — ölçüm yapılamadı, fail-closed.`);
  } else {
    g.push(
      `K = ${kTotal} (ağaç ${kod.agac}) — İKİ küme: eski kapı çağıranı ${kod.cagiranlar.length} + kapısız yol ${sayilanKapisiz.length}/${kapisiz.yollar.length}`,
    );
    if (kTotal > 0) bagli = false;
    if (kod.cagiranlar.length > 0) {
      g.push(`  (i) eski kapı çağıranları (${kod.taranan} dosya tarandı):`);
      for (const c of kod.cagiranlar) g.push(`      ${c.dosya}:${c.satir} → ${c.fonksiyon}()`);
    } else {
      g.push(`  (i) eski kapı çağıranı 0 (${kod.taranan} dosya tarandı) ✓`);
    }
    g.push(`  (ii) bilinen kapısız yollar (${kapisiz.yollar.length} yol ölçüldü — kapsanan küme):`);
    for (const y of kapisiz.yollar) {
      g.push(
        y.bagli
          ? `      ✓ ${y.ad} — ${y.dosya}:${y.fonksiyon} → ${y.bulunanKapi}()`
          : `      ✗ ${y.ad} — ${y.dosya}:${y.fonksiyon} hiçbir defter kapısını çağırmıyor`,
      );
    }
  }
  if (veri.toplamSatir === 0) {
    g.push("V VERİ: defterde hiç satır yok — veri ayağı ölçülemez (bilgi).");
  } else if (veri.kanitVar) {
    g.push(
      `V VERİ: ${veri.enYeniStatusuz ? `en yeni statüsüz satır ${veri.enYeniStatusuz.toISOString()}, ondan sonra stok defteri kapısından yazılmış satır var (${veri.enYeniStatulu?.toISOString()})` : "statüsüz satır yok"} ✓`,
    );
  } else {
    bagli = false;
    g.push(
      `V VERİ: en yeni statüsüz (eski kapı) satır ${veri.enYeniStatusuz?.toISOString()}; ondan sonra stok defteri kapısından yazılmış satır YOK` +
        `${veri.enYeniStatulu ? ` (en yeni statülü ${veri.enYeniStatulu.toISOString()})` : " (statülü satır hiç yok)"} — sahadaki backend'in yeni kapıyı kullandığına kanıt yok.`,
    );
  }
  for (const a of veri.aileler) {
    const durum = a.sonCreatedAt === null ? "satır yok" : `son satır ${a.sonCreatedAt.toISOString().slice(0, 10)} ${a.sonStatulu ? "STATÜLÜ" : "statüsüz"}`;
    g.push(`    ${a.aile.padEnd(18)} ${durum} · statüsüz toplam ${a.statusuzToplam}`);
  }
  return { bagli, gerekceler: g };
}
