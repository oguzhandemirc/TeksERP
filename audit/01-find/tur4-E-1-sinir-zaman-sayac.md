# TUR 4 · E-1 — Sınır durum: ZAMAN (gece yarısı, ay/yıl sonu, saat dilimi, sayaç sarması)

> Denetçi: E-1 · Salt-okunur · Dal `adnansahin` · Ortak zemin: `audit/00-map/_BRIEF.md`, `KUNYE.md`, `audit/01-find/_FINDER-BRIEF.md`, beceri paketi `express-api-audit` (§9 yanlış pozitif kataloğu okundu).
> Mercek: bulgunun bir DEĞERİN ya da KOŞULUN ucunda doğması. Aynı kod noktası önceki turda geçtiyse yalnız SINIR koşulu yeni bilgi katıyorsa yazıldı (`onceki_defter` dolduruldu).

## ⚠️ BU OTURUMUN ÖLÇÜM KISITI (severity tavanını belirler)

`audit/tools/sql-dev.sh` ve `sql-saha.sh` bu oturumda **çalışmadı**:

```
psql: error: connection to server at "localhost" (::1), port 5432 failed:
FATAL:  Postgres.app failed to verify "trust" authentication
DETAIL: ... user that started the server is no longer logged in ...
```

TCP (`localhost`, `127.0.0.1`) ve unix soket (`/tmp/.s.PGSQL.5432`) yollarının üçü de aynı hatayı verdi; başka bağlantı kurulmadı (kural 2). Sonuç:

- **K2 (veride fiili ihlal) HİÇBİR bulguda üretilemedi.** Her bulguda "Veride fiili ihlal" bölümü, oturum açıldığında tek komutla koşulacak **hazır SQL** taşır.
- **Prisma tabanlı K3 repro yazılamadı.** Bunun yerine, alanın doğası gereği (sınır aritmetiği) **DB'ye hiç dokunmayan, üretim modüllerini birebir import eden 4 deterministik repro** yazıldı ve koşturuldu — bunlar K3 sayılır (davranış ÖLÇÜLDÜ, tahmin edilmedi):
  | Script | Log | Sonuç |
  |---|---|---|
  | `Teks-Erp/scripts/audit_repro_E-1-01.ts` | `audit/repro/E-1-01.log` | 3/3 ✅ (sapma üretildi) |
  | `Teks-Erp/scripts/audit_repro_E-1-02.ts` | `audit/repro/E-1-02.log` | 4/4 ✅ (sessiz kayma üretildi) |
  | `Teks-Erp/scripts/audit_repro_E-1-03.ts` | `audit/repro/E-1-03.log` | 7/7 ✅ (400 + OTIF + gece penceresi üretildi) |
  | `Teks-Erp/scripts/audit_repro_E-1-04.ts` | `audit/repro/E-1-04.log` | 7/7 ✅ (biçim kırılması + sıra bozulması üretildi) |
- **S0 yazılmadı** (kural: S0 için K2/K3-canlı şart). En yüksek şiddet **S2**.

---

## Alanın zemini — ölçülmüş gerçekler (bulguların dayanağı)

| Olgu | Değer | Kanıt |
|---|---|---|
| Fabrika günü tek kaynağı | `FACTORY_TIMEZONE = "Europe/Istanbul"`, `factoryDayStart/factoryYmd/factoryDaySql/factoryMonthSql/factoryDayKeyUtcMidnight` | `Teks-Erp/src/constants/time.ts:50-186` |
| Türkiye kalıcı UTC+3 (DST yok) → gece penceresi | Yerel 00:00–03:00 = UTC'de bir önceki gün | `constants/time.ts:16-23` |
| PG oturumu | `-c timezone=UTC` (LOAD-BEARING) | `src/lib/prisma.ts:62-72`, `src/lib/pg-session.ts` |
| Süreç TZ | prod'da **PİNLENMEMİŞ** (`ecosystem.config.js` `env` bloğunda `TZ` yok); Docker'da pinli | `Teks-Erp/ecosystem.config.js:72-140`, `Dockerfile:23` |
| Tüm tarih kolonları | `timestamptz`, **precision belirtilmemiş** (varsayılan 6 = mikro saniye) | `prisma/migrations/20260801040000_timestamptz_conversion/migration.sql:88+` (185 ALTER, hiçbirinde `(3)` yok) |
| Günlük belge sayacı | `PREFIX+GGAAYY+NNNN`, gün = fabrika günü; sıra `nextDailySeq` (numerik max+1, `Number.isFinite` guard'ı O-4 **AYAKTA**) | `src/utils/code-format.ts:63-106`; repro E-1-04 §1 |
| Top barkod sayacı | `T+GGAAYY+H/F+NNNN`, atomik `ON CONFLICT n=n+count`, tavan 9999 → **409 fail-closed** | `src/services/helpers/roll-barcode.helper.ts:82-95` |
| Parti no | `P01…P99` körlemesine sarar (bilinçli, 2026-08-05 kullanıcı kararı); `@unique` kaldırıldı, koruma 8022 advisory | `src/services/batch.service.ts:120-145`, `code-format.ts:255-268` |
| Gün sınırı bekçisi | `scripts/test_report_day_boundary.ts` — `DATE_TRUNC`/`CURRENT_DATE`/`setHours` tarar; **`setMonth`/`setDate` BİLEREK dışarıda**, `getDate()/getMonth()` hiç taranmıyor | `scripts/test_report_day_boundary.ts:194-212` |

---

# BULGULAR

---

### [E-1-01] Audit arşiv kesme tarihi `setMonth` ile ay uzunluğunu taşıyor — ayın 29/30/31'inde koşulunca "6 ay" fiilen 5 ay 25 gün olur

| Şiddet | S3 | Kategori | E (İş kuralı) / J — kontrol listesi E1e | Öncelik | P4 | Modül | audit/arşiv | Kanıt seviyesi | K3 |

**Özet.** `AuditService.archiveOlderThan(N)` kesme tarihini `cutoff.setMonth(cutoff.getMonth() - N)` ile hesaplıyor. JS'te hedef ayda o gün yoksa tarih **bir sonraki aya taşar** (31 Ağustos − 6 ay → "31 Şubat" → 3 Mart). Yani arşivleyici ayın 29/30/31'inde koştuğunda kesme tarihi 1-3 gün **ileri** gider ve söz verilenden erken, sessizce, o kadar günlük audit satırını sıcak tablodan `system_log_archives`'a taşır. Aynı kusur elle arşiv ucunda (`monthsToKeep` 1..120) daha görünür: `monthsToKeep=1`, 31 Mart'ta koşulunca "1 ay" 28 güne iner.

**Kanıt.**
```ts
// Teks-Erp/src/services/audit.service.ts:204-206
static async archiveOlderThan(monthsToKeep: number): Promise<{ archived: number; cutoff: string }> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsToKeep);
```
- Çağıranlar: `src/jobs/archive-scheduler.ts:78` (`MONTHS_TO_KEEP = 6`, `:22`) ve `src/routes/admin.routes.ts:869-870` (`monthsToKeep: z.number().int().min(1).max(120)`, `:852`).
- **Aynı repoda DOĞRU yazılmış ikizi var** — `src/services/latency-persist.service.ts:170-171` `cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS)`: gün bazlı kaydırma ay/yıl devrini doğru yapar. Düzeltmenin şekli budur.
- **Koruma yok teyidi (nereye bakıldı):** (a) `archiveOlderThan` içinde kelepçe yok; (b) `archive-scheduler.ts` çağrı yerinde kelepçe yok; (c) `admin.routes.ts:852` Zod yalnız 1..120 aralığını doğrular, kesme tarihini görmez; (d) DB tarafında kısıt/trigger yok; (e) feature-flag yok.
- **Bekçinin kör noktası hatanın kendisiyle aynı yerde:** `scripts/test_report_day_boundary.ts:202-208` `setDate`/`setMonth`'u **bilerek** kapsam dışı bırakıyor, gerekçe olarak "onlar gün SINIRI kurmaz, SÜRE kaydırır" diyor. Bu gerekçe `deadline + 30 gün` için doğrudur ama `audit.service.ts:206` bir **saklama sınırı**dır ve sonucu ayın uzunluğuna bağlıdır — bekçi tam bu satırı görmez.

**failure_mode.** Arşivleyici 31 Ağustos 2026 gecesi koşar (`INTERVAL_DAYS=30` nedeniyle koşum günü takvime çıpalanmaz, kaydığı için ayın herhangi bir gününe düşebilir). `MONTHS_TO_KEEP=6` iken cutoff **2026-03-03** olur (doğrusu 2026-02-28). 28 Şubat – 3 Mart arasındaki tüm `system_logs` satırları "6 aydan eski" sayılıp sıcak tablodan silinir ve Sistem → Loglar ekranında **görünmez olur** (arşiv tablosunu okuyan bir liste yüzeyi yok — `audit.report.service.ts` ve `system-log.service` yalnız `system_logs` okur). Hata yok, log yok; kullanıcı "3 gün eksik" diyene kadar fark edilmez.

**Veride fiili ihlal (K2).** ARANDI — **ölçülemedi** (DB erişimi yok, bkz. başlık). Oturum açıldığında tek komut:
```sql
-- (a) Arşivleyici hangi gün koştu? Sonuç ayın 29/30/31'i ise fiili ihlal vardır.
SELECT key, value FROM system_settings WHERE key = 'audit.lastArchiveAt';
-- (b) Sıcak tablo ile arşiv arasındaki sınır gerçekten 6 ay mı?
SELECT min("createdAt") AS sicak_en_eski FROM system_logs;
SELECT max("createdAt") AS arsiv_en_yeni, count(*) FROM system_log_archives;
```
K8 haritasının 2026-08-28 ölçümü: saha `audit.lastArchiveAt = 2026-08-16` (ayın 16'sı → o koşumda sapma **0**), `system_log_archives` 0 satır → **bugüne kadar fiilen hiç satır taşınmamış**. Yani bugün zarar YOK; kusur ilk gerçek arşiv koşumunda ve ayın son günlerine denk gelirse doğar.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_E-1-01.ts` → `audit/repro/E-1-01.log`
```
31 Ağu 2026, monthsToKeep=6 → üretim cutoff = 2026-03-03 | doğrusu 2026-02-28 | SAPMA = 3 gün
En büyük sapma: 3 gün — 2026-03-31 · monthsToKeep=1 → cutoff 2026-03-03 (beklenen 2026-02-28)
Karşı örnek: latency-persist `setUTCDate` ay/yıl devrinde DOĞRU
```

**İş etkisi.** ISO 27001 A.8.15 kapsamındaki denetim izinin "6 ay sıcak" sözü 3 güne kadar erken kesilir. Veri kaybı YOK (satır arşive taşınır) ama arşiv tablosunu okuyan bir yüzey olmadığı için pratikte erişilemez olur. Ayrıca kesme `setMonth` yerel takvimde çalıştığı için sınır süreç saat dilimine de bağlıdır (`constants/time.ts` tek kaynağının dışında).

**Öneri (2. tur için).** `archiveOlderThan`'da ayı elle kelepçele (hedef ayın son gününü aşma) ve kesmeyi fabrika gününe oturt:
```ts
const now = new Date();
const target = new Date(now); target.setDate(1); target.setMonth(now.getMonth() - monthsToKeep);
const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
target.setDate(Math.min(now.getDate(), lastDay));
const cutoff = factoryDayStart(target);
```
Kod/veri dokunuşu yok, migration yok, `prod_risk: düşük`. Bekçi tarafında: `test_report_day_boundary.ts`'in `setMonth` muafiyetini **daraltarak** sürdür — "süre kaydırma" (deadline+N gün) muaf kalsın, "saklama sınırı" muaf OLMASIN (ör. dosya bazlı allowlist).

**Kabul kriteri.** `audit_repro_E-1-01.ts` §1'de 6 koşum gününün **hepsinde** sapma = 0 gün; §2'de azami sapma 0.
**Efor.** 0.3 gün.
**Önceki defter.** Yok (`audit/FINDINGS.jsonl`'de `archiveOlderThan` kesmesine dair kayıt bulunmadı).

---

### [E-1-02] İçe aktarımda tarih hücresi takvimi doğrulamıyor: `31.02.2026` sessizce 3 Mart olur, `45900` (Excel seri no) yıl 45900 olur

| Şiddet | S2 | Kategori | F (girdi doğrulama) / E — kontrol listesi E1b/E1g "girdi uçları" | Öncelik | P2 | Modül | import (17 adaptör) | Kanıt seviyesi | K3 |

**Özet.** `parseDateCell` gün/ay aralığını yalnız kaba sınırla kontrol ediyor (`m 1..12`, `d 1..31`) ve sonra `Date.UTC(y, m-1, d)` çağırıyor. JS bu çağrıda taşan günü **bir sonraki aya devreder**: `31.02.2026` → 3 Mart, `29.02.2026` (2026 artık yıl DEĞİL) → 1 Mart, `31.04/31.06/31.09` → ayın 1'i. İkinci uç: tanınmayan biçim **hata değil**, `new Date(s)` yedeğine düşüyor; sayısal bir hücre (Excel'in tarih seri numarası ya da yanlış kolon) JS'te **yıl** olarak parse ediliyor — `"45900"` → yıl 45899/45900, `"0"` → 1999, `"1"` → 2000. Her iki uçta da içe aktarım satırı **kabul edilir** ve yanlış tarih sipariş kaydına yazılır.

**Kanıt.**
```ts
// Teks-Erp/src/services/import/import-coerce.ts:86-96
  } else {
    const parsed = new Date(s);                       // ← tanınmayan biçim: serbest JS parse
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null; // ← ayın UZUNLUĞU kontrol EDİLMİYOR
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);     // ← 31 Şubat burada 3 Mart olur
```
- Tüketici: `src/services/import/import.service.ts:88-91` — `case "date": const d = parseDateCell(text); if (!d) return { error: ... }` → `null` dönmediği için satır **hatasız** geçer.
- Ulaşılabilir yüzey: `src/services/import/adapters/order.adapter.ts:57-58` → `orderDate` ve `deadline` `type: "date"`. Panelden yüklenen sipariş dosyası bu yoldan geçer.
- **Koruma yok teyidi:** (a) `parseDateCell` içinde takvim doğrulaması yok; (b) `import.service.ts` yalnız `null` kontrolü yapıyor; (c) adaptörde ek `validate` yok (`order.adapter.ts:57-58` sütun tanımı sadece `help`/`example` taşır); (d) `orders.orderDate` / `orders.deadline` üzerinde CHECK yok (`prisma/schema.prisma:1969-1975`); (e) Zod bu yolda koşmuyor (içe aktarım kendi dönüştürücüsünü kullanır).
- Karşı-kanıt (aynı fonksiyonun DOĞRU yanı): geçerli tarih fabrika gününün yerel 00:00'ına oturuyor (`:91-95` + `istanbulOffsetMs`), yani gece penceresi burada düşünülmüş. Sorun yalnız **doğrulama**da.

**failure_mode.** Planlama personeli müşterinin gönderdiği sipariş listesini içe aktarır; bir satırda termin `31.02.2026` yazıyordur (yazım hatası ya da ay/gün yer değiştirmesi). Sistem satırı **kabul eder** ve siparişin termini **3 Mart 2026** olur. Ekranda "3.03.2026" görünür, kimse hatayı yakalamaz; sipariş 3 gün geç terminle üretim sırasına girer ve OTIF karnesinde yanlış dönemde sayılır. İkinci senaryo: kolon kaymış bir dosyada termin hücresine `45900` düşer; sipariş **yıl 45900** terminiyle açılır → hiçbir "geciken sipariş" listesinde görünmez (`deadline < now()` asla doğru olmaz), Ürün Dengesi'nde sonsuza kadar açık talep olarak durur.

**Veride fiili ihlal (K2).** ARANDI — **ölçülemedi** (DB erişimi yok). Hazır sorgu:
```sql
-- (a) Uçuk tarih (Excel seri no / yıl olarak okunmuş hücre)
SELECT count(*) FROM orders
 WHERE "orderDate" > now() + interval '10 years' OR deadline > now() + interval '10 years'
    OR "orderDate" < timestamptz '2000-01-01';
-- (b) Ay sonu kayması izi: ayın 1-3'üne düşen ve içe aktarımla gelmiş sipariş tarihleri
SELECT date_trunc('day', "orderDate" AT TIME ZONE 'Europe/Istanbul')::date AS gun, count(*)
  FROM orders GROUP BY 1 HAVING count(*) > 1 ORDER BY 1;
```

**Repro (K3).** `Teks-Erp/scripts/audit_repro_E-1-02.ts` → `audit/repro/E-1-02.log` (üretim modülü birebir import edildi)
```
31.02.2026 → 3.03.2026 00:00  ← SESSİZ KAYMA        29.02.2026 → 1.03.2026 (artık yıl DEĞİL)
"45900" → yıl 45899   "0" → yıl 1999   "1" → yıl 2000   "99999" → yıl 99998
6/6 geçersiz takvim günü kabul edildi · 6/6 tarih-olmayan hücre tarih sayıldı
```

**İş etkisi.** Sipariş/termin verisi sessizce yanlış — üretim önceliği, OTIF karnesi, Geciken Siparişler ve Ürün Dengesi hepsi bu iki kolonu okur. Kullanıcıya hiçbir uyarı çıkmadığı için hata dosyanın kendisinde aranır, sistemde değil.

**Öneri (2. tur için).** `parseDateCell`'de iki satırlık kapı:
```ts
const at = new Date(utcGuess - offsetMs);
// Takvim doğrulaması: JS'in devretmesini yakala
const back = new Intl.DateTimeFormat("en-CA", { timeZone: FACTORY_TIMEZONE, year:"numeric", month:"2-digit", day:"2-digit" }).format(at);
if (back !== `${y}-${p(m)}-${p(d)}`) return null;   // 31.02 → reddet
```
ve serbest yedeği daralt: `new Date(s)` yalnız **tam ISO** desenine (`/^\d{4}-\d{2}-\d{2}T/`) uyuyorsa kullanılsın; salt rakam içeren hücre `null` dönsün (hata mesajı zaten var: "tarih okunamadı — GG.AA.YYYY yazın"). Migration yok, veri dokunuşu yok, `prod_risk: düşük`. Not: Excel seri numarasını **desteklemek** ayrı bir karardır; bu düzeltme onu sessiz kabulden açık redde çevirir.

**Kabul kriteri.** `audit_repro_E-1-02.ts` §1'de 6/6 satır `null`; §2'de 6/6 satır `null`; §3 (geçerli tarih → yerel 00:00) değişmeden geçer.
**Efor.** 0.3 gün (+ 0.2 gün bekçi: `scripts/test_import_*` içine sınır vakaları).
**Önceki defter.** Yok.

---

### [E-1-03] "Tarih-yalnız" alanlar UTC gece yarısına çakılıyor: UTC+3'te bu seçilen günün **03:00'ıdır** → bugün terminli sipariş 400 alır, termin gününde kapanan sipariş OTIF'te GEÇ sayılır, 00:00–03:00'te açılan kayıt formda bir gün geri görünür

| Şiddet | S2 | Kategori | E (İş kuralı) / C — kontrol listesi E1a/E1c | Öncelik | P2 | Modül | sipariş · iş emri · raporlar | Kanıt seviyesi | K3 |

**Özet.** Termin (`Order.deadline`), iş emri planlı tarihleri ve süreli izin sınırları istemcide **`YYYY-MM-DD`** olarak seçiliyor ve `new Date(ymd).toISOString()` ile gönderiliyor. JS bu biçimi **UTC gece yarısı** olarak okur; Türkiye kalıcı UTC+3 olduğu için saklanan an seçilen günün **yerel 03:00**'ıdır — fabrika gününün başlangıcı değil (`factoryDayStart` 21:00Z verir, gönderilen 00:00Z). Backend bu değeri **bir AN** olarak `now()`/`completedAt` ile kıyaslıyor. Üç somut sonuç doğuyor (üçü de ölçüldü).

**Kanıt — istemci sözleşmesi (Electron, salt-okunur inceleme).**
```ts
// Electron/src/pages/Operations/Orders/OrdersPage.tsx:168 ve :205
deadline: v.deadline ? new Date(v.deadline).toISOString() : null,   // v.deadline = "2026-09-01"
// Electron/src/pages/Operations/Orders/OrderFormDialog.tsx:53
deadline: order.deadline ? order.deadline.slice(0, 10) : "",        // ISO'nun UTC gün parçası
// Electron/src/pages/Operations/WorkOrders/workOrderPayload.ts:15-17
function dateOrNull(s) { if (!s) return null; return new Date(s).toISOString(); }
// Electron/src/pages/Operations/WorkOrders/workOrderPrefill.ts:22-25
function dateToInput(iso) { return iso.slice(0, 10); }
```

**Kanıt — backend, üç tüketici.**
```ts
// (a) Teks-Erp/src/services/order.service.ts:955-964  — create yolunda ref = NOW
private assertDeadlineNotBeforeOrderDate(deadline: unknown, orderDate: unknown): void {
    const d = new Date(deadline as string);
    const ref = orderDate != null ? new Date(orderDate as string) : new Date();   // ← orderDate gönderilmiyor
    if (d.getTime() < ref.getTime()) throw AppError.badRequest("Termin tarihi sipariş tarihinden önce olamaz");
}
// çağrı: order.service.ts:1855 (create). update yolunda (:2277-2282) referans current.orderDate — orası DOĞRU.

// (b) Teks-Erp/src/services/reports/shipment-scorecard.report.service.ts:103-104 (OTIF)
COUNT(*) FILTER (WHERE o.deadline IS NOT NULL AND o."completedAt" <= o.deadline) AS "onTime",

// (c) Teks-Erp/src/services/reports/open-order-coverage.report.service.ts:203-206
const late = line.deadline && line.deadline.getTime() < now
  ? Math.floor((now - line.deadline.getTime()) / 86_400_000) : null;
if (late != null && uncovered.greaterThan(0)) { sum.overdueLines++; ... }
```
- Backend'in kendi varsayılanı da tarih-yalnız DEĞİL: `order.service.ts:1848-1852` `deadline = orderDate + N gün` — **siparişin girildiği saati taşır**. Yani iki sipariş "7 gün termin" dese de biri saat 08:00'de, diğeri 22:00'de biter.
- İş emri tarafı: `src/services/workorder.service.ts:388-399` `resolvePlanDates` — `plannedStartDate = startInput ? new Date(startInput) : new Date()`.
- **Koruma yok teyidi:** (a) backend'de tarih-yalnız değerleri fabrika gününe oturtan hiçbir normalizasyon yok (`grep factoryDayStart src/services/order.service.ts` = 0 sonuç); (b) `Order.deadline` `DateTime? @db.Timestamptz` (`prisma/schema.prisma:1975`) — CHECK/trigger yok; (c) Zod yalnız `z.coerce.date()` (tip), semantik yok; (d) `scripts/test_report_day_boundary.ts` yalnız `DATE_TRUNC`/`CURRENT_DATE`/`setHours` tarar — bu sınıfı görmez; (e) `scripts/test_order_leadtime.ts` termin gün sınırını sondalamıyor.

**failure_mode (üç ayrı, üçü de ölçüldü).**
1. **"Bugün terminli sipariş" 400.** Planlamacı sabah 08:00'de acil sipariş girer, termini "bugün" seçer. Gönderilen `deadline = bugün 00:00Z`, `ref = now = bugün 05:00Z` → `d < ref` → **400 "Termin tarihi sipariş tarihinden önce olamaz"**. Mesaj sipariş tarihinden söz eder ama kullanıcı sipariş tarihi girmemiştir; tek çıkış yolu termini yarına almaktır. Kural yalnız gece 00:00–03:00 arasında geçer.
2. **OTIF termin gününü GEÇ sayar.** Termini 1 Eylül olan sipariş 1 Eylül saat 15:00'te kapanır → `completedAt (12:00Z) > deadline (00:00Z)` → karnede **GEÇ**; `lateDaysSum`'a 0,5 gün eklenir. Termin günü fiilen sabah 03:00'a kadardır. Aynı sipariş gece 01:00'de kapansaydı "zamanında" sayılırdı.
3. **Gece penceresinde form bir gün geri gösterir ve kaydedince geri yazar.** Gece 01:00'de açılan iş emrinin `plannedStartDate`'i `new Date()` = 31 Ağustos 22:00Z olur. Düzenle diyaloğu `iso.slice(0,10)` ile **"2026-08-31"** gösterir (fabrika günü 1 Eylül'dür). Kullanıcı başka bir alanı düzeltip kaydederse plan başlangıcı kalıcı olarak **31 Ağustos 00:00Z**'ye (1 Eylül 03:00 yerine 31 Ağustos 03:00) geri yazılır — 1 gün + 22 saat geriye.

**Veride fiili ihlal (K2).** ARANDI — **ölçülemedi** (DB erişimi yok). Hazır sorgular:
```sql
-- (a) Kaç termin "gece yarısı" damgası taşıyor (istemciden gelen) vs saat taşıyor (backend varsayılanı)?
SELECT date_part('hour', deadline AT TIME ZONE 'Europe/Istanbul') AS yerel_saat, count(*)
  FROM orders WHERE deadline IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;   -- 3 = istemci; diğerleri = varsayılan
-- (b) OTIF'in yanlış "geç" saydığı siparişler: aynı TAKVİM GÜNÜNDE kapandığı hâlde geç sayılanlar
SELECT count(*) FROM orders
 WHERE "completedAt" IS NOT NULL AND deadline IS NOT NULL AND "completedAt" > deadline
   AND ("completedAt" AT TIME ZONE 'Europe/Istanbul')::date <= (deadline AT TIME ZONE 'Europe/Istanbul')::date;
-- (c) Gece penceresinde doğmuş plan tarihleri (form bir gün geri gösterir)
SELECT count(*) FROM work_orders
 WHERE date_part('hour', "plannedStartDate" AT TIME ZONE 'Europe/Istanbul') < 3;
```

**Repro (K3).** `Teks-Erp/scripts/audit_repro_E-1-03.ts` → `audit/repro/E-1-03.log` (üretim `constants/time` import edildi, backend kuralları birebir kopyalandı)
```
'1 Eylül' seçildi → 2026-09-01T00:00:00.000Z = fabrika saatiyle 1.09.2026 03:00:00
  (fabrika gününün gerçek başlangıcı 2026-08-31T21:00:00.000Z)
Bugün terminli sipariş: 08:00 / 13:00 / 18:00 → 400 · yalnız 01:30'da kabul   (3/4)
OTIF: 1 Eylül 07:00 / 15:00 / 23:00 kapanış → GEÇ · yalnız 01:00 ZAMANINDA     (3/4)
open-order-coverage: termin GÜNÜNDE late = 0 (null olmalıydı) → overdue kovasına düşüyor
Gece penceresi: 01:00 ve 02:59'da açılan İE formda 2026-08-31 görünüyor (fabrika günü 2026-09-01)
```

**İş etkisi.** (1) Acil (aynı gün terminli) sipariş sisteme girilemiyor — operasyonel tıkanma, yanlış hata mesajı. (2) OTIF (Sevkiyat Karnesi) ve Açık Sipariş Karşılama raporu termin gününü sistematik olarak fabrikanın aleyhine sayıyor; "geciken sipariş" listesi termin gününün sabahında dolmaya başlıyor. (3) İş emri plan tarihleri düzenleme sırasında sessizce geri kayıyor — Refakat Kartı'na basılan planlı tarih de bundan besleniyor (`traveler-card.service.ts:1156-1157`).

**Öneri (2. tur için).**
- **Sözleşmeyi yaz ve TEK yerde uygula:** "termin/planlı tarih bir TAKVİM GÜNÜDÜR". Backend, tarih-yalnız gelen (saat bileşeni 00:00Z olan) değerleri kabul ederken **fabrika gününün SONUNA** çeksin (`factoryDayStart(d + 1 gün) − 1 ms`) — böylece "1 Eylül termini" 1 Eylül 23:59:59.999 yerel olur ve üç failure_mode da kapanır. Alternatif: kolonu `@db.Date`'e çevirmek (migration + tüm okuyucular → `prod_risk: yuksek`, geri alma = kolon tipini geri çevirme; bu tur için önerilmez).
- `assertDeadlineNotBeforeOrderDate` create yolunda `ref`i `factoryDayStart(new Date())` yapsın (gün kıyası, an kıyası değil).
- İstemci tarafında `slice(0,10)` yerine fabrika günü (`Intl` + `Europe/Istanbul`) ile biçimle — aksi hâlde gece penceresinde görüntü hâlâ bir gün geri kalır (`Electron/src/pages/Operations/Orders/OrderFormDialog.tsx:53`, `WorkOrders/workOrderPrefill.ts:22-25`, `Access/Users/PermissionsTab.tsx:58`).
- Bekçi: `test_report_day_boundary.ts`'e "tarih-yalnız alan" bölümü — `deadline`/`plannedStartDate`/`validUntil` yazan yolların fabrika gün sınırına oturduğunu ölçen negatif sondalı kontrol.

**Kabul kriteri.** `audit_repro_E-1-03.ts` §2'de 4/4 "kabul"; §3'te 4/4 "ZAMANINDA"; §4'te `late === null`; §5'te 0/3 kayma.
**Efor.** 1,5 gün (backend 0,5 + Electron 0,5 + bekçi 0,5).
**Önceki defter.** Yok. (Kök `CLAUDE.md`'nin "fabrika günü" kuralının kapsamadığı alan: kural OKUMA/gruplama tarafına uygulanmış, YAZMA tarafındaki tarih-yalnız alanlara uygulanmamış.)

---

### [E-1-04] Süreli yetki "gün sonu" değil **03:00** biter; "bugüne kadar" verilemez — sessiz 403 gece vardiyasının ortasında

| Şiddet | S3 | Kategori | E / G — kontrol listesi E1f | Öncelik | P3 | Modül | yetki / oturum | Kanıt seviyesi | K3 |

**Özet.** E-1-03'ün mekanizması yetki tarafında ayrı bir sahibe ve ayrı bir patlama yarıçapına sahip. Panelden verilen süreli yetkinin bitişi `"YYYY-MM-DD"` gider, `z.coerce.date()` bunu UTC gece yarısı yapar; oturum ömrü bu ana kelepçelenir (`auth.service`). Sonuç: "5 Eylül'e kadar" verilen yetki **5 Eylül sabah 03:00'ta** düşer — o günün ~21 saati yetkisizdir. Ayrıca `.refine(validUntil > new Date())` yüzünden "bugüne kadar geçerli" yetki çalışma saatlerinde **400** alır.

**Kanıt.**
```ts
// Teks-Erp/src/routes/admin.routes.ts:332,339-341
  validUntil: z.coerce.date().optional().nullable(),
  .refine((v) => !v.validUntil || v.validUntil > new Date(), { ..., path: ["validUntil"] })
// Teks-Erp/src/services/auth.service.ts:317-338  (oturum bu ana kırpılır)
  validUntil: { gt: nowDate }, ... orderBy: { validUntil: "asc" }
  for (const boundary of [nearestExpiry?.validUntil, nearestOpening?.validFrom]) {
    if (boundary && (!hasExp || boundary.getTime() < effectiveExpiresAt.getTime())) { effectiveExpiresAt = boundary; hasExp = true; }
  }
// İstemci: Electron/src/pages/Access/Users/PermissionsTab.tsx:58 ve :141
  for (const g of grants) if (g.validUntil) initialDates[g.permissionId] = g.validUntil.slice(0, 10);
  selected.map((id) => ({ permissionId: id, validUntil: dates[id] || null }));   // "YYYY-MM-DD"
```
- **Koruma yok teyidi:** (a) backend'de gün-sonu normalizasyonu yok; (b) `user_permissions.validUntil` üzerinde CHECK yok; (c) `scripts/test_timed_permissions.ts` gün sınırını değil yalnız "süre dolunca yetki düşüyor mu"yu sondalıyor; (d) `auth.service.ts:370-374` `Math.max(1, …)` yalnız negatif `expiresIn`i kelepçeler (bu DOĞRU yazılmış, ayrı konu).

**failure_mode.** Süpervizör, vardiya amirine 5 Eylül'e kadar `roll:manual-adjust` verir (`validUntil = "2026-09-05"` → 2026-09-05T00:00:00Z). 5 Eylül gece 02:00'de gece vardiyası amiri Tambur'da kayıt düzeltmesi yapabiliyorken saat **03:00'ı geçtiğinde** aynı işlem **403** döner; ekranda "yetkiniz yok" yazar, hiçbir yerde "yetkinizin süresi bugün sabah doldu" bilgisi yoktur. Üstelik oturum token'ı da 03:00'ta biteceği için kullanıcı vardiya ortasında yeniden giriş yapmak zorunda kalır. İkinci uç: aynı süpervizör "bugün için" yetki vermek isterse (`validUntil` = bugün) istek **400** alır ve tek çıkışı yarını seçmektir — yani yetkiyi istediğinden bir gün fazla verir (SoD gevşemesi).

**Veride fiili ihlal (K2).** ARANDI — **ölçülemedi** (DB erişimi yok). Hazır sorgu:
```sql
SELECT date_part('hour', "validUntil" AT TIME ZONE 'Europe/Istanbul') AS yerel_saat, count(*)
  FROM user_permissions WHERE "validUntil" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;  -- 3 = gün-sonu değil sabah
```

**Repro (K3).** `Teks-Erp/scripts/audit_repro_E-1-03.ts` §6 → `audit/repro/E-1-03.log`
```
'Bugüne kadar geçerli' izin @ 1.09.2026 10:00:00 → 400 'Geçerlilik bitişi gelecekte olmalı'
'2 Eylül'e kadar' izin → yetki 2.09.2026 03:00:00'da düşüyor (2 Eylül vardiyasının ~21 saati yetkisiz)
```

**İş etkisi.** Süreli yetki mekanizması (SoD üçlüsü: `shipping:invoice`, `shipping:undo-dispatch`, `roll:manual-adjust`) fabrikanın anladığı "gün" ile çalışmıyor. Gece vardiyasında sessiz 403; yetki verirken bir gün fazla verme eğilimi.

**Öneri (2. tur için).** `admin.routes.ts` şemasında `validUntil`/`validFrom` için gün normalizasyonu: gelen değerin saat bileşeni 00:00Z ise `validUntil = factoryDayStart(d + 1 gün) − 1 ms`, `validFrom = factoryDayStart(d)`. `.refine`'ı da gün kıyasına çevir (`validUntil >= factoryDayStart(now)`). Migration yok, izin kodu yok; APK gerekmez (panel işi). `prod_risk: düşük` — mevcut satırlar dokunulmadan kalır, yalnız yeni yazımlar düzelir (geçmiş satırları düzeltmek ayrı, dry-run'lı script işidir).

**Kabul kriteri.** `test_timed_permissions.ts`'e iki kontrol: "bugüne kadar" yetkisi kabul edilir; "yarına kadar" yetkisi yarın 23:59 yerelde hâlâ geçerlidir, ertesi gün 00:01'de değildir.
**Efor.** 0,5 gün.
**Önceki defter.** Yok.

---

### [E-1-05] Belge numarası GGAAYY taşıyor → **sözlüksel sıra kronolojik değil**; ama `workOrderNumber`/`shipmentNo` sıralanabilir kolon. Ayrıca 9999'u aşan sıra biçim sözleşmesini sessizce kırıyor

| Şiddet | S3 | Kategori | L / F — kontrol listesi E1b | Öncelik | P4 | Modül | belge no / listeler | Kanıt seviyesi | K3 |

**Özet.** İki ayrı sayaç ucu, tek kök: `PREFIX + GGAAYY + NNNN`.
**(a) Sıralama.** Kod GÜN-AY-YIL ile başladığı için sözlüksel sıra tarihsel sıra değildir: `IE0109260001 < IE3108260001` (1 Eylül, 31 Ağustos'tan önce sıralanır) ve yıl devrinde `IE0101270001 < IE3112260001`. Repo bu tuzağı **yalnız parti no için** yazıya dökmüş (`code-format.ts:33-35`: "Parti listeleyen hiçbir yer `orderBy: batchNumber` KULLANMAZ") ama aynı önek iş emri / sevkiyat numaralarında da var ve **o iki alan sıralanabilir kolon olarak sunuluyor**.
**(b) Tavan.** Günlük sıra 9999'u aşarsa `String(seq).padStart(4,"0")` beş hane üretir; kod 13 karakterden 14'e çıkar ve `isDailyCode()` (tarama girişi doğrulaması) onu artık **tanımaz**. Sayacın kendisi doğru devam eder (numerik max), ama biçim sözleşmesi sessizce kırılır. Karşı örnek aynı repoda: top barkodunda tavan **409 ile fail-closed** kapatılmıştır.

**Kanıt.**
```ts
// Teks-Erp/src/utils/code-format.ts:33-35  (yasak YALNIZ parti için yazılı)
//   ⚠️ Bedeli: dolgusuz kodda SÖZLÜKSEL sıra ≠ SAYISAL sıra (`P05082610` < `P0508262`).
//   Parti listeleyen hiçbir yer `orderBy: batchNumber` KULLANMAZ...
// Teks-Erp/src/services/workorder.service.ts:28-36
const WO_SORTABLE_FIELDS = ["createdAt","updatedAt","plannedEndDate","plannedStartDate","targetQuantity","workOrderNumber","status"] as const;
// Teks-Erp/src/services/shipping.service.ts:2346-2348
const SORTABLE = ["createdAt", "shipmentNo", "dispatchedAt"] as const;
// Tavan: sıra kodu 4 haneye elle dolduruluyor (buildDailyCode kullanılmıyor)
//   workorder.service.ts:591  `${prefix}${String(seq).padStart(4, "0")}`
//   workorder.service.ts:6549 (manifest CL) · free-document.service.ts:48 (SD)
//   fabric-property.service.ts:48 (OZL) · subcontractor.service.ts:1242,2785 (FS/FK, buildDailyCode ile)
// Karşı örnek (DOĞRU): roll-barcode.helper.ts:90-94
if (first < 1 || last > MAX_ROLL_SEQ) throw AppError.conflict(`Bu gün için ${type} top barkod sırası doldu (${MAX_ROLL_SEQ}). Yarın 0001'den başlar.`);
```
- **Koruma yok teyidi:** (a) `resolveSortBy` yalnız alanın allowlist'te olup olmadığına bakar, semantiğine değil (`base.service.ts:403,427,666`); (b) belge no üreten hiçbir yerde 9999 kontrolü yok (`grep -n "9999" src/services/*.ts` → yalnız `roll-barcode.helper`); (c) `orderNumber`/`shipmentNo`/`workOrderNumber` üzerinde uzunluk CHECK'i yok, kolonlar `VarChar(64)` (`prisma/schema.prisma:1961,2152`) → 14 karakter DB'ye sorunsuz yazılır; (d) `scripts/test_batch_number_format.ts` yalnız parti biçimini ölçer.

**failure_mode.**
(a) Planlamacı İş Emirleri listesinde "İş Emri No" başlığına tıklar (azalan). Beklediği "en yeni iş emri en üstte"dir; aldığı şey **ayın 31'inde açılmış tüm iş emirleri en üstte**, sonra 30'unda açılanlar… Ay/yıl karışır. Aynı şey Sevkiyatlar'da "Sevkiyat No" ile olur. Hata mesajı yok; liste "bozuk" değil, yalnız anlamsız.
(b) Yoğun bir günde 10.000. sipariş/iş emri numarası `SIP01092610000` olur; `isDailyCode(code,"SIP")` **false** döner. Bu doğrulamayı kullanan tarama/giriş yolları o kaydı "geçersiz kod" sayar (bugün `isDailyCode`'un çağrıldığı yer sınırlı olsa da sözleşme kırılmıştır ve etikete basılan sabit-genişlik varsayımı da düşer).

**Veride fiili ihlal (K2).** ARANDI — **ölçülemedi** (DB erişimi yok). Hazır sorgu:
```sql
SELECT max(length("workOrderNumber")) FROM work_orders;      -- 12'yi aşan = 9999 taşması yaşandı
SELECT max(length("orderNumber")) FROM orders;
SELECT "day","type",n FROM roll_barcode_counters ORDER BY n DESC LIMIT 5;  -- top barkodunda tavana yakınlık
```
Ölçek notu (KUNYE): saha 213 iş emri / 278 sipariş → 9999/gün tavanına bugün uzak; sıralama sorunu ise **bugün** görünür.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_E-1-04.ts` → `audit/repro/E-1-04.log`
```
kronolojik : IE3008260001 → IE3108260001 → IE0109260001 → IE0209260001 → IE3112260001 → IE0101270001
sözlüksel  : IE0101270001 → IE0109260001 → IE0209260001 → IE3008260001 → IE3108260001 → IE3112260001
seq=10000 → SIP01092610000 (uzunluk 14, isDailyCode=false)     seq=9999 → isDailyCode=true
Karşı örnek: T010926H10000 → ROLL_BARCODE_RE=false + helper 409 fırlatıyor (fail-closed)
```

**İş etkisi.** (a) Liste sıralaması operatörü yanıltır — "en son açtığım iş emri nerede" sorusu numara sırasıyla cevaplanamaz. (b) Tavanda biçim sözleşmesinin sessizce kırılması, etiket/tarama tarafında ileride teşhis edilmesi zor bir sınıf açar.

**Öneri (2. tur için).**
- Sıralama: `workOrderNumber`/`shipmentNo`/`orderNumber` sıralama isteğini **`createdAt`'e eşle** (kullanıcı "numaraya göre" derken kronoloji kastediyor) ya da SQL tarafında `substring(no from 9 for 2) || substring(no from 7 for 2) || substring(no from 5 for 2) || substring(no from 11)` gibi bir sıralama ifadesi kullan. En ucuz ve tutarlı yol birincisidir; kolon başlığını "İş Emri No (tarih sırası)" diye açıkla.
- Tavan: sıra üreten beş noktayı `buildDailyCode` altında topla ve `seq > 9999` olduğunda `roll-barcode.helper` emsaliyle **409 fail-closed** ver ("Bugünün belge sırası doldu"). Migration yok, veri dokunuşu yok.
- Bekçi: `code-format.ts:33-35`'teki yasağı mekanikleştir — AST bekçisi `orderBy: { <no alanı> }` yazımını yakalasın (fason açık-sevk tek-kaynak bekçisinin emsali, `test_fason_open_dispatch_single_source`).

**Kabul kriteri.** `audit_repro_E-1-04.ts` §1'de seq 10000 için `isDailyCode=true` **ya da** üretim yolunun 409 vermesi; §3'te sözlüksel sıra = kronolojik sıra (ya da ilgili alanların sıralanabilir listeden çıkması).
**Efor.** 0,5 gün.
**Önceki defter.** Yok. (Parti no tarafı bilinçli karar — `parti-no-kisa-donen`, `parti-no-bicimi-dolgusuz`; bu bulgu o kararı AÇMAZ, kararın yazılı sonucunun diğer kod ailelerine uygulanmamış olmasını yazar.)

---

### [E-1-06] `finalizedAt`/`statusChangedAt` trigger'ı `now()` (= TRANSACTION başlangıcı) yazıyor: damga olayın anı değil, tx'in açıldığı andır — gece yarısına yayılan tx topu bir ÖNCEKİ günün karnesine yazar ve damga topun `createdAt`'inden ÖNCE olabilir

| Şiddet | S3 | Kategori | C / E — kontrol listesi E1c | Öncelik | P3 | Modül | raporlar (kalite/fire/stok karnesi) | Kanıt seviyesi | K1 |

**Özet.** Üretim damgalarını yazan trigger `now()` kullanıyor. PostgreSQL'de `now()` = `transaction_timestamp()` — **transaction'ın başladığı an**, ifadenin koştuğu an değil (`clock_timestamp()` onu verir). Damgayı yazan akışlar (Tambur finalize, fason kabul, kapanış dispozisyonu) uzun, çok yazmalı transaction'lardır. Sonuç iki uçta görünür: (1) tx gece yarısını geçerse top **bir önceki fabrika gününün** karnesine düşer; (2) aynı tx'te doğan top için damga, topun kendi `createdAt`'inden **önce** olabilir.

**Kanıt.**
```sql
-- Teks-Erp/prisma/migrations/20260809090000_roll_production_timestamps/migration.sql:45-91
CREATE OR REPLACE FUNCTION "roll_stamp_production_timestamps"() ...
  IF TG_OP = 'INSERT' THEN
    IF NEW."statusChangedAt" IS NULL THEN NEW."statusChangedAt" := now(); END IF;      -- :51
    IF NEW."finalizedAt" IS NULL AND NEW."status" IN ('WAREHOUSE','A1_STOCK','SCRAP')
      THEN NEW."finalizedAt" := now(); END IF;                                          -- :58
  ...
    NEW."finalizedAt" := now();                                                         -- :85
```
Migration'ın kendi yorumu (`:40-44`) `now()`in **saat dilimi** tarafını gerekçelendiriyor ("çıplak `now()` GÜVENLİ") — bu doğrudur; tartışılmayan şey `now()`in **transaction_timestamp** semantiğidir.
- Tüketiciler gün kovasına keser: `src/services/reports/quality-scorecard.report.service.ts:311-317` ve `scrap-scorecard.report.service.ts:328-333` → `${factoryDaySql('r."finalizedAt"')} AS day` + `r."finalizedAt" >= range.from`.
- Aynı satırda **iki farklı saat kaynağı** yaşıyor: `createdAt` Prisma/DB default ile, `updatedAt` Prisma tarafından (`@updatedAt`, DDL'de DEFAULT yok → uygulama saati), `finalizedAt`/`statusChangedAt` DB `now()` ile yazılıyor.
- **Koruma yok teyidi:** (a) trigger'da `clock_timestamp()` kullanılmıyor; (b) `finalizedAt >= createdAt` gibi bir CHECK yok (`prisma/schema.prisma` Roll bloğu + `test_db_invariants` envanteri); (c) `scripts/test_quality_scorecard.ts` gün sınırını sondalamıyor (K7b'nin de gözlemi); (d) uygulama katmanında damgayı yeniden yazan/düzelten kod yok — bilinçli ("trigger atlanamaz").

**failure_mode.** Tambur operatörü 23:59:58'de "Bitir"e basar. Finalize transaction'ı açılır (belgeli: 225 satır + 8 yazma + 3 tx-helper; ölçülmüş kilit süreleri saniye mertebesinde), COMMIT 00:00:03'te gerçekleşir. Trigger `finalizedAt = 23:59:58` yazar. Kalite Karnesi `factoryDaySql('finalizedAt')` ile keser → toplar **düne** yazılır; oysa aynı topların `createdAt`'i (kesim çocukları için) bugündür ve Envanter listesi onları bugün gösterir. Vardiya amiri "gece 40 top çıktı, karnede 12 var" der; iki ekran da kendi içinde tutarlıdır. İkinci uç: aynı tx'te doğan kesim çocuğu için `finalizedAt` (tx başı) < `createdAt` (INSERT anı) olur → "üretim tamamlanma" damgası "doğuş"tan önce görünür ve `finalizedAt − createdAt` ile süre hesaplayan her yeni yüzey **negatif** üretir.

**Veride fiili ihlal (K2).** ARANDI — **ölçülemedi** (DB erişimi yok). **Ancak Tur 2 bu ihlali ZATEN ÖLÇMÜŞ**: `BULGU-T2-034` — "955 kayıtta damga doğuştan önce". Bu bulgu o ölçümün **mekanizmasını** veriyor (Tur 2 olguyu saptamıştı, sebebi değil). Doğrulama sorguları:
```sql
-- (a) Damga doğuştan önce — Tur 2'nin 955 kaydı; farkın dağılımı tx süresini verir
SELECT count(*) AS adet,
       max(extract(epoch from ("createdAt" - "finalizedAt"))) AS max_fark_sn,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY extract(epoch from ("createdAt" - "finalizedAt"))) AS medyan_sn
  FROM rolls WHERE "finalizedAt" IS NOT NULL AND "finalizedAt" < "createdAt";
-- (b) Gün sınırını gerçekten geçen kayıt var mı?
SELECT count(*) FROM rolls
 WHERE "finalizedAt" IS NOT NULL
   AND ("finalizedAt" AT TIME ZONE 'Europe/Istanbul')::date <> ("createdAt" AT TIME ZONE 'Europe/Istanbul')::date
   AND "finalizedAt" < "createdAt";
```
(b) sıfır dönerse etki bugün yalnızca "damga doğuştan önce" tuhaflığıdır; sıfır değilse karne kayması fiilen yaşanmıştır.

**Repro (K3).** Yazılamadı — tetiklemek için DB'de gerçek bir transaction gerekir (Postgres erişilemedi). Negatif sonuç kaydı: bu bulgunun kanıtı **kod + migration + Tur 2'nin veri ölçümü**dür (K1 + önceki defter).

**İş etkisi.** Kalite Karnesi, Fire Karnesi ve Stok Karnesi'nin dönem çıpası; gece vardiyasının son dakikalarında kapanan işler önceki güne yazılıyor. `finalizedAt`'i "üretim anı" sayan her yeni rapor aynı hatayı miras alır.

**Öneri (2. tur için).** Trigger'da `now()` → **`clock_timestamp()`**. `clock_timestamp()` de `timestamptz` döner, saat dilimi gerekçesi (`:40-44`) aynen korunur; değişen tek şey "tx başı" yerine "ifade anı"dır. Migration gerektirir (`CREATE OR REPLACE FUNCTION`, tablo yeniden yazımı YOK, kilit anlıktır) → **`prod_risk: orta`**; geri alma = aynı fonksiyonu `now()` ile yeniden yaratmak (tek `CREATE OR REPLACE`, veri dokunuşu yok). **Geçmiş 955 satır düzeltilmemeli** — mutabakat kapısının kırmızısı kök nedeni görünür tutar (2026-08-22 kararının aynısı). Ayrıca `test_quality_scorecard.ts`'e gün-sınırı sondası ekle.

**Kabul kriteri.** Yeni bir bekçi: bir tx aç → 2 sn bekle → final statüde top yarat → COMMIT; `finalizedAt >= createdAt` ve `finalizedAt` tx başına DEĞİL INSERT anına yakın olmalı (fark < 200 ms).
**Efor.** 0,5 gün.
**Önceki defter.** `BULGU-T2-034` (Tur 2 — "955 kayıtta damga doğuştan önce"). Bu satır o olgunun sebebini ve gün-sınırı sonucunu ekler; olguyu yeniden AÇMAZ.

---

### [E-1-07] KK1 giriş damgası kelepçeyi aşınca **sessizce** sunucu saatine düşüyor — bozuk saatli tablette çevrimdışı kuyruk boşalınca meşru toplar 409 fırtınası üretir ve "damgaya güvenilmedi" hiçbir yerde ölçülmüyor

| Şiddet | S3 | Kategori | E / I — kontrol listesi E1d | Öncelik | P4 | Modül | KK1 ham giriş | Kanıt seviyesi | K1 |

**Özet.** `resolveEntryStamp` istemcinin beyan ettiği giriş anını kabul ederken iki kelepçe uyguluyor: geçmişte 36 saat, gelecekte 5 dakika. Kelepçe **fail-open** (üretimi durdurmuyor — doğru karar) ama **sessiz**: kelepçeyi geçemeyen beyan `null` olarak saklanıyor ve mükerrer tuzağının 90 sn penceresi sunucu saatine düşüyor. Tam da bu düşüş, damganın var olma sebebini ortadan kaldırıyor: çevrimdışı kuyruk tek flush'ta boşaldığı için sunucu saatiyle ölçülen pencere **her zaman doludur**.

**Kanıt.**
```ts
// Teks-Erp/src/services/helpers/duplicate-guard.helper.ts:36,42,113-127
export const ENTRY_STAMP_MAX_PAST_MS   = 36 * 60 * 60 * 1000;
export const ENTRY_STAMP_MAX_FUTURE_MS = 5 * 60 * 1000;
export function resolveEntryStamp(declared, now) {
  ...
  const plausible = d >= nowMs - ENTRY_STAMP_MAX_PAST_MS && d <= nowMs + ENTRY_STAMP_MAX_FUTURE_MS;
  return plausible ? { storedEnteredAt: declared, anchorMs: d } : { storedEnteredAt: null, anchorMs: nowMs };
}
// Kullanım: src/services/inventory.service.ts:813-814 + guard sorgusu :845-865
const { storedEnteredAt, anchorMs } = resolveEntryStamp(data.clientEnteredAt, nowForEntry);
```
Dosyanın kendi gerekçesi (`:93-96`) tam bu senaryoyu anlatıyor: *"sunucu saatiyle ölçülen 90 sn penceresi her flush'ta DAİMA doludur … bu yüzden 409 fırtınası üretirdi."* Kelepçe aşıldığında sistem **tam o eski davranışa** geri döner.
- Bayrak durumu: `kk1.duplicateGuardEnabled` kodda varsayılan KAPALI (`CLAUDE.md`), MEMORY notu `kk1-mukerrer-top-korumasi` sahada **AÇIK** diyor → yol canlı.
- İstemci damgayı UTC olarak gönderiyor (`mobil/src/offline/entryAttempt.ts:129` `now()` → ISO), yani naif-string/TZ karışıklığı YOK — tek değişken cihaz saatidir.
- **Koruma/gözlemlenebilirlik yok teyidi:** (a) kelepçe düşüşünde audit/log/sayaç YOK (`grep -n "storedEnteredAt" src` → yalnız yazım noktası); (b) `/api/admin/health` bu düşüşü saymıyor (`src/app.ts` health bloğu); (c) `scripts/test_kk1_duplicate_guard.ts` kelepçe sınırını (case 15 dışında) sondalıyor ama **kelepçe düşüşünün 409 fırtınasına yol açtığını** ölçmüyor; (d) cihaz saati doğrulayan/senkronlayan bir mekanizma yok.

**failure_mode.** Bir Tambur/KK1 tabletinin RTC pili biter, saat 2 gün geriye kayar (Android'de fabrika ağı internetsizse NTP düzeltmez). Operatör vardiya boyunca çevrimdışı 12 top girer; ağ gelince kuyruk boşalır. Her kaydın `clientEnteredAt`'i 36 saatlik kelepçeyi **geçemez** → hepsi `null` saklanır ve pencere sunucu saatine düşer. Aynı partiden eşit metrajlı (tekstilde olağan) ardışık toplar milisaniyelerle ayrıldığı için 2.–12. toplar **409 `POSSIBLE_DUPLICATE`** alır; operatör her biri için "gerçekten ayrı bir top" modalını onaylamak zorunda kalır. Sistem tarafında hiçbir iz yoktur: ne "bu cihazın saati bozuk" uyarısı, ne bir sayaç. Teşhis, operatörün şikâyetiyle başlar.

**Veride fiili ihlal (K2).** ARANDI — **ölçülemedi** (DB erişimi yok). Hazır sorgu:
```sql
-- Kelepçeye takılan giriş oranı (cihaz bazında): clientEnteredAt NULL ama kayıt yeni
SELECT r."createdMachineId", count(*) FILTER (WHERE r."clientEnteredAt" IS NULL) AS damgasiz,
       count(*) AS toplam
  FROM rolls r
 WHERE r."entrySource" IN ('SUPPLIER_RECEIPT','MANUAL_ENTRY') AND r."createdAt" > now() - interval '30 days'
 GROUP BY 1 ORDER BY 2 DESC;
-- Damga ile sunucu saati arasındaki fark dağılımı (saat kayması izi)
SELECT percentile_disc(ARRAY[0.5,0.95,1.0]) WITHIN GROUP (ORDER BY extract(epoch from ("createdAt" - "clientEnteredAt")))
  FROM rolls WHERE "clientEnteredAt" IS NOT NULL;
```

**Repro (K3).** Yazılamadı (DB gerekiyor). Saf katman kısmen ölçülebilir: `resolveEntryStamp` kelepçesi `scripts/test_kk1_duplicate_guard.ts` case 15'te var; eksik olan **düşüş sonrası 409 fırtınası** ölçümü.

**İş etkisi.** Tek bir bozuk saatli tablet, o cihazdan girilen her ham girişte onay modalı üretir; operatör modalı refleksle onaylamayı öğrenirse tuzak fiilen devre dışı kalır (gerçek mükerrer de onaylanır). Sessizlik, arızayı ay(lar)ca görünmez tutar.

**Öneri (2. tur için).** Kelepçe düşüşünü **ölçülebilir** yap: `resolveEntryStamp` `null` döndüğünde (a) `Roll` kaydına ek kolon GEREKMEZ — `clientEnteredAt IS NULL` zaten sinyaldir, ama beyanın **gelmiş olduğu** hâli ayırmak gerekir; en ucuz yol `/api/admin/health` altında process-local bir sayaç (`entryStampRejected`) + ilk düşüşte tek bir `AuditService.logEvent` (gürültü için cihaz başına günde 1). Ayrıca mobil tarafta cihaz saati ile sunucu saati farkı > 10 dk ise giriş ekranında bir bant ("Bu tabletin saati yanlış — X saat sapma"); sunucu farkı zaten `clientEnteredAt` ile `createdAt` arasında görüyor. Migration yok, izin yok; mobil bant APK ister. `prod_risk: düşük`.

**Kabul kriteri.** Bekçi: kelepçe dışı damgayla 5 ardışık aynı-metrajlı giriş → hepsinin 409 aldığı ÖLÇÜLÜR ve `/health` sayacı 5 artar (bugün 0 artıyor).
**Efor.** 0,5 gün (backend) + APK turu.
**Önceki defter.** `MEMORY.md → kk1-mukerrer-top-korumasi` ("boşluk 90 sn dışı") — bu satır o boşluğun **cihaz saati** ucunu ekler.

---

### [E-1-08] Gün sınırı tek kaynağa taşındı ama **gösterim/belge no tarafındaki 15 nokta hâlâ süreç saat dilimine bağlı** ve üretimde `TZ` pinlenmemiş — gece 00:00–03:00 penceresinde kâğıt ile kod farklı gün söyleyebilir

| Şiddet | S3 | Kategori | C / L — kontrol listesi E1a | Öncelik | P4 | Modül | belge render / iade belge no | Kanıt seviyesi | K1 |

**Özet.** `constants/time.ts` tam olarak bu hata sınıfını kapatmak için yazıldı ve okuma/gruplama tarafında uygulandı. Ama **kâğıda basılan tarihler** ve bir **belge numarası** hâlâ `Date.prototype.getDate()/getMonth()/getFullYear()` ile, yani süreç saat dilimiyle üretiliyor. Üretimde süreç TZ'si hiçbir yerde sabitlenmemiş: `ecosystem.config.js`'in `env` bloğunda `TZ` yok (Docker'da var). Bugün sonuç doğru (saha oturum TZ'si `Europe/Istanbul` ölçülmüş, K8 §2(4)) — kusur, doğruluğun **yazılı olmayan bir varsayıma** dayanması ve gece penceresinde iki yüzeyin ayrışabilmesi.

**Kanıt — süreç TZ'sine bağlı noktalar (grep `getDate()|getMonth()|getFullYear()` src/):**
| Dosya:satır | Ne üretiyor |
|---|---|
| `src/services/return.service.ts:1086` | **Belge NUMARASI** `IADE-GGAAYY-<id6>` (tek-kalıp `ddmmyy`/fabrika günü KULLANMIYOR) |
| `src/services/printed-document.service.ts:273` | Basım tarihi/saati (donmuş belge üstbilgisi) |
| `src/services/document-render/traveler-card.html.ts:145,152` · `traveler-card-raw.ts:58,66` | Refakat kartı tarih/saat |
| `document-render/fason-ceki.html.ts:191` · `fason-receipt.html.ts:84` · `fason-direct-ship.html.ts:138` | Fason çeki / kabul makbuzu tarihi |
| `document-render/shipment-dispatch.html.ts:265` · `return-dispatch.html.ts:69` | İrsaliye tarihi |
| `document-render/kartela-ceki.html.ts:103` · `quality-certificate.html.ts:81` · `free-document.html.ts:38` | Kartela çekisi / kalite sertifikası / serbest belge |
| `src/services/helpers/label-html.shared.ts:136-139` | **Etikete basılan** tarih/saat |
| `src/services/free-document.service.ts:140` | `printedAtText` |
| `src/services/helpers/backup-naming.helper.ts:26-27` | Yedek dosya damgası — **bilinçli** ("SUNUCUNUN YEREL saatiyle", `:23`) |

**Kanıt — pinleme yok.**
```js
// Teks-Erp/ecosystem.config.js:72-140  env bloğu: NODE_ENV, APP_ENV, PORT, HOST, BACKUP_* … TZ YOK
// Teks-Erp/Dockerfile:23              TZ=Europe/Istanbul   ← yalnız konteyner yolunda
```
- **Koruma yok teyidi:** (a) `scripts/test_report_day_boundary.ts:194-212` yalnız `DATE_TRUNC`/`CURRENT_DATE`/`setHours` tarar — `getDate()/getMonth()` hiç aranmıyor; (b) boot'ta TZ doğrulayan bir assert yok (`server.ts`'de `assertBaseServiceGuards` var, TZ yok); (c) `/api/admin/health` süreç TZ'sini raporlamıyor.
- Karşı-kanıt (mekanizmanın gerçekliği): `code-format.ts:55-61` aynı hatanın belge NUMARASI tarafında yaşandığını ve düzeltildiğini yazıyor: *"UTC kurulan/konteynere alınan bir sunucuda her gece 00:00–03:00 arasında üretilen belge numaraları BİR ÖNCEKİ günün GGAAYY'sini taşır"*. Gösterim tarafı bu düzeltmeye dahil edilmemiş.

**failure_mode.** Sunucu bir bakım sonrası UTC ile kurulur (ya da pm2 farklı bir Windows hesabından, farklı bölge ayarıyla başlatılır). Gece 01:30'da kesilen fason çekisinin **numarası** `FS0109260007` (fabrika günü — doğru), üstündeki **tarih** ise `31.08.2026` (süreç TZ'si UTC) basılır. Aynı kâğıt iki farklı gün söyler; fasoncu tarih üzerinden mutabakat yaptığı için itiraz doğar. Aynı gece kesilen iade irsaliyesinin **numarası** da `IADE-310826-…` olur — yani belge numarası bile fabrika gününden kayar (bu nokta `ddmmyy`'yi hiç kullanmıyor). Hata yok, log yok.

**Veride fiili ihlal (K2).** ARANDI — **ölçülemedi** (DB erişimi yok). Hazır sorgu (kayma yaşanmış mı):
```sql
-- İade belge numarasındaki GGAAYY ile kaydın fabrika günü uyuşuyor mu?
SELECT count(*) FROM roll_returns rr
 WHERE to_char(rr."createdAt" AT TIME ZONE 'Europe/Istanbul', 'DDMMYY')
    <> substring( (SELECT 'x') , 1, 0) || to_char(rr."createdAt" AT TIME ZONE 'UTC', 'DDMMYY');
-- (basitçe: gece penceresinde üretilmiş belge sayısı)
SELECT count(*) FROM roll_returns WHERE date_part('hour', "createdAt" AT TIME ZONE 'Europe/Istanbul') < 3;
```

**Repro (K3).** `audit_repro_E-1-01.ts` §4 süreç TZ'sini raporluyor (bu makinede `Europe/Istanbul`), yani kayma bugün üretilemiyor — **negatif sonuç da kanıttır**: kusur "bugün yanlış" değil, "doğruluk pinlenmemiş bir varsayıma bağlı"dır.

**İş etkisi.** Müşteriye/fasoncuya giden kâğıtta tarih ile belge numarası ayrışabilir; iade belge numarası tek-kalıp kuralının dışında. Etkinin ortaya çıkması için tek bir ops değişikliği (sunucu TZ'si) yeterli ve o değişiklik hiçbir bekçiyi kırmaz.

**Öneri (2. tur için).** İki adım, ikisi de ucuz:
1. **Pinle:** `ecosystem.config.js` `env` bloğuna `TZ: "Europe/Istanbul"` + `server.ts` boot'unda tek satır assert (`Intl.DateTimeFormat().resolvedOptions().timeZone !== FACTORY_TIMEZONE` → uyarı logu + `/health`'te alan). Deploy dışı risk yok.
2. **Tek kapıya al:** belge render'larındaki `p(d.getDate())…` yardımcılarını `constants/time.ts`'e taşınacak ortak `formatFactoryDate/Time` ile değiştir; `return.service.ts:1086`'daki `IADE-…` numarasını `dailyCodePrefix("IADE", d)` kalıbına çek (**⚠️ belge numarası biçimi değişir → yalnız YENİ kayıtlar; eski numaralar dokunulmaz**). Bekçi: `test_report_day_boundary.ts`'in tarayıcısına `getDate()|getMonth()|getFullYear()` deseni + `backup-naming.helper.ts` muafiyeti (orası bilinçli).

**Kabul kriteri.** `TZ=UTC npx tsx scripts/test_report_day_boundary.ts` yeşil kalır (bugün bu koşum gösterim noktalarını hiç ölçmüyor); yeni bekçi `TZ=UTC` altında belge tarihinin fabrika günüyle aynı olduğunu ölçer.
**Efor.** 0,5 gün.
**Önceki defter.** Yok (`code-format.ts:55-61` aynı sınıfın belge-numarası ucunu kapatmış; bu satır gösterim ucunun açık kaldığını yazar).

---

## Uygulanan kontrol listesi

Görevdeki E1a–E1g sınırları + prompt Bölüm 3 §E'nin bu alana düşen maddeleri.

| Madde | Durum |
|---|---|
| **E1a** Günlük belge sayacı GGAAYY — gün hangi saatte dönüyor; pg oturumu UTC vs Node TZ; `nextDailySeq` tarih kaynağı JS mi SQL mi; 00:00–03:00'te iki farklı gün öneki / sayaç sıfırlanmaması | **uygulandı.** Sayaç tarihi JS'te ve **fabrika gününden** çözülüyor (`ddmmyy` → `factoryYmd`); sorgu `startsWith: PREFIX+GGAAYY` ile aynı önekten besleniyor → önek ile sıra **tek kaynaktan**, gece penceresinde ayrışma YOK. Tüm çağrı yerleri (`workorder:585`, `:6546`, `free-document:42-48`, `fabric-property:39-48`, `subcontractor:111-128 + 1241-1242 / 2784-2785`, `batch.service:138-144`) kodu **aynı `prefix`/`date`'ten** kuruyor → "önek D günü, kod D+1 günü" tuzağı YOK (ayrıca ölçüldü: repro E-1-04 §5 yıl devrini doğru döndürüyor). **Gösterim/İADE numarası tarafı açık → E-1-08.** |
| **E1b** 9999 taşması (`Number.isFinite` guard O-4), 10000. belge, parti dolgusuz sıralama, P99→P01 körlemesine sarma, yıl dönümü sözlüksel sıralama, `'…23:59:59.999'` kesme | **uygulandı → E-1-05.** O-4 guard'ı AYAKTA (ölçüldü). 10000. belge biçim sözleşmesini kırıyor. P99→P01 sarması bilinçli karar (bulgu değil, sınır kaydı). Yıl dönümü sıralaması bulgu. `23:59:59.999` kesme: `resolveDateRange` istemcinin verdiği anı **yuvarlamıyor** (`_shared.ts:38-48`) ve bu yazılı bir sözleşme → doğru. |
| **E1c** `finalizedAt/statusChangedAt` trigger'ı; rapor gün/ay kovaları (DATE_TRUNC UTC vs İstanbul); ay sonu 00:00–03:00 kayıtları; karneler ay sınırında çift/eksik sayar mı; T2-034 üstüne | **uygulandı → E-1-06.** Gün/ay kovaları **doğru**: `factoryDaySql`/`factoryMonthSql` 8 raporda, tek muaf `constants/time.ts`, bekçi `test_report_day_boundary.ts` çıplak `DATE_TRUNC`'u yakalıyor (ölçüldü: `grep DATE_TRUNC src` → yalnız `constants/time.ts`). Çift sayım: `resolveCompareRange` `prev` penceresini `from − 1 ms`'te bitiriyor (`_shared.ts:132-137`) → **çakışma yok**. Kalan kusur damga kaynağında (tx başı) → E-1-06. |
| **E1d** `clientEnteredAt` kelepçesi (1970 / 2099 / +3 gün); KK1 90 sn penceresi gün sınırında | **uygulandı → E-1-07.** Kelepçe DOĞRU çalışıyor (1970 ve 2099 reddedilir, +3 gün reddedilir); pencere **iki yönlü** ve gün sınırıyla ilgisi yok (mutlak fark) → gün sınırında ek kusur YOK. Kusur kelepçe düşüşünün **sessizliği**. |
| **E1e** archive 6 ay hesabı (ay uzunlukları); `backup.hour` yerel/UTC; retention 30 gün + "en yeni 3" gün sınırında | **uygulandı → E-1-01.** `backup.hour`: `factoryDayStart(now) + hour*3600000` (`backup-scheduler.ts:95`) → fabrika gününe çıpalı, **doğru** (F-OPS-VER-005 düzeltmesi); gün devri `last >= dueAt` ile korunuyor. Retention: `slice(RETENTION_MIN_KEEP=3)` sonra mutlak `mtime < cutoff` (`backup.service.ts:314-317`) → ay/yıl devrinden bağımsız, **doğru**. Latency retention `setUTCDate` → **doğru**. Tek kusur audit arşivinde. |
| **E1f** JWT süresi / oturum kaydı TZ; work-session süre hesapları gece vardiyası (23:50 → 00:10 negatif süre?) | **uygulandı → E-1-04 (validUntil).** Oturum süreleri **mutlak** (ms) hesaplanıyor, takvim günü kullanmıyor → gece vardiyası negatif süre üretmiyor. `expiresIn` `Math.max(1, …)` ile kelepçeli (`auth.service.ts:370-374`) → **doğru**. `work-session-activity.service.ts:403` `stayMinutes` `Math.max(0, …)` ile kelepçeli → **doğru**. `work-session.service.ts:82-83` JS `endedAt` ↔ DB `startedAt` karışımı 5 sn toleransla çözülmüş; prod'da uygulama ve DB aynı makinede (SAHINSRV) → risk yok, **bulgu yazılmadı**. Kalan kusur `validUntil`'in gün semantiğinde. |
| **E1g** Decimal/precision: 0.001 m, 99999.999, "65,30" varsayılanı, JS Number 2^53, `toFixed(3)` yuvarlama yönü (0.0005), negatif sıfır | **kısmen uygulandı — bulgu YOK.** Zod tavanları (`999_999_999`) ile `Decimal(12,3)` kapasitesi (999.999.999,999) **hizalı** → numeric overflow (22003) yolu ulaşılamadı. `duplicateGuardLockKey` `Prisma.Decimal(v).toFixed(3)` ile DB hassasiyetine yuvarlıyor ve gerekçesi yazılı (`duplicate-guard.helper.ts:51-57`) → **doğru** ve PG'nin numeric yuvarlamasıyla aynı yön. `pctOf` `whole > 0` ile sıfıra bölmeye karşı korumalı (`_breakdown.ts:33-34`). `round1` negatifte asimetrik (`Math.round(-2.5) = -2`) ve `-0` üretebiliyor, ama tek negatif tüketici `fireQty` ve JSON `-0`'ı `0` basıyor → **S4 altı, yazılmadı**. Ondalık basamak kısıtının Zod'da olmaması K7a'nın (L alanı) gözlemi, sınır etkisi ölçülemedi (DB yok). `parseLocaleNumber` tek-ayraç kuralı **bilinçli ve şablonda yazılı** (`import-coerce.ts:22-29`) → bulgu değil; sınır davranışı repro E-1-02 §4'e kayda geçirildi. |
| **Bölüm 3 §E — "Dönem kapanışı: kapalı döneme kayıt atılabiliyor mu"** | **kapsam dışı — sebep:** ERP muhasebe dönemi tutmuyor (fatura kesmiyor, `CLAUDE.md`); dönem kapanışı kavramı yok. |
| **Bölüm 3 §E — "Fiyat hangi anda donuyor / fiyat listesi geçerlilik aralıkları çakışıyor mu"** | **kapsam dışı — sebep:** fiyat listesi/geçerlilik aralığı modeli yok (`OrderLine.unitPrice` serbest alan, `pricingEnabled` bayrağı ile gizlenir). |
| **Bölüm 3 §E — "Birim çevrimi / faktör versiyonlanması"** | **kapsam dışı — sebep:** tek temel birim (metre + kg + adet ayrı kolonlar), çevrim faktörü yok. |
| **Bölüm 3 §E — SKT/FEFO, kredi limiti, ödeme eşleştirme, maliyet katmanı** | **kapsam dışı — sebep:** modeller yok (`_FINDER-BRIEF` §E N/A listesi). |
| **Sayaç sarması — `roll_barcode_counters` gün anahtarı 2 haneli yıl** | uygulandı, **bulgu değil**: anahtar yalnız eşitlikle kullanılıyor (sıralama yok), 100 yıllık dönüş bilgi notu (repro E-1-04 §5). |
| **Cursor tie-breaker'ın "aynı millisaniye" varsayımı ↔ `timestamptz` mikro saniye** | uygulandı, **bulgu YAZILMADI** — ulaşılabilir bir kırılma noktası adlandırılamadı (bkz. Sınır ötesi notlar + Kapsanmayan). Beceri §7.3 kuralı: adlandıramıyorsan satır yazılmaz. |

---

## Doğru yapılanlar (korunması gereken kalıplar)

1. **Gün sınırı bir İŞ KARARI olarak yazıya geçirilmiş ve TEK kaynağa alınmış.** `src/constants/time.ts` yalnız yardımcı değil, kararın gerekçesini de taşıyor ("takvim günü mü, mutlak pencere mi" ayrımı `:14-27`), `Europe/Istanbul` literali **yalnız orada** yaşıyor ve `test_report_day_boundary.ts` bunu mekanik olarak koruyor (çıplak `DATE_TRUNC` yazan dosya kırmızı). Denetimde `grep -rn "DATE_TRUNC" src` = yalnız `constants/time.ts` → kural fiilen tutuyor.
2. **`factoryDayStart` DST'ye dayanıklı yazılmış olmasa da olurdu — ama yazılmış.** İki turlu ofset çözümü (`constants/time.ts:141-149`) ve `eachDay`'in "26 saat ileri atıp güne oturt" deseni (`reports/_shared.ts:189-192`) Türkiye'de bugün gereksiz; varsayımı koda gömmemek bilinçli ve doğru bir tercih.
3. **Sayaç tavanında FAIL-CLOSED örneği var:** `roll-barcode.helper.ts:90-94` 9999'u aşınca operatör diliyle 409 veriyor ("Yarın 0001'den başlar") — belge kodlarında eksik olan tam bu kalıp (E-1-05'in önerisi bunu kopyalamak).
4. **Sayaç kaynağı veriden türetiliyor, saklanan sayaç yok** (`nextDailySeq`, `readLastShortBatchSeqTx`) → yedekten geri yüklemede tutarlı, "ayar ne diyor / veri ne diyor" ikiliği yok; gerekçesi `batch.service.ts:146-153`'te yazılı.
5. **Karşılaştırma pencereleri çakışmıyor:** `resolveCompareRange` `prev` bitişini `from − 1 ms` yapıyor ve **niye** yaptığını yazıyor (`_shared.ts:130-137`) — dönem karşılaştırmalarında en sık görülen çift-sayım sınırı kapalı.
6. **Kelepçeler fail-open ama gerekçeli:** `resolveEntryStamp` bozuk tablet saatinde üretimi durdurmuyor ve neden 400 vermediğini yazıyor (`duplicate-guard.helper.ts:103-105`); `expiresIn` `Math.max(1,…)` ile negatif token süresi imkânsız.
7. **`@db.Date` istisnası bilinçli ve gerekçeli:** `EndpointLatencyDaily.day` için UTC-gece-yarısı anahtarı (`factoryDayKeyUtcMidnight`) ve "local-midnight verilseydi her satır 1 gün geri etiketlenirdi" ölçümü yazılı (`latency-persist.service.ts:55-72`).

---

## Sınır ötesi notlar

- **[C · veri modeli / H · performans] `timestamptz` precision belirtilmemiş — cursor'ın "aynı millisaniye" varsayımı yazılı ama zorlanmıyor.** `20260801040000_timestamptz_conversion` 185 kolonu `TYPE timestamptz` (varsayılan precision **6**) yapıyor; oysa kolonlar `TIMESTAMP(3)` idi. `utils/cursor.ts:14` sayfalamanın tie-breaker'ını **"aynı millisaniyede eklenen kayıtlar"** diye tanımlıyor ve cursor değerini `toISOString()` (ms) ile serileştiriyor (`:27`, `:241`). DB tarafında `now()` ile yazılan damgalar (trigger `finalizedAt`/`statusChangedAt`, 11 ham SQL `exitedAt` yazımı) **mikro saniye** taşır. Bugün kırılan bir yol adlandıramadım (`ROLL_SORTABLE_FIELDS` bu kolonları içermiyor; `BaseService` sortable kümesi yalnız master-data modellerini kapsıyor ve orada DB-yazımı damga yok), o yüzden bulgu yazmadım. **Tek sorguyla kesinleşir:**
  ```sql
  SELECT count(*) FILTER (WHERE date_part('microsecond', "createdAt")::int % 1000 <> 0) AS mikrosaniyeli,
         count(*) AS toplam FROM system_logs;
  SELECT count(*) FILTER (WHERE date_part('microsecond', "finalizedAt")::int % 1000 <> 0) AS mikrosaniyeli
    FROM rolls WHERE "finalizedAt" IS NOT NULL;
  ```
  `system_logs` tarafı sıfırdan farklı çıkarsa **audit log listesinin cursor sayfalaması sessizce satır atlıyor** demektir (`system-log.service` `cursorWhere` kullanıyor) — o zaman bu bir S2 bulgusudur. K8 haritasının psql örnekleri (`03:27:18.034`, `03:14:24.752`) üç basamaklı, yani ms lehine kanıt, ama kesin değil.
- **[A · eşzamanlılık] `readLastShortBatchSeqTx` `ORDER BY "createdAt" DESC LIMIT 1` — `createdAt` DB default `CURRENT_TIMESTAMP` = transaction_timestamp, yani AYNI transaction'da doğan partiler eşit damga taşır.** Tek tx'te birden çok parti yaratan bir akış varsa (`createBatchTx` çağrı yerleri: `workorder.service.ts:4239,4553`, `workorder-split.service.ts:359,504`, `subcontractor.service.ts:1140,1231,3014`, `workorder-manual-move.service.ts:699`) sıralama eşitlikte **belirsizdir** ve sayaç aynı numarayı iki kez üretebilir. 8022 advisory kilidi tx'ler ARASI yarışı kapatır, **tx İÇİ eşitliği kapatmaz**. Ölçüm (DB gerekiyor): `SELECT "createdAt", count(*), string_agg("batchNumber", ',') FROM batches GROUP BY 1 HAVING count(*) > 1;` — Tur 2'de ölçülen "61 numara çift" bununla kesişiyor olabilir.
- **[I · gözlemlenebilirlik] `finalizedAt` damgasının tx-başı semantiği raporlara sızıyor** (E-1-06). Ek olarak: aynı satırda `createdAt` (DB), `updatedAt` (uygulama saati, `@updatedAt` DDL'de DEFAULT'suz) ve trigger damgaları (DB) üç ayrı kaynaktan geliyor; uygulama ve DB aynı makinede olduğu sürece fark yok, ayrıştıkları gün hiçbir bekçi kırmızı vermez.
- **[J · migration] `ecosystem.config.js` `TZ` pinlemiyor, `Dockerfile` pinliyor** (E-1-08 madde 1). Deploy runbook'una tek satır ekleyerek kapanabilecek bir asimetri.
- **[F · API] `assertDeadlineNotBeforeOrderDate` create/update asimetrisi:** create'te referans `new Date()` (`order.service.ts:959`), update'te `current.orderDate` (`:2280-2282`). Update tarafı doğru; create tarafı E-1-03'ün 1. failure_mode'unu üretiyor. Aynı yardımcının iki çağrı yeri arasındaki bu fark, F alanının "create/replace asimetrisi" sınıfına da giriyor.
- **[K · test] `test_report_day_boundary.ts:202-208`'in `setMonth` muafiyeti gerekçesi eksik.** "Süre kaydırma" muafiyeti doğru ama "saklama sınırı" da aynı muafiyetten geçiyor (E-1-01). Muafiyet dosya/fonksiyon bazlı daraltılmalı.
- **[E · iş kuralı] "Aynı gün" kelepçeleri gece vardiyasını ortadan kesiyor** (`shipping.undoDispatchSameDayOnly`, `tambur.undoFullSameDayOnly`). İkisi de varsayılan **KAPALI** ve `factoryDayStart` ile doğru çözülüyor (`system-setting.service.ts:2365-2373` gerekçeyi yazıyor), bu yüzden bulgu yazılmadı; ancak açıldıklarında 23:58'de yapılan sevkin 00:02'de geri alınamaz olduğunu ayarın açıklama metni SÖYLEMİYOR. Ayar metnine "gün = takvim günü, vardiya değil" cümlesi eklenmeli (ürün kararı).

---

## Kapsanmayan / Erişilemeyen

1. **Veritabanı erişimi (K2) — TAMAMEN kapalı.** `audit/tools/sql-dev.sh`, `sql-saha.sh`, TCP (`localhost`/`127.0.0.1`) ve unix soket (`/tmp/.s.PGSQL.5432`) dört yolun dördü de `FATAL: Postgres.app failed to verify "trust" authentication` verdi. Kural gereği başka bağlantı denenmedi, `pg_hba` / sunucu ayarı **değiştirilmedi**. Her bulguya hazır SQL bırakıldı; bu sorgular koşulmadan hiçbir bulgu S2'nin üstüne çıkarılmamalı.
2. **Prisma tabanlı eşzamanlılık repro'su** (E-1-06 tx-sınırı, batch `createdAt` eşitliği, KK1 409 fırtınası) yazılamadı — üçü de canlı DB gerektiriyor. Bunlar 3. tura devredilecek en yüksek getirili ölçümler.
3. **Cursor mikro saniye sorusu** (yukarıdaki sınır ötesi not) — ölçüm olmadan sınıflandırılamadı; ne bulgu ne temiz.
4. **Prod sunucusunun gerçek TZ'si ve `pm2` başlatan hesabın bölge ayarı** doğrulanamadı; K8'in saha ölçümü (`current_setting('TimeZone')` = `Europe/Istanbul`) 2026-08-25 kopyasının anıdır. E-1-08 bu belirsizliği bulgunun kendisi olarak yazıyor.
5. **Electron ve mobil salt-okunur incelendi** (sözleşme kanıtı için); istemci tarafında koşulan bir ölçüm yapılmadı — `DatePickerInput`'un gerçekten `YYYY-MM-DD` ürettiği `OrderFormDialog.tsx:53` + `schema.ts:52` + `OrdersPage.tsx:168` üçlüsünden **türetildi**, çalıştırılarak doğrulanmadı. [VARSAYIM] etiketi bu tek noktaya aittir; `new Date("YYYY-MM-DD")` → UTC gece yarısı davranışı ise ölçüldü (repro E-1-03 §1).
6. **Yıl dönümü (2026→2027) canlı davranışı** yalnız saf fonksiyonlarla ölçüldü; sistemin o gece gerçekten ne yazacağı (sayaç satırları, `roll_barcode_counters` yeni gün anahtarı) DB olmadan sondalanamadı.
7. **Feature-flag'ler DEĞİŞTİRİLMEDİ** (kural). `kk1.duplicateGuardEnabled`, `shipping.undoDispatchSameDayOnly`, `tambur.undoFullSameDayOnly`, `batch.shortNumberEnabled` durumları koddaki varsayılan + MEMORY notlarından okundu; canlı değerleri doğrulanamadı. E-1-07'nin etkisi bayrağın AÇIK olmasına bağlıdır ("flag gerektirir").
