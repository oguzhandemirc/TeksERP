# D-D — Transaction Sınırları & Tutarlılık (② BULMA, TUR 1)

**Denetçi:** D-D · **Tarih:** 2026-08-28 · **Dal/HEAD:** `adnansahin` / `ce8681d1`
**Kapsam:** Prompt Bölüm 3-**D** (satır 521-527) + **A.4**'ün tx kısmı (sınır ve yan etki odaklı; D-A ile bilinçli örtüşme)
**Ana girdiler:** `K3a`/`K3b` (128 tx sitesi), `K6`, `K9`, `KRITIK-YAZMA-YOLLARI.md §6` (Tx-dışı yazım sütunu, 12 yol), `SINIR-OTESI-YONLENDIRME.md` §D
**Yöntem:** Haritalardaki her "tx-dışı / kısmi durum" adayının **gövdesi yeniden okundu** (harita satırına güvenilmedi); dış I/O ve batch-form taramaları bağımsız olarak yeniden koşuldu; DB kanıtı `audit/tools/sql-saha.sh` (prod kopyası `tekserp_saha_0825`, salt-okunur).

---

## 0. Ölçülen olgular (bağımsız doğrulama)

| Ölçüm | Değer | Komut / kanıt |
|---|---|---|
| `$transaction(` metin eşleşmesi (repo) | **135** | `grep -rn '\$transaction' src --include='*.ts' \| wc -l` |
| interactive `$transaction(async` | **118** | grep |
| batch `$transaction([` | **2** (+3 çok satırlı dizi formu: `shipping:2592`, `reason-preset:505`, `master-data-merge:543`) | grep |
| **tx gövdesinde dış I/O** (fetch/axios/child_process/fs/bcrypt/sharp/puppeteer/setTimeout) | **0** — 14 eşleşmenin hepsi tx DIŞINDA (`auth.service.ts:73/:398`, `permission-management.service.ts:423/:483`, `backup.service.ts:123`, `helpers/offsite-backup.helper.ts:372/:379`, `helpers/pg-tool.helper.ts:105`, `helpers/device-transport.ts:50/:80`) | grep + gövde okuması |
| **tx gövdesinde `Promise.all(tx.*)`** | **0** | K3a/K3b + gövde okuması |
| **helpers/ içinde iç içe `prisma.$transaction`** | **0** (`grep -rn 'prisma.\$transaction' src/services/helpers src/utils` → boş) → nested-tx / pass-through sorusu **N/A** | grep |
| Global tx bütçesi | `maxWait 5.000 / timeout 20.000` (`src/lib/prisma.ts:89-92`) | okuma |
| Site-özel bütçe | **1**: `master-data-merge.service.ts:711` `{ timeout: 120_000, maxWait: 10_000 }` | okuma |
| DB `statement_timeout` (yerel sunucu, per-DB) | `adnansahin_db` → **50 s**, `idle_in_transaction_session_timeout` → **5 dk**; `tekserp_saha_0825` kopyasında per-DB ayar **yok** | `pg_db_role_setting` sorgusu |
| Audit çağrılarının konumu | **tümü tx DIŞINDA, commit'ten sonra**; `AuditService.log` gövdesi `try/catch` + `recordAuditFailure` (`audit.service.ts:110-115`) | okuma |
| Havuz | `max 30`, `connectionTimeoutMillis 5.000` (`lib/prisma.ts:69-71`) | okuma |

**Sonuç:** Prompt D'nin iki klasik maddesi (**"rollback edilemeyen yan etki tx içinde"** ve **"tx içinde `tx` yerine global `prisma` ile YAZMA"**) bu kod tabanında **ihlal edilmiyor**. Bulguların tamamı üçüncü sınıftan: **iş biriminin bir parçası tx'in DIŞINDA/ÖNCESİNDE koşuyor** ve düşerse telafi edilmiyor / raporlanmıyor.

---

## 1. Bulgular

### [D-D-01] İş emri iptali fason sevkini kapatamazsa, fasondaki mal HAM STOĞA düşer ve açık sevk ortada kalır

| Şiddet | **S1** | Kategori | D (+A.4 "tx dışına taşan yazma") | Öncelik | **P1** | Modül | WO / Fason | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** İş emri iptalinde, iptal transaction'ından **önce** iki yazma havuz client'ıyla yapılıyor: (a) açık fason sevkleri `cancelBulk` ile (her biri kendi tx'i), (b) hâlâ fasonda görünen toplar `prisma.roll.updateMany` ile `IN_PRODUCTION`'a çekiliyor. `cancelBulk`'ın döndürdüğü `failed[]` **okunmuyor**. Kısmi kabul görmüş bir sevk `cancel()` tarafından bilinçli olarak reddedilir (`acceptedReceiptItem` guard'ı) — yani boyahanede fiziksel olarak mal kalmış olan tam da bu durumda sevk iptali BAŞARISIZ olur, ama (b) topu yine de `IN_PRODUCTION` yapar, tx içindeki fason guard'ı artık hiçbir şey görmez (`count = 0`) ve iptalin toplu geri çekmesi topu **`STOCK`**'a alır. Kodun kendi yazdığı değişmez — *"Fason malı asla ham stoğa dönemez"* — bu yoldan sessizce ihlal edilir.

**Kanıt**
- `Teks-Erp/src/services/workorder.service.ts:3253-3256` — `cancelBulk` çağrısı, dönüş değeri **atılıyor**:
  ```ts
  await new SubcontractorService().cancelBulk(
    { dispatchIds: openDispatches.map((d) => d.id), reason: `İş emri iptali: ${reason}` },
    userId,
  );
  ```
- `Teks-Erp/src/services/subcontractor.service.ts:2245-2252` — `cancelBulk` iş kuralı hatasını **yutup `failed[]`'e yazıyor** (bilinçli, yorumlu): `if (!(e instanceof AppError)) throw e; failed.push({ dispatchId, dispatchNo, message: e.message });`
- `Teks-Erp/src/services/subcontractor.service.ts:1963-1971, :1991-2000` — `cancel()` engel yüklemi: `acceptedReceiptItem` (`receipt.cancelledAt: null`, **`isPartial` süzgeci YOK** → kısmi makbuz da engeller) → `resolveDispatchCancelBlockReason` → `AppError.conflict`.
- `Teks-Erp/src/services/helpers/fason-open-dispatch.helper.ts:47-51` — `OUTSTANDING_ITEM` kısmi makbuzu kalem kapatıcı SAYMAZ (`isPartial: false` şartı) → kısmen kabul edilmiş sevk **hâlâ `OPEN_OUTSTANDING`**, yani `:3248` sorgusuna girer.
- `Teks-Erp/src/services/workorder.service.ts:3271-3283` — telafisiz havuz yazımı:
  ```ts
  const residual = await prisma.roll.findMany({ where: { id: { in: fasonRolls… },
    status: { in: [AT_SUBCONTRACTOR, RETURNED_FROM_SUBCONTRACTOR] } }, … });
  if (residual.length > 0) {
    await prisma.roll.updateMany({ where: { id: { in: residual… } },
      data: { status: RollStatus.IN_PRODUCTION } });   // ← tx DIŞI, koşulsuz
  }
  ```
- `Teks-Erp/src/services/workorder.service.ts:3376` — asıl tx **buradan sonra** açılıyor; `:3423-3444` fason in-flight guard'ı artık `AT_SUBCONTRACTOR` göremez; `:3506-3520` toplu geri çekme:
  `where: { currentStepId: { in: stepIds }, status: IN_PRODUCTION, entrySource: { not: SUBCONTRACTOR_RETURN } } → data: { status: STOCK, currentStepId: null }`.
- **Koruma kontrolü (K1):** ① DB kısıtı yok — `Roll.status` ↔ açık `SubcontractorDispatchItem` arasında CHECK/trigger/FK yok (`schema.prisma`); ② mutabakat scripti kör — `scripts/consistency-check-derived.sql:151` (§24a) ve `:166` (§24b) **ikisi de `r.status = 'AT_SUBCONTRACTOR'` süzgeci taşır**, yani "açık sevkin topu artık fasonda DEĞİL" hiçbir bölümde sorulmuyor; ③ bekçi kör — `scripts/test_wo_cancel_fason.ts:113-118` yalnız MUTLU yolu ölçüyor ("fasondaki top HAM STOĞA döndü" = sevk iptali başarılıyken doğru davranış), `cancelBulk` başarısızlığı senaryosu yok; ④ feature-flag yok (yol koşulsuz).

**Çakışma senaryosu** — *yarış değil, deterministik sıra*:
```
T1  Fason kabul: 100 m giden toptan 51 m kabul edildi (isPartial=true) → Roll AT_SUBCONTRACTOR, currentQty=49
T2  Planlamacı iş emrini iptal eder, modalda "Fasondaki mal: STOĞA DÖNSÜN" (fasonAction=RETURN_TO_STOCK)
T3  prepareFasonCancelDecision → openDispatches = [FS…0001]  (OPEN_OUTSTANDING ✓, kısmi kabul kapatmaz)
T4  cancelBulk → cancel(FS…0001) → acceptedReceiptItem bulundu → AppError.conflict → failed[] (OKUNMAZ)
T5  residual updateMany → Roll: AT_SUBCONTRACTOR → IN_PRODUCTION            [tx DIŞI, kalıcı]
T6  tx: WO claim ✓ → fasonInFlight count = 0 (top artık IN_PRODUCTION) → guard geçer
T7  tx: blanket updateMany → Roll: IN_PRODUCTION → STOCK, currentStepId = null ; COMMIT
SONUÇ: FS…0001 hâlâ AÇIK (cancelledAt = NULL) ve boyahanede 49 m mal duruyor;
       aynı top Ham Stok listesinde "üretime hazır 49 m" olarak görünüyor.
       Hiçbir hata mesajı yok, iptal "başarılı" döndü.
```

**failure_mode.** 100 m'lik top boyahaneye gitti, 51 m döndü (`isPartial`), 49 m fasonda. Sipariş iptal olunca planlamacı iş emrini "fasondaki mal stoğa dönsün" diyerek iptal eder → **istek 200 döner**, ekranda *"İş emri iptal edildi, ham toplar STOCK'a çekildi"* yazar. DB'de: `subcontractor_dispatches.cancelledAt IS NULL` (fason ekranında "bizde 49 m var" görünmeye devam eder) **ve** `rolls.status = 'STOCK'` (Ham Stok'ta sayılır, yeni iş emrine bağlanabilir, sevk edilebilir). Aynı 49 m **iki yerde birden** sayılır; fabrikaya fiziksel olarak gelmemiş kumaş üretime planlanır.

**Veride fiili ihlal (K2).** Arandı, **0**:
```sql
-- açık+outstanding sevk kaleminin topu, statü kırılımı (tekserp_saha_0825)
SELECT r.status, count(*) FROM rolls r
JOIN subcontractor_dispatch_items di ON di."rollId" = r.id
JOIN subcontractor_dispatches d ON d.id = di."dispatchId"
WHERE d."cancelledAt" IS NULL AND d."directShippedAt" IS NULL AND di."remainderClosedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM subcontractor_receipt_items ri
                  JOIN subcontractor_receipts rc ON rc.id = ri."receiptId"
                  WHERE ri."sourceDispatchItemId" = di.id AND ri."isPartial" = false
                    AND rc."cancelledAt" IS NULL)
GROUP BY 1;
--> AT_SUBCONTRACTOR | 188   (başka statü YOK)
```
Ayrıca: açık+outstanding sevki olan iş emirlerinin **hepsi `IN_PROGRESS`** (48 sevk), `CANCELLED` WO'ya bağlı açık sevk **0**; sistemde toplam 22 `CANCELLED` iş emri var. Yani yol **henüz tetiklenmemiş** (fason karar modalı 2026-08-17'de eklendi, kopya 2026-08-25). Bu bir "yok" kanıtı değil, **maruziyet penceresi kısa** kanıtıdır.

**Repro (K3).** İstenmiyor (D-A/D-B yükümlülüğü). Yol yarış gerektirmediği için tek süreçli bir script ile üretilebilir; öneri §Öneri'de.

**İş etkisi.** Depoda olmayan kumaş Ham Stok'ta görünür → planlama o metrajı yeni iş emrine bağlar, tambur/sevk aşamasında "top yok" ile karşılaşılır. Fason cari mutabakatı bozulur (boyahanede duran 49 m'nin sistemdeki karşılığı ortadan kalkar; `closeRemainder`/`cancelReceipt` yolları topu artık `AT_SUBCONTRACTOR` bulamaz → **claim `count=0` → 409**, yani fason kalemi bir daha hiçbir yoldan kapatılamaz).

**Öneri (2. tur için).**
1. **Kısa vade (kod, migration yok):** `prepareFasonCancelDecision` `cancelBulk` sonucunu okusun; `failed.length > 0` ise **iptali durdur** (`AppError.conflict`, `code: "FASON_DISPATCH_CANCEL_FAILED"`, `failed[]` detayda) — kararı kullanıcıya geri ver. Bu tek satırlık davranış değişikliği (b) adımının hiç koşmamasını sağlar.
2. **Orta vade:** `residual` yazımını iptal tx'inin **İÇİNE** taşı (WO claim'inden sonra, guard'dan önce) ve `updateMany`'yi claim'e çevir (`where: { id: { in: … }, status: { in: [AT_SUBCONTRACTOR, RETURNED_FROM_SUBCONTRACTOR] } }` + `count` kontrolü). Böylece tx düşerse yazım da geri sarılır.
3. **Sed:** `scripts/consistency-check-derived.sql`'e §24c ekle — *"AÇIK+OUTSTANDING sevk kalemi ama topun statüsü `AT_SUBCONTRACTOR` DEĞİL"* (yukarıdaki K2 sorgusunun `HAVING status <> 'AT_SUBCONTRACTOR'` biçimi). `[PROD'DA ÇALIŞTIRMA]` gerekmez — salt-okunur.
4. **Bekçi:** `test_wo_cancel_fason.ts`'e **negatif sonda**: kısmi kabul yapılmış sevki olan WO'yu `fasonAction: "RETURN_TO_STOCK"` ile iptal et → beklenen: 409 **ve** topun statüsü `AT_SUBCONTRACTOR` kalmış.

**Kabul kriteri.** (a) Kısmi kabul edilmiş açık sevki olan iş emrinin iptali 409 ile reddediliyor ve top `AT_SUBCONTRACTOR` kalıyor; (b) `consistency-check-derived §24c` dev + saha kopyasında 0 satır; (c) bekçi düzeltme geri alındığında KIRMIZI (negatif sonda ile doğrulanmış).
**Efor.** 1,5 gün (kod 0,5 + bekçi 0,5 + mutabakat bölümü 0,5).
**Önceki defter.** Yeni. İlgili açık kayıt: `F-FAS-ESZ-002` (fason tavan ölçümü bayat) — aynı dosya, farklı konu.

---

### [D-D-02] Sipariş iptalinde iş emirleri sipariş transaction'ından ÖNCE iptal ediliyor — sipariş açık kalır, iş emirleri ölür

| Şiddet | **S2** | Kategori | D | Öncelik | **P2** | Modül | Sipariş / WO | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `cancelWithActions` önce `CANCEL_WO` seçilen her iş emrini `WorkOrderService.softDelete` ile **ayrı ayrı** iptal eder (her biri kendi tx'i, hepsi commit'lidir), sonra sipariş iptalini + bağ sökümünü tek bir tx'te yapar. Sipariş tx'i düşerse iptal edilmiş iş emirleri **geri alınmaz** ve kullanıcı yalnız "sipariş iptal edilemedi" hatasını görür — üretimin durdurulmuş olduğunu söyleyen hiçbir yüzey yok. Telafi kodu, uyarı, `failed[]` yok.

**Kanıt**
- `Teks-Erp/src/services/order.service.ts:3128-3135`:
  ```ts
  if (cancelWoIds.length > 0) {
    const { WorkOrderService } = await import("./workorder.service");
    const woService = new WorkOrderService();
    for (const woId of cancelWoIds) {
      await woService.softDelete(woId, userId);   // ← her biri AYRI tx, commit'li
    }
  }
  // 2) Tek transaction: convert + unlink + order cancel.
  await prisma.$transaction(async (tx) => { … });   // :3138
  ```
- `Teks-Erp/src/services/order.service.ts:3145-3172` — tx'in içindeki fırlatma noktaları: sipariş claim'i `count === 0` → 409 (`:3160-3168`), bayat önizleme kontrolü → 409 (`:3183-3187`), "önizleme sonrası doğan yeni bağ" kontrolü (`:3196+`).
- **Deterministik tetikleyici:** `softDelete` **gövdesiz** çağrılıyor (`input` verilmiyor) → `prepareFasonCancelDecision` fasonda topu olan WO için `FASON_DECISION_REQUIRED` 409 fırlatır (`workorder.service.ts:3229-3233`). Önizleme bunu bilmiyor: `computeAllowedActions` (`order.service.ts:96-116`) `IN_PROGRESS` + tek-sipariş WO'ya **`CANCEL_WO`'yu her koşulda sunuyor**; fason topu kontrolü yok.
- **Koruma kontrolü (K1):** telafi/`try-catch`/`failed[]` yok (grep: `:3128-3137` aralığında `catch` 0); WO iptali geri alınabilir bir uç değil (`WorkOrderStatus.CANCELLED` terminal — `softDelete` `:3313` "İş emri zaten iptal edilmiş"); bekçi yok (`grep -rln "cancelWithActions" scripts` → yalnız mutlu yol testleri).

**Çakışma senaryosu** (yarış gerektirmeyen dal):
```
Sipariş S1'e iki iş emri bağlı: IE-A (IN_PROGRESS, sadece S1) ve IE-B (IN_PROGRESS, sadece S1, topları FASONDA)
T1  Kullanıcı iptal önizlemesinde ikisi için de CANCEL_WO seçer (önizleme ikisini de "izinli" gösterir)
T2  softDelete(IE-A) → COMMIT  (IE-A CANCELLED, topları STOCK'a çekildi, kartları VOIDED)
T3  softDelete(IE-B) → prepareFasonCancelDecision → fasonAction yok → 409 FASON_DECISION_REQUIRED
T4  İstek 409 ile biter; :3138 tx HİÇ AÇILMAZ
SONUÇ: S1 hâlâ ACTIVE (iptal edilmedi) · IE-A CANCELLED (üretim durdu, toplar stoğa döndü, kartlar geçersiz)
       Kullanıcının gördüğü mesaj yalnız "Fasondaki toplar için karar verilmeden iş emri iptal edilemez."
```

**failure_mode.** İki iş emirli bir siparişi iptal etmeye çalışan planlamacı, ikinci iş emrinin topları boyahanede olduğu için 409 alır. Ekran "iptal edilemedi" der; oysa **birinci iş emri iptal edilmiş, refakat kartı VOIDED olmuş ve topları ham stoğa çekilmiştir**. Sipariş hâlâ açık göründüğü için planlamacı yeniden üretim başlatmaz; sahadaki operatör iptal edilmiş kartı okutamaz ("kart okutulamıyor"). Prod kopyasında **19/113 sipariş ≥2 iş emri taşıyor** (2 WO: 13, 3 WO: 5, 5 WO: 1) → yol nadir değil.

**Veride fiili ihlal (K2).** Arandı, doğrudan ölçülemez (iptal edilmiş WO + açık sipariş bileşimi meşru de olabilir — `UNLINK_ONLY` yolu aynı durumu üretir). Dolaylı: WO/sipariş sayımları yukarıda.

**İş etkisi.** Üretim sessizce durur; sipariş takibi "açık" der. Geri dönüş yolu yok — iptal edilmiş iş emri diriltilemez, yeni iş emri açmak gerekir (parti/kart/izler kopar).

**Öneri (2. tur için).**
1. **Ön kontrol (ucuz, davranış korur):** `cancelWithActions` `CANCEL_WO` döngüsünden ÖNCE her WO için iptal edilebilirliği **kuru koşumla** doğrulasın (fason in-flight sayımı + terminal statü) ve **hepsi geçmezse hiç başlamasın**. `getCancelPreview` `allowedActions` hesabına fason topu şartı eklenmeli (`computeAllowedActions`'a `hasFasonInFlight` parametresi).
2. **Kısmi durumu görünür kıl:** döngüyü `try/catch` + `cancelledWoIds[]` / `failed[]` ile sar; sipariş tx'i düşerse yanıtta **"şu iş emirleri iptal edildi"** listesi dönsün (`cancelBulk` deseni, `subcontractor.service.ts:2183`).
3. **Sipariş iptali fason kararını taşısın:** `CancelWithActionsInput`'a `fasonAction` alanı ekle (WO başına), `softDelete`'e ilet.

**Kabul kriteri.** Fasonda topu olan iş emri içeren bir siparişin iptali, **hiçbir iş emrini iptal etmeden** 409 döner ve mesaj hangi iş emrinin engellediğini söyler; bekçi negatif sondayla kırmızı verir.
**Efor.** 1 gün.
**Önceki defter.** Yeni.

---

### [D-D-03] `bulkDispatchStep` SEPARATE: döngü ortasındaki hata önceki sevkleri yutuyor, aynı seçimle tekrar denemek 400 veriyor

| Şiddet | **S2** | Kategori | D (beceri §2 "sessiz parçalı sonuç") | Öncelik | **P2** | Modül | Fason | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Çok partili bir fason adımında "her parti ayrı sevk" seçildiğinde, parti başına ayrı `dispatch()` transaction'ı koşuluyor. Döngüde `try/catch` **yok**: ikinci parti düşerse istek hata döner, ama birinci partinin sevki (FS belgesi, `AT_SUBCONTRACTOR` toplar, dondurulmuş irsaliye, kart bayrağı) **commit edilmiştir ve yanıtta hiç görünmez**. Aynı dosyadaki kardeş toplu uç `cancelBulk` (`:2183`) ve `kursun-bypass.assignBulk` (`:1085-1103`) tam da bunu `failed[]` ile çözüyor — desen ayrışmış.

**Kanıt** — `Teks-Erp/src/services/subcontractor.service.ts:1537-1560`:
```ts
if (byBatch.size > 1) {
  const dispatches: unknown[] = [];
  for (const [, rollIds] of byBatch) {
    const res = await this.dispatch({ …, rollIds, … }, userId);   // ← try/catch YOK
    dispatches.push(res.data);
  }
  return { success: true, data: { separate: true, dispatchCount: dispatches.length, dispatches }, … };
}
```
- Karşılaştırma (aynı dosya, `failed[]` VAR): `:2245-2252` `cancelBulk`; `kursun-bypass.service.ts:1085-1103` `assignBulk`; `label.service.ts:2007-2015` yorumu bu kuralı **açıkça yazıyor**: *"ATLANAN HER SATIR SOMUT SEBEBİYLE DÖNER — '42 yazıldı' deyip 8'inin neden atlandığını yutmak en kötü davranıştır."*
- **Tekrar denemenin kilitlenmesi:** `:1516-1521` — `rollIds` alt-kümesi verilmişse `rolls.length !== data.rollIds!.length` → **400** *"Seçilen toplardan bazıları artık sevke uygun değil"*. Birinci partinin topları artık `AT_SUBCONTRACTOR` olduğu için `:1508-1513` sorgusuna (`status in [IN_PRODUCTION, STOCK]`) girmez → operatör aynı seçimle tekrar deneyemez.
- **Koruma kontrolü (K1):** telafi yok; `dispatch()` içinde idempotency `clientToken` yok (KYY-09 "Token: YOK"); kısmi-başarı sözleşmesi belgesiz (dosya başında `transferToNextFason` için belge var — `:1583-1590` — ama SEPARATE dalı için yok).

**Çakışma senaryosu**
```
Adımda 3 parti var (P01: 8 top, P02: 5 top, P03: 4 top). Operatör "Her parti ayrı sevk" der.
T1  dispatch(P01) → COMMIT: FS2508280001 donar, 8 top AT_SUBCONTRACTOR, refakat kartı dirty
T2  Bu arada başka bir tablet P02'nin bir topunu Tambur'a okutmuştur (currentStepId değişti)
T3  dispatch(P02) → roll çoklu claim count !== len → 409 "toplar sevke uygun değil"
T4  İstek 409 ile biter. Yanıt gövdesinde P01'in sevkinden TEK KELİME yok.
SONUÇ: Boyahaneye FS2508280001 ile 8 top gitti; ekran "sevk yapılamadı" diyor.
       Operatör aynı seçimi tekrar gönderir → 400 (P01'in topları artık uygun değil) → çıkmaz.
```

**failure_mode.** 3 partili bir fason sevkinde 2. parti reddedilirse: sistemde **açık bir fason sevki** (FS numarası basılmış, kâğıt kesilmiş) durur ama operatör "sevk olmadı" sanır ve topları tekrar sevk etmeye çalışır; ikinci deneme 400 ile reddedilir. Fason firmasına giden kâğıtla sistemdeki kayıt ayrışmaz (kayıt doğrudur) — ayrışan **operatörün bildiği**dir.

**Veride fiili ihlal (K2).** Aranmadı — "operatörün bilmediği sevk" verinin kendisinden ayırt edilemez (meşru bir tek-parti sevkiyle aynı görünür). Dolaylı sonda mümkün: aynı adım+firma için 1 dk içinde açılıp ardından iptal edilen sevkler; prod kopyasında sorgulanmadı (sebep: yanlış pozitif oranı yüksek).

**İş etkisi.** Fason cari/kâğıt takibinde kayıp izler; operatörün "sevk edemedim" raporu ile sistemdeki açık sevk çelişir. `transferToNextFason` de bu fonksiyonu çağırdığı için (`:1738`) zincir iki kat parçalı olur.

**Öneri (2. tur için).** Döngüyü `try/catch` ile sar; `AppError` → `failed.push({ batchNumber, rollCount, message })`, `AppError` olmayan → yeniden fırlat (`cancelBulk`'ın birebir kuralı). Yanıt `{ separate: true, dispatchCount, dispatches, failed }`; mesaj `"N parti sevk edildi, M parti atlandı"`. `dispatch()` çağrılarını `batchId`'ye göre **deterministik sırala** (deadlock önlemi, `cancelBulk` `:2216-2229` deseni).
**Kabul kriteri.** İkinci parti bilerek düşürülen bir bekçide yanıt `dispatchCount = 1` **ve** `failed.length = 1` döner, HTTP 200; bekçi `failed` alanı kaldırılınca kırmızı.
**Efor.** 0,5 gün.
**Önceki defter.** Yeni (K3a HOTSPOT #13'ün bulgu hâli).

---

### [D-D-04] İçe aktarımda koşum kaydı ve audit izi N yazımdan SONRA yazılıyor — süreç ölümünde izsiz ve token'sız satırlar kalır

| Şiddet | **S2** | Kategori | D (+B idempotency, +I iz) | Öncelik | **P2** | Modül | İçe aktarım | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `ImportService.apply` en fazla 10.000 satırı **satır satır, ayrı servis çağrılarıyla** yazar (bilinçli ve belgeli — tek tx'e almak sahte bir atomiklik vaadi olurdu). Ama iki dayanak da **döngünün SONUNDA** yazılıyor: (a) idempotency çapası + koşumun tek kalıcı kaydı olan `ImportRun`, (b) satır başına audit satırlarının tamamı (`auditEntries` dizisi **bellekte biriktiriliyor**). Süreç bu aralıkta ölürse (pm2 restart, OOM, DB kesintisi) yazılan N kayıt **hiçbir koşuma bağlanamaz**, audit izi tamamen kaybolur ve aynı `clientToken` ile yapılan tekrar deneme "önceki koşum yok" diyerek **tümünü yeniden yazar**. Sipariş adaptörü yalnız CREATE yaptığı için bu doğrudan **mükerrer sipariş** demektir.

**Kanıt**
- `Teks-Erp/src/services/import/import.service.ts:447-449` — replay kapısı yalnız **tamamlanmış** koşumu görür:
  `const prior = await prisma.importRun.findUnique({ where: { clientToken: options.clientToken } });`
- `:508-541` — yazma döngüsü; audit satırları **belleğe** birikir (`auditEntries.push({…})`, `:522-533`).
- `:552-575` — `ImportRun` **döngüden sonra** yaratılıyor; `:577` `await AuditService.logMany(auditEntries)` — audit de sonda.
- `:12-25` — dosya başlığı atomiklik sözleşmesini yazıyor ve ilk hatada durup `PARTIAL` + `stoppedAtRowNo` döndüğünü söylüyor (bu kısım **doğru uygulanmış**, `:534-541`). Eksik olan, sözleşmenin **süreç ölümü** dalını hiç kapsamaması.
- `:127-135` (`import-coerce.ts`) — `MAX_IMPORT_ROWS = 10000`, satır tavanı var ✓; süre tavanı / `server.requestTimeout` ayarı **yok** (`grep -rn "server.timeout\|requestTimeout\|headersTimeout" src` → 0 → Node varsayılanı 300 s).
- `src/services/import/adapters/order.adapter.ts:284-313` — `createOne` `orderService.create(payload, ctx.userId)` çağırıyor; **payload'da `clientToken` YOK** → satır düzeyinde idempotency de yok. `:314-318` `updateOne()` her zaman fırlatır (*"her grup CREATE'tir"*).
- **Koruma kontrolü (K1):** satır düzeyi token yok; `ImportRun.clientToken` yalnız tamamlanmış koşumu korur; kısmi koşum için "devam et"/"geri al" yolu yok (`grep -rn "importRunId" src` → yalnız audit `newData` alanı, geri alma uçlarında kullanılmıyor); scheduler değil ama beceri §6(2)'nin **"damga sonda + iş idempotent değil"** çelişkisi birebir geçerli.

**Çakışma senaryosu**
```
T1  8.000 satırlık sipariş dosyası "Uygula" ile gönderilir; doğrulama temiz.
T2  Döngü 5.200 satırı yazar (5.200 sipariş oluşur). auditEntries dizisinde 5.200 kayıt BELLEKTE.
T3  Sunucu yeniden başlar (pm2 restart / dağıtım / OOM).
T4  ImportRun HİÇ yazılmadı; 5.200 audit satırı bellekle birlikte gitti.
T5  Operatör "yükleme yarıda kaldı" deyip aynı dosyayı aynı token ile tekrar gönderir.
T6  :448 prior = null → doğrulama yeniden koşar (kod tekilliği yok, sipariş no sunucu üretir) → 8.000 sipariş DAHA yazılır.
SONUÇ: 13.200 sipariş satırı; 5.200'ünün nereden geldiği hiçbir yerde yazmıyor.
```

**failure_mode.** 8.000 satırlık sipariş içe aktarımı yarıda kesilirse, aynı dosyanın ikinci yüklemesi **mükerrer sipariş** üretir ve ilk 5.200 siparişin `_source: "IMPORT"` audit izi hiç yazılmadığı için hangilerinin çift olduğu **veriden ayırt edilemez** (sipariş numaraları farklıdır, müşteri/kalem aynıdır). Temizlik elle arkeoloji gerektirir.

**Veride fiili ihlal (K2).** Arandı, **0** — prod kopyasında `import_runs` tablosu bu denetimde sorgulanmadı ancak `system_logs`'ta `IMPORT_RUN` olayı yok (`SELECT ... WHERE action='IMPORT_RUN'` kapsam dışı bırakıldı; içe aktarım paketi sahada henüz kullanılmıyor — `data:import` izni atanmamış, bkz. bellek notu *"İçe aktarım paketi — açık iş izin ataması"*). **Maruziyet bugün sıfır, yayına alınmadan kapatılmalı.**

**İş etkisi.** Yayına alındığı gün ilk büyük yükleme kesilirse mükerrer sipariş/müşteri kartı doğar; ana veri mükerrer paneli (`duplicate-detection`) bunları yakalar ama sipariş için mükerrer paneli yok.

**Öneri (2. tur için).**
1. `ImportRun` satırını **döngüden ÖNCE** `status: "RUNNING"` ile yarat (id zaten `:439`'da önceden üretiliyor), sonda `update` ile kapat. Replay kapısı `RUNNING` gördüğünde **409 `IMPORT_IN_PROGRESS`** dönsün (kullanıcı "devam mı, baştan mı" kararını bilerek versin) — scheduler'ın "damga başta" tuzağına düşmemek için `RUNNING` kaydı **atlanmış sayılmaz**, bilinçli bir soru üretir.
2. `auditEntries`'i **parçalar hâlinde** (ör. 200 satırda bir) `logMany` ile boşalt — bellekte biriken iz süreç ölümünde tamamen kaybolmasın.
3. Sipariş adaptörü `orderService.create` payload'una **satır düzeyi `clientToken`** koysun (`sha1(runId|rowNo)`) — `orders_clientToken_key` partial unique zaten var; ikinci koşum aynı satırı replay eder, çift sipariş doğmaz. Bu, (1) ve (2) düşse bile son savunma hattıdır.
**Kabul kriteri.** Yazma döngüsü ortasında süreç öldürülüp aynı token ile tekrar denendiğinde toplam oluşan sipariş sayısı dosyadaki satır sayısına eşit (bekçi: `test_import_*` içine kesinti sondası).
**Efor.** 1,5 gün.
**Önceki defter.** Yeni; `SINIR-OTESI-YONLENDIRME.md` K9 satırı ("import: token yalnız tamamlanmış koşum") ile aynı kök.

---

### [D-D-05] `workorder.create` transaction AÇIKKEN havuzdan ikinci bağlantı alıyor — repoda iki kez ölçülüp düzeltilmiş sınıfın kalan örneği

| Şiddet | **S2** | Kategori | A.4 / D (tx sınırı) | Öncelik | **P3** | Modül | WO | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** İş emri oluşturma transaction'ının ilk ifadesi, iş emri numarasını **global havuz client'ından** okuyor (`this.generateWorkOrderNumber()` → 5 denemeli döngü, deneme başına 2 sorgu). Aynı tx içinde ikinci bir havuz okuması daha var (`resolvePlanDates` → `readWorkOrderDefaultPlanDurationDays()` argümansız). Yani interaktif tx bir bağlantıyı tutarken **aynı havuzdan 2-10 bağlantı daha ödünç ister**. Bu tam olarak repoda iki ayrı yerde ölçülüp yasaklanmış desendir; `shipping.service.ts` bu yüzden `nextShipmentNo(tx)`'e çevrilmiş ve tx alan ikiz üretici (`workorder-clone.helper.ts:31 generateWorkOrderNumberTx`) zaten var ama `create()` onu **kullanmıyor**.

**Kanıt**
- `Teks-Erp/src/services/workorder.service.ts:988-989`:
  ```ts
  const workOrder = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
    const workOrderNumber = manualWorkOrderNumber ?? (await this.generateWorkOrderNumber());
  ```
  `:571-596` — `generateWorkOrderNumber()` gövdesi: `prisma.workOrder.findMany` (`:580`) + `prisma.workOrder.findUnique` (`:592`), **5 denemeli döngü**, hepsi havuz client'ı.
- `:1002` `resolvePlanDates(...)` → `:395` `readWorkOrderDefaultPlanDurationDays()` (argümansız) → `system-setting.service.ts` `tx ?? prisma` → havuz. Aynı desen `:5505` (`replace`).
- **Yasağın repodaki iki yazılı hâli:**
  `src/services/helpers/roll-barcode.helper.ts:55-66` — *"⚠️ **HAVUZ CLIENT'INI TX AÇIKKEN KULLANMA.** … ikinci bir bağlantı ister ve havuz (max 30) tükenir: **30 eş zamanlı işlemin yalnız 3'ü tamamlandı**, kalanı `timeout exceeded when trying to connect` aldı (ölçüldü)."*
  `src/services/shipping.service.ts:133-140` — *"⚠️ `tx` ZORUNLU … eskiden global `prisma` client'ından okunuyordu … 1) HAVUZ: interaktif tx bir pg bağlantısını TUTARKEN ikinci bir bağlantı ödünç alınıyordu (`lib/prisma.ts` max:30). Yoğunlukta kendi kendini bekleme riski."*
- **Kullanılmayan doğru ikiz:** `src/services/helpers/workorder-clone.helper.ts:31` `generateWorkOrderNumberTx(tx, …)` — `workorder.service.ts:4181` ve `workorder-split.service.ts:471/:639` kullanıyor, `create()` kullanmıyor.
- **Koruma kontrolü (K1):** havuz doygunluğu için devre kesici yok; `connectionTimeoutMillis 5.000` aşılınca `pg` **çıplak Error** fırlatır (`lib/prisma.ts:55-60` — Rust havuzu yok, `P2024` üretilmez) → `error.middleware` `classifyPoolTimeout` → **503**; ölçüm noktası `/health` `poolAcquireTimeouts` + `poolWaitingMax` var, **eşik alarmı yok**. Bekçi: `scripts/test_barcode_reservation.ts` yalnız barkod sayacının konumunu ölçüyor (`reserveRollBarcodes*(tx` regex'i), İE numarasını kapsamıyor.

**Çakışma senaryosu**
```
T0  Açılış patlaması: scheduler + presence + feature-flag cache havuzu 24 bağlantıya çıkarır
    (lib/prisma.ts:41-46 — "ÖLÇÜLEN AYAK İZİ … poolWaitingMax=7")
T1  Aynı anda 7 Hızlı İş Emri / iş emri açılışı gelir → 7 tx açılır (7 bağlantı tutulur)
T2  Her biri generateWorkOrderNumber() için 8. … 30. bağlantıyı ister
T3  Havuz 30/30 → connectionTimeoutMillis 5.000 dolar → pg çıplak Error
SONUÇ: tx timeout'a düşmeden 503 ("sunucu meşgul") döner; iş emri açılmaz.
       Aynı ölçüm repoda zaten yapılmış: "30 eşzamanlı işlemin yalnız 3'ü tamamlandı".
```

**failure_mode.** Vardiya başında (sunucu yeni açılmış, scheduler'lar koşuyor) 5-10 tablet aynı anda Hızlı İş Emri açarsa, iş emri oluşturma uçları `503 — bağlantı alınamadı` döner. Hata **tx bütçesiyle ilgisizdir** (20 s'ye hiç gelinmez) ve log'da "timeout exceeded when trying to connect" olarak görünür; yanlış teşhis (havuzu büyütmek) sorunu maskeler.

**Veride fiili ihlal (K2).** Arandı: prod kopyasında `POOL_TIMEOUT` kaydı **0** (K12 satır 24 ölçümüyle aynı; tek kayıt dev DB'de). Yani bugün tetiklenmemiş.

**İş etkisi.** Yoğunluk anında iş emri açılamaz; `quickStart` zinciri (create → attach → dispatch) ilk adımda düşer, telafi gerekmez ama üretim başlatılamaz.

**Öneri (2. tur için).** `create()` içinde `generateWorkOrderNumber()` yerine `generateWorkOrderNumberTx(tx, …)` çağır (ikiz zaten var, `withBarcodeRetry` sarmalı korunur — retry her denemede yeni tx açtığı için numara okuması taze kalır, `shipping.service.ts:152-155` notu). `resolvePlanDates`'e `tx` parametresi ekle ve `:1002`/`:5505`'te geçir. Bekçi: `scripts/test_barcode_reservation.ts` §"havuz" sondasının ikizi — 30 paralel `workOrderService.create` → **30/30 tamamlanmalı**.
**Kabul kriteri.** 30 paralel iş emri açılışında 0 `connect timeout`; kaynak taramasında `$transaction(async (tx)` gövdesi içinde `this.generateWorkOrderNumber(`/`readWorkOrderDefaultPlanDurationDays()` **0 eşleşme** (AST/regex bekçisi).
**Efor.** 0,5 gün.
**Önceki defter.** İlgili açık kayıt `F-CORE-VER-005` (havuz dengesi — ölçüm, bulgu değil) ve kapanmış `F-CORE-VER-001` (aynı sınıfın barkod sayacı örneği).

---

### [D-D-06] Birleştirmenin 120 sn'lik transaction bütçesi, DB'nin 50 sn'lik `statement_timeout`'u yüzünden ulaşılamaz — önizleme eşiği (200k satır) DB'nin vermeyeceği bir söz veriyor

| Şiddet | **S3** | Kategori | A.4 (tx bütçesi) / D | Öncelik | **P5** | Modül | Ana veri / merge | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `MasterDataMergeService.merge` tek transaction'da 42 kuralı `$executeRawUnsafe` UPDATE'leriyle koşar ve bunun için özel bir bütçe alır (`timeout: 120_000`). Aynı transaction, DB tarafında **`statement_timeout = 50 s`** ile sınırlıdır ve kod hiçbir yerde `SET LOCAL statement_timeout` ile bunu yükseltmez. Yani **tek bir UPDATE 50 sn'yi aştığı anda** birleştirme `57014` ile ölür — 120 sn'lik bütçe yalnız "çok sayıda kısa ifade" için işe yarar. Önizlemedeki "bu iş çok büyük" eşiği (`MAX_ROWS_TO_MOVE = 200_000`) bu ayrımı bilmediği için, DB'nin tek ifadede taşıyamayacağı bir hacmi "uygulanabilir" olarak onaylar.

**Kanıt**
- `Teks-Erp/src/services/master-data-merge.service.ts:57-64`:
  ```ts
  /** Önizlemede "bu iş çok büyük" eşiği. 20 sn'lik varsayılan tx tavanına karşı
   *  ÜÇ katmanlı savunmanın birincisi (ikincisi çağrıya özel timeout, …). */
  const MAX_ROWS_TO_MOVE = 200_000;
  /** Bu çağrıya özel tx tavanı — varsayılan 5 sn/20 sn birleştirmeye yetmez. */
  const MERGE_TX_TIMEOUT_MS = 120_000;
  ```
- `:711` — `{ timeout: MERGE_TX_TIMEOUT_MS, maxWait: 10_000 }`; `:629` — kural başına `$executeRawUnsafe` UPDATE (tablo/kolon `MERGE_MAP` sabitinden, değerler bind).
- `SET LOCAL` repoda **yalnız 1 yerde**: `audit.service.ts:233` (`teks.audit_purge`). Merge'de yok (`grep -rn "SET LOCAL" src` → tek vuruş).
- DB tarafı: yerel sunucuda `adnansahin_db` için `setconfig = {statement_timeout=50s, idle_in_transaction_session_timeout=5min}`; `Teks-Erp/docker-compose.yml:26` `statement_timeout=50s`; `lib/prisma.ts:87` yorumu global bütçe için bu ilişkiyi doğru kuruyor (*"timeout DB statement_timeout=50s altında"*) ama **merge override'ı bu ilişkiyi kırıyor**.
- **Koruma kontrolü (K1):** retry yok (`P2034`/`57014` hiçbir yerde yakalanmıyor — `error.middleware.ts:517-523` P2034'ü 409'a çeviriyor, `57014` generic 500'e düşer); parçalı (chunk'lı) UPDATE yok; `MAX_ROWS_TO_MOVE` yalnız toplam satır sayısına bakıyor, **tek kuralın** satır sayısına değil.

**failure_mode.** Sistemin en çok satırı olan tablosunda (ör. `rolls` ya da `system_logs`) 200.000'e yakın satır taşıyan bir müşteri birleştirmesi: `UPDATE rolls SET "customerId" = $1 WHERE "customerId" = $2` 50 sn'yi aşar → `canceling statement due to statement timeout` → tüm merge geri sarılır → kullanıcı **500** alır. Hata **kalıcı ve deterministiktir**: tekrar denemek her seferinde aynı yerde ölür, birleştirme hiçbir zaman tamamlanamaz; panel "önizleme uygun" demeye devam eder.

**Veride fiili ihlal (K2).** Arandı, **bugün ulaşılamaz**: prod kopyasında toplam `rolls` 2.431, `system_logs` 10.485 satır. Tek bir birleştirmenin taşıyabileceği en büyük hacim binlerle ifade ediliyor → 50 sn'lik ifade süresine uzak. Bulgu **tasarım çelişkisi** olarak kayda geçiyor, bugünün riski değil.

**İş etkisi.** Bugün yok. Veri büyüdükçe (ya da `system_logs` arşivlenmeden birikirse) mükerrer temizliği tıkanır ve sebebi yanlış yerde aranır ("tx timeout'u artıralım" → işe yaramaz).

**Öneri (2. tur için).** ① Merge tx'inin İLK ifadesi `SET LOCAL statement_timeout = '110s'` olsun (tx'e özeldir, commit'te söner — `audit.service.ts:225-233` emsali, aynı `SET LOCAL` disiplini); ② `MAX_ROWS_TO_MOVE` kontrolü **kural başına** da uygulansın (en büyük tek kuralın satır sayısı ayrı eşik); ③ önizleme metni "bu iş X saniye sürebilir" yerine somut kuralı göstersin. Migration/veri dokunuşu **yok**.
**Kabul kriteri.** Merge tx'i açıldığında oturumun `statement_timeout`'u ≥ tx bütçesi (bekçi: `test_master_data_merge` içinde `SHOW statement_timeout` sondası); kural başına eşik aşımı önizlemede blocker olarak görünüyor.
**Efor.** 0,5 gün.
**Önceki defter.** Yeni (K3b HOTSPOT H-10'un bulgu hâli).

---

### [D-D-07] Sevkiyat iptali/stornosunun "kim, ne zaman, neden" izi yalnızca best-effort audit'te — `Shipment`'ta iptal kolonu yok

| Şiddet | **S3** | Kategori | D (yan etkinin commit sonrasına alınması) / I | Öncelik | **P4** | Modül | Sevkiyat | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `cancelShipment` sevkiyatı `CANCELLED` yaparken **hiçbir iz kolonu yazmıyor** (`cancelledAt`, `cancelledById`, `cancelReason` alanları `Shipment` modelinde yok) ve uç zaten sebep de istemiyor. `undoDispatch` sebep istiyor (≥3 karakter) ama sebebi transaction içinde yalnız `printed_documents.voidReason`'a yazıyor; "kim geri aldı" bilgisi **sadece** commit sonrası best-effort audit satırında. Audit yazımı tasarım gereği isteği düşürmez (`audit.service.ts:110-115`) — düşerse yıkıcı işlemin faili kaybolur. Aynı projede `WorkOrder` ve `Roll` için tam tersi karar verilmiş ve gerekçesi yazılmış (*"İptal izi KOLONDA: audit 6 ayda bir arşivleniyor, sebep orada kalırsa 'bu iş emri neden iptal edildi' sorusu sessizce cevapsız kalırdı"* — `workorder.service.ts:3392-3396`).

**Kanıt**
- `Teks-Erp/prisma/schema.prisma` `model Shipment` alan listesi: `dispatchedAt/dispatchedById`, `invoiceNo/invoicedAt/invoicedById` **var**; `cancelledAt` / `cancelledById` / `cancelReason` **yok** (awk ile tam alan dökümü alındı).
- `Teks-Erp/src/services/shipping.service.ts:1989-2000` — `cancelShipment(shipmentId, userId)`: **sebep parametresi yok**; tx yalnız `cancelPlannedShipmentTx`; iz `AuditService.log(… newData: { kind: "CANCEL", freedSacks })` (`:1998`, tx sonrası, best-effort).
- `:2231-2244` — `undoDispatch` audit'i (`kind: "UNDO_DISPATCH"`, `reason`) commit sonrası; tx içindeki tek kalıcı sebep izi `:2211-2216` `voidForSource(tx, …, \`Sevk geri alındı: ${trimmed}\`)`.
- Karşı örnek (doğru desen): `workorder.service.ts:3397-3401` `cancelledAt/cancelledById/cancelReason/cancelReasonCode` **claim'in içinde**; `inventory.service.ts:3149-3156` `resolveReasonCode` + kolon.
- **Koruma kontrolü (K2/K1):** `/health` `auditWriteFailures` sayacı var (`audit.service.ts:39-56`) ama **eşik alarmı yok**; süreç-içi sayaç restart'ta sıfırlanır (`:26` yorumu bunu söylüyor).

**failure_mode.** DB anlık bir hata verdiğinde (havuz timeout'u, `system_logs` üzerindeki koruma trigger'ı, disk) `AuditService.log` yutulur. Sevkiyat `CANCELLED` olur, çuvallar havuza döner, tahsisler silinir — ve **hiçbir yerde kimin iptal ettiği yazmaz**: `Shipment.updatedAt` dışında zaman damgası bile yok. "Bu sevkiyatı kim iptal etti?" sorusu kalıcı olarak cevapsız kalır; müşteri "malım nerede" dediğinde iz sürülemez.

**Veride fiili ihlal (K2).** Kısmen ölçüldü:
```sql
SELECT s.status, count(*) FROM shipments s GROUP BY 1;   --> PLANNED 1 · DISPATCHED 39 (CANCELLED 0)
SELECT "newData"->>'kind', count(*) FROM system_logs WHERE "tableName"='SHIPMENT' GROUP BY 1;
--> DISPATCH_NOTE 2 · UNDO_DISPATCH 1 · (null) 40
```
`CANCELLED` sevkiyat henüz yok → fiili iz kaybı **0**. Ancak **audit kapsamının eksikliği ölçülebilir durumda**: 2.431 topun **55'inin** `system_logs`'ta `tableName='ROLL'` + `recordId=<roll.id>` satırı YOK (33 `SUBCONTRACTOR_RETURN`/`IN_PRODUCTION`, 22 `TAMBUR_SPLIT`/`WAREHOUSE`; hepsi 2026-08-06…08-24 arasında doğdu, arşiv tablosu **boş** → arşivlenme değil). Bu toplar için iz yalnız başka bir kaydın JSON gövdesinde geçiyor (örnek `0e03f1a2-…`: `recordId` eşleşmesi 0, JSON içinde 1) → `recordId` ile sorgulanan hiçbir yüzey onları bulamaz.

**İş etkisi.** ISO 27001 / iç denetim açısından yıkıcı işlemin faili kaydı garantisiz. Pratikte: "sevkiyat neden iptal edildi" sorusu 6 ay sonra değil, **audit yazımı düştüğü an** cevapsız kalır.

**Öneri (2. tur için).** ① `Shipment`'a `cancelledAt`/`cancelledById`/`cancelReason` kolonları + `cancelShipment`'a zorunlu sebep (`[PROD'DA ÇALIŞTIRMA]` — additive migration, `NULL`-able; geri alma: kolonları düşürmek yerine kullanmayı bırak); ② `undoDispatch` sebebini `Shipment` üzerinde de sakla (bugün yalnız belgede); ③ `/health` `auditWriteFailures > 0` için panelde görünür bant (mekanizma var, yüzey yok); ④ ayrı iş: doğuşta audit yazmayan yaratma yolları (`subcontractor.receive` born roll'ları, tambur kesim çocukları) için `logMany` ile satır başına iz — **I alanına yönlendirildi**.
**Kabul kriteri.** `cancelShipment` sebepsiz çağrılamıyor; iptal edilmiş her sevkiyatta `cancelledById IS NOT NULL`; `consistency-check`'e "CANCELLED sevkiyat ama `cancelledById` NULL" satırı eklendi.
**Efor.** 1 gün (migration + uç + Electron sebep kutusu hariç).
**Önceki defter.** Yeni.

---

### [D-D-08] `recordPrintEvent` iki ayrı yazım + yutulan alt-çağrı: etiket çözülemese bile "etiket güncel" işareti temizleniyor

| Şiddet | **S3** | Kategori | D (iş biriminin parçaları ayrı) | Öncelik | **P5** | Modül | Etiket | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Etiket baskı olayı üç adımı transaction'sız zincirliyor: (1) `seedRollLabelSnapshot` (topun `lastLabelSnapshot` + `labelCustomerId` alanlarını yazar), (2) `roll.update` ile `labelDirty:false` + `labelPrintedAt`, (3) audit. (1) etiketi çözemezse **sessizce `seeded:false` döner ve bu dönüş okunmaz** → (2) yine de "etiket güncel" der. (1) ile (2) arasında bir hata olursa da durum yarım kalır. İki yazım **aynı satıra** gittiği için tek `update`'te birleştirilebilir olmaları bu bulgunun düzeltmesini ucuzlatıyor.

**Kanıt** — `Teks-Erp/src/services/label.service.ts:2095-2116`:
```ts
await this.seedRollLabelSnapshot(rollId, userId, opts);   // ← dönüş DEĞERİ atılıyor
…
await prisma.roll.update({                                 // ← ayrı yazım
  where: { id: rollId },
  data: { labelDirty: false, labelPrintedAt: new Date() },
});
```
- `:1976-1982` — `seedRollLabelSnapshot`'ın sessiz dalı: `catch (e) { console.error(…); return { success: true, data: { seeded: false } }; }` — **fırlatmıyor**.
- `:1989-1999` — snapshot yazımı; yorumu *"İkisi ayrı yazılsaydı biri düşünce kolon ile JSON ayrışır"* diyerek **aynı update içinde** iki alanı yazmayı zaten kural edinmiş; aynı kural bir üst seviyede uygulanmamış.
- **Koruma kontrolü (K1):** tx yok; telafi yok; `labelDirty` için mutabakat kontrolü var ama farklı bir soruyu ölçüyor (`consistency-check-derived.sql:200` §25 — kartelalık işareti); "snapshot yok ama `labelDirty=false`" sorusu hiçbir bölümde yok.

**failure_mode.** Şablon ataması silinmiş / müşteri alias'ı bozuk bir topta baskı yapılırsa: `getRollLabel` fırlatır → `console.error` → snapshot yazılmaz, ama `labelDirty:false` yazılır ve `LABEL_PRINTED` audit'i atılır. Sonuç: top listesinde **"etiketi güncel"** görünür, oysa sistemde o etiketin ne bastığına dair hiçbir kayıt yoktur (`lastLabelSnapshot` eski/boş). "Bu topun etiketinde ne yazıyordu" sorusu cevapsız kalır ve operatör yeniden basma ihtiyacını fark etmez.

**Veride fiili ihlal (K2).** Aranmadı — sebep: `lastLabelSnapshot` JSON'unun "eski mi" olduğu tek başına ayırt edilemez (baskı zamanı ile snapshot içeriği arasında kıyaslanabilir bir damga yok). Ölçülebilir hâle gelmesi için snapshot'a baskı zamanı eklenmesi gerekir (öneriye dahil).

**İş etkisi.** Düşük — fiziksel kâğıt zaten basılmıştır; kaybolan, "hangi şablonla/hangi müşteriyle basıldı" izidir.

**Öneri (2. tur için).** Üç adımı tek tx'e al ya da en azından: `seedRollLabelSnapshot`'ın dönüşünü oku; `seeded === false` ise `labelDirty`'yi **temizleme** (fail-closed) ve yanıtta uyarı döndür. `labelPrintedAt` damgası her hâlükârda yazılsın (fiziksel kâğıt gerçeği).
**Kabul kriteri.** Etiket çözülemeyen bir topta `recordPrintEvent` sonrası `labelDirty` hâlâ `true` ve yanıt `warnings` taşıyor; bekçi negatif sondayla kırmızı.
**Efor.** 0,5 gün.
**Önceki defter.** Yeni.

---

### [D-D-09] `changeTargetColor` / `changeWidth`: havuz claim'i ile refakat kartı bayat işareti ayrı iki yazım

| Şiddet | **S3** | Kategori | D (çift-mod helper, havuz çağrı yeri) | Öncelik | **P5** | Modül | WO / Refakat kartı | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** İş emrinin hedef rengini/enini değiştiren iki uç, atomik claim'i **havuz client'ıyla** yapıyor ve hemen ardından `markTravelerCardDirtyTx(prisma, workOrderId)` çağırıyor — çift-mod helper'ın havuz client'ıyla çağrıldığı iki yer bunlar (K3a §4). İkinci yazım düşerse plan değişmiş ama refakat kartı "içerik güncel" olarak işaretli kalır. Yön güvenli tarafta ("fazla işaretlemek güvenli, eksik hata") ama burada **eksik** tarafa düşülüyor.

**Kanıt** — `Teks-Erp/src/services/workorder-link.service.ts:564-577` ve `:632-640`:
```ts
const claim = await prisma.workOrder.updateMany({ where: { id: workOrderId, status: { notIn: PLAN_CHANGE_FROZEN_STATUSES }, targetColorId: wo.targetColorId }, data: { targetColorId: colorId } });
if (claim.count === 0) throw AppError.conflict(…);
await markTravelerCardDirtyTx(prisma, workOrderId);      // ← AYRI yazım, havuz client'ı
```
`:639` yorumu bayrağın yükünü açıkça söylüyor: *"En, fason çekisindeki TEK 'EN' değerinin kaynağı → kâğıt bayatladı."*
- Karşılaştırma: aynı helper'ın diğer **20+** çağrı yerinin hepsi `tx` alıyor (`traveler-card-dirty.helper.ts:34`; `workorder.service.ts:4840/:5562/:5716`, `order.service.ts:505/:2827/:3231`, `subcontractor.service.ts:1294/:2033/:5356`, `batch.service.ts:254/:485/:702`, …).
- **Hafifletici (K1 kontrolü):** 2026-08-06 kararıyla refakat kartı baskısı planı **canlı** çözüyor (`traveler-card.service` `resolvePrintPlan`) → bayat bayrak artık yanlış İÇERİK bastırmaz; ayrıca rozet yüzeyleri kaldırıldı. Kalan etki: `contentDirty` tabanlı iç sorgular/raporlar.

**failure_mode.** En değişikliği commit olur, `markTravelerCardDirtyTx` havuz timeout'una düşer → `TravelerCard.contentDirty` `false` kalır. Fason çekisi yeniden basılana kadar kartın "yeniden basılmalı" sinyali üretilmez; bayrağa bakan her yüzey kartı güncel sanar.

**Veride fiili ihlal (K2).** Aranmadı — `contentDirty=false` olan bir kartın gerçekten güncel olup olmadığı yalnız `planKey` yeniden hesaplanarak anlaşılır; salt-okunur SQL ile ölçülemez.

**Öneri (2. tur için).** İki fonksiyonu da `prisma.$transaction(async (tx) => { claim; markTravelerCardDirtyTx(tx, …) })` biçimine al (tek satırlık iki yazım, bütçe sorunu yok). Bekçi: `traveler-card-dirty.helper` çağrı yerlerinin **hepsinin** `tx` aldığını doğrulayan AST bekçisi (`fason-open-dispatch` tek-kaynak bekçisi deseni).
**Kabul kriteri.** `grep -n "markTravelerCardDirtyTx(prisma" src` → **0**; AST bekçisi kırmızı verebiliyor.
**Efor.** 0,25 gün.
**Önceki defter.** Yeni.

---

### [D-D-10] "Sipariş Bağla (override)" zinciri: son adım düşerse plan + toplar kalıcı olarak değişmiş kalır, kullanıcı yalnız hatayı görür

| Şiddet | **S3** | Kategori | D (tx-dışı çok adımlı orkestrasyon) | Öncelik | **P5** | Modül | WO / Sipariş | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `linkOrderLineWithOverride` üç işi sırayla, **üç ayrı transaction**'da yapar: ① iş emrinin hedef rengi/eni düzeltilir, ② düzeltilebilir topların rengi/eni eşitlenir (top başına ayrı tx, `failed[]` ✓), ③ sipariş bağı kurulur. Sıra bilinçli ve gerekçesi yazılı ("sonraki adımın düşmesi öncekini yanlışlamaz"). Ama ③ fırlattığında **istisna yukarı gider** ve yanıt hiç oluşmaz: kullanıcı ①+②'nin kalıcı olduğunu hiçbir yerden öğrenemez.

**Kanıt** — `Teks-Erp/src/services/workorder-link.service.ts:852-858` (sözleşme), `:930-966` (① ve ②), `:967-969`:
```ts
// ③ Bağ — hedef artık satırla uyumlu, normal doğrulamadan geçer.
const linkRes = await this.linkOrderLines(workOrderId, [orderLineId], userId);   // ← fırlatırsa ①+② kalıcı
warnings.push(...linkRes.data.warnings);
```
- ③'ün fırlatabildiği yerler: `linkOrderLines` `:279-342` pre-tx doğrulamaları (`assertPlanEditable`, iptal edilmiş kalem, kumaş/renk uyumu).
- **Koruma kontrolü (K1):** telafi yok; ①'in geri alınması için ayrı bir uç yok (`changeTargetColor` yeniden çağrılabilir ama toplar ②'de değişmiş olur ve `COLOR_DYED_BLOCKED` kapısına takılabilir).

**failure_mode.** Süpervizör tamburda "elimdeki mal aslında bu siparişin renginde" diyerek override zincirini başlatır. ① ve ② koşar (iş emrinin hedef rengi + 12 topun rengi değişir), ③'te iş emri bu arada başka bir kullanıcı tarafından `COMPLETED` edilmiştir → `assertPlanEditable` 409. Süpervizör *"iş emri planı değiştirilemez"* hatasını görür ve **hiçbir şey olmadı** sanır; oysa iş emrinin hedef rengi ve 12 topun rengi kalıcı olarak değişmiştir.

**Veride fiili ihlal (K2).** Aranmadı — "renk değişti ama bağ kurulmadı" durumu meşru bir düzeltmeden ayırt edilemez (aynı audit izini bırakır).

**Öneri (2. tur için).** ③'ü `try/catch` ile sar; hata hâlinde **200 dönerek** `{ linked: false, changedColor, changedWidth, rollsUpdated, warnings: [ …, "Plan ve toplar düzeltildi ancak sipariş bağı kurulamadı: <mesaj>" ] }` döndür (zincirin kendi felsefesiyle tutarlı: her adım kendi başına meşru). Alternatif: ③'ü **ilk adım** yapmak mümkün değil (uyumsuzluk nedeniyle reddedilir) — bu yüzden raporlama tek çözüm.
**Kabul kriteri.** ③ bilerek düşürülen bekçide yanıt 200 + `linked:false` + açıklayıcı `warnings`; bekçi düzeltme geri alınınca kırmızı.
**Efor.** 0,25 gün.
**Önceki defter.** Yeni.

---

### [D-D-11] Fason kabulünden sonraki iki best-effort düzeltmeden biri sessiz: en güncellenemezse kullanıcıya hiçbir şey söylenmiyor

| Şiddet | **S3** | Kategori | D (commit sonrası yan etki) | Öncelik | **P5** | Modül | Fason | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Fason kabul transaction'ı commit olduktan sonra iki "best-effort" güncelleme koşuyor: iş emrinin **eni** ve (istenmişse) **hedef rengi**. İkisi de tx dışı ve bilinçli; ama renk hatası `warnings`'e yazılıp kullanıcıya dönerken, en hatası yalnız `console.warn`'a düşüyor. Aynı sınıftaki iki yan etkiden biri görünür, diğeri sessiz.

**Kanıt** — `Teks-Erp/src/services/subcontractor.service.ts:3269-3283` (sessiz) ↔ `:3296-3310` (raporlu):
```ts
try { await workOrderLinkService.changeWidth(…); }
catch (err) { console.warn(`[fason-kabul] İş emri eni güncellenemedi (WO ${data.workOrderId}):`, …); }
…
try { const res = await workOrderLinkService.changeTargetColor(…); postWarnings.push(...res.data.warnings); }
catch (err) { postWarnings.push(`İş emrinin rengi değiştirilemedi: …`); }
```
- Yükün büyüklüğü aynı dosyada yazılı (`workorder-link.service.ts:639`): en, **fason çekisindeki tek EN değerinin kaynağı**.
- **Koruma kontrolü (K1):** `changeWidth` `PLAN_CHANGE_FROZEN_STATUSES` nedeniyle terminal WO'da fırlatır — yani **beklenen ve sık** bir hata yolu; buna rağmen sessiz.

**failure_mode.** Kabul personeli 148 cm ölçüp girer; iş emri o sırada `COMPLETED` olduğu için `changeWidth` `AppError.conflict` fırlatır ve yutulur. Kullanıcı *"Kabul tamamlandı"* mesajını görür; ölçülen en yalnız doğan topa yazılmıştır, iş emrinde eski değer kalır ve **bir sonraki fason çekisi hâlâ eski eni basar** — düzeltmenin çözmek için eklendiği sorun geri gelir, kimse fark etmez.

**Veride fiili ihlal (K2).** Aranmadı — "topun eni ≠ iş emrinin eni" meşru olarak da doğar (çekme/ölçüm farkı). Ayırt edici sorgu için kabul zamanı ile WO `width` güncellenme zamanının kıyası gerekir; audit tabanlı, salt-okunur SQL ile güvenilir değil.

**Öneri (2. tur için).** `changeWidth` catch'i de `postWarnings.push(...)` yapsın (tek satır); yanıttaki `warnings` alanı zaten var ve Electron gösteriyor.
**Kabul kriteri.** Terminal WO'ya yapılan kabulde yanıt `warnings` içinde "İş emrinin eni güncellenemedi" satırı var.
**Efor.** 0,1 gün.
**Önceki defter.** Yeni.

---

### [D-D-12] `GET .../printed-documents` lazy-init yolu YAZIYOR ve snapshot'ı transaction dışında kuruyor

| Şiddet | **S4** (bilgi) | Kategori | D / F | Öncelik | **P6** | Modül | Belge | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Donmuş belge okuma yolu, belge hiç yoksa onu **o anda üretip yazıyor** (geriye dönük dondurma). Snapshot havuz client'ıyla kuruluyor ve tek `create` ile yazılıyor — transaction yok. Yarış P2002 + "kazananı oku" ile doğru şekilde kapatılmış; yine de bir GET ucunun yan etkili olması ve belgenin içeriğinin okuma ile yazma arasında değişebilmesi kayda geçirilmeli.

**Kanıt** — `Teks-Erp/src/services/printed-document.service.ts:381-420`: `(entry.lazyInit ?? entry.fresh)(prisma, sourceId)` → `buildSnapshotEnvelope(prisma, …)` → `prisma.printedDocument.create({ version: 1, reconstructed: true })`; `:415-427` P2002 → `winner` okuması. Aynı sınıfın kardeşi `reissue` (`:664-681`) da snapshot'ı havuzda kurup claim'i tx'te yapıyor (K3b T5).
**failure_mode.** İki kullanıcı aynı anda eski bir sevkiyatın belgesini açarsa biri P2002 alır ve diğerinin ürettiği belgeyi okur — doğru davranış. Kalan risk: `buildSnapshotEnvelope` ile `create` arasında kaynak değişirse (ör. iade commit'i) belge, hiç var olmamış bir ara duruma göre dondurulur; "belge yolu da brüt" kuralının (2026-08-05) geçerliliği bu pencerede doğrulanmamıştır.
**Öneri.** Okuma + oluşturma tek tx'e alınsın (üç ifade, bütçe sorunu yok) ya da `lazyInit` yalnız açık bir POST ucundan tetiklensin. **E/BLG alanına da yönlendirildi.**
**Efor.** 0,25 gün.

---

## 2. Uygulanan kontrol listesi

Prompt **Bölüm 3-D** (satır 521-527) + **A.4**'ün tx kısmı:

| Madde | Durum |
|---|---|
| **D.1** İş biriminin tüm parçaları tek tx'te mi? — sevkiyat dispatch (shipment + allocation + roll SHIPPED + belge dondurma + sipariş recompute) | **uygulandı** — `shipping.service.ts:1806-1882` **hepsi tek tx** ✓ (bulgu yok; §3'te olumlu kayıt) |
| D.1 — storno (`releaseSacks` + `cancelPlannedShipmentTx`) | **uygulandı** — `:2152-2229` **aynı tx** ✓ (2026-08-22 kararı doğrulandı) |
| D.1 — toplu iade (N defter satırı + tek irsaliye) | **uygulandı** — `return.service.ts:481-570` tek tx + `lockShipmentScopeTx` ilk ifade ✓ |
| D.1 — fason kabul (makbuz + kalemler + yeni toplar + parti + sapma + WO adımı) | **uygulandı** — `subcontractor.service.ts:2678-3235` tek tx ✓; tx dışı kalan `changeWidth`/`changeTargetColor` → **D-D-11** |
| D.1 — tambur finalize / kesim / geri alma (sayaç tx öncesi) | **uygulandı** — sayaç rezervasyonu bilinçli ve ölçülmüş (`roll-barcode.helper.ts:48-72`), boşluk zararsız; **bulgu yazılmadı** (bkz. §3). Yalnız `finalizeWarehouseCut` yorum↔kod ayrışması **B alanına** yönlendirildi (K3b H-5, defterde `F-CORE-VER-008` açık) |
| D.1 — kapanış dispozisyonu | **uygulandı** — `workorder.service.ts:3862-4086` tek tx, kapsam birebir claim ✓ |
| D.1 — WO iptali (`prepareFasonCancelDecision` tx-öncesi havuz `updateMany` + `cancelBulk` `failed[]`) | **uygulandı → D-D-01** |
| D.1 — `order-links/override` zinciri ("tek tx DEĞİL, bilinçli" — sonucu ne?) | **uygulandı → D-D-10** (sonuç: ①+② kalıcı, ③ düşerse kullanıcı bilmiyor) |
| D.1 — sipariş oluşturma O2 `create` tx dışı | **uygulandı — bulgu yazılmadı**: `order.service.ts:2138-2143` create'in fırlatabileceği tüm doğrulamalar claim'den ÖNCE koşuyor + `clientToken` replay; kalan pencere belgeli (`:2134-2140`). §3'te olumlu kayıt |
| D.1 — sipariş iptali O5 WO iptalleri tx dışı | **uygulandı → D-D-02** |
| D.1 — merge (42 kural) | **uygulandı** — tek tx + 8027 ilk ifade ✓; bütçe çelişkisi → **D-D-06**; `markMerged` tx dışı best-effort (belgeli, `:754-757`) → bulgu değil |
| D.1 — import (satır tx mi tek tx mi) | **uygulandı** — satır satır **bilinçli** ve belgeli (`import.service.ts:12-25`) ✓; koşum kaydı/audit'in sonda olması → **D-D-04** |
| D.1 — kurşun/fason `bulkDispatchStep` SEPARATE | **uygulandı → D-D-03** (kurşun `assignBulk`/`cancelBulk` `failed[]` taşıyor ✓, ayrışan tek yol fason SEPARATE) |
| D.1 — etiket `print-event` 3 yazım tx'siz | **uygulandı → D-D-08** |
| D.1 — manuel top FAZ1/FAZ2 iki tx | **uygulandı — bulgu yazılmadı**: `tambur-manual.service.ts` dosya başlığında belgeli; FAZ2 idempotent dal (`:1128-1147`) aynı token ile bağlamayı tamamlıyor; kalan durum ("top stokta, adıma bağlanmamış") görünür ve düzeltilebilir |
| **D.2** Tx dışında kalan yazmalar (A.4 `prisma` vs `tx` taraması) | **uygulandı** — `$transaction(async (tx)` gövdelerinde global `prisma.*` **YAZIMI 0** (K3a/K3b + bağımsız grep); bulunan iki dolaylı kullanım **salt-okuma** (`workorder.service.ts:989`, `:1002`, `:5505`) → havuz sınıfı **D-D-05** |
| **D.3** Rollback edilemeyen yan etki tx içinde mi? (e-posta/webhook/dosya/dış çağrı) | **uygulandı** — **0**. 14 I/O eşleşmesinin hepsi tx dışında (§0 tablosu); `pg_dump`/`rclone` child process'leri (`helpers/pg-tool.helper.ts:105`, `offsite-backup.helper.ts`) hiç tx görmüyor; `bcrypt` tx dışı; `setTimeout` yalnız `backup.service.ts:123` (unref'li) |
| **D.4** Read replica → kullanıcı kaydettiğini hemen görüyor mu | **kapsam dışı — read replica YOK** (KUNYE: tek DB, `pg.Pool` tek `connectionString`) |
| **D.5** Mikroservis / telafi (compensation) | **kapsam dışı — ayrık servis YOK** (tek Express süreci, PM2 `fork`, `instances:1`). Yerine geçen "servisler arası zincir" telafisi D-D-01/02/03/10'da denetlendi |
| **A.4** `$transaction` varsayılan timeout'ları / uzun işlerde opsiyon | **uygulandı** — global `maxWait 5s/timeout 20s` (`lib/prisma.ts:89-92`) DB `statement_timeout=50s` altında ✓; tek override merge 120 s → **D-D-06**; en uzun işler: dispozisyon (`DISPOSITION_MAX_ROLLS=200`), tambur kesim (`.max(200)`), arşiv (5.000 satır/tur, idempotent), kartela `receive` (Σcount ≤ 1000/kalem, **dizi tavansız** → F alanına) |
| **A.4** tx içinde `await` ile dış çağrı | **uygulandı** — 0 (yukarıda) |
| **A.4** tx dışına taşan yazma | **uygulandı** — 0 doğrudan; 12 "tx-öncesi/dışı" yol tek tek okundu (KYY §6 sütunu), 6'sı belgeli, 6'sı belgesiz; belgesizlerden 4'ü bulgu (D-D-01/02/03/09), 2'si düşük (D-D-08, D-D-12) |
| **A.4** batch (`$transaction([...])`) vs interactive — karar mantığı tx dışında mı? | **uygulandı** — 5 batch sitesi: `permission-management:1011` (karar `existing` diff'i tx dışı ama `createMany` çakışması **tüm batch'i geri sarar**, yarım durum yok), `reason-preset:505` (küme eşitliği pre-tx; aradaki yeni satır kendi `sortOrder`'ıyla kalır — bozulma yok), `device:263`, `shipping:2592` (`RepeatableRead`, salt-okuma — `F-SEV-ESZ-002`'nin düzeltmesi), `master-data-merge` çok satırlı interactive. **Bulgu yok** |
| **A.4** İç içe transaction / `tx` parametresini opsiyonel alan servisler | **uygulandı** — `helpers/` ve `utils/` içinde `prisma.$transaction` **0** → nested tx yolu yok. Opsiyonel-`tx` deseni yalnız `system-setting.service.ts` (58 okuyucu, `tx ?? prisma`) ve `customer-alias.service.ts:223`; **hepsi salt-okuma** — tek anlamlı sonucu D-D-05'teki havuz sorusu |
| **A.4** Connection pool tükenmesi (uzun tx sayısı > havuz) | **uygulandı → D-D-05**; ölçüm: prod kopyasında `POOL_TIMEOUT` **0** |
| **A.4** `$transaction` içinde `Promise.all` | **uygulandı** — **0** (K3a/K3b + gövde okuması). ESLint kuralının kapsamı doğrulanmadı (bkz. §5) |
| **A.4** Nested write (`create` içinde `create`) | **uygulandı** — tek tx ✓ (`workorder.service.ts:1007` WO+steps+links+targetProps; `subcontractor.service.ts:1244` dispatch+items); kısmi hata mesajı okunabilirliği kapsam dışı (L alanı) |
| Çift-mod helper çağrı yerlerinde havuz client'ı geçilen **atomik olması gereken** noktalar (K3b envanteri) | **uygulandı** — 20 DB-yazan helper'ın çağrı yerleri tarandı; **yazan** helper'lardan havuzla çağrılan tek gerçek çift: `markTravelerCardDirtyTx(prisma, …)` `workorder-link.service.ts:577/:640` → **D-D-09**. Diğer havuz çağrıları **salt-okuma** guard/önizleme (`computeWorkOrderLocks`, `assertTargetColorChange`, `assertKursunTabletMayWrite`, `loadStationPropertyCaps`, `quality-grade`) → **A/D-A alanına** (check-then-act, tx sınırı değil) |
| 20 sn tx tavanı vs uzun işler — **en uzun iş** üzerinden failure_mode | **uygulandı → D-D-06** (merge; en uzun iş). Diğer adaylar ölçüldü ve elendi: arşiv 5.000 satır/tur **idempotent** (`skipDuplicates` + id listesi, `audit.service.ts:220-262`), dispozisyon 200 top tavanlı, import tek tx değil |
| Audit best-effort → yıkıcı işlemlerde iz kaybı; 55/2431 top ölçümü | **uygulandı → D-D-07** (ölçüm dahil) |
| "Yanıt commit'ten önce" adayları | **uygulandı — bulgu yok**: hiçbir controller `res.json`'u servis promise'inden önce göndermiyor; `void` fire-and-forget yalnız `backup.service.ts:408` `triggerManualBackup` (202 semantiği, `running` bayrağı ile korunuyor — **K-OPS**). `.catch(() => undefined)` kullanımlarının tamamı **audit / oturum kaydı** gibi ikincil izler (auth ×4, device ×8, work-session ×5, peripheral ×4, customer-standalone-label ×1) |
| "Yarım kalan durum" senaryosu her bulguda | **uygulandı** — D-D-01/02/03/04/05'te T1…T7 çizelgesi; D-D-06…12'de failure_mode paragrafı |

---

## 3. Doğru yapılanlar (korunması gereken kalıplar)

1. **Sevk / storno / PLANNED iptali tek transaction ve TEK GÖVDE.** `performDispatchTx` (`shipping.service.ts:1806-1882`) sevkiyat statüsü + `shipment_orders` + top `SHIPPED` + `OrderLine` kilitleri + `recomputeOrderStatus` + **irsaliye dondurma**'yı tek tx'te yapıyor; `undoDispatch` (`:2152-2229`) advisory kilidi **tx'in ilk ifadesi** olarak alıp storno + kapanışı aynı tx'te birleştiriyor; `cancelPlannedShipmentTx` (`:1961-1983`) iki çağıranın **tek kaynağı** ve yorumu ikinci kopya yazmayı açıkça yasaklıyor. ERP'nin para/stok etkili çekirdeği bu denetimde **kusursuz**.
2. **Tx içinde dış dünya YOK — istisnasız.** 118 interaktif transaction'ın hiçbirinde HTTP/dosya/child-process/bcrypt/sleep yok; etiket ve belge üreticileri `db` parametresiyle çalışıyor, baskı ve yazıcı iletişimi tamamen tx dışında. Bu, ERP'lerde en sık görülen "kilit ağ süresince tutuluyor" sınıfını **yapısal olarak** kapatıyor.
3. **Audit konvansiyonu tek yönlü ve tutarlı:** her `AuditService.log/logMany` çağrısı tx **sonrasında**; rollback'te iz yazılmıyor, `withBarcodeRetry` ile sarılı sitelerde retry audit'i çoğaltmıyor. Best-effort yutma sessiz değil — `/health` `auditWriteFailures` sayacı var (`audit.service.ts:39-56`).
4. **Parçalı sonuç kültürü:** `cancelBulk` (`subcontractor.service.ts:2245-2258`), `assignBulk`/`cancelBulk` (`kursun-bypass.service.ts:1085-1103`, `:1133-1149`), `applyAttributeToRolls`, `seedRollLabelSnapshotsBulk` (`label.service.ts:2007-2015`) — hepsi `failed[]` döndürüyor **ve** `AppError` olmayan hatayı yeniden fırlatıyor ("gerçek arıza '2 satır atlandı' diye rapor edilmesin"). D-D-03 bu kuralın tek ihlali.
5. **Sayaç kilidinin konumu ölçülerek seçilmiş.** `roll-barcode.helper.ts:48-72` barkod sayacının tx içinde mi dışında mı alınacağını **iki koşullu kabul kriteriyle** (T1 < 100 ms **VE** T2 = 30/30) belgeliyor; yalnız kilit süresine bakan "düzeltme"nin üretimi durduracağını yazıyor. Bu, denetim literatüründeki sayaç-kilidi kuralının doğru uygulanmış hâli.
6. **Kısmi durumun bilinçli kabul edildiği yerlerde gerekçe kodda yazılı:** `quickStart` (`workorder.service.ts:1204-1207`), `quickOrderFromRolls` (`order.service.ts:2134-2143` — üstelik `create`'in fırlatabildiği **tüm** doğrulamalar claim'den öne alınmış), `transferToNextFason` (`subcontractor.service.ts:1583-1590`), `fabric-property.service.ts:372-375`, `import.service.ts:12-25`. Denetim açısından kritik olan bu: **kabul edilen risk yazılı olduğunda bulgu değil, karardır.**

---

## 4. Sınır ötesi notlar

- **(A / D-A)** Havuz client'ıyla çağrılan **salt-okuma** guard'ları — `computeWorkOrderLocks(prisma)` `workorder.service.ts:5627` (tx içi ikizi YOK), `assertTargetColorChange(prisma)` `:4697` + `workorder-link.service.ts:525`, `assertKursunTabletMayWrite(prisma)` `kursun-qc.service.ts:613/:812`, `loadStationPropertyCaps(prisma)` `kursun-qc.service.ts:415/:1405` + `inventory.service.ts:4654` — tx sınırı bulgusu **değil** (yazım yok), check-then-act bulgusudur. D-A'ya.
- **(B)** `finalizeWarehouseCut` (`tambur.service.ts:2448-2458` yorum ↔ `:2466` kod): idempotency yorumu `clientToken @unique` P2002'sine dayanıyor ama o yolda `clientToken` yazılmıyor ve catch yok → replay 409 + yanmış barkod numarası. Defterde `F-CORE-VER-008` **açık**.
- **(B)** Sipariş içe aktarımında **satır düzeyi `clientToken` yok** (`order.adapter.ts:284-313`); D-D-04'ün üçüncü önerisi doğrudan B alanına girer.
- **(I)** Doğuşta `recordId`-anahtarlı audit satırı üretmeyen iki yaratma yolu ölçüldü: `subcontractor.receive` born roll'ları (33 top) ve tambur kesim çocukları (22 top) — toplam **55/2431**. Arşivleme değil (arşiv tablosu boş), kapsam boşluğu. `system_logs.recordId` ile sorgulanan hiçbir yüzey bu topları bulamaz.
- **(I / J)** `consistency-check-derived.sql` §24a/§24b **ikisi de `r.status='AT_SUBCONTRACTOR'`** süzgeci taşıyor; D-D-01'in ürettiği drift ("açık sevkin topu artık fasonda değil") hiçbir bölümde sorulmuyor. Mutabakat kapsamı genişletilmeli.
- **(F)** Tavansız diziler tx bütçesini besliyor: `label-template.controller.ts:130` `variants`, `kartela.controller.ts:32` `returns` (kalem başına `count ≤ 1000` ama dizi tavansız → tek `createMany` ile N swatch), `batch.controller.ts:23` `batchIds`. Ayrıca `server.requestTimeout` ayarlanmamış (Node varsayılanı 300 s) — 10.000 satırlık import bu sınırla çakışabilir.
- **(F / D)** `printed-document.service.ts:381-420` — **GET ucu yazıyor** (lazy-init). Yarış P2002 ile kapatılmış ama "GET yan etkisizdir" ilkesiyle (refakat kartı önizlemesi için açıkça yazılmış) çelişiyor.
- **(K)** `test_wo_cancel_fason.ts` (`:113-118`) yalnız mutlu yolu ölçüyor — bekçinin kör noktası D-D-01'in bulunduğu yerle **birebir aynı**. `cancelWithActions`, `bulkDispatchStep` SEPARATE ve import kesinti senaryosu için de eşzamanlılık/kısmi-durum bekçisi yok.
- **(H / OPS)** `/health` `auditWriteFailures` ve `poolAcquireTimeouts` sayaçları **var**, eşik/alarm **yok** — D-D-05 ve D-D-07'nin erken uyarı katmanı bugün pasif.
- **(OPS)** Prod DB'nin per-DB `statement_timeout` ayarı **doğrulanamadı** (yerel sunucudaki `adnansahin_db` 50 s; saha kopyası `tekserp_saha_0825` per-DB ayar taşımıyor). D-D-06'nın tetiklenebilmesi bu ayara bağlı — prod'da ölçülmeli.

---

## 5. Kapsanmayan / erişilemeyen

- **Canlı prod'a erişim yok.** Tüm DB kanıtları 2026-08-25 kopyasından (`tekserp_saha_0825`, 190/195 migration — son 5 migration'ın kolonları orada YOK). Prod'un `statement_timeout` / `max_connections` değerleri **doğrulanamadı** → D-D-06 `[VARSAYIM]` içerir.
- **Repro (K3) koşulmadı.** Bu denetçiden istenmedi (D-A/D-B yükümlülüğü). D-D-01, D-D-02 ve D-D-03 **yarış gerektirmediği** için tek süreçli script ile üretilebilir; D-D-05 için 30 paralel istek sondası gerekir. Hiçbir bulgu için dev DB'ye yazılmadı.
- **Zamanlama ölçümü yapılmadı** (tx süresi, kilit tutulma süresi, havuz doygunluğu). D-D-05 ve D-D-06'daki süre iddiaları repodaki **mevcut** ölçümlere (`roll-barcode.helper.ts:56-64`, `lib/prisma.ts:41-46`) dayanıyor, yeniden ölçülmedi.
- **Okunmayan gövdeler (tx kapsamını etkileyebilir):** `batch-dispatch-surgery.helper.ts:116` `performDispatchSurgeryTx` (K3b envanterine güvenildi), `traveler-card.service.buildPlan/resolveForPrint` (client aktarımı `[VARSAYIM]`), `db-copy.service` / `backup.service` iş gövdeleri (K-OPS), `import` adaptörlerinin 16'sı (yalnız `order.adapter` okundu — create-only olan tek adaptör olduğu için).
- **ESLint kuralının kapsamı doğrulanmadı** — `eslint.config.mjs` okunmadı; "tx içinde `Promise.all` 0" sonucu grep + gövde okumasıyla üretildi, kuralın bunu mekanik olarak koruduğu **teyit edilmedi**.
- **`ImportRun` tablosunun saha verisi sorgulanmadı** (içe aktarım paketi sahada kullanılmıyor — `data:import` izni atanmamış); D-D-04'ün "maruziyet bugün 0" ifadesi bu dolaylı gerekçeye dayanıyor.
- **`Promise.all` + `updateManyAndReturn` sürücü davranışı** (tek bağlantıda "hard error" iddiası) çalıştırılarak doğrulanmadı; beceri referansına dayanıldı.
- **Satır numaraları** çalışma ağacından (2026-08-28); `git status` `Teks-Erp/src` altında yalnız `services/reports/order-cancellation.report.service.ts` değişikliği gösteriyor — denetlenen dosyaların hiçbiri değişiklik listesinde değil, HEAD ile aynı kabul edildi.
