# Envanter → Fasonda Görünürlüğü — Uygulama Spec'i

> **Durum:** ONAYLI, uygulama bekliyor · **Tarih:** 2026-07-29 · **Hazırlayan:** Claude Fable 5 (çok-ajanlı spec + çapraz doğrulama)
> **Kapsam:** SADECE aşağıdaki 3 madde. Şema değişikliği YOK, tüm backend işi salt-okur. Kanban ve Envanter Özeti Excel'i geliştirmek KAPSAM DIŞI.

## Kapsam ve onaylı UX

Kullanıcının derdi: "hangi fasonda şu an ne kadar malım var — envanter ekranında göreyim". Onaylı çözüm (**Tek sekme + özet kartları**):

1. **Özet şeridi** (Fasonda sekmesi üstü): işlem-tipi chip'leri (Tümü/Boyahane/Zımpara… her biri top adedi + Σmetre) + firma kartları (firma adı, top adedi, Σmetre, "en eski N gün"); chip/karta tıklayınca liste süzülür.
2. **Tabloya iki sütun:** "İşlem" (fason kategorisi) + "Fason Firması"; firma/kategori filtresi çalışır.
3. **Top detay paneli** (RollDetailSheet): AT_SUBCONTRACTOR topu için fason kartı (firma + sevk no + sevk tarihi + işlem) — AT_KARTELA "Kartela Fasonu" kartı emsal.

```text
Envanter ▸ [Depoda] [Fasonda] [Sevk...]
 İşlem: (Tümü 66 top·5.810m) (Boyahane 54·4.830m) (Zımpara 12·980m)

 ┌─ Yılmaz Boya ─────┐ ┌─ Demir Zımpara ──┐ ┌─ Ak Yıkama ─────┐
 │ 42 top · 3.850 m  │ │ 12 top · 980 m   │ │ 12 top · 980 m  │
 │ en eski: 12 gün   │ │ en eski: 4 gün   │ │ en eski: 2 gün  │
 └───────────────────┘ └──────────────────┘ └─────────────────┘
   ↑ karta tıkla → liste o firmaya süzülür

 Barkod  Kumaş   Renk      Metre  İşlem     Fason Firması  Gün
 R-1041  Süprem  Lacivert  118    Boyahane  Yılmaz Boya    12
```

## Uygulayıcı için bağlayıcılık sırası

Çelişki halinde öncelik: **(1) Bölüm A nihai API sözleşmesi → (2) Bölüm B bağlayıcı düzeltmeler → (3) Bölüm C/D spec metinleri.** Spec'lerdeki satır numaraları yazım anındaki snapshot'tır — uygulamada satır numarası değil ÇAPA METİNLERİ (sabit/fonksiyon adları: `ROLL_LIST_INCLUDE`, `buildRollWhere`, `kartelaDispatchItems`, `buildRollForceFilters`…) esas alınır. Önerilen uygulama sırası: backend (Değişiklik 1→4) → frontend (tip → kolon → şerit → detay kartı) → testler.

---

# BÖLÜM A — Nihai API sözleşmesi (iki taraf da birebir buna uyar)

```ts
// ============================================================================
// NİHAİ API SÖZLEŞMESİ — Envanter "Fasonda" fason görünürlüğü
// (backend esas alındı; frontend ihtiyacı olan `total` alanı eklendi.
//  İki taraf da BİREBİR buna uyar — alan adları/nullability pazarlıksız.)
// ============================================================================

// ----------------------------------------------------------------------------
// 1) GET /api/rolls  (+ GET /api/rolls/stats, POST /api/rolls/stats-batch)
//    MEVCUT uçlar. İzin: requireAnyPermission("roll:read", ...MOBILE_ROLL_READ).
//    İki YENİ query param (opsiyonel, AND ile kesişir; offset + cursor modunda
//    ve stats/stats-batch filters objesinde de geçerli — buildRollWhere paylaşımı):
//      filter[subcontractorId]=<uuid>
//        → AÇIK (dönmemiş) fason sevk kalemi bu firmada olan toplar
//      filter[subcontractorCategoryId]=<uuid>
//        → açık kalemin adımının WorkOrderStep.requiredCategoryId'si bu olan toplar
//    "Açık kalem" tanımı (F85, üç yüzeyde ortak): dispatch.cancelledAt IS NULL
//    AND dispatch.directShippedAt IS NULL AND aktif (iptalsiz) receipt-item'ı YOK.
// ----------------------------------------------------------------------------

/** Liste (ROLL_LIST_INCLUDE) VE detay (findRollById) Roll satırına eklenen alan.
 *  Prisma relation adı: `dispatchItems` (schema.prisma:994). */
interface RollSubcontractDispatchInfo {
  /** 0 | 1 eleman (take:1, orderBy createdAt desc) — topun AÇIK son fason sevk
   *  kalemi. BOŞ dizi = fasonda değil / dönmüş / açık kalemi yok (anomali).
   *  receipt-none koşulu sayesinde dönmüş topta DAİMA boş — yine de UI
   *  hücre/kartlarda status === "AT_SUBCONTRACTOR" guard'ı savunma amaçlı korur. */
  dispatchItems: Array<{
    dispatch: {
      dispatchNo: string;                 // "SD-YYMM-NNNNNN"
      dispatchedAt: string;               // ISO (JSON serileşmiş Date)
      subcontractor: {
        id: string;
        name: string;
        code: string;                     // şemada NOT NULL (@unique) — null DEĞİL
      };
      step: {
        /** null = adımın requiredCategoryId'si yok → UI "—" */
        requiredCategory: { id: string; name: string } | null;
      };
    };
  }>;
}
// GET /api/rolls           → PaginatedResponse<Roll & RollSubcontractDispatchInfo>
//                            (cursor modunda CursorPaginatedResponse<...>; zarflar değişmez)
// GET /api/rolls/:id       → ApiResponse<Roll & RollSubcontractDispatchInfo & mevcut detay alanları>
// getProductionFlow (Kanban) aynı include'u paylaşır → fason kolonu önizlemesi de taşır.

// ----------------------------------------------------------------------------
// 2) GET /api/rolls/subcontractor-summary  — YENİ uç (param/body YOK)
//    İzin: requireAnyPermission("roll:read", ...MOBILE_ROLL_READ)
//    Route sırası: MUTLAKA router.get("/:id", ...) ÖNCESİNE kaydedilir.
//    Evren: status = AT_SUBCONTRACTOR + FIRE-hariç (liste default'uyla hizalı:
//    qualityGrade IS NULL OR qualityGrade <> 'FIRE'). Bilinçli kenar:
//    filter[includeFire]=true toggle'ı listeyi etkiler, şeridi ETKİLEMEZ.
//    Her top tam BİR (bySubcontractor, byCategory) grubuna düşer;
//    total = Σ byCategory = Σ bySubcontractor.
// ----------------------------------------------------------------------------

/** Cevap: ApiResponse<RollSubcontractorSummary> → { success: true, data: {...} } */
export interface RollSubcontractorSummary {
  /** Evren toplamı — frontend "Tümü" chip'i + boş-durum gate'i bunu okur. */
  total: {
    rollCount: number;
    /** Σ currentQty (mt), 1 ondalık yuvarlanmış. */
    totalQty: number;
  };
  /** Firma kartları. subcontractorId === null → açık sevk kalemi bulunamayan
   *  AT_SUBCONTRACTOR top (veri anomalisi) = "Bilinmiyor" kartı; bu kart
   *  UI'da DISABLED (filter[subcontractorId] ile süzülemez). */
  bySubcontractor: Array<{
    subcontractorId: string | null;
    name: string;                     // null grupta backend "Bilinmiyor" üretir
    code: string | null;              // yalnız null grupta null
    rollCount: number;
    totalQty: number;                 // 1 ondalık
    oldestDispatchedAt: string | null; // ISO; null yalnız "Bilinmiyor" grubunda
    /** En eski açık sevkin yaşı — gün, floor((now-dispatchedAt)/86400000), min 0.
     *  Frontend BUNU basar ("en eski N gün"); yeniden HESAPLAMAZ.
     *  null iken satır gizlenir. */
    oldestDays: number | null;
  }>;
  /** İşlem-tipi chip'leri. categoryId === null → kategorisiz adım + anomali
   *  toplamı, name backend'den "Bilinmiyor" gelir; chip DISABLED (filtrelenemez). */
  byCategory: Array<{
    categoryId: string | null;
    name: string;
    rollCount: number;
    totalQty: number;                 // 1 ondalık
  }>;
}

// ----------------------------------------------------------------------------
// Frontend bağlayıcı notlar (nihai):
//  - service.ts tipleri bu şekle birebir uyar: `byFirm`→`bySubcontractor`,
//    `id`→`subcontractorId`/`categoryId`, `FasonSummary.total` backend'den gelir;
//    "Diğer" etiketi KULLANILMAZ (name alanı backend'den basılır).
//  - FasonSummaryStrip: daysSince/date-fns hesabı YOK → `oldestDays` doğrudan;
//    subcontractorId===null kart ve categoryId===null chip disabled.
//  - Chip/kart tıklaması URL'e filter[subcontractorId] / filter[subcontractorCategoryId]
//    yazar — FilterBar lookup dropdown'ları ile AYNI anahtarlar (tek URL state).
//  - service.test.ts mock payload'u bu şekille (total + bySubcontractor + byCategory) kurulur.
// Backend bağlayıcı notlar (nihai):
//  - Özet SQL `base` CTE'sine FIRE-hariç koşulu eklenir; test senaryosu 8 aynı
//    FIRE-hariç where ile doğrular.
//  - total servis katmanında Σ byCategory olarak hesaplanıp cevaba yazılır.
// ----------------------------------------------------------------------------
```

---

# BÖLÜM B — Bağlayıcı düzeltmeler (çapraz doğrulama çıktısı)

Aşağıdaki maddeler Bölüm C/D spec metinlerini **ezer**:


**B1.** SÖZLEŞME UYUŞMAZLIĞI (özet ucu response şekli): Backend `{ bySubcontractor: [{subcontractorId, name, code, rollCount, totalQty, oldestDispatchedAt, oldestDays}], byCategory: [{categoryId, ...}] }` dönerken frontend `{ total: {rollCount,totalQty}, byCategory: [{id,...}], byFirm: [{id: string (non-null), ..., oldestDispatchedAt: string (non-null)}] }` bekliyor. DÜZELTME (backend esas + frontend ihtiyacı tamamlandı): alan adları `bySubcontractor`/`byCategory`, anahtarlar `subcontractorId`/`categoryId` (frontend'in `byFirm`/`id` adlandırması TERK edilir); backend cevaba `total: { rollCount, totalQty }` alanı EKLENİR (Σ byCategory, servis map'inde hesaplanır — frontend `data.total.rollCount === 0` gate'i ve 'Tümü' chip'i bunu okur). Frontend'in `FasonSummaryFirm.id: string` ve `oldestDispatchedAt: string` non-null tipleri YANLIŞ: 'Bilinmiyor' satırında `subcontractorId: null` ve `oldestDispatchedAt/oldestDays: null` gelir → firma kartı `subcontractorId === null` iken disabled (tıklanamaz) çizilmeli, 'en eski N gün' satırı `oldestDays === null` iken gizlenmeli. Frontend service.ts tipleri, FasonSummaryStrip ve service.test.ts mock payload'u nihai sözleşme şekline göre yeniden yazılacak.


**B2.** SÖZLEŞME UYUŞMAZLIĞI (gün hesabı çifte kaynak): Backend `oldestDays` alanını hazır gönderiyor (getOpenDispatches daysOpen kopyası, floor + max 0); frontend spec bunu yok sayıp date-fns `differenceInCalendarDays` ile YENİDEN hesaplıyor (farklı semantik: takvim günü vs 24saat-floor → sınır saatlerinde ±1 gün sapar). DÜZELTME: frontend backend'in `oldestDays` alanını DOĞRUDAN kullanır; `daysSince`/date-fns import'u FasonSummaryStrip'ten çıkarılır.


**B3.** SÖZLEŞME UYUŞMAZLIĞI (null-kategori etiketi): Frontend kategorisiz kovaya `name: "Diğer"` adını veriyor; backend `name ?? "Bilinmiyor"` üretiyor. DÜZELTME: isim backend'den gelir (`"Bilinmiyor"`), frontend name alanını olduğu gibi basar; iki spec'in ortak kararı korunur: `categoryId === null` chip'i disabled (filtrelenemez).


**B4.** KODA KARŞI YANLIŞ İDDİA (FIRE evreni — frontend): Frontend spec özet ucunu "Evren: AT_SUBCONTRACTOR + default FIRE-hariç (liste default'uyla hizalı)" diye belgeliyor ama backend spec'in SQL'inde FIRE dışlaması YOK. Kod doğrulaması: liste default'u gerçekten FIRE-hariç — `buildRollWhere` (Teks-Erp/src/services/inventory.service.ts:717-734) `qualityGrade` filtresi/`includeFire=true` yoksa `{ OR: [{qualityGrade: null},{qualityGrade:{not:"FIRE"}}] }` uygular; RollsPage'de "Fire kaliteyi de göster" toggle'ı Fasonda sekmesinde de görünür (RollsPage.tsx:170-177,239). Şerit tablo üstünde filtre kumandası olduğundan sayılar default görünümle EŞLEŞMELİ. DÜZELTME (backend değişir): özet SQL'inin `base` CTE'sine `AND (r."qualityGrade" IS NULL OR r."qualityGrade" <> 'FIRE')` eklenir; backend test senaryosu 8 de aynı FIRE-hariç where ile sayar (`prisma.roll.count({where:{status:"AT_SUBCONTRACTOR", OR:[{qualityGrade:null},{qualityGrade:{not:"FIRE"}}]}})`). Bilinçli kabul edilen kenar: kullanıcı `filter[includeFire]=true` açarsa liste FIRE topları gösterir ama şerit sayıları FIRE-hariç kalır (fasonda FIRE topu istisnai; şerit koduna yorum düşülür).


**B5.** KODA KARŞI YANLIŞ İDDİA (subcontractor.code nullability): Frontend `RollActiveDispatch.subcontractor.code: string | null` ve backend özet SQL tipi null'lı; ama şemada `Subcontractor.code String @unique` NULLABLE DEĞİL (schema.prisma:2089). DÜZELTME: dispatch include sözleşmesinde `code: string` (backend spec zaten doğru); özette yalnız 'Bilinmiyor' LEFT JOIN satırında `code: null` mümkün → orada `string | null` doğru. Frontend'in include tarafında `string | null` yazması zararsız (kartelaDispatchItems ev stili emsali, types.ts:62-69) — kalabilir ama null yalnız savunmacıdır.


**B6.** KODA KARŞI BAYAT YORUM (frontend types.ts eklentisi): Frontend spec `dispatchItems` alanını "Statüsü fasondan çıkmış toplarda da dolu GELEBİLİR — aktiflik = sevk iptal edilmemiş" diye belgeliyor. Backend'in nihai include'unda `receiptItems: { none: { receipt: { cancelledAt: null } } }` koşulu VAR → fasondan dönmüş topta dizi BOŞ döner; yorum kartela-emsalinin eski (receipt-none'suz) varsayımına dayanıyor. DÜZELTME: yorum "Açık (dönmemiş) son fason sevk kalemi — dönmüş topta boş dizi; hücre/karttaki status===AT_SUBCONTRACTOR guard'ı yine de savunma amaçlı korunur (anlık status-geçiş/bayat cache)" şeklinde güncellenir; kolon hücrelerindeki ve detay kartındaki status guard'ları KALIR (zararsız, savunmacı).


**B7.** DOĞRULANAN KRİTİK İDDİALAR (çelişki yok — uygulayıcı için teyit): (1) Kolon mimarisi: TÜM sekmeler tek `rollColumns`'ı paylaşır; `useDataTable` `initialVisibility` opsiyonu mevcut (Electron/src/hooks/useDataTable.ts:37) ve kullanıcı tercihi onu ezer (`{...initialVisibility, ...prefs.tableVisibility[queryKey]}`, satır 88-95) — frontend'in sekme-başına default-gizli planı koda uygun; KartelaPage da aynı kolonları kullanır (KartelaPage.tsx:94-102), oradaki initialVisibility eklemesi gerekli. (2) `buildRollForceFilters` (Electron Rolls/service.ts:157-181): SUBCONTRACTOR sekmesi yalnız `{status:"AT_SUBCONTRACTOR"}` gönderir; `KARTELA_SENT` (AT_KARTELA) ayrı sanal anahtar, Fasonda sekmesine GİRMEZ (service.ts:37-51) — backend spec'in sekme iddiası doğru. (3) `buildWhereClause` (Teks-Erp/src/utils/query-parser.ts:116-141) her filter anahtarını düz kolon olarak where'e kopyalar → backend Değişiklik 3'teki `delete where.subcontractorId` / `delete where.subcontractorCategoryId` ŞART (markedForKartela emsali inventory.service.ts:870-874, `return where` 876). (4) Kartela include deseni birebir doğrulandı (findRollById 1285, kartelaDispatchItems 1321-1334, `where:{dispatch:{cancelledAt:null}}, take:1`); ROLL_LIST_INCLUDE 300-313, getProductionFlow paylaşımı 1010. (5) F85 açık-kalem tanımı doğrulandı (reports/subcontract.report.service.ts:110-160: cancelledAt null + directShippedAt null + iptalsiz receipt-item yok; daysOpen floor formülü 159-160); Prisma receipt-none emsali subcontractor.service.ts:2576; raw SQL `r.status = 'AT_SUBCONTRACTOR'` enum-literal emsali ~2634-2644. (6) İzin kalıbı doğrulandı: /stats (routes 215), /warehouse-scope (271-273), /:id (296) hepsi `requireAnyPermission("roll:read", ...MOBILE_ROLL_READ)`; yeni route'un /:id ÖNCESİNE konması gerekliliği route sırasından doğru. (7) `Prisma` değer olarak import'lu (inventory.service.ts:70) → `Prisma.sql` kullanılabilir; Roll'da `@@index([status, createdAt])`, dispatch_items `@@index([rollId])` (schema:1876), receipt_items `@@index([sourceDispatchItemId])` (schema:2043) mevcut. (8) useRollStats aynı URL filtrelerini okur (useRollStats.ts:14-21) → chip'in URL'e yazması tabloyu VE Top/Metre özetini birlikte süzer; şerit queryKey'i `["rolls",...]` prefix'i invalidation'a uyumlu. (9) FilterBar LookupFilter `getAll({filters:{isActive:"true"}})` çağırır (FilterBar.tsx:363-375); `subcontractorService` ve `subcontractorCategoryService` createCrudService ile mevcut. (10) columns.tsx zaten `RollStatus` (satır 7) ve `Badge` (satır 4) import ediyor — yeni import satırına yalnız `activeDispatchOf` eklenecek; RollDetailSheet lucide satırına (satır 3) `Send` eklenmeli, `Palette` oradan zaten geliyor.


**B8.** KÜÇÜK SATIR-REFERANS DÜZELTMELERİ: Backend spec 'Electron Rolls/service.ts:36-50' → gerçek konum 37-51 (STATUS_GROUPS); backend spec '/warehouse-scope bloğu 270-275' → route çağrısı 271-275; frontend spec 'SHIPMENT_SCOPE_FILTER 52-62' → gerçek ~53-63, 'buildRollFilterDefs 65-67' → ~66-68. Uygulayıcı satır numaralarını değil çapa metinlerini (sabit/fonksiyon adları) esas almalı.


**B9.** KAPSAM DENETİMİ: Gerçek kapsam sızıntısı YOK. Sınırda ama gerekçeli kalemler: (a) KartelaPage initialVisibility eklemesi — paylaşılan rollColumns'un zorunlu regresyon-önleme sonucu, kapsam içi; (b) RollsPage selectTab'ın sekme değişiminde fason filtrelerini URL'den temizlemesi — filtre mekanizmasının zorunlu hijyeni, kapsam içi; (c) getProductionFlow/Kanban'ın ROLL_LIST_INCLUDE paylaşımıyla dispatchItems'ı 'bedavaya' kazanması — yeni özellik değil, paylaşılan include'un yan etkisi (RollDetailSheet fallback'i bundan yararlanır); (d) FasonSummaryStrip'teki 30+ gün amber rengi — madde 1'in ('en eski N gün') görsel detayı, kapsam içi. Her iki spec de şema değişikliği içermiyor ve backend işi salt-okur — kapsam kuralına uygun.


---

# BÖLÜM C — Backend spec

# Backend Spec — Envanter "Fasonda" sekmesi fason görünürlüğü

Depo kökü: `/Users/oad/Documents/projeler/AdnanSahin/Teks-Erp`. Tüm iş salt-okur, şema değişikliği YOK. Sekme bağlamı (doğrulandı): Electron `src/pages/Operations/Rolls/service.ts:36-50` — "Fasonda" sekmesi = `SUBCONTRACTOR: "AT_SUBCONTRACTOR"`, yani backend'e `filter[status]=AT_SUBCONTRACTOR` gelir. `AT_KARTELA` ayrı sanal anahtar (`KARTELA_SENT`, yalnız Kartela sayfası kullanır) → bu sekmeye GİRMEZ; ayrıca özet ucu da `status='AT_SUBCONTRACTOR'` süzer, kartela toplarına hiç dokunmaz.

**Ortak "açık kalem" tanımı (tek doğruluk kaynağı, F85 — `src/services/reports/subcontract.report.service.ts:109-148`):** bir `SubcontractorDispatchItem` şu üç koşulu birden sağlıyorsa AÇIKTIR: (1) `dispatch.cancelledAt IS NULL`, (2) `dispatch.directShippedAt IS NULL`, (3) aktif (iptalsiz) receipt-item'ı YOK (`receiptItems none { receipt: { cancelledAt: null } }`). Aşağıdaki 3 yüzey (liste include'u, liste filtresi, özet ucu) bu tanımı BİREBİR paylaşır — sayılar birbirinden sapmaz. Aynı desenin canlı emsali: `subcontractor.service.ts:2573-2577` (`items: { some: { receiptItems: { none: { receipt: { cancelledAt: null } } } } }`).

**Kategori kaynağı kararı:** "İşlem" = `dispatch.step.requiredCategory` (`SubcontractorDispatch.stepId` zorunlu FK → `WorkOrderStep.requiredCategoryId` (nullable, `schema.prisma:1403`) → `SubcontractorCategory`). Gerekçe: (a) fason firmasının `categories` M:N'i firmanın *yeteneklerini* söyler, o sevkte hangi işlemin yapıldığını değil; (b) `step.requiredCategory` gerçekleşen sevkin adımına bağlıdır ve PK join'lerle en ucuz yoldur; (c) mobil pending-returns zaten aynı kaynağı okur (`subcontractor.service.ts:2564`). `requiredCategoryId` null olabilir → "Bilinmiyor" grubu (aşağıda D).

---

## Değişiklik 1 — `ROLL_LIST_INCLUDE`'a açık fason sevk kalemi

**Dosya:** `src/services/inventory.service.ts`, `ROLL_LIST_INCLUDE` sabiti (satır 300-313). `sack` satırından (312) sonra, `} as const;` kapanışından önce ekle:

```ts
  sack: { select: { id: true, sackNo: true, seq: true } },
  // Fasonda görünürlüğü: topun AÇIK (dönmemiş) son fason sevk kalemi — liste
  // "İşlem" + "Fason Firması" kolonlarını besler. Açık-kalem tanımı F85 ile
  // birebir (iptalsiz + doğrudan-sevksiz dispatch + aktif receipt-item'ı yok)
  // → dönmüş/eski topta dizi BOŞ döner; kartela emsalinden (findRollById
  // kartelaDispatchItems) farkı receipt-none koşulu: bu include TÜM sekmelerce
  // paylaşıldığı için dönmüş STOCK topunda bayat firma göstermemek ŞART.
  // take:1 → Prisma sayfa başına tek LATERAL sorgu (N+1 yok); rollId +
  // sourceDispatchItemId indeksli, anti-join ucuz.
  dispatchItems: {
    where: {
      dispatch: { cancelledAt: null, directShippedAt: null },
      receiptItems: { none: { receipt: { cancelledAt: null } } },
    },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      dispatch: {
        select: {
          dispatchNo: true,
          dispatchedAt: true,
          subcontractor: { select: { id: true, name: true, code: true } },
          step: { select: { requiredCategory: { select: { id: true, name: true } } } },
        },
      },
    },
  },
} as const;
```

**Görev tarifinden bilinçli sapma:** tarif "kartela emsalinin birebir uyarlaması — where {dispatch:{cancelledAt:null, directShippedAt:null}}" diyor; buna `receiptItems: { none: ... }` EKLENDİ. Kartela emsalinde frontend `status===AT_KARTELA` gate'i vardı; `ROLL_LIST_INCLUDE` ise tüm sekmelerin (Ham Stok, Depo, Arşiv, Kanban `getProductionFlow` satır 1010) ortak şekli — receipt-none olmadan fasondan dönmüş her top sonsuza dek son firmasını taşırdı. Ek koşul, Değişiklik 3/4'teki tanımla da birebir hizalar.

**Performans değerlendirmesi:** Prisma 5+ `take:1` relation load'u parent sayfası (≤500 satır) için TEK ek LATERAL sorgu üretir — N+1 yok. Yol: `subcontractor_dispatch_items @@index([rollId])` (schema 1876) → `subcontractor_dispatches` PK → `work_order_steps` PK; anti-join `subcontractor_receipt_items @@index([sourceDispatchItemId])` (schema 2043). Hiç sevk görmemiş toplar (Ham Stok çoğunluğu) rollId indeks miss'iyle anında düşer. `getProductionFlow` da bu include'u paylaşır → Kanban "Fason" kolonu önizlemesi bedavaya aynı veriyi kazanır. Regresyon ölçülürse B planı: include'u yalnız `AT_SUBCONTRACTOR` içeren isteklerde koşullu kurmak (şimdi GEREKMEZ).

## Değişiklik 2 — `findRollById` include'una aynı blok

**Dosya:** `src/services/inventory.service.ts`, `findRollById` (satır 1285), include objesi içinde `kartelaDispatchItems` bloğundan (1321-1334) sonra ekle:

```ts
        // AT_SUBCONTRACTOR top için açık (dönmemiş) fason sevk kalemi → detay
        // panelinde (RollDetailSheet) "Fasonda" kartı: firma + sevk no + sevk
        // tarihi + işlem. ROLL_LIST_INCLUDE.dispatchItems ile AYNI tanım (F85).
        dispatchItems: {
          where: {
            dispatch: { cancelledAt: null, directShippedAt: null },
            receiptItems: { none: { receipt: { cancelledAt: null } } },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            dispatch: {
              select: {
                dispatchNo: true,
                dispatchedAt: true,
                subcontractor: { select: { id: true, name: true, code: true } },
                step: { select: { requiredCategory: { select: { id: true, name: true } } } },
              },
            },
          },
        },
```

Not: Roll modelindeki relation alan adı `dispatchItems` (`schema.prisma:994`) — kartela kartının (`kartelaDispatchItems`) birebir kardeşi. Frontend AT_KARTELA kartı gibi `status===AT_SUBCONTRACTOR && dispatchItems[0]` ile render eder (dizi 0|1 eleman).

## Değişiklik 3 — `buildRollWhere`'e iki yeni filtre

**Dosya:** `src/services/inventory.service.ts`, `buildRollWhere` içinde `markedForKartela` bloğundan (870-874) SONRA, `return where;` (876) ÖNCESİNE ekle. (`delete where.X` şart: `buildWhereClause` — `src/utils/query-parser.ts:116-141` — her filter anahtarını düz kolon olarak kopyalar; Roll'da bu kolonlar yok → silinmezse Prisma validation 500 verir. Mevcut desenin aynısı.)

```ts
    // --- Fasonda görünürlüğü: firma + işlem (kategori) filtresi ---
    // "Açık sevk kalemi" tanımı F85 (getOpenDispatches) ile birebir: iptalsiz +
    // doğrudan-sevksiz dispatch'in aktif (iptalsiz) receipt-item'ı OLMAYAN
    // kalemi. subcontractor-summary ucu ve ROLL_LIST_INCLUDE.dispatchItems ile
    // AYNI küme → şerit/kolon/liste sayıları sapmaz. AND'e eklenir (status/
    // renk scope'larıyla kesişir); sekme tabanı (status=AT_SUBCONTRACTOR)
    // frontend forceFilters'tan ayrıca gelir.
    const subcontractorId =
      typeof f["subcontractorId"] === "string" && f["subcontractorId"]
        ? (f["subcontractorId"] as string)
        : null;
    delete where.subcontractorId;
    const subcontractorCategoryId =
      typeof f["subcontractorCategoryId"] === "string" && f["subcontractorCategoryId"]
        ? (f["subcontractorCategoryId"] as string)
        : null;
    delete where.subcontractorCategoryId;
    if (subcontractorId || subcontractorCategoryId) {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        {
          dispatchItems: {
            some: {
              dispatch: {
                cancelledAt: null,
                directShippedAt: null,
                ...(subcontractorId ? { subcontractorId } : {}),
                ...(subcontractorCategoryId
                  ? { step: { requiredCategoryId: subcontractorCategoryId } }
                  : {}),
              },
              receiptItems: { none: { receipt: { cancelledAt: null } } },
            },
          },
        },
      ];
    }
```

`buildRollWhere` paylaşımı sayesinde `GET /api/rolls` (offset + cursor mod), `GET /api/rolls/stats` ve `POST /api/rolls/stats-batch` bu filtreleri OTOMATİK kazanır — chip/karta tıklayınca üst-satır Top/Σmetre özeti de aynı süzgeçle döner, ek iş yok.

## Değişiklik 4 — Yeni özet ucu: servis metodu

**Dosya:** `src/services/inventory.service.ts`.

(4a) Interface — `RollStats` interface'inden (94-104) sonra ekle:

```ts
/** Fasonda özet şeridi — GET /api/rolls/subcontractor-summary cevabı. */
export interface RollSubcontractorSummary {
  /** Firma kartları. subcontractorId=null → açık sevk kalemi bulunamayan
   *  AT_SUBCONTRACTOR top (veri anomalisi) — "Bilinmiyor" kartı. */
  bySubcontractor: Array<{
    subcontractorId: string | null;
    name: string;
    code: string | null;
    rollCount: number;
    /** Σ currentQty (mt) — 1 ondalık (F85 yuvarlama kuralı). */
    totalQty: number;
    oldestDispatchedAt: Date | null;
    /** En eski açık sevkin yaşı (gün, floor) — "en eski N gün". */
    oldestDays: number | null;
  }>;
  /** İşlem-tipi chip'leri. categoryId=null → "Bilinmiyor" (kategorisiz adım + anomali).
   *  Her top tam BİR gruba düşer → "Tümü" chip'i = Σ byCategory. */
  byCategory: Array<{
    categoryId: string | null;
    name: string;
    rollCount: number;
    totalQty: number;
  }>;
}
```

(4b) Metot — `getWarehouseScope`'un kapanışından (satır 1280) sonra, `findRollById`'dan önce ekle:

```ts
  /**
   * Fasonda özet şeridi — AT_SUBCONTRACTOR topların firma + işlem (kategori)
   * bazlı dağılımı, TEK istekte iki dizi. Açık-kalem tanımı F85 ile birebir
   * (reports/subcontract getOpenDispatches): iptalsiz + doğrudan-sevksiz
   * sevkin, aktif (iptalsiz) receipt-item'ı OLMAYAN kalemi. base ROLL-driven
   * (1 satır/top) + DISTINCT ON en güncel açık kalemi seçer → fason→fason
   * transferde/anomalide çift sayım İMKANSIZ; açık kalemi bulunamayan top
   * null gruba düşer ("Bilinmiyor"). LIMIT bilinçli YOK: grup sayısı master
   * tablo kardinalitesiyle sınırlı (≤ firma/kategori sayısı + 1 ≈ onlar),
   * sevk hacmiyle büyümez — F85'in LIMIT 200'ü sevk-satırı listesi içindi.
   */
  async getRollSubcontractorSummary(): Promise<ApiResponse<RollSubcontractorSummary>> {
    // Paylaşılan CTE — rolls tarafı @@index([status, createdAt]), kalemler
    // @@index([rollId]), anti-join @@index([sourceDispatchItemId]) kullanır.
    const baseCte = Prisma.sql`
      open_items AS (
        SELECT DISTINCT ON (sdi."rollId")
          sdi."rollId"            AS "rollId",
          sd."subcontractorId"    AS "subcontractorId",
          sd."dispatchedAt"       AS "dispatchedAt",
          ws."requiredCategoryId" AS "categoryId"
        FROM rolls r
        JOIN subcontractor_dispatch_items sdi ON sdi."rollId" = r.id
        JOIN subcontractor_dispatches sd      ON sd.id = sdi."dispatchId"
        JOIN work_order_steps ws              ON ws.id = sd."stepId"
        WHERE r.status = 'AT_SUBCONTRACTOR'
          AND sd."cancelledAt" IS NULL
          AND sd."directShippedAt" IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM subcontractor_receipt_items sri
            JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
            WHERE sri."sourceDispatchItemId" = sdi.id
              AND sr."cancelledAt" IS NULL
          )
        ORDER BY sdi."rollId", sd."dispatchedAt" DESC, sdi."createdAt" DESC
      ),
      base AS (
        SELECT r.id, r."currentQty", oi."subcontractorId", oi."dispatchedAt", oi."categoryId"
        FROM rolls r
        LEFT JOIN open_items oi ON oi."rollId" = r.id
        WHERE r.status = 'AT_SUBCONTRACTOR'
      )
    `;

    const [firmRows, catRows] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          subcontractorId: string | null;
          name: string | null;
          code: string | null;
          rollCount: bigint;
          totalQty: number | null;
          oldestDispatchedAt: Date | null;
        }>
      >(Prisma.sql`
        WITH ${baseCte}
        SELECT
          b."subcontractorId"        AS "subcontractorId",
          s.name                     AS "name",
          s.code                     AS "code",
          COUNT(*)                   AS "rollCount",
          SUM(b."currentQty")::float AS "totalQty",
          MIN(b."dispatchedAt")      AS "oldestDispatchedAt"
        FROM base b
        LEFT JOIN subcontractors s ON s.id = b."subcontractorId"
        GROUP BY b."subcontractorId", s.name, s.code
        ORDER BY "rollCount" DESC, s.name ASC NULLS LAST
      `),
      prisma.$queryRaw<
        Array<{
          categoryId: string | null;
          name: string | null;
          rollCount: bigint;
          totalQty: number | null;
        }>
      >(Prisma.sql`
        WITH ${baseCte}
        SELECT
          b."categoryId"             AS "categoryId",
          c.name                     AS "name",
          COUNT(*)                   AS "rollCount",
          SUM(b."currentQty")::float AS "totalQty"
        FROM base b
        LEFT JOIN subcontractor_categories c ON c.id = b."categoryId"
        GROUP BY b."categoryId", c.name
        ORDER BY "rollCount" DESC, c.name ASC NULLS LAST
      `),
    ]);

    const now = Date.now();
    return {
      success: true,
      data: {
        bySubcontractor: firmRows.map((r) => ({
          subcontractorId: r.subcontractorId,
          name: r.name ?? "Bilinmiyor",
          code: r.code,
          rollCount: Number(r.rollCount),
          totalQty: Math.round(Number(r.totalQty ?? 0) * 10) / 10,
          oldestDispatchedAt: r.oldestDispatchedAt,
          oldestDays: r.oldestDispatchedAt
            ? Math.max(0, Math.floor((now - new Date(r.oldestDispatchedAt).getTime()) / 86_400_000))
            : null,
        })),
        byCategory: catRows.map((r) => ({
          categoryId: r.categoryId,
          name: r.name ?? "Bilinmiyor",
          rollCount: Number(r.rollCount),
          totalQty: Math.round(Number(r.totalQty ?? 0) * 10) / 10,
        })),
      },
    };
  }
```

Notlar: `Prisma.sql` fragment'ı iç içe interpolasyonu destekler (parametre değil SQL parçası olarak gömülür). `r.status = 'AT_SUBCONTRACTOR'` enum literal karşılaştırması bu depoda çalışan emsal (`subcontractor.service.ts:2644`). `COUNT(*)` bigint döner → `Number()` (F85 satır 77-93 deseni). `oldestDays` hesabı `getOpenDispatches` `daysOpen`'ın (satır 159) birebir kopyası.

## Değişiklik 5 — Controller

**Dosya:** `src/controllers/inventory.controller.ts`.

(5a) Constructor bind — satır 107 (`this.getWarehouseScope = ...`) sonrasına:

```ts
    this.getSubcontractorSummary = this.getSubcontractorSummary.bind(this);
```

(5b) Metot — `getWarehouseScope` (263-270) sonrasına:

```ts
  /**
   * GET /api/rolls/subcontractor-summary
   * Fasonda sekmesi özet şeridi — firma + işlem (kategori) bazlı açık fason dağılımı.
   */
  async getSubcontractorSummary(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getRollSubcontractorSummary();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
```

Body/param yok → Zod şeması gerekmez.

## Değişiklik 6 — Route kaydı + OpenAPI

**Dosya:** `src/routes/inventory.routes.ts`.

(6a) Yeni route — `/warehouse-scope` bloğundan (270-275) SONRA, **MUTLAKA `router.get("/:id", ...)` (satır 296) ÖNCESİNE** (Express sıra kuralı — aksi halde "subcontractor-summary" string'i UUID validasyonuna düşer, `/stats` ve `/warehouse-scope` ile aynı gerekçe):

```ts
/**
 * @openapi
 * /api/rolls/subcontractor-summary:
 *   get:
 *     tags: [Inventory]
 *     summary: Fasonda özeti — firma + işlem (kategori) bazlı açık fason dağılımı
 *     description: |
 *       AT_SUBCONTRACTOR topların TEK istekte iki dağılımı: `bySubcontractor`
 *       (firma kartları — top adedi, Σ metre, en eski açık sevk tarihi/yaşı) +
 *       `byCategory` (işlem chip'leri — top adedi, Σ metre). Açık kalem tanımı
 *       F85 ile aynı: iptalsiz + doğrudan-sevksiz sevkin aktif receipt-item'ı
 *       olmayan kalemi. Açık kalemi bulunamayan top null ("Bilinmiyor") grupta.
 *       "Tümü" chip'i = Σ byCategory (her top tam bir kez sayılır).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ bySubcontractor[], byCategory[] }"
 */
router.get(
  "/subcontractor-summary",
  verifyToken,
  requireAnyPermission("roll:read", ...MOBILE_ROLL_READ),
  controller.getSubcontractorSummary,
);
```

İzin gerekçesi: sekmenin liste/stat uçlarıyla (`/stats` satır 215, `/warehouse-scope` satır 270) aynı kalıp — `requireAnyPermission("roll:read", ...MOBILE_ROLL_READ)`.

(6b) `GET /api/rolls` OpenAPI parametre bloğuna, `filter[qtyMax]`'tan (118-122) sonra:

```ts
 *       - in: query
 *         name: filter[subcontractorId]
 *         schema: { type: string, format: uuid }
 *         description: |
 *           Açık (dönmemiş) fason sevk kalemi bu firmada olan toplar.
 *           Fasonda sekmesi firma kartı/filtresi — filter[status]=AT_SUBCONTRACTOR ile kullanılır.
 *       - in: query
 *         name: filter[subcontractorCategoryId]
 *         schema: { type: string, format: uuid }
 *         description: |
 *           Açık fason sevk kaleminin adım kategorisi (WorkOrderStep.requiredCategoryId)
 *           bu olan toplar. Fasonda sekmesi işlem chip'i/filtresi.
```

---

## D) Kenar durumlar (kararlar)

1. **AT_SUBCONTRACTOR ama açık kalemi yok (veri anomalisi):** Özette firma dizisinde `subcontractorId:null, name:"Bilinmiyor"` satırı, kategori dizisinde `categoryId:null` satırı olarak görünür (base roll-driven LEFT JOIN sayesinde toplam sayı sekme toplamıyla DAİMA eşit). Listede `dispatchItems` boş dizi döner → frontend "İşlem"/"Fason Firması" kolonlarında "—" gösterir. Bu toplar `filter[subcontractorId]` ile süzülemez ("Bilinmiyor" kartı tıklanamaz olmalı — frontend spec'ine not).
2. **Fason→fason transferde çift sayım yok — gerekçe:** (a) Özet: `base` CTE topu tabana alır (`FROM rolls WHERE status='AT_SUBCONTRACTOR'` → top başına TEK satır) ve `open_items` `DISTINCT ON (sdi."rollId") ... ORDER BY dispatchedAt DESC` ile top başına EN GÜNCEL tek açık kalemi seçer; iki fason arası geçişte önceki sevkin kalemi aktif receipt-item'la kapandığından zaten açık sayılmaz, kapanmamış olsa bile DISTINCT ON teke indirir. (b) Liste include'u `take:1 orderBy createdAt desc` aynı teke-indirmeyi yapar. (c) Liste sayımı top-bazlıdır (`some` relation filtresi topu bir kez döndürür).
3. **AT_KARTELA sekmeye girmiyor (doğrulandı):** Electron `Rolls/service.ts:36-50` — Fasonda sekmesi yalnız `status=AT_SUBCONTRACTOR` gönderir; `AT_KARTELA` Kartela sayfasının ayrı sanal anahtarı. Özet SQL'i de `r.status='AT_SUBCONTRACTOR'` süzer. Kartela sevk kayıtları apayrı tablolarda (`kartela_dispatch_*`) — bu sorgulara hiç değmez.
4. **Dönmüş topta bayat firma gösterimi:** `receiptItems none` koşulu sayesinde fasondan dönmüş (RETURNED_FROM_SUBCONTRACTOR/STOCK/WAREHOUSE) topların `dispatchItems`'ı boş döner — diğer sekmeler kirlenmez (kartela emsalindeki frontend-gate ihtiyacı burada yok).
5. **İptalli kabul:** `receipt.cancelledAt` dolu kabul kalemi "dönmüş" SAYILMAZ (F85 kuralı) → kabulü iptal edilip AT_SUBCONTRACTOR'a dönen top hem listede hem özette yeniden doğru firmada görünür.

## E) Test — kabul senaryoları

Altyapı: jest/vitest YOK (CLAUDE.md kuralı); `scripts/test_*.ts` dosyaları `npm test <substring>` / `npx tsx scripts/test_fason_visibility.ts` ile koşar (`scripts/run-all-tests.ts`). Yeni dosya: **`scripts/test_fason_visibility.ts`** — ev stili: business-key fixture çözümü (`test_consecutive_fason.ts:27-40` emsali: Item `PATOS`, Station `BOYA_FASON`/`ZIMPARA_FASON`, Subcontractor `BOYER`/`KESTEL`, User `admin`), `check(label, cond)` sayacı, `finally` temizliği, `process.exit(fail>0?1:0)`. Servis çağrıları `{ query: {...} } as unknown as Request` deseniyle (`test_fason_dispatch_picker.ts:72-85` birebir emsal). Kurulum (WO + fason step + `SubcontractorService.dispatch` + `receive`) `test_consecutive_fason.ts`'ten uyarlanır.

Senaryolar:
1. **Liste include:** Topu BOYER'e (Boyahane adımı) sevk et → `findAllRolls({filter[status]:"AT_SUBCONTRACTOR", filter[id]:rollId})` dönen satırda `dispatchItems.length===1`, `dispatchItems[0].dispatch.subcontractor.code==="BOYER"`, `dispatch.dispatchNo` dolu, `dispatch.step.requiredCategory.name` Boyahane.
2. **Firma filtresi:** `filter[subcontractorId]=BOYER_id` → top döner; `filter[subcontractorId]=KESTEL_id` → dönmez.
3. **Kategori filtresi:** `filter[subcontractorCategoryId]=BOYAHANE_cat_id` → döner; zımpara kategorisiyle → dönmez.
4. **Kabul sonrası temizlik:** `receive` sonrası aynı top `filter[status]=AT_SUBCONTRACTOR` listesinde yok; topun (veya dönen yeni topun) `dispatchItems`'ı boş; `filter[subcontractorId]=BOYER` artık bu topu döndürmez.
5. **İptalli sevk:** `cancelDispatch` sonrası top firma filtresinde görünmez, `dispatchItems` boş.
6. **Kabul iptali:** kabul + `cancelReceipt` sonrası top yeniden AT_SUBCONTRACTOR'da ve `dispatchItems[0]` yine BOYER (F85 kuralı).
7. **Özet ucu:** `getRollSubcontractorSummary()` → BOYER satırında `rollCount`/`totalQty` sevk edilen toplarla eşit; `oldestDays >= 0`; `oldestDispatchedAt` = en eski sevkin tarihi; Boyahane kategori satırı doğru.
8. **Toplam tutarlılığı:** Σ `byCategory.rollCount` === `prisma.roll.count({where:{status:"AT_SUBCONTRACTOR"}})` (test DB'sindeki diğer kayıtlar dahil — mutlak eşitlik).
9. **Anomali/Bilinmiyor:** `prisma.roll.update` ile bir topu elle `AT_SUBCONTRACTOR` yap (açık kalemi yok) → özette `subcontractorId===null` grubunda sayılır; listede `dispatchItems` boş.
10. **Stats paritesi:** `getRollStats({filter[status]:"AT_SUBCONTRACTOR", filter[subcontractorId]:BOYER_id})`.totalCount === aynı filtreli `findAllRolls` toplamı (buildRollWhere paylaşımı).
11. **Fason→fason:** Boyahane kabulü sonrası aynı WO'nun Zımpara adımına ikinci sevk → top özette YALNIZ Zımpara/KESTEL altında bir kez sayılır (çift sayım yok).

## Backend açık konular / kabul edilen riskler

- ROLL_LIST_INCLUDE'a eklenen dispatchItems alt-sorgusu TÜM sekmelerin liste sorgusuna ve getProductionFlow Kanban önizlemelerine dahil olur — indeksler yerinde ve take:1 tek LATERAL üretir ama 300k+ satırlı gerçek DB'de EXPLAIN/ölçüm yapılmadı; regresyon çıkarsa include sekme-koşullu (yalnız AT_SUBCONTRACTOR içeren isteklerde) yapılabilir.
- Görev tarifi include'u 'kartela emsalinin birebir uyarlaması' diye tanımlıyordu; spec buna receiptItems:{none:{receipt:{cancelledAt:null}}} koşulunu bilinçli ekledi (paylaşılan include'da dönmüş topların bayat firma göstermemesi + F85 tanımıyla tutarlılık için). Uygulayıcı bu sapmayı kaldırmamalı; kaldırırsa frontend'e status gate'i şart olur.
- 'Bilinmiyor' firma kartı (subcontractorId=null) liste filtresiyle ifade edilemiyor — filter[subcontractorId] null-sentinel desteklemiyor; frontend bu kartı tıklanamaz yapmalı. Gerekirse ileride '__unknown__' sentinel + buildRollWhere'de dispatchItems:{none:{...açık-kalem...}} çevirisi eklenebilir.
- Anomali durumunda (aynı topta ≥2 açık kalem — normalde imkânsız, DB unique'leri değil iş akışı engeller): liste filtresi some semantiğiyle her iki firmada da eşleşir, include ve özet ise en güncel tek kalemi gösterir → kart sayısı ile tıklama sonucu listesi 1 top farklı olabilir. Kabul edilen risk; DISTINCT ON/take:1 sayesinde çift sayım yine olmaz.
- Özet ucu parametre almaz (global snapshot): kullanıcı listede arama/ürün filtresi uygularsa şerit sayıları listeyle bilinçli olarak sapar (şerit her zaman sekmenin tümünü gösterir). Frontend spec'i bunu UI'da netleştirmeli.
- step.requiredCategoryId nullable — eski/elle açılmış fason adımlarının sevklerinde kategori null olabilir; bunlar kategori chip'lerinde 'Bilinmiyor'a düşer ve anomali toplarıyla aynı chip'te birleşir (ayrıştırmak istenirse response'a ayrı 'uncategorized' alanı gerekir).
- Prisma.sql fragment interpolasyonu (WITH ${baseCte} ...) projede ilk kez kullanılıyor (F85 inline yazmış); Prisma'nın desteklediği belgeli özellik ama uygulamada tsc + tek smoke çağrısıyla doğrulanmalı — sorun çıkarsa CTE metni iki sorguya kopyalanır (davranış aynı).
- Test senaryoları SubcontractorService.dispatch/receive/cancel imzalarına dayanıyor (test_consecutive_fason.ts emsalinden uyarlanacak) — bu imzalar bu spec'te tek tek doğrulanmadı; test yazarken emsal dosyadan birebir kopyalanmalı.

---

# BÖLÜM D — Frontend spec

# Frontend Spec — Envanter "Fasonda" sekmesi fason görünürlüğü

Tüm yollar mutlak. Kod stili: mevcut dosyalardaki Türkçe yorum + İngilizce tanımlayıcı düzeni korunur. Şema/DB değişikliği yok; tüm veri salt-okur uçlardan gelir.

**Mimari kararların dayanağı (keşif sonucu):**
- Filtre mekanizması URL-tabanlı: `FilterBar`/chip'ler `filter[<key>]`'i `useSearchParams`'a yazar → `useDataTable` (`/Users/oad/Documents/projeler/AdnanSahin/Electron/src/hooks/useDataTable.ts` satır 65-73: `parseUrlToQueryParams` + `forceFilters` merge) ve `useRollStats` (satır 19-21) AYNI URL'i izler. Yani chip tıklaması için ekstra state gerekmez; URL'e yazmak hem tabloyu hem "Top/Metre" özetini süzer.
- Kolon mimarisi: TÜM sekmeler tek `rollColumns` dizisini paylaşır; sekme farkı `useDataTable`'ın `queryKey: "rolls:${tab}"` string'i üzerinden SEKME-BAŞINA görünürlük tercihi (`prefs.tableVisibility[queryKey]`) ve `initialVisibility` ile yönetilir (useDataTable.ts 88-95; emsal: WorkOrdersPage.tsx 79). **Karar:** yeni 2 kolon `rollColumns`'a koşulsuz eklenir, Fasonda dışındaki sekmelerde `initialVisibility` ile default-gizli başlar (kullanıcı isterse "Sütunlar"dan açar, hücre "—" gösterir). Export `getVisibleLeafColumns` kullandığından (table-export.ts:107) gizli kolon dışa aktarım kirletmez.
- Detay verisi emsali: `kartelaDispatchItems` (backend `inventory.service.ts` findRollById 1318-1332; frontend types.ts 62-69, RollDetailSheet 331-363). Fason için birebir aynı desen: Prisma ilişki adıyla (`dispatchItems`) take:1 aktif sevk.

---

## 1) `/Users/oad/Documents/projeler/AdnanSahin/Electron/src/pages/Operations/Rolls/types.ts`

`kartelaDispatchItems` alanının (satır 62-69) hemen ALTINA ekle:

```ts
  /** AT_SUBCONTRACTOR top için aktif (iptal edilmemiş) SON fason sevki — liste
   *  VE detay include'undan gelir (kartelaDispatchItems emsali, en fazla 1 eleman).
   *  Statüsü fasondan çıkmış (dönmüş/arşiv) toplarda da dolu GELEBİLİR — UI yalnız
   *  status=AT_SUBCONTRACTOR iken gösterir. */
  dispatchItems?: Array<{ dispatch: RollActiveDispatch }>;
```

Dosyanın uygun yerine (RollColor/RollItem arayüzlerinin yanına) yeni tip + yardımcı:

```ts
/** Aktif fason sevkinin liste/detay cevabındaki şekli. Kategori sevkin bağlı
 *  olduğu WO adımından (step.requiredCategory) gelir — sevk kaydında ayrı
 *  kategori alanı yok (Prisma: SubcontractorDispatch → step → requiredCategory). */
export interface RollActiveDispatch {
  dispatchNo: string;
  dispatchedAt: string;
  subcontractor: { id: string; name: string; code: string | null };
  step: { requiredCategory: { id: string; name: string } | null };
}

/** Topun aktif fason sevki (varsa) — kolon hücreleri + detay kartı ortak okur. */
export function activeDispatchOf(roll: Roll): RollActiveDispatch | null {
  return roll.dispatchItems?.[0]?.dispatch ?? null;
}
```

## 2) `/Users/oad/Documents/projeler/AdnanSahin/Electron/src/pages/Operations/Rolls/service.ts`

`RollStats` arayüzünün (satır 67-73) altına özet tipleri:

```ts
// --- Fasonda özet şeridi (Envanter → Fasonda sekmesi) -----------------------
/** İşlem-tipi chip'i — kategori bazında top adedi + Σmetre. Kategorisiz sevkler
 *  (adımda requiredCategory yok) id:null + name:"Diğer" kovasında toplanır. */
export interface FasonSummaryCategory {
  id: string | null;
  name: string;
  rollCount: number;
  totalQty: number;
}

/** Firma kartı — firmadaki top adedi + Σmetre + en eski aktif sevk tarihi. */
export interface FasonSummaryFirm {
  id: string;
  name: string;
  code: string | null;
  rollCount: number;
  totalQty: number;
  /** Firmadaki (hâlâ fasonda topu olan) aktif sevklerin en eskisi (ISO) —
   *  karttaki "en eski N gün" rozeti bundan hesaplanır. */
  oldestDispatchedAt: string;
}

export interface FasonSummary {
  total: { rollCount: number; totalQty: number };
  byCategory: FasonSummaryCategory[];
  byFirm: FasonSummaryFirm[];
}
```

`rollService` objesine (`getProductionFlow`'un altına, satır ~138) yeni çağrı:

```ts
  /** Fasonda özet şeridi — kategori chip'leri + firma kartları TEK istekte.
   *  Evren: AT_SUBCONTRACTOR + default FIRE-hariç (liste default'uyla hizalı). */
  getSubcontractorSummary: (): Promise<ApiResponse<FasonSummary>> =>
    apiClient
      .get<ApiResponse<FasonSummary>>("/api/rolls/subcontractor-summary")
      .then((r) => r.data),
```

## 3) `/Users/oad/Documents/projeler/AdnanSahin/Electron/src/pages/Operations/Rolls/columns.tsx`

Import satırı 8'i güncelle: `import { type Roll, shipmentScopeLabels, activeDispatchOf } from "./types";`

`processing` ("Tip") kolon objesinin bittiği yerin (satır 141, `},`) hemen ALTINA, `currentQty`'den önce iki kolon ekle. Guard önemli: `dispatchItems` include'u statüden bağımsız dolabileceği için hücreler yalnız `AT_SUBCONTRACTOR`'da değer basar — fasondan dönmüş/arşiv topta yanıltıcı firma görünmesin:

```ts
  {
    id: "subcontractorCategory",
    header: "İşlem",
    meta: {
      label: "İşlem",
      exportValue: (r) =>
        r.status === RollStatus.AT_SUBCONTRACTOR
          ? activeDispatchOf(r)?.step.requiredCategory?.name ?? ""
          : "",
    },
    enableSorting: false,
    // Yalnız fasondaki topta göster — dispatchItems include'u dönüş sonrası da
    // dolu gelebilir (aktiflik = sevk iptal edilmemiş), statü guard'ı şart.
    cell: ({ row }) => {
      const d =
        row.original.status === RollStatus.AT_SUBCONTRACTOR
          ? activeDispatchOf(row.original)
          : null;
      return d?.step.requiredCategory ? (
        <Badge variant="outline" className="text-[10px]">
          {d.step.requiredCategory.name}
        </Badge>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      );
    },
  },
  {
    id: "subcontractor",
    header: "Fason Firması",
    meta: {
      label: "Fason Firması",
      exportValue: (r) =>
        r.status === RollStatus.AT_SUBCONTRACTOR
          ? activeDispatchOf(r)?.subcontractor.name ?? ""
          : "",
    },
    enableSorting: false,
    cell: ({ row }) => {
      const d =
        row.original.status === RollStatus.AT_SUBCONTRACTOR
          ? activeDispatchOf(row.original)
          : null;
      if (!d) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <span className="text-xs font-medium">
          {d.subcontractor.name}
          {d.subcontractor.code ? (
            <span className="ml-1 text-muted-foreground">({d.subcontractor.code})</span>
          ) : null}
        </span>
      );
    },
  },
```

## 4) YENİ DOSYA `/Users/oad/Documents/projeler/AdnanSahin/Electron/src/pages/Operations/Rolls/FasonSummaryStrip.tsx`

Kod tabanında hazır chip/özet-kart bileşeni YOK (arandı: RollsStats tek satırlık sayaç, RollsKanban kartları kolon-bazlı) → RollsStats/RollsKanban görsel dilini izleyen yeni bileşen:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { differenceInCalendarDays } from "date-fns";
import { Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { rollService } from "./service";

const NUM_FMT = new Intl.NumberFormat("tr-TR", { useGrouping: false });
const DEC_FMT = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

/** Aktif sevkin yaşı (tam gün, negatif olmaz) — firma kartındaki "en eski N gün". */
function daysSince(iso: string): number {
  return Math.max(0, differenceInCalendarDays(new Date(), new Date(iso)));
}

/**
 * Fasonda sekmesi özet şeridi: işlem-tipi chip'leri (Tümü + kategori başına
 * adet/Σmetre) + firma kartları (adet/Σmetre + "en eski N gün"). Tıklama URL
 * `filter[...]`'a yazar → tablo (useDataTable) ve "Top/Metre" özeti (useRollStats)
 * aynı URL'i izlediği için ikisi birden süzülür; ekstra state yok. Seçiliye
 * tekrar tıklamak filtreyi kaldırır (toggle). Şeridin kendi sayıları SÜZÜLMEZ —
 * şerit filtre kumandasıdır, evren sabittir (tüm Fasonda).
 */
export function FasonSummaryStrip() {
  const [searchParams, setSearchParams] = useSearchParams();
  const summaryQuery = useQuery({
    // ["rolls","SUBCONTRACTOR"] prefix'i → RefreshButton invalidate'i tabloyla
    // birlikte şeridi de tazeler (queryKey array kuralı, Y2 emsali).
    queryKey: ["rolls", "SUBCONTRACTOR", "fason-summary"],
    queryFn: () => rollService.getSubcontractorSummary(),
    staleTime: 30_000,
  });

  const selectedCategoryId = searchParams.get("filter[subcontractorCategoryId]");
  const selectedFirmId = searchParams.get("filter[subcontractorId]");

  const toggleFilter = (
    key: "subcontractorCategoryId" | "subcontractorId",
    id: string | null,
  ) => {
    const next = new URLSearchParams(searchParams);
    const paramKey = `filter[${key}]`;
    if (id === null || next.get(paramKey) === id) next.delete(paramKey);
    else next.set(paramKey, id);
    setSearchParams(next, { replace: true });
  };

  // Özet ucu hata verirse şerit sessizce gizlenir — liste çalışmaya devam eder
  // (şerit yardımcı görünüm, kritik akış değil; toast da basılmaz).
  if (summaryQuery.isError) return null;

  if (summaryQuery.isLoading) {
    return (
      <div className="space-y-2 border-b px-4 py-2.5">
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 w-32 rounded-full" />
          ))}
        </div>
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[72px] w-44 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  const data = summaryQuery.data?.data;
  // Fasonda hiç top yoksa şerit çizilmez — tablo zaten "Top bulunamadı." gösterir.
  if (!data || data.total.rollCount === 0) return null;

  return (
    <div className="space-y-2 border-b px-4 py-2.5">
      {/* İşlem-tipi chip satırı — "Tümü" + kategori başına adet/Σmetre. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip
          active={!selectedCategoryId}
          onClick={() => toggleFilter("subcontractorCategoryId", null)}
        >
          <span className="font-medium">Tümü</span>
          <ChipStat count={data.total.rollCount} qty={data.total.totalQty} />
        </Chip>
        {data.byCategory.map((c) => (
          <Chip
            key={c.id ?? "none"}
            active={c.id !== null && selectedCategoryId === c.id}
            // Kategorisiz kova ("Diğer", id:null) filtrelenemez — salt gösterim.
            disabled={c.id === null}
            onClick={() => c.id && toggleFilter("subcontractorCategoryId", c.id)}
          >
            <span className="font-medium">{c.name}</span>
            <ChipStat count={c.rollCount} qty={c.totalQty} />
          </Chip>
        ))}
      </div>
      {/* Firma kartları — yatay kaydırılır satır. */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {data.byFirm.map((f) => {
          const active = selectedFirmId === f.id;
          const days = daysSince(f.oldestDispatchedAt);
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => toggleFilter("subcontractorId", f.id)}
              className={cn(
                "w-44 shrink-0 rounded-md border bg-card p-2.5 text-left transition-colors hover:bg-accent",
                active && "border-primary ring-1 ring-primary",
              )}
            >
              <div className="truncate text-sm font-semibold leading-tight">
                {f.name}
              </div>
              <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                {NUM_FMT.format(f.rollCount)} top · {DEC_FMT.format(f.totalQty)} m
              </div>
              <div
                className={cn(
                  "mt-1 flex items-center gap-1 text-[10px] tabular-nums",
                  // 30+ gündür fasonda bekleyen mal — dikkat rengi.
                  days >= 30 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                )}
              >
                <Clock className="h-3 w-3" /> en eski {NUM_FMT.format(days)} gün
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card hover:bg-accent",
        disabled && "cursor-default opacity-60 hover:bg-card",
      )}
    >
      {children}
    </button>
  );
}

function ChipStat({ count, qty }: { count: number; qty: number }) {
  return (
    <span className="tabular-nums opacity-80">
      {NUM_FMT.format(count)} top · {DEC_FMT.format(qty)} m
    </span>
  );
}
```

## 5) `/Users/oad/Documents/projeler/AdnanSahin/Electron/src/pages/Operations/Rolls/RollsPage.tsx`

**(a)** Import: `import { FasonSummaryStrip } from "./FasonSummaryStrip";`

**(b)** Sekme değişince fason filtrelerini sıfırla. `toggleIncludeFire`'ın (satır 172-177) yanına yardımcı ekle ve `ReorderableTabBar`'ın `onSelect`'ini (satır 256) buna bağla:

```tsx
  // Fason chip/kart filtreleri yalnız Fasonda sekmesinde anlamlı — sekmeden
  // ayrılırken URL'den temizle (başka sekmede dispatch-bazlı filtre listeyi
  // sessizce yanlış daraltırdı).
  const selectTab = (next: RollTabKey) => {
    if (tab === "SUBCONTRACTOR" && next !== "SUBCONTRACTOR") {
      const sp = new URLSearchParams(searchParams);
      if (sp.has("filter[subcontractorId]") || sp.has("filter[subcontractorCategoryId]")) {
        sp.delete("filter[subcontractorId]");
        sp.delete("filter[subcontractorCategoryId]");
        setSearchParams(sp, { replace: true });
      }
    }
    setTab(next);
  };
```

```tsx
        onSelect={(k) => selectTab(k as RollTabKey)}
```

**(c)** `useDataTable` çağrısına (satır 140-148) `initialVisibility` ekle — fason kolonları yalnız Fasonda sekmesinde default görünür (görünürlük tercihi `rolls:${tab}` anahtarıyla sekme-başına saklandığı için çakışmaz; kullanıcı tercihleri `initialVisibility`'yi ezer, useDataTable.ts 89-95):

```tsx
  const dataTable = useDataTable<Roll>({
    queryKey: `rolls:${tab}`,
    queryKeyParts: ["rolls", tab],
    fetchFn: rollService.listCursor,
    columns: rollColumns,
    defaultPageSize: 100,
    forceFilters: tab === "KANBAN" ? {} : buildRollForceFilters(tab),
    // Fason sütunları ("İşlem" + "Fason Firması") yalnız Fasonda sekmesinde
    // default açık; diğer sekmelerde gizli başlar (Sütunlar'dan açılabilir,
    // hücre "—" gösterir — veri yalnız AT_SUBCONTRACTOR'da dolar).
    initialVisibility:
      tab === "SUBCONTRACTOR"
        ? undefined
        : { subcontractorCategory: false, subcontractor: false },
    enabled: isTableTab,
  });
```

**(d)** Özet şeridi: `<ReorderableTabBar ... />`'ın kapanışından (satır 268) hemen sonra, `{tab === "KANBAN" ? ...}` bloğundan önce:

```tsx
      {/* Fasonda özet şeridi — işlem chip'leri + firma kartları; tıklama URL
          filter'ı üzerinden tabloyu ve Top/Metre özetini birlikte süzer. */}
      {tab === "SUBCONTRACTOR" && <FasonSummaryStrip />}
```

## 6) `/Users/oad/Documents/projeler/AdnanSahin/Electron/src/pages/Operations/Rolls/RollsTableBody.tsx`

**(a)** Import'lara ekle (satır 11-13 bloğuna):

```ts
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
```

**(b)** `SHIPMENT_SCOPE_FILTER`'ın (satır 52-62) altına fason filtreleri; `buildRollFilterDefs`'i (satır 65-67) genişlet. `LookupFilter` `service.getAll({filters:{isActive:"true"}})` çağırır (FilterBar.tsx 366-377) — iki servis de `createCrudService` ve iki modelde de `isActive` var, uyumlu:

```ts
// Yalnız "Fasonda" sekmesi: aktif fason sevkine göre firma + işlem (kategori)
// daraltması. Özet şeridi chip/kartları da AYNI filter anahtarlarına yazar —
// FilterBar dropdown'ı ile chip seçimi tek URL state'inde buluşur.
const FASON_FILTERS: FilterDef[] = [
  {
    kind: "lookup",
    key: "subcontractorId",
    label: "Fason Firması",
    service: subcontractorService,
    queryKey: "subcontractors",
  },
  {
    kind: "lookup",
    key: "subcontractorCategoryId",
    label: "İşlem",
    service: subcontractorCategoryService,
    queryKey: "subcontractor-categories",
  },
];

// Serbest/rezerve filtresi yalnız depo (Bitmiş Depo); fason filtreleri yalnız Fasonda.
export function buildRollFilterDefs(tab: RollStatusTabKey): FilterDef[] {
  if (tab === "FINISHED_STOCK") return [...FILTERS, SHIPMENT_SCOPE_FILTER];
  if (tab === "SUBCONTRACTOR") return [...FILTERS, ...FASON_FILTERS];
  return FILTERS;
}
```

## 7) `/Users/oad/Documents/projeler/AdnanSahin/Electron/src/pages/Operations/Rolls/RollDetailSheet.tsx`

**(a)** lucide import satırı 3'e `Send` ekle (Fason ikonu — TABS + Kanban "Fason" kolonuyla tutarlı).

**(b)** `kartelaDispatch` sabitinin (satır 57) altına:

```ts
  // AT_SUBCONTRACTOR top: hangi fason firmasında/işlemde — kartela kartı emsali.
  // Liste cevabı da dispatchItems taşır (fallback) → panel açılır açılmaz dolu görünür.
  const activeDispatch =
    detail?.dispatchItems?.[0]?.dispatch ?? roll?.dispatchItems?.[0]?.dispatch ?? null;
```

**(c)** "Kartela Fasonu" bloğunun (satır 331-363) hemen ÜSTÜNE, sevkiyat rezervasyon kartının altına — AT_KARTELA bloğunun birebir uyarlaması:

```tsx
            {/* Fason bilgisi — top fason firmasında işlemde (AT_SUBCONTRACTOR). */}
            {roll.status === "AT_SUBCONTRACTOR" && (
              <Card>
                <CardContent className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Send className="h-3.5 w-3.5" /> Fason Bilgisi
                  </div>
                  {detailQuery.isLoading && !activeDispatch ? (
                    <Skeleton className="h-10 w-full" />
                  ) : activeDispatch ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <div className="text-xs text-muted-foreground">Firma</div>
                      <div className="font-medium">
                        {activeDispatch.subcontractor.name}
                        {activeDispatch.subcontractor.code
                          ? ` (${activeDispatch.subcontractor.code})`
                          : ""}
                      </div>
                      {activeDispatch.step.requiredCategory && (
                        <>
                          <div className="text-xs text-muted-foreground">İşlem</div>
                          <div className="text-xs">
                            {activeDispatch.step.requiredCategory.name}
                          </div>
                        </>
                      )}
                      <div className="text-xs text-muted-foreground">Sevk No</div>
                      <div className="font-mono text-xs">{activeDispatch.dispatchNo}</div>
                      <div className="text-xs text-muted-foreground">Gönderim</div>
                      <div className="text-xs">
                        {safeFormat(activeDispatch.dispatchedAt, "dd.MM.yyyy HH:mm")}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Aktif fason sevki bulunamadı.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
```

Not: Kanban "Fason" kolonundan açılan panelde `roll.dispatchItems` olmayabilir (production-flow ucu farklı include) — fallback zinciri detay fetch'inden dolar, skeleton koşulu bunu kapsıyor.

## 8) `/Users/oad/Documents/projeler/AdnanSahin/Electron/src/pages/Operations/Kartela/KartelaPage.tsx`

"Kartelada Toplar" tablosu da `rollColumns`'ı paylaşıyor (satır 94-103) — fason kolonları orada da default gizli başlasın. `useDataTable` çağrısına ekle:

```tsx
    // Fason sütunları kartela tablosunda anlamsız (AT_KARTELA topta aktif fason
    // sevki yok) — default gizli; Sütunlar'dan açılırsa "—" gösterir.
    initialVisibility: { subcontractorCategory: false, subcontractor: false },
```

## 9) `/Users/oad/Documents/projeler/AdnanSahin/Electron/src/pages/Operations/Rolls/service.test.ts`

`swatchService.test.ts` kalıbıyla (aynı dizin) URL sözleşme testi:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "@/services/apiClient";
import { rollService } from "./service";

// apiClient'i mock'la — fason özet ucunun URL sözleşmesini doğrula.
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;

describe("rollService — fasonda özet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: { total: { rollCount: 0, totalQty: 0 }, byCategory: [], byFirm: [] },
      },
    });
  });

  it("getSubcontractorSummary → GET /api/rolls/subcontractor-summary", async () => {
    await rollService.getSubcontractorSummary();
    expect(mockGet).toHaveBeenCalledWith("/api/rolls/subcontractor-summary");
  });

  it("getSubcontractorSummary ApiResponse.data'yı döndürür", async () => {
    const payload = {
      total: { rollCount: 3, totalQty: 250 },
      byCategory: [{ id: "c1", name: "Boyahane", rollCount: 3, totalQty: 250 }],
      byFirm: [
        {
          id: "s1", name: "ABC Boya", code: "ABC",
          rollCount: 3, totalQty: 250,
          oldestDispatchedAt: "2026-07-01T09:00:00.000Z",
        },
      ],
    };
    mockGet.mockResolvedValue({ data: { success: true, data: payload } });
    const res = await rollService.getSubcontractorSummary();
    expect(res.data).toEqual(payload);
  });
});
```

## 10) Kabul senaryoları (manuel doğrulama)

1. Envanter → Fasonda: şeritte "Tümü" + kategori chip'leri (adet/Σm) + firma kartları (adet/Σm + "en eski N gün") görünür; tabloda "İşlem" ve "Fason Firması" kolonları dolu.
2. "Boyahane" chip'ine tıkla → URL'de `filter[subcontractorCategoryId]` belirir, liste yalnız boyahanedeki topları gösterir, sağ üst "Top/Metre" özeti de aynı kümeye düşer; chip'e tekrar tıkla veya "Tümü" → filtre kalkar.
3. Firma kartına tıkla → `filter[subcontractorId]` uygulanır, kart ring-primary ile seçili görünür; tekrar tıkla → kalkar. Chip + kart birlikte seçilebilir (AND).
4. FilterBar'daki "Fason Firması"/"İşlem" dropdown'ları chip/kart seçimini aynen yansıtır (aynı URL anahtarı).
5. Fasonda → Ham Stok'a geç → fason filtreleri URL'den silinir; Ham Stok'ta "İşlem"/"Fason Firması" kolonları default görünmez (Sütunlar'dan açılırsa hücreler "—").
6. Fasondaki bir topun satırına tıkla → RollDetailSheet'te "Fason Bilgisi" kartı: firma (+kod), işlem, sevk no (SD-…), gönderim tarihi. AT_KARTELA topta kartela kartı davranışı DEĞİŞMEDEN kalır.
7. Özet ucu 500 dönerse şerit görünmez, liste ve filtreler çalışmaya devam eder (toast yok).
8. Aktif sevki bulunamayan AT_SUBCONTRACTOR top: kolonlarda "—", detayda "Aktif fason sevki bulunamadı."
9. RefreshButton (Fasonda aktifken) tabloyu VE şeridi birlikte tazeler (`["rolls","SUBCONTRACTOR"]` prefix invalidation).
10. Kanban ("Üretim Akışı") davranışı değişmez; Kanban fason kolonundan açılan detay panelinde de fason kartı (detay fetch'iyle) dolar.
11. `pnpm vitest run src/pages/Operations/Rolls/service.test.ts` geçer; `tsc` temiz.

## Frontend açık konular / kabul edilen riskler

- Kategorisiz sevk kovası ('Diğer', id:null) chip'i salt-gösterim (tıklanamaz) bırakıldı — null-id URL filtresine çevrilemiyor; gerekirse backend'e 'NONE' sentinel'i (requiredCategoryId IS NULL) eklenerek tıklanabilir yapılabilir.
- Özet şeridinin sayıları statik evren (tüm Fasonda, default FIRE-hariç): kullanıcı arama/tarih/includeFire gibi ek filtre uygularsa chip sayıları filtreli listeyle birebir örtüşmez (şerit filtre kumandası olarak tasarlandı, bilinçli sadelik).
- Firma kartları kategori chip'i seçilince yeniden agregasyon YAPMAZ (kategori×firma matrisi sözleşmede yok) — istenirse summary ucuna ?categoryId parametresi eklenip strip query key'ine bağlanabilir.
- dispatchItems include'u statüden bağımsız 'son iptal-edilmemiş sevki' döndürür; frontend status===AT_SUBCONTRACTOR guard'ı ile yanlış gösterimi engelliyor — backend spec'i include'u ayrıca daraltmak isterse (ör. where'e roll.status koşulu eklenemez, item-level filtre yeterli) çelişki yok ama iki spec'in aynı alan adını (dispatchItems) kullandığı teyit edilmeli.
- Dashboard'tan ?tab= deep-link ile Fasonda'dan başka sekmeye geçiş (RollsPage useEffect, satır 181-188) fason filtrelerini temizlemez — yalnız manuel sekme tıklaması temizler; deep-link URL'lerinde fason filtresi pratikte bulunmadığı için kabul edilebilir, istenirse aynı temizlik useEffect'e de eklenir.
- oldestDispatchedAt gün hesabı client saatine göre (differenceInCalendarDays) — sunucu/istemci saat farkında ±1 gün oynayabilir; kritik değil.
- LookupFilter master listeyi pageSize:200 ile çeker — fason firma/kategori sayısı 200'ü aşarsa dropdown kırpılır (mevcut FilterBar sınırlaması, bu işte dokunulmuyor).

---

# BÖLÜM E — Kabul kriterleri

1. Envanter → Fasonda sekmesinde her top satırında fason firması ve işlem tipi görünür; fasonda olmayan topların satırında "—".
2. Özet şeridi firma başına top adedi + Σmetre + "en eski N gün" gösterir; toplamlar tablo default görünümüyle (FIRE-hariç) tutarlıdır.
3. Chip/kart tıklaması listeyi VE Top/Metre özetini birlikte süzer; "Tümü" ve manuel sekme değişimi filtreyi temizler; "Bilinmiyor" kart/chip'i tıklanamaz.
4. Top detayında AT_SUBCONTRACTOR için fason kartı (firma + sevk no + tarih + işlem) görünür; AT_KARTELA kartı davranışı değişmez.
5. Fason→fason transfer edilmiş top yalnız GÜNCEL firmasında sayılır/görünür; dönmüş (SUBCONTRACTOR_CONSUMED / tekrar stokta) toplar hiçbir firma kartında sayılmaz, satırlarında firma görünmez.
6. Diğer sekmeler (Ham Stok, Depo, Arşiv, Kartela) ve Kanban görünümü regresyonsuz; özet ucu hata verirse şerit gizlenir, liste çalışmaya devam eder.
7. Backend testleri: Bölüm C test senaryoları (sevk→listede firma, kabul→listeden düşer, transfer→tek firma, sevk iptali→düşer, FIRE-hariç sayım) yeşil.
