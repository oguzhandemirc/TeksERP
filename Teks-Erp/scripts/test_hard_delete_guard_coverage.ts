// =============================================================================
// Test: hardDelete guard kapsama bekçisi (A5 — 2026-07-31 veri bütünlüğü denetimi)
// Çalıştır: npx tsx scripts/test_hard_delete_guard_coverage.ts
//
// NEDEN: /:id/permanent guard'ları "bu modele point eden FK'ler" listesini ELLE
// tutar. Restrict FK'ler P2003 ile kendini korur; ama SetNull (Prisma'da opsiyonel
// ilişkinin SESSİZ varsayılanı!) ve Cascade bağlar guard'a yazılmazsa iz sessizce
// kaybolur — üç kez tekrarlanmış sistemik boşluk (Item/Customer/Device, rapor A5).
//
// 2026-09-12 — İZLENEN MODEL LİSTESİ ARTIK ELLE TUTULMUYOR: eski `WATCHED` üç
// model sayıyordu (Item/Customer/Device), oysa sahada ON DÖRT `/:id/permanent`
// ucu var. Liste elle tutulduğu için on bir model KÖR kalmıştı. Artık uçlar route
// dosyalarından KEŞFEDİLİR; elle tutulan tek şey "bu uç hangi modeli FİZİKSEL
// siliyor" eşlemesidir ve eksiksizliği İKİ YÖNLÜ ölçülür (yeni uç → kırmızı,
// ölü harita satırı → kırmızı).
//
// Uçların beşi adına rağmen FİZİKSEL SİLMİYOR (mezar taşı / iptal yazıyor) —
// o uçlarda FK aksiyonu hiç tetiklenmez, bu yüzden modelleri izlenmez. Bu iddia
// da mekanik çapaya bağlandı: ilgili servis dosyasında o modelin fiziksel silmesi
// BULUNMAMALI (biri mezar taşını gerçek silmeye çevirirse bekçi kırmızı olur).
//
// NE YAPAR: schema.prisma'yı parse eder, izlenen modellere gelen EFEKTİF
// SetNull/Cascade ilişkileri çıkarır ve aşağıdaki allowlist ile karşılaştırır.
// Yeni bir SetNull/Cascade ilişki eklendiğinde bu test DÜŞER — geliştirici ya
// guard'a sayım ekler ya da bilinçli-cascade olarak buraya yazar (test_db_invariants
// deseninin kardeşi). Ek bölüm (§D): Machine'e gelen her FK kolonu ya
// `MACHINE_DELETE_GUARDS`ta sayılır ya muaf listesinde gerekçelidir. Şema + kaynak
// tek kaynak; DB'ye bağlanmaz.
// =============================================================================
import fs from "fs";
import path from "path";
import { yorumlariSok } from "./lib/regime-gate-scan";

const ROOT = path.resolve(__dirname, "..");
const ROUTES_DIR = path.join(ROOT, "src/routes");
const GUARD_FILE = path.join(ROOT, "src/services/helpers/guarded-hard-remove.ts");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

// =============================================================================
// §A — Kalıcı silme uçları: route dosyalarından KEŞFEDİLİR
// =============================================================================

interface Endpoint {
  /** `<route dosyası>#<handler>` — station.routes.ts iki uç taşıdığı için handler anahtara girer. */
  key: string;
  file: string;
  handler: string;
}

function discoverPermanentEndpoints(): Endpoint[] {
  const found: Endpoint[] = [];
  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".routes.ts"))
    .sort();
  for (const file of files) {
    // Yorumlar SÖKÜLÜR: yorumlanmış bir mount "var" sayılmamalı (negatif sonda dürüstlüğü).
    const src = yorumlariSok(fs.readFileSync(path.join(ROUTES_DIR, file), "utf8"));
    const mountRe = /\.delete\(\s*"\/:id\/permanent"\s*,([\s\S]*?)\)\s*;/g;
    let m: RegExpExecArray | null;
    while ((m = mountRe.exec(src))) {
      // Son tanımlayıcı handler'dır: string'ler ve çağrı argümanları atılır.
      const args = m[1].replace(/"[^"]*"/g, "").replace(/\([^)]*\)/g, "");
      const ids = args.match(/[A-Za-z_][\w.]*/g) ?? [];
      const handler = ids[ids.length - 1] ?? "?";
      found.push({ key: `${file}#${handler}`, file, handler });
    }
  }
  return found;
}

/** Uç → o ucun FİZİKSEL olarak sildiği model; `null` = mezar taşı/iptal yazar, FK aksiyonu tetiklenmez. */
const ENDPOINT_TARGETS: Record<string, string | null> = {
  "customer.routes.ts#controller.hardRemove": "Customer",
  "defect-type.routes.ts#defectTypeHardRemove": "DefectType",
  "device.routes.ts#DeviceController.hardDelete": "Device",
  "item.routes.ts#controller.hardRemove": "Item",
  "product-recipe.routes.ts#recipeHardRemove": "ProductRecipe",
  "route.routes.ts#routeHardRemove": "Route",
  "station.routes.ts#stationHardRemove": "Station",
  "station.routes.ts#machineHardRemove": "Machine",
  "warehouse.routes.ts#controller.hardRemove": "Warehouse",
  // --- Adı "permanent" ama gövdesi FİZİKSEL SİLMİYOR (2026-09-12 ölçümü) ---
  // Bu uçların modelleri İZLENMEZ: satır fiziksel silinmediği için gelen FK'ların
  // SetNull/Cascade aksiyonu hiç tetiklenmez. İddia §B'de çapaya bağlı.
  "inventory.routes.ts#controller.hardDelete": null, // Roll → status CANCELLED arşivi
  "label-template.routes.ts#controller.hardDelete": null, // LabelTemplate → deletedAt mezar taşı
  "order.routes.ts#controller.hardRemove": null, // Order → hardDelete() softDelete'e yönlenir
  "peripheral.routes.ts#controller.hardRemove": null, // PeripheralDevice → deletedAt mezar taşı
  "workorder.routes.ts#controller.hardDelete": null, // WorkOrder → isActive:false arşivi
};

/** `null` eşlenen ucun çapası: bu servis dosyasında bu modelin fiziksel silmesi OLMAMALI. */
const TOMBSTONE_ANCHORS: Record<string, { service: string; model: string }> = {
  "inventory.routes.ts#controller.hardDelete": { service: "inventory.service.ts", model: "roll" },
  "label-template.routes.ts#controller.hardDelete": {
    service: "label-template.service.ts",
    model: "labelTemplate",
  },
  "order.routes.ts#controller.hardRemove": { service: "order.service.ts", model: "order" },
  "peripheral.routes.ts#controller.hardRemove": {
    service: "peripheral.service.ts",
    model: "peripheralDevice",
  },
  "workorder.routes.ts#controller.hardDelete": {
    service: "workorder.service.ts",
    model: "workOrder",
  },
};

/** İzlenen modeller = kalıcı silme ucu GERÇEKTEN fiziksel silen modeller (haritadan TÜRER). */
const WATCHED = new Set(
  Object.values(ENDPOINT_TARGETS).filter((m): m is string => m !== null),
);

/** Beklenen envanter: "Hedef <- Kaynak.alan : Aksiyon" → gerekçe.
 *  guarded  = ilgili hardDelete sayımı blokluyor
 *  cascade-intended = bilinçli birlikte-ölüm (alias/pivot; parent'sız anlamsız) */
const EXPECTED: Record<string, string> = {
  "Customer <- CustomerBranch.customer : Cascade": "guarded (branchCount) — sayım 0 değilse silme zaten bloklanır",
  "Customer <- CustomerColorAlias.customer : Cascade": "cascade-intended — alias müşterisiz anlamsız",
  "Customer <- CustomerItemAlias.customer : Cascade": "cascade-intended — alias müşterisiz anlamsız",
  // Paket D (2026-08-14) — `CustomerItemAlias` ile BİREBİR aynı şekil ve aynı
  // gerekçe: fiyat satırı, ait olduğu müşteri/kalem yokken anlamsızdır. Kalıcı
  // silme zaten bağımlılık-guard'lı `DELETE /:id/permanent` ucundan geçiyor;
  // fiyat satırı orada "kullanımda" sayılmaz, çünkü geçmiş belgeler tutarı
  // `InvoiceLine.unitPrice` / `Roll.purchasePrice` ile DONDURMUŞTUR — yani
  // cascade geçmişi değiştirmez, yalnız ölü bir varsayılanı temizler.
  "Customer <- ItemPrice.customer : Cascade": "cascade-intended — müşteri istisnası müşterisiz anlamsız",
  "Item <- ItemPrice.item : Cascade": "cascade-intended — fiyat kalemsiz anlamsız",
  "Customer <- CustomerStandaloneLabel.customer : Cascade": "cascade-intended — müşteri etiket konfigürasyonu",
  "Customer <- CustomerTemplateRoute.customer : Cascade": "cascade-intended — müşteri şablon yönlendirmesi",
  "Customer <- Route.customer : SetNull": "guarded (routeCount, A5 2026-07-31)",
  // 2026-08-19 — BİRLEŞTİRME SOY BAĞI (`mergedIntoId`). Sayım guard'ı BİLEREK
  // EKLENMEDİ ve SetNull doğru davranıştır:
  //   • Bu bir SAHİPLİK bağı değil, bir TARİHÇE işaretidir ("bu kayıt X'e
  //     birleşti"). Survivor bir gün kalıcı silinirse tombstone'un kendisi
  //     kaybolmamalı — yalnız kime birleştiği bilinmez olur.
  //   • Ters yön (tombstone'u silmek) FK'nın işi değil, servis katmanının:
  //     `master-data-merge.service` hiç DELETE yapmaz ve diriltme iki kapıda
  //     (`update` + `reactivate`) 400 ile reddedilir.
  //   • Sayım guard'ı eklemek, "birleştirilmiş kaydı olan müşteri silinemez"
  //     demek olurdu — oysa silinmesi gereken şey ZATEN tombstone değil,
  //     survivor'dır ve onun kendi bağları (sipariş/sevkiyat) zaten guard'lı.
  "Customer <- Customer.mergedInto : SetNull": "merge soy bağı — tarihçe işareti, sahiplik değil (bkz. yukarıdaki not)",
  "Item <- Item.mergedInto : SetNull": "merge soy bağı — tarihçe işareti, sahiplik değil",
  // ⚠️ Renk ve fason firma BU TARAMANIN DIŞINDA: ikisinin kalıcı silme ucu YOK,
  // bu yüzden `WATCHED` (uç keşfinden türer) onları kapsamaz. Soy bağları aynı
  // şekilde SetNull ama buraya yazılamaz — yazılsaydı "bayat satır" kontrolü
  // düşerdi. İkisine bir gün `/:id/permanent` eklenirse harita satırı eklenir ve
  // bekçi kendiliğinden genişler; o an renk için ÖZEL bir tehlike doğar:
  // `Roll.colorId` SetNull'dır ve `colorId IS NULL` bu sistemde "HAM KUMAŞ"
  // demektir, yani bir rengi silmek boyalı topları sessizce hama çevirir.
  "Customer <- Sack.customer : SetNull": "guarded (sackCount, 2026-07-15)",
  // Ticaret paketi (2026-08-13): firma TEDARİKÇİ rolündeyken mal kabul fişine
  // bağlanır; guard'sız silmede satın alma izi sessizce kopardı.
  "Customer <- GoodsReceipt.supplier : SetNull": "guarded (goodsReceiptCount, 2026-08-13)",
  // 2026-08-09 — `Roll.labelCustomerId`, `lastLabelSnapshot.customerId`'nin
  // SORGULANABİLİR aynası (sahiplik DEĞİL, basılmış kâğıdın izi).
  //
  // SetNull BİLİNÇLİ ve sayım guard'ı EKLENMEDİ: bu kolon bir BAĞ değil, bir
  // AYNADIR. Müşteri gerçekten kalıcı silindiyse (soft delete varsayılan;
  // hard delete zaten `/permanent` guard'ından geçiyor) aynanın boşalması
  // DOĞRUDUR — artık var olmayan bir müşteriye işaret etmemeli.
  //
  // ⚠️ Tarihsel kayıt KAYBOLMAZ: `lastLabelSnapshot` JSON'u o baskıdaki
  // müşteri id'sini ve ADINI taşımaya devam eder (snapshot tanım gereği
  // dondurulmuş kayıttır). Kaybolan yalnız FİLTRELENEBİLİRLİK — ki silinmiş
  // müşteriye göre filtrelemenin zaten bir anlamı yok.
  //
  // Guard eklemek TERS etki yapardı: "bu müşteriye 3 yıl önce etiket basılmış"
  // diye müşteri silmeyi bloklamak, silinemeyen müşteri yığını üretirdi.
  "Customer <- Roll.labelCustomer : SetNull": "ayna kolon — bağ değil; müşteri silinince aynanın boşalması doğru (snapshot JSON tarihsel kaydı korur)",
  "Device <- DevicePeripheral.device : Cascade": "guarded (pivotCount, A5 2026-07-31)",
  "Device <- PeripheralDevice.device : SetNull": "guarded (peripheralCount, A5 2026-07-31)",
  "Item <- CustomerItemAlias.item : Cascade": "cascade-intended — alias ürünsüz anlamsız",
  "Item <- ItemAllowedColor.item : Cascade": "cascade-intended — izin pivotu (pivot replace istisnası)",
  "Item <- ItemAllowedProperty.item : Cascade": "cascade-intended — izin pivotu",
  "Item <- WorkOrder.targetItem : SetNull": "guarded (woCount, A5 2026-07-31)",
  // --- 2026-09-12: uç keşfiyle İZLEMEYE GİREN altı model ---------------------
  // Makine: üretim atfı ve oturum geçmişi guard'lıdır (gerekçeler
  // `guarded-hard-remove.ts` MACHINE_DELETE_GUARDS başlığında). Tek bilinçli
  // istisna donanımdır: makine silinince donanım kaydı korunur, yalnız
  // ataması çözülür — `deleteTx` bunu AÇIKÇA yapar, FK'nın insafına bırakmaz.
  "Machine <- Device.machine : SetNull": "guarded (deviceCount) — eşlenmiş tablet yetim kalmasın",
  "Machine <- PeripheralDevice.machine : SetNull": "BİLEREK guard'sız — silmede machineId=null'a çekilir, donanım kaydı + COM/kalibrasyon ayarı korunur (deleteTx açıkça çözer)",
  "Machine <- Roll.createdMachine : SetNull": "guarded (rollCreatedCount) — KK1 giriş atfı",
  "Machine <- RollMovement.machine : SetNull": "guarded (rollMovementCount) — revokedAt süzülmez, geri alınmış hareket de üretim kanıtı",
  "Machine <- RollOperation.machine : SetNull": "guarded (rollOperationCount) — kurşun/QC2 damgası",
  // Dokuma P4 (2026-09-13). Cascade BİLİNÇLİ: künye makinesiz anlamsızdır.
  // ⚠️ Bu satır guard'ın YOKLUĞUNU beyan eder, VARLIĞINI değil — ve bugün doğru:
  // künyenin yazma yüzeyi yok, yani `baselineRunHours` (ERP öncesi çalışma saati
  // bakiyesi, ELLE girilen veri) hiç dolamaz. O yüzey açıldığı gün dolu bakiye
  // Cascade ile sessizce ölebilir hâle gelir ⇒ önizlemeye 409 guard'ı O DİLİMDE
  // eklenir ve bu satır "guarded"a döner. Guard, ihlal edebilecek ilk yüzeyle
  // birlikte doğar — öncesinde erişilemez bir dalı korurdu.
  // Dokuma P2b-1 (2026-09-13). Kapsam satırı makinesiz anlamsızdır — ve bu
  // Cascade veri KAYBETMEZ: hangi toplayıcının hangi makineye bastığı bir
  // YAPILANDIRMADIR, bir defter satırı değil. Makine silinirse o yapılandırma
  // da konusuz kalır. ⚠️ Duruş DEFTERİ ayrı ve `Restrict` — o silinmez.
  "Machine <- MachineCollectorLink.machine : Cascade": "cascade-intended — toplayıcı kapsamı makinesiz anlamsız (yapılandırma, defter değil)",
  "Machine <- MachineSpec.machine : Cascade": "cascade-intended — künye makinesiz anlamsız; bakiyesi dolu künye `machineSpecBaselineCount` guard'ıyla silmeyi durdurur (B3, 2026-09-14)",
  "Station <- PeripheralDevice.station : SetNull": "guarded (peripheralCount — stationId VEYA machine.stationId)",
  "Station <- Roll.entryStation : SetNull": "guarded (rollEntryStationCount, 2026-08-05) — makine damgası olmayan girişleri de kapsar",
  "Station <- StationColor.station : Cascade": "cascade-intended — istasyon renk yapılandırması istasyonsuz anlamsız",
  "Station <- StationProperty.station : Cascade": "cascade-intended — istasyon özellik pivotu",
  "Route <- RouteStep.route : Cascade": "cascade-intended — adım rotasız anlamsız; deleteTx ayrıca siler",
  "Route <- ProductRecipe.route : SetNull": "guarded (recipeCount, F211) — reçete rotasını sessizce kaybetmesin",
  "Route <- WorkOrder.routeTemplate : SetNull": "guarded (woCount) — şablondan üretilmiş WO soy izi korunur",
  "ProductRecipe <- ProductRecipeProperty.recipe : Cascade": "cascade-intended — reçete özellik pivotu; deleteTx ayrıca siler",
  "Warehouse <- WarehouseMovement.fromWarehouse : SetNull": "guarded (movementCount — from VEYA to)",
  "Warehouse <- WarehouseMovement.toWarehouse : SetNull": "guarded (movementCount — from VEYA to)",
  "DefectType <- RollError.defectType : SetNull": "guarded (rollErrorCount, F39) — mükerrer-hata partial unique'i devre dışı kalmasın",
};

// =============================================================================
// §C/§D — şema taraması (ilişki + FK kolonu)
// =============================================================================

interface Relation {
  target: string;
  source: string;
  field: string;
  columns: string[];
  effective: string;
}

function scanSchema(): Relation[] {
  const schema = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
  const modelRe = /^model (\w+) \{([\s\S]*?)^\}/gm;
  const found: Relation[] = [];
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(schema))) {
    const source = m[1];
    for (const line of m[2].split("\n")) {
      // Yalnız FK-sahibi taraf (fields: [...] içeren @relation) — ters taraf listelenmez.
      const rel = line.match(/^\s*(\w+)\s+(\w+)(\?)?\s+.*@relation\(([^)]*fields:\s*\[[^\]]*\][^)]*)\)/);
      if (!rel) continue;
      const [, field, target, opt, attrs] = rel;
      const onDelete = attrs.match(/onDelete:\s*(\w+)/)?.[1];
      // Prisma efektif varsayılanı: opsiyonel ilişki → SetNull, zorunlu → Restrict.
      const effective = onDelete ?? (opt ? "SetNull" : "Restrict");
      const columns = (attrs.match(/fields:\s*\[([^\]]*)\]/)?.[1] ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      found.push({ target, source, field, columns, effective });
    }
  }
  return found;
}

function wipingKeys(relations: Relation[]): string[] {
  return relations
    .filter((r) => WATCHED.has(r.target) && (r.effective === "SetNull" || r.effective === "Cascade"))
    .map((r) => `${r.target} <- ${r.source}.${r.field} : ${r.effective}`)
    .sort();
}

const camel = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** `MACHINE_DELETE_GUARDS` satırlarının saydığı `<model>.<kolon>` kümesi. */
function machineGuardTargets(): string[] {
  // Yorumlar SÖKÜLÜR: yorumlanmış guard satırı "var" sayılmamalı (negatif sonda).
  const src = yorumlariSok(fs.readFileSync(GUARD_FILE, "utf8"));
  const block = src.match(/const MACHINE_DELETE_GUARDS[\s\S]*?\n\];/)?.[0] ?? "";
  const out: string[] = [];
  const countRe = /prisma\.(\w+)\.count\(\{\s*where:\s*\{\s*(\w+):/g;
  let m: RegExpExecArray | null;
  while ((m = countRe.exec(block))) out.push(`${m[1]}.${m[2]}`);
  return out.sort();
}

/** Machine'e gelen ama BİLEREK sayılmayan FK kolonları — iki yönlü denetlenir. */
const MACHINE_GUARD_EXEMPT: Record<string, string> = {
  "peripheralDevice.machineId":
    "donanım BLOKLAMAZ: silmede machineId=null'a çekilir (kayıt + ayar korunur, atamasız boşa çıkar)",
  // Dokuma P2b-1 (2026-09-13) — ikisi de YAZMA YÜZEYİ olmadan indi.
  // ⚠️ `machineStopEvent.machineId` `Restrict`tir ve duruş bir DEFTERDİR: guard
  // GEREKLİ olacak (aksi hâlde operatör okunabilir 409 yerine ham P2003 görür,
  // `machineSpec`te ÖLÇÜLEN davranış). Bugün eklenmedi çünkü duruş yazan hiçbir
  // uç yok ⇒ sayaç her zaman 0 döner ve guard erişilemez bir dalı korur.
  // ⇒ Duruş yazma ucunu (ingest) açan dilim bu satırı SİLER ve
  //   `MACHINE_DELETE_GUARDS`a `machineStopCount` ekler.
  "machineStopEvent.machineId":
    "duruş defteri henüz yazılmıyor; `machineStopCount` guard'ı ingest dilimiyle gelecek (Restrict ⇒ o gün ZORUNLU)",
  "machineCollectorLink.machineId":
    "kapsam satırı Cascade ile birlikte ölür — yapılandırmadır, defter değil; sayım guard'ı gerekmez",
};

// =============================================================================

function checkEndpointMap(endpoints: Endpoint[]): void {
  // Körlük zemini: keşif hiç uç bulamazsa "0 ihlal" yeşili YANILTICIDIR.
  check(`route keşfi uç buldu (${endpoints.length} kalıcı silme ucu)`, endpoints.length > 0);

  const discovered = endpoints.map((e) => e.key).sort();
  const mapped = Object.keys(ENDPOINT_TARGETS).sort();
  const unmapped = discovered.filter((k) => !(k in ENDPOINT_TARGETS));
  const stale = mapped.filter((k) => !discovered.includes(k));

  check(
    "keşfedilen her ucun haritada karşılığı var (yeni uç kör kalmıyor)",
    unmapped.length === 0,
    unmapped.length
      ? `haritasız uç: ${unmapped.join(" | ")} → ENDPOINT_TARGETS'a modeli (ya da gerekçeli null) yaz`
      : "",
  );
  check(
    "haritadaki her uç hâlâ route'ta duruyor (bayat satır yok)",
    stale.length === 0,
    stale.length ? `route'tan kaybolmuş: ${stale.join(" | ")}` : "",
  );
}

function checkTombstoneAnchors(): void {
  const tombstones = Object.entries(ENDPOINT_TARGETS)
    .filter(([, model]) => model === null)
    .map(([key]) => key);
  check(
    "her mezar taşı ucunun çapası tanımlı",
    tombstones.every((k) => k in TOMBSTONE_ANCHORS),
    tombstones.filter((k) => !(k in TOMBSTONE_ANCHORS)).join(" | "),
  );

  for (const key of tombstones) {
    const anchor = TOMBSTONE_ANCHORS[key];
    if (!anchor) continue;
    const src = yorumlariSok(
      fs.readFileSync(path.join(ROOT, "src/services", anchor.service), "utf8"),
    );
    const physical = new RegExp(`(prisma|tx)\\.${anchor.model}\\.delete(Many)?\\(`).test(src);
    check(
      `${anchor.service}: ${anchor.model} fiziksel silmesi yok (uç mezar taşı yazıyor)`,
      !physical,
      physical
        ? "uç artık GERÇEKTEN siliyor → ENDPOINT_TARGETS'ta modeli izlemeye al, EXPECTED satırlarını yaz"
        : "",
    );
  }
}

function checkWipingInventory(relations: Relation[]): void {
  const found = wipingKeys(relations);
  check(
    `şema tarandı, izlenen ${WATCHED.size} modele gelen SetNull/Cascade bulundu (${found.length} bağ)`,
    found.length > 0,
  );

  const missing = Object.keys(EXPECTED)
    .sort()
    .filter((k) => !found.includes(k));
  const unexpected = found.filter((k) => !EXPECTED[k]);

  check(
    "beklenen envanterin tamamı şemada duruyor (bayat satır yok)",
    missing.length === 0,
    missing.length ? `şemadan kaybolmuş: ${missing.join(" | ")}` : "",
  );
  check(
    "şemada ALLOWLIST-DIŞI SetNull/Cascade yok (yeni delik yok)",
    unexpected.length === 0,
    unexpected.length
      ? `karar bekleyen yeni ilişki: ${unexpected.join(" | ")} → ya guard'a sayım ekle ya EXPECTED'e gerekçeyle yaz`
      : "",
  );
}

function checkMachineGuards(relations: Relation[]): void {
  const machineFks = relations
    .filter((r) => r.target === "Machine")
    .flatMap((r) => r.columns.map((c) => `${camel(r.source)}.${c}`))
    .sort();
  const guards = machineGuardTargets();

  // Körlük zemini: guard bloğu okunamazsa alt küme kontrolü vakumen yeşil kalırdı.
  check(`MACHINE_DELETE_GUARDS okundu (${guards.length} sayım satırı)`, guards.length > 0);
  check(`Machine'e gelen FK kolonları bulundu (${machineFks.length})`, machineFks.length > 0);

  const uncovered = machineFks.filter((f) => !guards.includes(f) && !MACHINE_GUARD_EXEMPT[f]);
  check(
    "Machine'e gelen her FK ya guard'da sayılıyor ya muaf listesinde gerekçeli",
    uncovered.length === 0,
    uncovered.length
      ? `sayımsız FK: ${uncovered.join(" | ")} → MACHINE_DELETE_GUARDS'a satır ekle (Restrict ise ham P2003 yerine Türkçe 409) ya da MACHINE_GUARD_EXEMPT'e gerekçe yaz`
      : "",
  );

  const deadGuards = guards.filter((g) => !machineFks.includes(g));
  check(
    "her guard satırı gerçek bir Machine FK kolonunu sayıyor (ölü guard yok)",
    deadGuards.length === 0,
    deadGuards.length ? `artık FK olmayan sayım: ${deadGuards.join(" | ")}` : "",
  );

  const deadExempt = Object.keys(MACHINE_GUARD_EXEMPT).filter((e) => !machineFks.includes(e));
  check(
    "her muaf satır hâlâ gerçek bir FK (ölü muaf yok)",
    deadExempt.length === 0,
    deadExempt.length ? `ölü muaf: ${deadExempt.join(" | ")}` : "",
  );
}

function main() {
  const endpoints = discoverPermanentEndpoints();
  const relations = scanSchema();

  console.log("\n--- §A Kalıcı silme uçları (route keşfi) ---");
  for (const e of endpoints) {
    const target = e.key in ENDPOINT_TARGETS ? ENDPOINT_TARGETS[e.key] : "HARİTASIZ";
    console.log(`  ${e.key} → ${target ?? "mezar taşı (izlenmez)"}`);
  }
  checkEndpointMap(endpoints);

  console.log("\n--- §B Mezar taşı çapaları ---");
  checkTombstoneAnchors();

  console.log(`\n--- §C İzlenen modeller: ${[...WATCHED].sort().join(", ")} ---`);
  checkWipingInventory(relations);

  console.log("\n--- §D Machine guard alt küme ölçümü ---");
  console.log(`  muaf: ${Object.keys(MACHINE_GUARD_EXEMPT).join(", ") || "(yok)"}`);
  checkMachineGuards(relations);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
