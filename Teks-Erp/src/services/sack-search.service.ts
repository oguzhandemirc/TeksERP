// =============================================================================
// Sack Search Service — Saha #1+#23: Çuval/Top Arama
// =============================================================================
// Üç soruya tek ekrandan cevap:
//   1) "X üründen hangi çuvallarda ne kadar var?"  → searchSacks(itemId/colorId/width)
//      — çuval listesi + her çuvalda EŞLEŞEN top sayısı/metresi.
//   2) "Şu çuvalda ne var?"                        → searchSacks(sackCode) + getSackContents
//   3) "Bu top hangi çuvalda/sevkiyatta?"          → locateRoll(barcode)
// Kapsam (scope): POOL (havuzda, shipmentId null) | PLANNED (planlı sevkiyatta) |
// DISPATCHED (sevk edilmiş) | ALL. Varsayılan: POOL + PLANNED (sevk edilmemiş).
// Salt-okunur — yazma/audit yok. Liste cursor'lı (sacks yıllar içinde büyür),
// aggregate'ler yalnız sayfadaki çuvallar için (over-fetch yok).
// =============================================================================

import { Prisma, RollStatus, ShipmentStatus, QualityGradeRole } from "@prisma/client";
import { loadQualityRoles } from "./helpers/quality-role.helper";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import { decodeDynamicCursor, dynamicCursorWhere, buildNextDynamicCursor, encodeDynamicCursor } from "../utils/cursor";
import { normalizeScanCode } from "../utils/code-format";
import { matchesSeries, resolveSeriesFormat } from "./number-series.service";
import { applyDateRange, buildTextSearch, isCodeLikeTerm, readFilterList, readIdCondition } from "../utils/query-parser";
import { foldSearchTokens } from "../utils/search-fold";
import { foldCodeForCompare } from "../utils/code-format";
import { SACK_ABSENT_STATUSES } from "./helpers/sack-invariants.helper";
import { ACTIVE_TAG_WHERE, ACTIVE_TAG_SELECT, toTagBadges } from "./helpers/sack-tag.helper";
import { batchLoadAliasesMulti } from "./helpers/customer-name.helper";
import { readPackingLotSettings } from "./helpers/packing-group.helper";
import { readPackingGroupsEnabled } from "./system-setting.service";

const PLANNED_STATUSES: ShipmentStatus[] = [ShipmentStatus.PLANNED];

/**
 * "Çuvalda FİZİKSEL olarak duran top" yüklemi — TEK KAYNAK.
 *
 * ⚠️ Liste satırındaki `rollCount` bu süzgeçten geçer (hayalet top: kartelaya /
 * tambura / fasona gitmiş ama `sackId` hâlâ dolu). "Boş çuval" filtresi de AYNI
 * yüklemi kullanmak ZORUNDA: ayrı yazılsaydı yalnız hayalet taşıyan bir çuval
 * listede "0 top" basar ama "Boş" filtresinde ÇIKMAZDI — bu depoda adı konmuş
 * "türetilmiş alan / ayrışan yüzey" sınıfı (2026-08-21 taraması).
 */
const PRESENT_ROLL_WHERE = { status: { notIn: SACK_ABSENT_STATUSES } } satisfies Prisma.RollWhereInput;

/**
 * Tarih aralığı filtresinin kabul ettiği kolonlar (FilterBar `dateRange`).
 * ⚠️ ALLOWLIST: liste dışı bir ad gelirse `applyDateRange` aralığı SESSİZCE yok
 * sayar — bu yüzden controller `dateField` gelmediğinde `createdAt`e düşer
 * (2026-08-12 "dateField gönderilmezse aralık sessizce yok sayılır" dersi).
 */
export const SACK_DATE_FIELDS = ["createdAt", "weighedAt"] as const;

/** Çuval-seçimli salt-okunur dökümlerde (çeki listesi, içerik dökümü) üst sınır. */
const MAX_SELECTED_SACKS = 200;

/** Tek değer / dizi → temiz ID dizisi (filtre semantiği: aynı alan içinde VEYA). */
function toIdList(v: string | string[] | undefined): string[] {
  return (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);
}

/**
 * "Müşterisiz (genel stok) çuvallar" süzgeç değeri — `filter[customerId]=none`.
 *
 * ⚠️ SENTİNEL SAYI DEĞİL, KAÇIŞ VALFİ: `Sack.customerId` OPSİYONELDİR (çuval bir
 * depo nesnesidir) ve canlı ölçümde depodaki çuvalların **%44'ü** (9 çuvalın 4'ü,
 * tekserp_demo 2026-09-04) müşterisizdi. Müşteri süzgeci yalnız UUID kabul ettiği
 * sürece bu küme hiçbir yüzeyden SÜZÜLEMİYORDU — "cariye göre" bir giriş kapısı
 * eklerken bu kümeyi adlandırmadan bırakmak, en büyük kovayı sessizce yutmak olurdu
 * (bu depoda tekrar eden arıza sınıfı: "sessizce düşen satır").
 *
 * ⚠️ SENTİNEL `in:` DİZİSİNE GİREMEZ: kolon `@db.Uuid` — düz metin Prisma'da
 * P2007 üretir (kök CLAUDE.md, 2026-08-06 "CSV de bir string'dir" notu). Bu yüzden
 * değer `splitCustomerFilter` ile UUID listesinden AYRIŞTIRILIR ve ayrı bir
 * `{ customerId: null }` OR dalı olarak eklenir.
 */
export const CUSTOMERLESS_FILTER_VALUE = "none";

/**
 * Müşteri süzgeci değerlerini ikiye ayırır: gerçek ID'ler + "müşterisiz" bayrağı.
 * Aynı alan içinde VEYA semantiği korunur (`none,<uuid>` → müşterisiz VEYA o cari).
 */
function splitCustomerFilter(v: string | string[] | undefined): { ids: string[]; customerless: boolean } {
  // ⚠️ VİRGÜLE DE BÖLER: `toIdList` bölmez (CSV'yi controller `filtIds` ayırır),
  // ama servisi doğrudan çağıran her yol (script, bekçi, dahili çağrı) ham CSV
  // gönderebilir ve o zaman "none,<uuid>" TEK değer olarak `in:`e girip P2007
  // verir — ölçüldü (2026-09-04, bekçinin ilk koşumu). Kök CLAUDE.md: "CSV de
  // bir string'dir".
  const raw = toIdList(v).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
  const customerless = raw.some((x) => x.toLowerCase() === CUSTOMERLESS_FILTER_VALUE);
  return { ids: raw.filter((x) => x.toLowerCase() !== CUSTOMERLESS_FILTER_VALUE), customerless };
}

/**
 * "İzi olmayan çuvallar" süzgeç değeri — `filter[tagId]=none`.
 *
 * ⚠️ `CUSTOMERLESS_FILTER_VALUE` ile AYNI SINIF ve aynı tuzak: sentinel `in:`
 * dizisine GİREMEZ (`tagId` `@db.Uuid` — düz metin P2007 üretir). Ayrı bir OR
 * dalı olarak eklenir. Panelde `sentinelOption` ile çizilir.
 */
export const UNTAGGED_FILTER_VALUE = "none";

/**
 * Etiket süzgeci değerlerini ikiye ayırır: gerçek ID'ler + "izsiz" bayrağı.
 * Aynı alan içinde VEYA korunur (`none,<uuid>` → izsiz VEYA o izi taşıyanlar).
 *
 * ⚠️ Değerler `readFilterList`ten geçer — CSV DE BİR STRING'DİR (2026-08-06
 * notu): servisi doğrudan çağıran her yol (script, bekçi, dahili çağrı) ham CSV
 * gönderebilir ve o zaman "a,b" TEK değer olarak `in:`e girip P2007 verir.
 */
/**
 * "none" sentinelini UUID listesinden ayırır. İKİ tüketicisi var: iz filtresi
 * (`tagId` → izsiz) ve paketleme grubu filtresi (`packingGroupId` → gruplanmamış).
 * İkisi de aynı soruyu soruyor ("bu bağı HİÇ olmayanlar"), ikinci bir kopya
 * yazılmadı — kopya, sentinelin bir tarafta unutulmasıyla P2007 üretirdi.
 */
function splitTagFilter(v: string | string[] | undefined): { ids: string[]; untagged: boolean } {
  const raw = readFilterList(v);
  const untagged = raw.some((x) => x.toLowerCase() === UNTAGGED_FILTER_VALUE);
  return { ids: raw.filter((x) => x.toLowerCase() !== UNTAGGED_FILTER_VALUE), untagged };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Kalite filtresi değerlerini KODA çevirir. Panel standart `multi-lookup`
 * kullandığı için UUID gönderir; uçlar/scriptler kodla da çağırabilir.
 *
 * ⚠️ Katalog KODU hiçbir yere gömülmez — 2026-09-13'te son istisna da kalktı:
 * statü eşlemesi artık `QualityGradeRole.SECOND` rolünden çözülüyor, gömülü
 * "A1" karşılaştırması YOK. Fabrika kaliteyi yeniden adlandırırsa liste
 * kendiliğinden doğru kalır (2026-08-09 "1. KALİTE koda gömülmez" kardeşi).
 */
async function resolveQualityCodes(values: string[]): Promise<string[]> {
  if (values.length === 0) return [];
  const ids = values.filter((v) => UUID_RE.test(v));
  const codes = values.filter((v) => !UUID_RE.test(v)).map((c) => c.toUpperCase());
  if (ids.length === 0) return codes;
  const rows = await prisma.qualityGrade.findMany({
    where: { id: { in: ids } },
    select: { code: true },
  });
  return [...new Set([...codes, ...rows.map((r) => r.code.toUpperCase())])];
}

export type SackSearchScope = "POOL" | "PLANNED" | "DISPATCHED" | "ALL";

export interface SackSearchParams {
  /** Tek ID ya da ID listesi — liste verilirse aynı alan içinde VEYA (IN) uygulanır. */
  itemId?: string | string[];
  colorId?: string | string[];
  width?: number;
  widthMin?: number;
  widthMax?: number;
  customerId?: string | string[];
  /** Müşteri ŞUBESİ (çoklu = VEYA). Liste "Şube" kolonunu basıyor ama süzülemiyordu. */
  branchId?: string | string[];
  /**
   * Tartı durumu — `true`: tartılmış (`weightKg` dolu) · `false`: tartılmamış.
   *
   * Saha sorusu: *"hangi çuvallar hâlâ tartılmadı?"* (ölçüm tekserp_demo
   * 2026-09-04: 33 çuvalın 32'si tartısız). `shipping.weighRequiredEnabled`
   * bayrağı açık kurulumda bu liste doğrudan yapılacak işin kendisidir.
   */
  weighed?: boolean;
  /** Çuval notu olan / olmayan. `hasNote` liste satırında zaten dönüyor. */
  hasNote?: boolean;
  /**
   * Not METNİNDE arama (harf-duyarsız `contains`). `hasNote` ikili süzmesinin
   * kardeşi: o "notu var mı" der, bu "notunda ne yazıyor" der.
   *
   * ⚠️ Serbest `search` kutusuna EKLENMEDİ ve bu bilinçli: o kutu kimlik arar
   * (çuval no / cari / sevkiyat no) ve not metnini oraya karıştırmak "TR-4521"
   * yazan bir notu çuval numarası sanılan satırlarla karıştırırdı.
   */
  noteText?: string;
  /**
   * Boş çuval (içinde fiziksel top DA kartela DA yok) / dolu çuval.
   *
   * ⚠️ Top ADEDİ aralığı ("2-5 top içerenler") bilinçli YOK: ilişki sayımına
   * göre süzmek Prisma'da tek sorguda ifade edilemez; `some/none` ile ifade
   * edilebilen tek soru "boş mu" ve o soru gerçek (boş çuval silinir).
   */
  empty?: boolean;
  /** Tarih aralığı — `SACK_DATE_FIELDS` allowlist'i (createdAt | weighedAt). */
  dateField?: string;
  dateFrom?: Date;
  dateTo?: Date;
  /**
   * İÇİNDE bu kaliteden top OLAN çuvallar (kalite KODU: "1.KALITE" / "A1" / …).
   *
   * Saha sorusu (2026-08-13): *"hangi çuvalda 2. kalite ürün var?"* — detayda
   * uyarı bandı vardı ama listede tek bakışta görülemiyordu.
   *
   * ⚠️ Semantik "İÇEREN"dir, "yalnız o kaliteden oluşan" DEĞİL: karışık çuval
   * meşrudur ve asıl aranan zaten "içine 2. kalite karışmış mı" sorusudur.
   * Çoklu seçim VEYA'dır (kumaş/renk ile aynı kural).
   *
   * ⚠️ `A1_STOCK` STATÜSÜ DE SAYILIR: top çuvala girerken statüsü değişebiliyor
   * ama kalite kodu üstünde kalıcı — uyuşmazlık bandı da (`sack-content-mismatch`)
   * ikisine ayrı ayrı bakıyor. Yalnız koda bakmak, statüsü A1 olup kodu
   * yazılmamış topu SESSİZCE atlardı.
   */
  qualityGrade?: string | string[];
  /**
   * ÇUVAL İZİ (ETİKET) — bu izlerden EN AZ BİRİNİ taşıyan çuvallar.
   *
   * ⚠️ Çoklu seçim **VEYA** (alan içi OR standardı — kumaş/renk/kalite ile aynı):
   * "Kontrol Et VEYA Eksik". VE semantiği (ikisini birden taşıyanlar) bilinçli
   * YOK; iz bir işarettir, kesişimi sormak sahanın sorusu değil.
   *
   * ⚠️ `UNTAGGED_FILTER_VALUE` ("none") sentineli listeye karışabilir →
   * `splitTagFilter` onu UUID listesinden AYIRIR (kolon `@db.Uuid`, düz metin
   * P2007 üretir — `CUSTOMERLESS_FILTER_VALUE` ile birebir aynı ders).
   *
   * ⚠️ YALNIZ ETKİN İZ SAYILIR (`ACTIVE_TAG_WHERE`): sevkte temizlenen iz
   * rozette de görünmez, filtrede de dönmez. İkisi TEK yüklemden geçmek
   * zorunda — ayrışırsa liste rozet basar ama filtre o satırı döndürmez.
   */
  tagId?: string | string[];
  /** İzi olan / hiç izi olmayan çuvallar (`hasNote` kardeşi). */
  hasTag?: boolean;
  /**
   * PAKETLEME GRUBU (çalışma yaftası) — bu gruplardan birine ait çuvallar.
   *
   * ⚠️ Çoklu seçim **VEYA** (alan içi OR standardı — iz/kumaş/renk ile aynı).
   *
   * ⚠️ `UNTAGGED_FILTER_VALUE` ("none") sentineli BURADA DA geçerli ve
   * "Gruplanmamış" demektir; `splitTagFilter` onu UUID listesinden AYIRIR
   * (kolon `@db.Uuid`, düz metin P2007 üretir — `CUSTOMERLESS_FILTER_VALUE`
   * ile birebir aynı ders).
   */
  packingGroupId?: string | string[];
  scope?: SackSearchScope;
  shipmentNo?: string;
  sackCode?: string;
  includeDispatched?: boolean;
  /** Serbest arama — sackNo / müşteri adı-kodu / sevkiyat no (DataTable arama kutusu). */
  search?: string;
  /** Sıralama alanı — yalnız Sack skaler kolonu (createdAt | sackNo); aksi createdAt. */
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /** İlk sayfada toplam tahmini (DataTable). */
  withTotal?: boolean;
  cursor?: string;
  limit?: number;
}

/** Kapsam → Sack where OR parçaları (POOL=havuz, PLANNED/DISPATCHED=sevkiyat statüsü). */
function scopeWhere(scope: SackSearchScope): Prisma.SackWhereInput[] {
  switch (scope) {
    case "POOL":
      return [{ shipmentId: null }];
    case "PLANNED":
      return [{ shipment: { status: { in: PLANNED_STATUSES } } }];
    case "DISPATCHED":
      return [{ shipment: { status: ShipmentStatus.DISPATCHED } }];
    case "ALL":
      return [{ shipmentId: null }, { shipment: { is: {} } }];
  }
}

/**
 * `scopeWhere`in SQL İKİZİ — cari kapısı toplulaştırma sorgusu (raw SQL) için.
 * Aynı dört anahtar, aynı hüküm; biri değişince öteki de değişir (bekçi
 * `test_sack_customer_gate §10` iki tarafı aynı fikstürle ölçer). Enum kolonu
 * `::text` ile karşılaştırılır (parametre text gelir).
 */
function scopeSql(scope: SackSearchScope): Prisma.Sql {
  switch (scope) {
    case "POOL":
      return Prisma.sql`s."shipmentId" IS NULL`;
    case "PLANNED":
      return Prisma.sql`sh.status::text IN (${Prisma.join(PLANNED_STATUSES.map((v) => Prisma.sql`${v}`))})`;
    case "DISPATCHED":
      return Prisma.sql`sh.status::text = ${ShipmentStatus.DISPATCHED}`;
    case "ALL":
      return Prisma.sql`TRUE`;
  }
}

/** Varsayılan scope (POOL+PLANNED) — `resolveScopeOr` ile aynı hüküm, SQL. */
function resolveScopeSql(scope?: SackSearchScope): Prisma.Sql {
  if (scope) return scopeSql(scope);
  return Prisma.sql`(${scopeSql("POOL")} OR ${scopeSql("PLANNED")})`;
}

/**
 * Kapsam çözümü — TEK KAYNAK. Varsayılan (scope verilmezse) POOL+PLANNED, yani
 * "sevk edilmemiş çuvallar". Liste (`searchSacks`) ile cari kapısı
 * (`listSackCustomers`) AYNI yüklemden beslenmek ZORUNDA: ayrışırsa kapı "3 çuval"
 * der, liste 5 satır basar ve operatör hangisinin doğru olduğunu bilemez.
 */
function resolveScopeOr(scope?: SackSearchScope, includeDispatched?: boolean): Prisma.SackWhereInput[] {
  if (scope) return scopeWhere(scope);
  if (includeDispatched) return scopeWhere("ALL");
  return [{ shipmentId: null }, { shipment: { status: { in: PLANNED_STATUSES } } }];
}

/** Cari kapısı satırı — `customerId: null` = müşterisiz (genel stok) kovası. */
export interface SackCustomerBucket {
  customerId: string | null;
  name: string;
  code: string | null;
  sackCount: number;
  /** Kapsamdaki çuvallardaki top sayısı (çuval sayısıyla AYNI sorgu kapsamı). */
  rollCount: number;
  /** Sevk edilmemiş (AÇIK) parti sayısı — yalnız sevk partisi modunda döner. */
  openLotCount?: number;
}

/**
 * Cari kapısının sayfalı yanıtı.
 *
 * ⚠️ "Tüm cariler" modu KESİLMEZ, SAYFALANIR (2026-09-04 kullanıcı kararı).
 * Her şeyi göstermek için var olan bir modda sessiz 500-kesme, bu kapının
 * kapatmak için yazıldığı "sessizce düşen satır" sınıfını geri getirirdi.
 */
/** Cari kapısı sıralama anahtarları — SUNUCUDA, toplulaştırılmış kolonlar üstünde. */
export const SACK_CUSTOMER_SORT_KEYS = ["name", "sackCount", "rollCount", "openLotCount"] as const;
export type SackCustomerSortKey = (typeof SACK_CUSTOMER_SORT_KEYS)[number];
export function isSackCustomerSortKey(v: unknown): v is SackCustomerSortKey {
  return typeof v === "string" && (SACK_CUSTOMER_SORT_KEYS as readonly string[]).includes(v);
}
/** Sıralama kolonu → alt sorgudaki kolon (kapalı anahtar kümesi; kullanıcı metni SQL'e girmez). */
const SORT_COL_SQL: Record<SackCustomerSortKey, Prisma.Sql> = {
  name: Prisma.sql`t.name`,
  sackCount: Prisma.sql`t."sackCount"`,
  rollCount: Prisma.sql`t."rollCount"`,
  openLotCount: Prisma.sql`t."openLotCount"`,
};

/** LIKE joker kaçışı — kullanıcı terimi desen değil DEĞERDİR. */
function likeKacir(v: string): string {
  return v.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Cari arama SQL'i — `buildTextSearch({text:["name"], code:["code","taxNumber"]})`
 * ile AYNI hüküm: katlanmış ad kelimeleri AND, kod-biçimli terim koda/vergi no'ya OR.
 */
function cariAramaSql(search: string): Prisma.Sql {
  const parcalar: Prisma.Sql[] = [];
  const tokens = foldSearchTokens(search);
  if (tokens.length > 0) {
    parcalar.push(Prisma.sql`(${Prisma.join(tokens.map((t) => Prisma.sql`c."nameFold" LIKE ${`%${likeKacir(t)}%`}`), " AND ")})`);
  }
  if (isCodeLikeTerm(search)) {
    const kod = `%${likeKacir(foldCodeForCompare(search))}%`;
    parcalar.push(Prisma.sql`c.code LIKE ${kod}`, Prisma.sql`c."taxNumber" LIKE ${kod}`);
  }
  return parcalar.length > 0 ? Prisma.sql`(${Prisma.join(parcalar, " OR ")})` : Prisma.sql`FALSE`;
}

export interface SackCustomerPage {
  items: SackCustomerBucket[];
  nextCursor: string | null;
}

/**
 * ÇUVAL LİSTESİ `where` KURUCUSU — TEK KAYNAK.
 *
 * `searchSacks` ile aynı süzgeçleri kullanan her yeni yüzey (özet/gruplama ucu,
 * dışa aktarma, sayaç) BURADAN geçmek zorunda: ikinci bir kopya yazıldığı gün
 * liste 5 satır, özet 3 satır basar ve operatör hangisinin doğru olduğunu
 * bilemez (bu depoda adı konmuş "türetilmiş alan / ayrışan yüzey" sınıfı).
 *
 * `async` — kalite süzgeci katalogdan KOD çözer (`resolveQualityCodes`).
 * Döner: `where` + `rollFilter`/`hasContentFilter` (sayfa aggregate'leri aynı
 * içerik yüklemini KULLANMAK ZORUNDA, yoksa "eşleşen > toplam" absürtlüğü doğar).
 */
export async function buildSackSearchWhere(params: SackSearchParams): Promise<{
  where: Prisma.SackWhereInput;
  rollFilter: Prisma.RollWhereInput;
  hasContentFilter: boolean;
}> {
  // İçerik (rulo düzeyi) filtresi — ürün/renk/en (en tek değer VEYA min-max aralık).
  // Çoklu ID = alan içinde VEYA (IN); farklı alanlar arasında VE (sektör standardı).
  const rollFilter: Prisma.RollWhereInput = {};
  const itemIds = toIdList(params.itemId);
  const colorIds = toIdList(params.colorId);
  if (itemIds.length) rollFilter.itemId = { in: itemIds };
  if (colorIds.length) rollFilter.colorId = { in: colorIds };
  if (params.widthMin != null || params.widthMax != null) {
    rollFilter.width = {
      ...(params.widthMin != null ? { gte: params.widthMin } : {}),
      ...(params.widthMax != null ? { lte: params.widthMax } : {}),
    };
  } else if (params.width != null) {
    rollFilter.width = params.width;
  }
  // KALİTE — kod VEYA statü (bkz. `qualityGrade` param dokümanı). Bu tek alan
  // kendi içinde OR taşıdığı için `rollFilter`a doğrudan yazılamaz; ayrı OR
  // bloğu olarak eklenir ve diğer içerik koşullarıyla VE'lenir.
  //
  // ⚠️ SÜZGEÇ FK'ya DEĞİL KOD SNAPSHOT'INA bakar: canlı veride 22 topun
  // `qualityGrade` kodu dolu ama `qualityGradeId` NULL (kolon sonradan geldi).
  // `qualityGradeId: { in }` yazmak o topları SESSİZCE atlardı — filtre "0
  // sonuç" değil EKSİK sonuç verirdi ki bu daha tehlikelidir.
  const qualityCodes = await resolveQualityCodes(toIdList(params.qualityGrade));
  if (qualityCodes.length) {
    // "2. kalite seçildiyse A1_STOCK statüsündeki toplar da gelsin" — kod
    // KATALOGDAN, gömülü `"A1"` DEĞİL (karar ①). Soru ROL sorusudur: kova
    // (`targetStatus`) bu fabrikada yanlış cevap verirdi, çünkü A1'in
    // targetStatus'u WAREHOUSE'tur ⇒ `a1Codes` BOŞ döner ve bu genişletme
    // SESSİZCE kapanırdı.
    // ⚠️ `roleOf` PASİF satırları da okur: seçilen kod pasifleştirilmiş olsa
    // bile geçmiş topların üstünde duruyor ve aramaya girmeli.
    const roles = await loadQualityRoles(prisma);
    const secondPicked = qualityCodes.some((c) => roles.roleOf(c) === QualityGradeRole.SECOND);
    rollFilter.OR = [
      { qualityGrade: { in: qualityCodes } },
      ...(secondPicked ? [{ status: RollStatus.A1_STOCK }] : []),
    ];
  }
  const hasContentFilter = Object.keys(rollFilter).length > 0;

  // Kapsam: verilen scope; yoksa includeDispatched'e göre ALL, aksi POOL+PLANNED (varsayılan).
  const scopeOr: Prisma.SackWhereInput[] = resolveScopeOr(params.scope, params.includeDispatched);

  const andClauses: Prisma.SackWhereInput[] = [{ OR: scopeOr }];
  // Müşteri süzgeci — "müşterisiz" sentineli UUID listesinden ayrışır (bkz.
  // CUSTOMERLESS_FILTER_VALUE). İkisi birlikte gelirse tek OR dalı olur.
  const { ids: customerIds, customerless } = splitCustomerFilter(params.customerId);
  if (customerIds.length || customerless) {
    const customerOr: Prisma.SackWhereInput[] = [];
    if (customerIds.length) customerOr.push({ customerId: { in: customerIds } });
    if (customerless) customerOr.push({ customerId: null });
    andClauses.push({ OR: customerOr });
  }
  // ŞUBE — cari süzgecinin çocuğu (panelde `dependent-lookup`). Sentinel YOK:
  // şubesiz çuval "müşterisiz" kovasının içinde zaten görünür, ikinci bir
  // "şubesiz" sentineli aynı kümeyi iki adla anlatırdı.
  const branchIds = toIdList(params.branchId);
  if (branchIds.length) andClauses.push({ branchId: { in: branchIds } });

  // TARTI DURUMU — `weightKg` NULL/NOT NULL. (`weighedAt` DEĞİL: eski satırlarda
  // kg var ama tartı izi kolonları yok — o topları "tartılmamış" saymak yalan olurdu.)
  if (params.weighed != null)
    andClauses.push(params.weighed ? { weightKg: { not: null } } : { weightKg: null });

  // NOT — `setSackNotes` boş metni NULL'a çevirdiği için tek yüklem yeterli
  // (liste satırındaki `hasNote: !!notes` ile birebir).
  // Not METNİ — `hasNote` ile birlikte gelirse VE'lenir (daraltır, çelişmez).
  // Türkçe harf katlaması YOK: `mode: "insensitive"` PG'nin kendi lower()'ı ile
  // çalışır ve not alanı bir KİMLİK değildir (kimlik alanına sed konmaz kuralı
  // buraya UZANMAZ — burada aranan şey serbest metin).
  if (params.noteText?.trim())
    andClauses.push({ notes: { contains: params.noteText.trim(), mode: "insensitive" } });

  if (params.hasNote != null)
    andClauses.push(params.hasNote ? { notes: { not: null } } : { notes: null });

  // BOŞ / DOLU — hayalet top DIŞLANIR (PRESENT_ROLL_WHERE, listedeki rollCount ile aynı yüklem).
  if (params.empty != null) {
    const emptyWhere: Prisma.SackWhereInput = {
      rolls: { none: PRESENT_ROLL_WHERE },
      swatches: { none: {} },
    };
    andClauses.push(params.empty ? emptyWhere : { NOT: emptyWhere });
  }

  // TARİH ARALIĞI — ortak yardımcı (allowlist dışı alan sessizce düşer; bkz. SACK_DATE_FIELDS).
  const dateWhere: Record<string, unknown> = {};
  applyDateRange(dateWhere, params, SACK_DATE_FIELDS);
  if (Object.keys(dateWhere).length) andClauses.push(dateWhere as Prisma.SackWhereInput);

  const shipmentNo = params.shipmentNo?.trim();
  if (shipmentNo)
    andClauses.push({
      shipment: { is: { OR: buildTextSearch<Prisma.ShipmentWhereInput>(shipmentNo, { code: ["shipmentNo"] }) } },
    });
  const sackCode = params.sackCode?.trim();
  if (sackCode) andClauses.push({ OR: buildTextSearch<Prisma.SackWhereInput>(sackCode, { code: ["sackNo"] }) });
  // Serbest arama (DataTable kutusu) — sackNo / müşteri adı-kodu / sevkiyat no.
  const search = params.search?.trim();
  if (search) {
    andClauses.push({
      OR: buildTextSearch<Prisma.SackWhereInput>(search, {
        text: ["customer.name"],
        code: ["sackNo", "customer.code", "shipment.shipmentNo"],
      }),
    });
  }

  // ÇUVAL İZİ (ETİKET) — etkin izler (`ACTIVE_TAG_WHERE`). Çoklu seçim VEYA.
  //
  // ⚠️ ROZET ↔ FİLTRE AYRIŞMASI YASAK: liste satırındaki rozet de bu yüklemden
  // (`ACTIVE_TAG_SELECT` → aynı `ACTIVE_TAG_WHERE`) besleniyor. Ayrı yazılsaydı
  // sevkte temizlenmiş iz birinde görünüp diğerinde görünmez, operatör hangisinin
  // doğru olduğunu bilemezdi (`hasNote`/`PRESENT_ROLL_WHERE` aynı dersi).
  //
  // ⚠️ `readIdCondition`den GEÇER — CSV de bir string'dir; ham geçirilseydi
  // uuid kolonda P2007 (→ HTTP 400) üretirdi.
  const { ids: tagIds, untagged } = splitTagFilter(params.tagId);
  if (tagIds.length || untagged) {
    const tagOr: Prisma.SackWhereInput[] = [];
    const idCond = readIdCondition(tagIds);
    if (idCond) tagOr.push({ tags: { some: { tagId: idCond, ...ACTIVE_TAG_WHERE } } });
    if (untagged) tagOr.push({ tags: { none: ACTIVE_TAG_WHERE } });
    andClauses.push({ OR: tagOr });
  }

  // PAKETLEME GRUBU — iz filtresiyle AYNI kalıp (VEYA + "none" sentineli).
  const { ids: groupIds, untagged: ungrouped } = splitTagFilter(params.packingGroupId);
  if (groupIds.length || ungrouped) {
    const groupOr: Prisma.SackWhereInput[] = [];
    const gCond = readIdCondition(groupIds);
    if (gCond) groupOr.push({ packingGroupId: gCond });
    if (ungrouped) groupOr.push({ packingGroupId: null });
    andClauses.push({ OR: groupOr });
  }

  // İZİ VAR / YOK — `hasNote` kardeşi. `tagId` sentineli ile aynı kümeyi iki
  // adla anlatır; ikisi birlikte gelirse VE'lenir (daraltır, çelişmez).
  if (params.hasTag != null)
    andClauses.push(
      params.hasTag ? { tags: { some: ACTIVE_TAG_WHERE } } : { tags: { none: ACTIVE_TAG_WHERE } },
    );

  if (hasContentFilter) andClauses.push({ rolls: { some: rollFilter } });

  return { where: { AND: andClauses }, rollFilter, hasContentFilter };
}

/**
 * Etikette YAZAN — `Roll.lastLabelSnapshot`tan okunur, CANLI VERİDEN TÜRETİLMEZ.
 *
 * İki snapshot biçimi var ve ayrımı korunur:
 *   · denormalize   → ad alanları DOLU (baskı anında yazıldı)
 *   · minimal niyet → yalnız `{orderLineId}`/`{customerId}`/`{stock}` — ad YOK
 * İkincisinde ad UYDURULMAZ, `null` döner. Adı canlı veriden türetmek, ölçmek
 * istediğimiz ayrışmayı (kâğıt ↔ kayıt) tam olarak gizlerdi.
 *
 * `null` dönüşü = ortada hiç etiket yok; "bayat etiket" ile "etiketsiz top"
 * sahada farklı sorunlardır ve ayrı kalırlar.
 */
function etiketiOku(snapRaw: unknown, printedAt: Date | null) {
  const snap = (snapRaw ?? null) as Record<string, unknown> | null;
  if (!snap && !printedAt) return null;
  const metin = (k: string) => (typeof snap?.[k] === "string" ? (snap[k] as string) : null);
  return {
    itemName: metin("itemName"),
    colorName: metin("colorName"),
    customerName: metin("customerName"),
    orderNumber: metin("orderNumber"),
    operatorName: metin("operatorName"),
    printedAt: printedAt ? printedAt.toISOString() : metin("printedAt"),
    stok: snap?.stock === true,
  };
}

/**
 * Müşteri karşılığı çözücüsü — satır başına `{itemName, colorName}` döndürür.
 *
 * ⚠️ Karşılık YOKSA `null` döner; BİZİM adımız "müşterideki ad" diye BASILMAZ
 * (2026-09-06 kullanıcı düzeltmesi: çoğu müşteri bizim adımızı kullanır,
 * uydurma alias defteri kirletir).
 */
async function musteriAdiCozucu(
  customerId: string | null,
  satirlar: { item: { id: string }; color: { id: string } | null }[],
): Promise<(itemId: string, colorId: string | null) => { itemName: string | null; colorName: string | null }> {
  if (!customerId) return () => ({ itemName: null, colorName: null });
  const { itemAlias, colorAlias } = await batchLoadAliasesMulti(
    prisma,
    [customerId],
    satirlar.map((r) => r.item.id),
    satirlar.map((r) => r.color?.id).filter((x): x is string => !!x),
  );
  return (itemId, colorId) => ({
    itemName: itemAlias.get(`${customerId}:${itemId}`) ?? null,
    colorName: colorId ? (colorAlias.get(`${customerId}:${colorId}`) ?? null) : null,
  });
}

/** `getContentDump` sorgusunun döndürdüğü ham çuval — döküm satırının girdisi. */
interface DokumKaynagi {
  id: string;
  sackNo: string;
  seq: number | null;
  weightKg: Prisma.Decimal | null;
  notes: string | null;
  customer: { id: string; name: string } | null;
  branch: { id: string; code: string | null; name: string } | null;
  shipment: { id: string; shipmentNo: string; status: ShipmentStatus } | null;
  rolls: {
    id: string;
    barcode: string | null;
    currentQty: Prisma.Decimal;
    width: Prisma.Decimal | null;
    qualityGrade: string | null;
    labelDirty: boolean;
    lastLabelSnapshot: Prisma.JsonValue;
    labelPrintedAt: Date | null;
    item: { id: string; name: string };
    color: { id: string; name: string } | null;
  }[];
  swatches: {
    id: string;
    barcode: string | null;
    item: { id: string; name: string };
    color: { id: string; name: string } | null;
  }[];
}

/**
 * Döküm satırı — tek çuvalın belge/Excel şekli. Metottan ayrı: boyut tavanı
 * YENİ kodda zorunlu ve üç ad eklenince `getContentDump` sınırı aştı.
 */
function dokumSatiri(
  s: DokumKaynagi,
  musterideki: (i: string, c: string | null) => { itemName: string | null; colorName: string | null },
) {
  const rolls = s.rolls.map((r) => ({
    id: r.id,
    barcode: r.barcode,
    itemName: r.item.name,
    colorName: r.color?.name ?? null,
    width: r.width === null ? null : Number(r.width),
    qty: Number(r.currentQty),
    qualityGrade: r.qualityGrade,
    musterideki: musterideki(r.item.id, r.color?.id ?? null),
    etiket: etiketiOku(r.lastLabelSnapshot, r.labelPrintedAt),
    labelDirty: r.labelDirty,
  }));
  return {
    id: s.id,
    sackNo: s.sackNo,
    seq: s.seq,
    weightKg: s.weightKg === null ? null : Number(s.weightKg),
    notes: s.notes,
    customer: s.customer,
    branch: s.branch,
    shipment: s.shipment,
    rollCount: rolls.length,
    totalQty: rolls.reduce((a, r) => a + r.qty, 0),
    rolls,
    swatches: s.swatches.map((w) => ({
      id: w.id,
      barcode: w.barcode,
      itemName: w.item.name,
      colorName: w.color?.name ?? null,
      musterideki: musterideki(w.item.id, w.color?.id ?? null),
    })),
  };
}

/**
 * SIRALAMA ALLOWLIST'İ — yalnız `Sack`ın KENDİ SKALER kolonları.
 *
 * ⚠️ Neden ilişki ve türetilmiş alan YOK: sayfalama keyset cursor'ludur
 * (`dynamicCursorWhere` tek bir skaler kolon üzerinde `gt`/`lt` kurar).
 *   • `packingGroup.name` / iz adı → İLİŞKİ. Prisma sıralayabilir ama cursor
 *     onu ifade edemez → sayfa sınırında satır atlanır/tekrarlanır. "Grupları
 *     bir arada gör" ihtiyacını grup FİLTRESİ karşılıyor (`packingGroupId`).
 *   • metraj / top adedi → bu sorguda YOK; sayfa çekildikten SONRA ayrı bir
 *     `groupBy` ile hesaplanıyor. SQL sıralamasına giremez; sıralamak için
 *     listeyi offset'e çevirmek gerekirdi (yasak).
 * Yeni alan eklerken: kolon `select`te DE olmalı — `buildNextDynamicCursor`
 * cursor değerini satırdan okur.
 */
// `packageNo` (2026-09-21) — sevk partisi içi sıra; skaler kolon, keyset cursor'la ifade edilir.
const SACK_SORTABLE = ["createdAt", "sackNo", "notes", "weightKg", "packageNo"] as const;
type SackSortField = (typeof SACK_SORTABLE)[number];
/** NULL taşıyabilen sıralama kolonları → `nulls: "last"` + cursor'da null fazı. */
const SACK_NULLABLE_SORT = new Set<SackSortField>(["notes", "weightKg"]);

function resolveSackSort(params: SackSearchParams): {
  sortField: SackSortField;
  sortOrder: "asc" | "desc";
  sortNullable: boolean;
  orderByPrimary: Prisma.SackOrderByWithRelationInput;
} {
  const sortField: SackSortField = SACK_SORTABLE.includes(params.sortBy as SackSortField)
    ? (params.sortBy as SackSortField)
    : "createdAt";
  const sortOrder: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";
  const sortNullable = SACK_NULLABLE_SORT.has(sortField);
  const orderByPrimary = (
    sortNullable ? { [sortField]: { sort: sortOrder, nulls: "last" as const } } : { [sortField]: sortOrder }
  ) as Prisma.SackOrderByWithRelationInput;
  return { sortField, sortOrder, sortNullable, orderByPrimary };
}

export class SackSearchService {
  /**
   * Çuval arama — içerik (ürün/renk/en) ve/veya kimlik (kod/sevkiyat/müşteri)
   * filtreli. İçerik filtresi aktifken her satırda eşleşen top adedi+metresi
   * ayrıca döner ("bu çuvalda aradığından ne kadar var").
   */
  async searchSacks(params: SackSearchParams): Promise<CursorPaginatedResponse<unknown>> {
    const limit = Math.min(Math.max(1, params.limit ?? 50), 100);
    const { sortField, sortOrder, sortNullable, orderByPrimary } = resolveSackSort(params);

    // Süzgeç kurucusu ORTAK (`buildSackSearchWhere`) — ileride özet/gruplama
    // ucu da onu çağıracak; ikinci bir kopya liste ile özeti ayrıştırırdı.
    const { where, rollFilter, hasContentFilter } = await buildSackSearchWhere(params);
    const cursor = decodeDynamicCursor(params.cursor);
    const finalWhere: Prisma.SackWhereInput = cursor
      ? {
          AND: [
            where,
            dynamicCursorWhere(cursor, sortField, sortOrder, sortNullable) as Prisma.SackWhereInput,
          ],
        }
      : where;

    const rows = await prisma.sack.findMany({
      where: finalWhere,
      orderBy: [orderByPrimary, { id: sortOrder }],
      take: limit + 1,
      select: {
        id: true,
        sackNo: true,
        seq: true,
        packageNo: true,
        weightKg: true,
        createdAt: true,
        // Yorum listede yalnız KIRPILMIŞ önizleme olarak döner (aşağıda notePreview:
        // 80 karakter) — YANIT payload'ı 500 karakter × sayfa başına 100 satır
        // şişmesin diye. ⚠️ DB→uygulama aşamasında tam metin YİNE ÇEKİLİYOR (kırpma
        // JS'te); kazanç ağ tarafında, sorgu tarafında DEĞİL. Sorguda da kırpmak
        // `$queryRaw` + `LEFT(notes, N)` ister — bu ölçekte (sayfa başına ≤100 satır)
        // değmez. Tam metin çuval detayında / `getSackNotes` ile alınır.
        notes: true,
        // Paketleme grubu — satırdaki "Grup" çipi ve şerit sayacı bundan doğar.
        // ⚠️ Grup ADI burada okunur, istemcide `packingGroupId`den TÜRETİLMEZ:
        // türetseydik ad iki kaynaktan gelir ve yeniden adlandırmadan sonra
        // liste bayat ad basardı.
        packingGroup: { select: { id: true, name: true, seq: true } },
        // ÇUVAL İZLERİ (rozet) — `ACTIVE_TAG_SELECT` ile. Yüklem (`clearedAt: null`)
        // filtreninkiyle AYNI kaynaktan gelir; ayrı yazılsaydı rozet ile "Etiket"
        // süzgeci sessizce ayrışırdı (sevkte temizlenen iz birinde görünür,
        // diğerinde görünmez).
        tags: ACTIVE_TAG_SELECT,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
          },
        },
      },
    });
    const totalEstimate = params.withTotal ? await prisma.sack.count({ where }) : undefined;

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const ids = pageRows.map((s) => s.id);
    const nextCursor = hasMore
      ? buildNextDynamicCursor(pageRows[pageRows.length - 1] as unknown as Record<string, unknown>, sortField)
      : null;

    // Sayfa kapsamı aggregate'leri: toplam içerik + (filtre aktifse) eşleşen kısım.
    // HAYALET DIŞLANIR (`SACK_ABSENT_STATUSES`): çuvalda kayıtlı ama fiziksel olarak
    // binada olmayan top (kartelaya/tambura/fasona gitmiş) sayılırsa liste, çuval
    // etiketi (label.service — aynı küme) ve irsaliye AYNI çuval için ÜÇ FARKLI top
    // adedi basardı. Filtre `matchAgg`'a da uygulanır; yoksa içerik filtresi seçili
    // ürünün hayaletini sayıp "eşleşen > toplam" absürtlüğü doğar.
    const presentOnly = PRESENT_ROLL_WHERE;
    const [allAgg, matchAgg, swatchAgg] = ids.length
      ? await Promise.all([
          prisma.roll.groupBy({
            by: ["sackId"],
            where: { sackId: { in: ids }, ...presentOnly },
            _count: { _all: true },
            _sum: { currentQty: true },
          }),
          hasContentFilter
            ? prisma.roll.groupBy({
                by: ["sackId"],
                where: { sackId: { in: ids }, ...presentOnly, ...rollFilter },
                _count: { _all: true },
                _sum: { currentQty: true },
              })
            : Promise.resolve([]),
          prisma.swatch.groupBy({
            by: ["sackId"],
            where: { sackId: { in: ids } },
            _count: { _all: true },
          }),
        ])
      : [[], [], []];

    const allBySack = new Map(allAgg.map((g) => [g.sackId, g]));
    const matchBySack = new Map(matchAgg.map((g) => [g.sackId, g]));
    const swatchBySack = new Map(swatchAgg.map((g) => [g.sackId, g]));

    const data = pageRows.map((s) => {
      const all = allBySack.get(s.id);
      const match = matchBySack.get(s.id);
      return {
        id: s.id,
        sackNo: s.sackNo,
        seq: s.seq,
        packageNo: s.packageNo, // sevk partisi içi ambalaj no; partisiz/grup modunda null
        weightKg: s.weightKg === null ? null : Number(s.weightKg),
        createdAt: s.createdAt,
        // Yorum var mı (💬 göstergesi) + ilk 80 karakter (satır ipucu).
        hasNote: !!s.notes,
        notePreview: s.notes ? s.notes.slice(0, 80) : null,
        // Etkin izler (rozet). ⚠️ `hasTag` DE bu diziden türer — ayrı hesaplanmış
        // ikinci bir sayaç eklenirse rozet ile filtre ayrışır (`/pool`a ayrı
        // etiket sayacı eklenmemesinin aynı gerekçesi).
        tags: toTagBadges(s.tags),
        hasTag: s.tags.length > 0,
        packingGroup: s.packingGroup,
        customer: s.customer,
        branch: s.branch,
        shipment: s.shipment, // null = havuzda; dolu = sevkiyatta
        rollCount: all?._count._all ?? 0,
        totalQty: Number(all?._sum.currentQty ?? 0),
        swatchCount: swatchBySack.get(s.id)?._count._all ?? 0,
        // İçerik filtresi yokken null — UI eşleşme sütununu gizler.
        matchRollCount: hasContentFilter ? (match?._count._all ?? 0) : null,
        matchQty: hasContentFilter ? Number(match?._sum.currentQty ?? 0) : null,
      };
    });

    return {
      success: true,
      data,
      pagination: { nextCursor, hasMore, limit, ...(totalEstimate !== undefined ? { totalEstimate } : {}) },
    };
  }

  /**
   * Cari kapısı — TEK toplulaştırma sorgusu (raw SQL), SUNUCUDA sıralama + keyset cursor.
   *
   * Saha isteği (2026-09-04): *"sevkiyat ekranına girerken önüme iki kutucuk
   * gelsin — tüm çuvallar / tüm cariler; cariyi seçince o carinin çuvalları
   * listelensin."*
   *
   * ⚠️ VARSAYILAN "TÜM CARİLER" — 2026-09-04 KULLANICI KARARI, GERİ ÇEVİRME.
   * Bu uç ilk yazıldığında YALNIZ çuvalı olan carileri döndürüyordu ve gerekçesi
   * şu ölçümdü: 43 aktif cariden yalnız 4'ünün depoda çuvalı var, kalan 39 "sonuç
   * yok" verirdi. Ölçüm doğruydu ama SORU yanlıştı: kapının işi "bugün elimde
   * kimin malı var" değil, **"hangi cariye çuval açacağım"**. Yeni bir cariye ilk
   * çuvalı açacak personel onu listede bulamıyordu — özelliğin var oluş sebebi de
   * tam olarak "seçtiğin caride sürekli ve kolay çuval açabilmek"ti.
   * Eski davranış `withSacksOnly=true` ile SÜZGEÇ olarak duruyor.
   *
   * ⚠️ ÇUVALI OLANLAR ÜSTTE. Kesme yerine sıralama: `sackCount desc`, sonra ad
   * (tr). Böylece "tüm cariler" isteği karşılanırken 39/43 "sonuç yok" tuzağı da
   * kapanır — aradığı cari zaten üstte.
   *
   * ⚠️ ROZET HER İKİ MODDA. Çuvalsız cari `sackCount: 0` alır. Sayıyı o modda
   * gizlemek, modu değiştiren düğmeyi "bozuk" gösterirdi — kıyaslama düğmenin
   * sebebi.
   *
   * ⚠️ KESME YOK, iki modda da SAYFALAMA var (`cursor` + `limit`); `withSacksOnly`
   * yalnız bir WHERE. Sıralama (`sortBy`: ad · çuval · top · açık parti) kapsamın
   * TAMAMI üstünde — istemci sayfa içinde sıralamaz (2026-09-22: 100+ carili firmada
   * "en çok bekleyen kim" sorusuna sayfa içi cevap eksikti; havuzun tamamını çekip
   * bellekte toplamak da cari sayısıyla değil havuzla ölçekleniyordu — yanlış eksen).
   *
   * ⚠️ MÜŞTERİSİZ KOVASI SATIR OLARAK DÖNER (`customerId: null`) — ölçümde
   * depodaki 9 çuvalın 4'ü müşterisizdi. Cari listesinde adı olmadığı için
   * "sessizce" düşmesi en olası satırdır; İLK sırada döner. Arama terimi
   * verilince DÖNMEZ (adı yok, eşleşmiyor).
   *
   * ⚠️ TOP ADEDİ parti özetiyle AYNI yüklem (çuvaldaki her top; statü süzgeci yok) —
   * metraj bilerek yok (hayalet-top yüklemini ikinci kez uygulamak dördüncü rakam olurdu).
   *
   * Salt-okunur; yazma/audit yok.
   */
  async listSackCustomers(params: {
    scope?: SackSearchScope;
    search?: string;
    /** true → yalnız kapsamda çuvalı olan cariler. */
    withSacksOnly?: boolean;
    /** Sıralama SUNUCUDA (toplulaştırılmış kolon); varsayılan çuvalı olanlar üstte, ad. */
    sortBy?: SackCustomerSortKey;
    sortOrder?: "asc" | "desc";
    cursor?: string;
    limit?: number;
  }): Promise<ApiResponse<SackCustomerPage>> {
    const search = params.search?.trim();
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 200);
    // Varsayılan sıra: çuvalı olanlar üstte (sackCount desc), eşitlikte ad (DB kolasyonu — Prisma orderBy ile aynı).
    const sortBy: SackCustomerSortKey = params.sortBy ?? "sackCount";
    const sortOrder: "asc" | "desc" = params.sortOrder ?? (sortBy === "name" ? "asc" : "desc");
    const col = SORT_COL_SQL[sortBy];
    const yon = sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    // Keyset cursor: (sıralama kolonu, ad, id) — ad ve id daima ASC tie-break; ad
    // eşitliğinde id, böylece aynı sayıya sahip cariler sayfa sınırında ne kopyalanır
    // ne düşer.
    const cursor = decodeDynamicCursor(params.cursor);
    let cursorSql = Prisma.sql`TRUE`;
    if (cursor && cursor.v !== null) {
      const op = sortOrder === "asc" ? Prisma.sql`>` : Prisma.sql`<`;
      const [vRaw, adRaw] = cursor.v.split("\u0000");
      const v = sortBy === "name" ? Prisma.sql`${vRaw}` : Prisma.sql`${Number(vRaw)}::int`;
      const ad = Prisma.sql`${adRaw ?? ""}`;
      cursorSql = Prisma.sql`(
        ${col} ${op} ${v}
        OR (${col} = ${v} AND t.name > ${ad})
        OR (${col} = ${v} AND t.name = ${ad} AND t.id > ${cursor.id}::uuid)
      )`;
    }
    const lotMode = (await readPackingGroupsEnabled()) && (await readPackingLotSettings()).mode === "sevk-partisi";
    const scope = resolveScopeSql(params.scope);

    // ── TEK toplulaştırma sorgusu: cari × (çuval · top · açık parti) ─────────
    // Sıralama KAPSAMIN tamamı üstünde (sayfa içi değil); maliyet havuz büyüklüğüne
    // değil cari başına gruba bağlı, sayfa boyutu kadar satır döner.
    type Row = { id: string; name: string; code: string | null; sackCount: number; rollCount: number; openLotCount: number };
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH pool AS (
        SELECT s.id, s."customerId"
        FROM sacks s
        LEFT JOIN shipments sh ON sh.id = s."shipmentId"
        WHERE s."customerId" IS NOT NULL AND ${scope}
      ),
      agg AS (
        SELECT p."customerId",
               COUNT(*)::int AS sack_count,
               COALESCE(SUM((SELECT COUNT(*) FROM rolls r WHERE r."sackId" = p.id)), 0)::int AS roll_count
        FROM pool p
        GROUP BY p."customerId"
      ),
      lots AS (
        SELECT "customerId", COUNT(*)::int AS open_lot_count
        FROM packing_groups
        WHERE status::text = 'OPEN'
        GROUP BY "customerId"
      ),
      base AS (
        SELECT c.id, c.name, c.code,
               COALESCE(a.sack_count, 0) AS "sackCount",
               COALESCE(a.roll_count, 0) AS "rollCount",
               COALESCE(l.open_lot_count, 0) AS "openLotCount"
        FROM customers c
        LEFT JOIN agg a ON a."customerId" = c.id
        LEFT JOIN lots l ON l."customerId" = c.id
        WHERE c."isActive" = TRUE
          AND ${search ? cariAramaSql(search) : Prisma.sql`TRUE`}
          AND ${params.withSacksOnly ? Prisma.sql`COALESCE(a.sack_count, 0) > 0` : Prisma.sql`TRUE`}
      )
      SELECT * FROM base t
      WHERE ${cursorSql}
      ORDER BY ${col} ${yon}, t.name ASC, t.id ASC
      LIMIT ${limit + 1}
    `);
    const hasMore = rows.length > limit;
    const sayfa = hasMore ? rows.slice(0, limit) : rows;
    const items: SackCustomerBucket[] = sayfa.map((r) => ({
      customerId: r.id,
      name: r.name,
      code: r.code,
      sackCount: r.sackCount,
      rollCount: r.rollCount,
      // Açık parti yalnız sevk partisi modunda anlamlı — grup modunda alan hiç gitmez.
      ...(lotMode ? { openLotCount: r.openLotCount } : {}),
    }));
    const son = sayfa[sayfa.length - 1];
    const nextCursor = hasMore && son
      ? encodeDynamicCursor({ v: `${String(son[sortBy])}\u0000${son.name}`, id: son.id, t: "s" })
      : null;

    // ── Müşterisiz kovası: İLK sayfada, aramasızken, en üstte (cari değil, sahipsiz stok) ──
    // Sayısı Prisma yüklemiyle (`resolveScopeOr`): SQL ikizinden ayrışırsa bekçi §10 yakalar.
    let customerless: SackCustomerBucket | null = null;
    if (!search && !cursor) {
      const sahipsiz = { customerId: null, OR: resolveScopeOr(params.scope) } as const;
      const sackCount = await prisma.sack.count({ where: sahipsiz });
      if (sackCount > 0) {
        const rollCount = await prisma.roll.count({ where: { sack: sahipsiz } });
        customerless = { customerId: null, name: "Müşterisiz (genel stok)", code: null, sackCount, rollCount };
      }
    }

    return {
      success: true,
      data: { items: [...(customerless ? [customerless] : []), ...items], nextCursor },
    };
  }

  /**
   * Tek çuvalın dökümü — arama satırı genişletilince lazy yüklenir.
   * Tek çuval = sınırlı scope (onlarca top) → satırları çekmek güvenli.
   */
  async getSackContents(sackId: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: {
        id: true,
        sackNo: true,
        seq: true,
        weightKg: true,
        // Tartının kaynağı — İÇ iz, yalnız DETAY yüzeyinde. Listeye eklenmedi
        // (gürültü) ve BELGEYE/ETİKETE hiç girmez (schema.prisma doc'u).
        // NULL = bu alandan önce tartılmış (legacy) → rozet gösterilmez.
        weightSource: true,
        // Müşteri karşılığı (alias) BU müşteriye göre çözülür. Depodaki çuvalda
        // sevkiyat YOKTUR; o yüzden çuvalın KENDİ müşterisi de gerekir.
        customerId: true,
        customer: { select: { id: true, name: true } },
        // Çuvalın ÜSTÜNDEKİ etiket bayat mı (müşteri değişimi → farklı şablon).
        // Toplarınki `rolls[].labelDirty`; bu, ÇUVALIN KENDİ etiketi.
        labelDirty: true,
        notes: true, // tek çuval → tam yorum (liste aksine kırpılmaz)
        // Sevk partisi + ambalaj no — editör başlığı "Partiye Al" sonrası buradan tazelenir.
        packingGroupId: true,
        packageNo: true,
        packingGroup: { select: { name: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, code: true, name: true } },
          },
        },
        rolls: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            // ⚠️ HAYALET GÖRÜNÜRLÜĞÜ — bu ekran (Paketleme / Çuvallar → çuval düzenle)
            // operatörün hayalet topu GÖRÜP ÇIKARDIĞI yerdir; guard'ların hata mesajı
            // buraya yönlendirir. Bu yüzden liste BURADA FİLTRELENMEZ ve `status`
            // döndürülür (istemci rozetler). Filtrelemek kaçış yolunu kapatırdı.
            status: true,
            currentQty: true,
            width: true,
            qualityGrade: true,
            // Etiket bayat mı — müşteri değişimi/relabel sonrası "yeniden bas"
            // uyarısını ve toplu yeniden-basma aksiyonunu besler.
            labelDirty: true,
            // ⭐ ÜÇLÜ KARŞILAŞTIRMA (2026-09-07 saha isteği): bu ekran, mal sevk
            // edilmeden önceki SON bakış anıdır ve üç ad orada ayrışabilir —
            // bizdeki · müşterideki · TOPUN ÜSTÜNDEKİ KÂĞITTA YAZAN. Üçüncüsü
            // `lastLabelSnapshot`ta baskı anında DONMUŞTUR; canlı veriden
            // türetilemez, çünkü asıl soru "kâğıt ile kayıt ayrıştı mı".
            // `labelPrintedAt` NULL = ortada hiç etiket yok (ayrı bir durum:
            // "bayat etiket" ile "etiketsiz top" farklı sahada farklı sorunlar).
            lastLabelSnapshot: true,
            labelPrintedAt: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true, hex: true } },
          },
        },
        swatches: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true, hex: true } },
          },
        },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");

    // ── ÜÇ AD YAN YANA ────────────────────────────────────────────────────────
    // ① bizdeki (canlı kayıt) ② müşterideki (alias kademesi) ③ etikette yazan
    // (baskı anında donmuş). Üçü de AYNI satırda gösterilir; ayrıştıklarında
    // görünür olsunlar diye. Saha gerekçesi: etikette A müşterisi yazan bir top
    // B'nin çuvalına düşerse bugün bunu gösteren HİÇBİR ekran yok.
    //
    // Alias kademesi müşteri kartındaki karşılıktır; yoksa `null` döner —
    // BİZİM adımız "müşterideki ad" diye BASILMAZ (2026-09-06 kullanıcı
    // düzeltmesi: çoğu müşteri bizim adımızı kullanır, uydurma alias yaratma).
    const musterideki = await musteriAdiCozucu(
      sack.customerId ?? sack.shipment?.customer?.id ?? null,
      [...sack.rolls, ...sack.swatches],
    );

    return {
      success: true,
      data: {
        ...sack,
        rolls: sack.rolls.map((r) => ({
          ...r,
          musterideki: musterideki(r.item.id, r.color?.id ?? null),
          etiket: etiketiOku(r.lastLabelSnapshot, r.labelPrintedAt),
        })),
        swatches: sack.swatches.map((w) => ({
          ...w,
          musterideki: musterideki(w.item.id, w.color?.id ?? null),
        })),
      },
    };
  }

  /**
   * Çeki listesi verisi — SEÇİLEN çuvalların içerik özetiyle tek istekte dökümü.
   * Senaryo: müşterinin farklı sevkiyatlarda bekleyen çuvallarından bir alt küme
   * seçilir ("sadece gri Patos"), kağıda basılır, sahada bulunan çuvalın üstü
   * çizilir. Çalışma kağıdıdır — PrintedDocument (donmuş/versiyonlu) DEĞİL.
   * Salt-okunur; seçim ≤200 çuval + çuval başına onlarca top → tek sorgu güvenli.
   */
  async getPickList(sackIds: string[]): Promise<ApiResponse<unknown>> {
    const ids = [...new Set(sackIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir çuval seçilmeli");
    if (ids.length > MAX_SELECTED_SACKS) {
      throw AppError.badRequest(`Bir çeki listesinde en fazla ${MAX_SELECTED_SACKS} çuval olabilir`);
    }

    const sacks = await prisma.sack.findMany({
      where: { id: { in: ids } },
      // Sevkiyat + çuval sırası: sahada aynı sevkin çuvalları yan yana durur.
      orderBy: [{ shipmentId: "asc" }, { seq: "asc" }],
      select: {
        id: true,
        sackNo: true,
        seq: true,
        weightKg: true,
        // Çeki listesi bir İÇ çalışma kağıdı (müşteriye gitmez) → notun TAM metni
        // döner (liste uçlarındaki 80 karakter kırpması burada gereksiz; scope
        // seçili çuvallarla sınırlı, en fazla 200). Basılması İSTEMCİDE opsiyonel.
        notes: true,
        // ÇUVAL İZLERİ (§F) — çeki listesi SAHADA ELE ALINAN kâğıt; "bunu kontrol
        // et / buna bir şey daha eklenecek" izinin en çok gerektiği yüzey burası.
        // Not ile AYNI sözleşme: uç veriyi DÖNER, basılıp basılmayacağına İSTEMCİ
        // karar verir (opt-in) — ve `withNotes` ile TEK bayrağa bindirilmez, ikisi
        // farklı hassasiyette veri. Yüklem yine `ACTIVE_TAG_SELECT` (sevkte
        // temizlenen iz burada da GÖRÜNMEZ — rozet/filtre/kâğıt tek kümedir).
        tags: ACTIVE_TAG_SELECT,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
          },
        },
        rolls: {
          // HAYALET DIŞLANIR: çeki listesi sahada "bu çuvalda şu ürünlerden N top
          // var" diye okunan bir arama kağıdıdır. Kartelaya/tambura gitmiş top
          // sayılırsa operatör olmayan malı arar ve "top eksik" alarmı verir.
          // Aynı küme etiket + liste + irsaliyede de kullanılır (tek kaynak).
          where: { status: { notIn: SACK_ABSENT_STATUSES } },
          select: {
            currentQty: true,
            width: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
        swatches: { select: { id: true } },
      },
    });

    const data = sacks.map((s) => {
      // Ürün·renk·en bazında özet (irsaliye döküm diliyle aynı).
      const groups = new Map<string, { itemName: string; colorName: string | null; width: number | null; qty: number; rollCount: number }>();
      let totalQty = 0;
      for (const r of s.rolls) {
        const widthNum = r.width === null ? null : Number(r.width);
        const key = `${r.item.name}|${r.color?.name ?? ""}|${widthNum ?? ""}`;
        const g = groups.get(key) ?? {
          itemName: r.item.name,
          colorName: r.color?.name ?? null,
          width: widthNum,
          qty: 0,
          rollCount: 0,
        };
        g.qty += Number(r.currentQty);
        g.rollCount += 1;
        groups.set(key, g);
        totalQty += Number(r.currentQty);
      }
      return {
        id: s.id,
        sackNo: s.sackNo,
        seq: s.seq,
        weightKg: s.weightKg === null ? null : Number(s.weightKg),
        notes: s.notes,
        // Rozet dönüşümü TEK noktadan (`toTagBadges`) — liste satırıyla aynı şekil.
        tags: toTagBadges(s.tags),
        customer: s.customer,
        branch: s.branch,
        shipment: s.shipment,
        rollCount: s.rolls.length,
        swatchCount: s.swatches.length,
        totalQty,
        contents: [...groups.values()],
      };
    });

    return { success: true, data };
  }

  /**
   * İÇERİK DÖKÜMÜ — seçilen çuvalların TOP BAZLI dökümü (Excel/PDF/yazdır kaynağı).
   *
   * Çeki listesinden (`getPickList`) farkı: orası ürün·renk·en bazında GRUPLU özet
   * basar (sahada çuval ararken doğru olan), burası her topu ayrı satır olarak
   * verir (barkod dahil) — "çuvalda tam olarak ne var" sorusunun cevabı.
   * Aynı iskelet: aynı ≤200 çuval sınırı, aynı sıralama (sevkiyat + çuval sırası,
   * sahada aynı sevkin çuvalları yan yana durur), salt-okunur, audit yok.
   *
   * Decimal alanlar BURADA `Number()`'a çevrilir — `getSackContents` bunu yapmadığı
   * için istemci her kullanımda `Number(...)` sarmak zorunda kalıyor; yeni uçta o
   * tuzak tekrarlanmaz.
   */
  async getContentDump(
    sackIds: string[],
    /**
     * PAKETLEME GRUBU kapsamı — verilirse çuval id'leri SUNUCUDA çözülür.
     *
     * ⚠️ İstemci grubun çuvallarını kendisi sayıp gönderemez: liste cursor'lu
     * sayfalıdır, yani ekrandaki sayfa grubun TAMAMI olmayabilir. "P2'nin
     * dökümünü al" dendiğinde eksik sayfayla eksik döküm üretmek, sessiz yanlış
     * cevabın ta kendisiydi.
     *
     * Kapsam HAVUZ çuvallarıdır (`shipmentId: null`) — grubun canlı tanımıyla
     * aynı yüklem. Sevk edilmiş çuval grubun geçmişidir, çalışma kâğıdına girmez.
     */
    packingGroupId?: string,
  ): Promise<ApiResponse<unknown>> {
    let ids = [...new Set(sackIds)];
    if (packingGroupId) {
      const rows = await prisma.sack.findMany({
        where: { packingGroupId, shipmentId: null },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      ids = rows.map((r) => r.id);
      if (ids.length === 0) throw AppError.badRequest("Bu grupta havuz çuvalı kalmamış");
    }
    if (ids.length === 0) throw AppError.badRequest("En az bir çuval seçilmeli");
    if (ids.length > MAX_SELECTED_SACKS) {
      throw AppError.badRequest(`Bir dökümde en fazla ${MAX_SELECTED_SACKS} çuval olabilir`);
    }

    const sacks = await prisma.sack.findMany({
      where: { id: { in: ids } },
      orderBy: [{ shipmentId: "asc" }, { seq: "asc" }],
      select: {
        id: true,
        sackNo: true,
        seq: true,
        weightKg: true,
        // İÇ döküm (müşteriye giden belge değil) → notun TAM metni döner. Basılıp
        // basılmayacağına İSTEMCİ karar verir (opt-in) — kök CLAUDE.md kuralı.
        notes: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shipment: { select: { id: true, shipmentNo: true, status: true } },
        rolls: {
          orderBy: { createdAt: "asc" },
          // HAYALET DIŞLANIR — `SACK_ABSENT_STATUSES` (SHIPPED sayılır). Döküm bir
          // SAYIM/BELGE yüzeyi: çeki listesi ve liste aggregate'leri de aynı kümeyi
          // eler. Elemezsek liste "3 top" derken döküm 4 satır basar (sessiz çelişki).
          where: { status: { notIn: SACK_ABSENT_STATUSES } },
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            qualityGrade: true,
            // ⭐ Belgeye de ÜÇ AD (2026-09-07): dökümü çıktı alan kişi bizim
            //    adımızı, müşterinin adını ve ETİKETTE YAZANI yan yana görmeli —
            //    ekranla aynı gerekçe (`getSackContents` başlığı).
            labelDirty: true,
            lastLabelSnapshot: true,
            labelPrintedAt: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true } },
          },
        },
        swatches: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Alias çözücü çuval BAŞINA kurulur: seçilen çuvallar farklı müşterilere ait
    // olabilir ve tek bir müşteriyle çözmek yanlış adı basardı.
    const cozucu = new Map<string, (i: string, c: string | null) => { itemName: string | null; colorName: string | null }>();
    for (const s2 of sacks) {
      cozucu.set(s2.id, await musteriAdiCozucu(s2.customer?.id ?? null, [...s2.rolls, ...s2.swatches]));
    }

    const data = sacks.map((s) => dokumSatiri(s, cozucu.get(s.id)!));

    return { success: true, data };
  }

  /**
   * Top yerini bul — barkod EXACT eşleşme (ILIKE contains seq-scan tuzağına
   * girilmez; barkodlar tam okutulur). Çuvalsız/sevkiyatsız toplar için de
   * konum cevabı verir (statü = depoda/üretimde/sevk edildi).
   */
  async locateRoll(barcode: string): Promise<ApiResponse<unknown>> {
    const code = normalizeScanCode(barcode);
    if (!code) throw AppError.badRequest("Barkod gerekli");
    // Çuval kodu okutulduysa top araması anlamsız — ne yapacağını söyle
    // (çuval etiketi basılabiliyor, bu okutma kaçınılmaz).
    if (matchesSeries(resolveSeriesFormat("sack"), code)) {
      throw AppError.badRequest(
        `${code} bir ÇUVAL kodu — bu ekran TOP barkodu bekler. Çuvalı bulmak için çuval aramasını kullanın.`,
      );
    }

    const roll = await prisma.roll.findFirst({
      where: { barcode: code },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentQty: true,
        width: true,
        qualityGrade: true,
        item: { select: { id: true, name: true } },
        color: { select: { id: true, name: true, hex: true } },
        sack: { select: { id: true, sackNo: true, seq: true, weightKg: true, notes: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound("Bu barkodla top bulunamadı");
    return { success: true, data: roll };
  }
}

export const sackSearchService = new SackSearchService();
