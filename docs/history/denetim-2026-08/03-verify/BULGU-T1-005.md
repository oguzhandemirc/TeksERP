# DOĞRULAMA — BULGU-T1-005 (TUR 1)

**Başlık:** Fason KISMİ kabulde aynı `clientToken` eşzamanlı gelince idempotent replay yerine
"Barkod üretimi 5 denemede başarısız oldu" 409'u dönüyor — sonuçta aynı teslimat iki kez düşülüyor

| Alan | Değer |
|---|---|
| Şiddet (giriş) | S1 | 
| **Şiddet (doğrulama sonrası)** | **S1 — DEĞİŞMEDİ** (aşağıda gerekçe) |
| Kanıt seviyesi (giriş) | K3 (iddia) |
| **Kanıt seviyesi (ulaşılan)** | **K3 — DOĞRULANDI + kontrol sondasıyla** (K2: arandı, sahada 0 ihlal) |
| Karar | **dogrulandi** |
| Modül | Fason (`subcontractor.service.ts`) · Kategori B.3 (idempotency) |
| Repro | `Teks-Erp/scripts/audit_repro_BULGU-T1-005.ts` → `audit/repro/BULGU-T1-005.log` |
| Veri | `audit/data/BULGU-T1-005.sql` → `audit/data/BULGU-T1-005.txt` |

---

## 1. K1 — kod/şema/koruma teyidi (bulgunun iddiaları tek tek ölçüldü)

| # | Bulgunun iddiası | Ölçüm | Sonuç |
|---|---|---|---|
| 1 | Token kontrolü tx DIŞINDA (havuz) | `subcontractor.service.ts:2349-2370` — `await prisma.subcontractorReceipt.findUnique({ where:{clientToken} })`, `prisma` (havuz), tx başlamadan | ✅ DOĞRU |
| 2 | `receipt.create` roll claim'lerinden ÖNCE | create `:2787-2800`; kısmi claim `:2879` | ✅ DOĞRU |
| 3 | Kısmi modda `freshReturns` kapısı ikinci isteği ELEMİYOR | `:2723-2734` `{id in, status: AT_SUBCONTRACTOR, currentStepId}` — kısmi kabulde top AT_SUBCONTRACTOR'da KALIR (`remainderStays`), dolayısıyla ikinci istek kapıyı geçer | ✅ DOĞRU (repro ile de teyit: 30/30 turda ikinci istek kapıyı geçip P2002'ye çarptı) |
| 4 | `withBarcodeRetry` çağrısında predicate YOK | `:2677` `withBarcodeRetry(() => prisma.$transaction(...))` — kapanış `:3232-3233` `})\n    );` → **tek argüman** (AST-lite ölçüm: `args=1`) | ✅ DOĞRU |
| 5 | Çağrının etrafında clientToken P2002'yi cached makbuza çeviren dış `catch` YOK | `sed -n '2300,3260p' … \| grep "try {\|} catch\|\.catch("` → **0 vuruş**; `receive()` gövdesinin tamamında hiç try/catch yok | ✅ DOĞRU |
| 6 | Küme-eşitliği guard'ı kısmi makbuzu bilerek atlıyor | `:2410-2412` `if (prior.items.some((i) => i.isPartial)) continue;` (+ yorum: "KISMİ makbuz cached DÖNEMEZ … replay kimliği clientToken'dır") | ✅ DOĞRU — **ikinci kapı da yok**, token TEK savunma |
| 7 | `subcontractor_receipts.clientToken` düz `@unique` | `prisma/schema.prisma:2157` `clientToken String? @unique @db.Uuid`; saha DB'de kısıt canlı | ✅ DOĞRU (DB seddi çalışıyor — sorun hatanın **ele alınmaması**) |
| 8 | `withBarcodeRetry` predicate verilmezse TÜM P2002 retry eder | `utils/barcode-retry.ts:33` `if (isRetryable && !isRetryable(err)) throw err;` → predicate yoksa koşul hiç kurulmaz; `:53-55` tükenme → `AppError.conflict("Barkod üretimi 5 denemede başarısız oldu…")` | ✅ DOĞRU |
| 9 | Kuralın kendisi repoda YAZILI | `utils/p2002.ts:26-34`: *"clientToken P2002'si RETRY EDİLMEZ — retry her denemede aynı token'ı yazacağından 5 tur boşa döner ve YANILTICI 'Barkod üretimi 5 denemede başarısız' hatası üretirdi"* | ✅ DOĞRU — kural yazılı, fason kabulde **uygulanmamış** |

### 1b. ⚠️ BULGUNUN BİR ÖLÇÜMÜ YANLIŞ — düzeltildi (bulguyu ZAYIFLATMAZ, GÜÇLENDİRİR)

Bulgunun `koruma_kontrolu` alanı şöyle diyordu:

> "ÖLÇÜM: `grep -rn "isRetryable" src` → yalnız `utils/barcode-retry.ts:23` (tanım) ve `:33` (kullanım);
> `withBarcodeRetry(` 28 çağrı yerinin **HİÇBİRİ** 3. argümanı geçmiyor → tüm P2002'ler fail-open retry
> ediliyor. (KRITIK-YAZMA-YOLLARI.md KYY-28'in 'predicate'li yalnız 4' ifadesi YANLIŞ.)"

**Bu ölçüm hatalıdır.** `grep isRetryable` yalnız **parametre adını** arar; çağrı yerleri predicate'i
isimsiz ok fonksiyonu olarak (`undefined, (err) => …`) geçtiği için grep onları göremez — klasik
"sessiz sıfır sonuç" tuzağı (beceri §5 generic-tip tuzağının kardeşi).

Yorum/dize/regex duyarlı bir tarayıcıyla (Türkçe kesme işareti `token'ı` düz paren sayıcıyı bozuyor —
ilk denememde tam da bu yüzden yanlış sonuç aldım) yeniden ölçüldü:

```
TOPLAM çağrı yeri = 25    predicate'li = 5    predicate'siz = 20
```

Predicate'i **OLAN** 5 yol (yani doğru desenin repoda YERLEŞİK olduğu yerler):

| Dosya:satır | Predicate | Dış catch (cached yanıt) |
|---|---|---|
| `workorder.service.ts:988` | `:1084-1094` `if (isClientTokenP2002(err)) return false;` | `.catch(… resolveCreateTokenReplay)` `:1096` |
| `order.service.ts:1942` | `:1977-1981` `!isClientTokenP2002(err)` | `.catch(… __replayOf)` `:1982` |
| `shipping.service.ts:250` (openSack) | `:275-287` `if (p2002Mentions(err,/clientToken/i)) return false;` | `:288-295` `readOpenSackReplay` |
| `shipping.service.ts:1401` (createShipment) | `:1432-1437` aynı | `:1439-1445` `readCreateShipmentReplay` |
| `item.service.ts:225` | `:306-307` `() => isAutoCode` (clientToken değil; manuel kod P2002'si retry edilmez) | — |

Ayrıca `inventory.service.ts:4221` ve `kartela.service.ts:1408` `isClientTokenP2002(err)` ile
**dış catch** kurar (wBR sarmalaması olmadan).

**Düzeltilmiş ifade — bulgunun asıl gücü budur:** sorun "kimse predicate kullanmıyor" değil,
**"clientToken yazan yolların hepsi bu korumayı kurmuş, fason kabul KURMAMIŞ"** — yani tutarsız
uygulama. `clientToken` yazan yollar ve durumları:

| Yol | Predicate | Dış catch | Durum |
|---|---|---|---|
| `workorder.service.ts:1014` | ✅ | ✅ | korumalı |
| `order.service.ts` (create) | ✅ | ✅ | korumalı |
| `shipping.service.ts:256` (sack) | ✅ | ✅ | korumalı |
| `shipping.service.ts:1408` (shipment) | ✅ | ✅ | korumalı |
| `inventory.service.ts:909/4169` (KK1) | — | ✅ | korumalı |
| `kartela.service.ts:1365` | — | ✅ | korumalı |
| **`subcontractor.service.ts:2790` (fason kabul)** | **❌** | **❌** | **KORUMASIZ** |

KYY-28 haritasının "predicate'li yalnız 4 / 21-25 predicate'siz" ifadesi de **bir eksik**
(doğrusu 5 / 20-25); `item.service.ts:225` sayılmamış. Haritaya not düşülmeli (küçük).

---

## 2. K2 — veride fiili ihlal araması

Sorgu: `audit/data/BULGU-T1-005.sql` · Sonuç: `audit/data/BULGU-T1-005.txt`
(saha = prod'un 2026-08-25 kopyası `tekserp_saha_0825`; dev = `adnansahin_db`; ikisi de salt-okunur)

### §1 Maruziyet

| Ölçüm | SAHA | DEV |
|---|---|---|
| Fason kabul makbuzu (toplam / aktif) | 143 / 143 | 52 / 50 |
| **`clientToken` taşıyan makbuz** | **2** | 0 |
| Kabul kalemi (toplam / kısmi) | 638 / **1** | 22 / 0 |
| Kısmi makbuz (ayrı) | 1 | 0 |

### §2 Zaman penceresi — yolun sahada YENİ açıldığı ölçüldü

| | SAHA |
|---|---|
| İlk kabul | 2026-07-20 |
| Son kabul | 2026-08-24 |
| **İlk tokenli kabul** | **2026-08-24 19:21:11+03** |
| **Son tokenli kabul** | **2026-08-24 19:23:46+03** |

Token gönderen APK sahaya **yedeğin alınmasından bir gün önce** ulaşmış; 143 kabulden yalnız 2'si
(aynı 2,5 dakikalık pencerede) token taşıyor. Yani ihlalin ön koşulu (tablet token gönderiyor)
**yeni doğmuş** ve yayıldıkça yoğunlaşacak.

### §3-§5 İhlal imzaları

| İmza | SAHA | DEV | Yorum |
|---|---|---|---|
| §3 Aynı (WO, adım, firma) üzerinde 60 sn içinde 2 aktif makbuz ("yanıltıcı 409 → operatör elle yeniden girdi") | **0 satır** | 10 satır | DEV satırları **bekçi/test kalıntısı** — hepsi tokensiz (`a_tokenli=f`, `b_tokenli=f`) ve 32-66 **milisaniye** arayla; operatör elle giremeyeceği kadar hızlı. Saha ölçümü belirleyicidir. |
| §4 Aynı top ≥2 aktif makbuzda **ve** kabul toplamı `initialQty`'yi AŞIYOR (çift düşülen teslimat) | **0 satır** | 0 satır | Ayırt edici sorgu; bugün ihlal YOK |
| §5 Aynı top birden çok aktif makbuzda | 1 | 0 | Tek tek incelendi: `dd3479de-…` — `initialQty=100`, iki makbuz toplamı **tam 100**, statü `SUBCONTRACTOR_CONSUMED` → **MEŞRU kısmi teslimat**, ihlal değil (§4'ün doğru ayırt ettiğinin kanıtı) |

### §6 Token sözleşmesi sahada fiilen kullanılıyor (yol ölü değil)

| Tablo | SAHA toplam / tokenli |
|---|---|
| `orders` | 278 / 269 |
| `work_orders` | 213 / 213 |
| `rolls` | 2431 / 2259 |
| `sacks` | 41 / 39 |
| `shipments` | 40 / 39 |
| **`subcontractor_receipts`** | **143 / 2** |

**K2 sonucu: "arandı, sahada 0 fiili ihlal."** Bu bulguyu çürütmez — ön koşulun (tokenli kabul)
sahada **4 günlük** olduğunu ve hacmin 2/143 olduğunu gösterir. K2 yokluğu, şiddetin S0'a
çıkarılmamasının gerekçesidir (aşağı bak).

---

## 3. K3 — eşzamanlı repro (DEV DB)

**Script:** `Teks-Erp/scripts/audit_repro_BULGU-T1-005.ts` (denetimin TEK yazma izni; üretim koduna
dokunulmadı) · **Log:** `audit/repro/BULGU-T1-005.log`

Fixture (tur başına, damgalı `AUDITREPRO-T1005-<rnd>`): iş emri + 2 adım (BOYA_FASON → KURSUN_KK2)
+ 300 m'lik top → fasona sevk. Sonra **N eşzamanlı** `receive()`, **TEK ve AYNI `clientToken`**,
kısmi kabul (`remainderStays: true`, `receivedQty: 120`). Sağlıklı sistemde beklenen:
1 makbuz + N-1 "idempotent retry" cevabı, topta **180 m** kalması.

Önceki koşum (`KYY-1-02`, N=2 × 6 tur) okundu ve **yeniden koşuldu**, N ölçeklendirilerek:

| N (eşzamanlı istek) | Tur | Yanıltıcı barkod-409'lu tur | Doğru idempotent replay | Mükerrer AKTİF makbuz | **ÇİFT DÜŞÜLEN teslimat** | Boşa koşan tx | Süre |
|---|---|---|---|---|---|---|---|
| 2 | 10 | **10/10** | 0/10 | 0/10 | **10/10** | 50 | 3,1 sn |
| 5 | 10 | **10/10** | 0/10 | 0/10 | **10/10** | 200 | 3,3 sn |
| 10 | 10 | **10/10** | 0/10 | 0/10 | **10/10** | 450 | 3,4 sn |
| **TOPLAM** | **30** | **30/30 (%100)** | **0/30** | 0/30 | **30/30 (%100)** | 700 | — |

Her turda kaybeden **her** istek (N-1 adet: 1, 4, 9) yanıltıcı 409'u aldı — istisna yok.

Tur başına gözlem (log'dan birebir):
```
❌ tur 1 YANILTICI 409 ×9/9 kaybeden — aktif makbuz=1, idempotent cevap=0
   ↳ ELLE yeniden giriş (yeni token): kalan=60 m (beklenen 180), aktif makbuz=2, doğan top=2
```

**Ölçülen zarar (commit sonrası, DB'den okunarak):** top `currentQty` **300 → 60** (doğrusu 180),
**2 aktif makbuz**, **2 doğan top** — yani 120 m'lik TEK fiziksel teslimat **iki kez** düşüldü.
Boyahaneye 120 m fazla borç yazılır.

**Mükerrer aktif makbuz 0/30** — `clientToken @unique` DB seddi görevini yapıyor. Bozulma seddin
delinmesinden değil, **seddin ürettiği hatanın yanlış ele alınmasından** doğuyor.

### 3b. KONTROL SONDASI (negatif sonda — harness körlük testi)

Bu harness'ın "her koşulda kırmızı" olmadığını ispatlamak için, **aynı eşzamanlılık şekli ve aynı
token sözleşmesi** ile ama predicate'i **VE** dış catch'i **OLAN** bir yol koşuldu:
`shipping.openSack` (`shipping.service.ts:250` + `:288`).

| N | Kontrol turu | Sonuç |
|---|---|---|
| 2 | 3/3 | ✅ başarılı=2/2, farklı çuval=**1**, DB satır=**1**, yanıltıcı409=**false** |
| 5 | 3/3 | ✅ başarılı=5/5, farklı çuval=**1**, DB satır=**1**, yanıltıcı409=**false** |
| 10 | 3/3 | ✅ başarılı=10/10, farklı çuval=**1**, DB satır=**1**, yanıltıcı409=**false** |

**9/9 sağlıklı.** Aynı harness, aynı DB, aynı N — fark yalnız predicate + dış catch. Bu, bulgunun
"ortam gürültüsü" ya da "her eşzamanlı çağrı zaten patlar" olmadığını mekanik olarak kilitler ve
düzeltmenin şeklini de gösterir: **fason kabul zaten repoda çalışan desene bağlanacak.**

### 3c. Temizlik / yan etki

`finally` bloğu FK sırasına göre siler (`rollVariance` dahil — RESTRICT FK). Koşum sonrası dev DB
denetlendi: `AUDITREPRO-T1005%` damgalı **0 iş emri / 0 top / 0 makbuz**. Global ayar/feature-flag
değiştirilmedi; yazıcı / `pg_dump` / `rclone` çağrılmadı. Toplam süre 3 × ~3,3 sn (bütçe 2 dk).

---

## 4. Şiddet değerlendirmesi — S1 KORUNDU (enflasyon yok, deflasyon yok)

| Eksen | Değer | Gerekçe |
|---|---|---|
| Etki | **Yüksek/kritik** | Mali: fasona 120 m fazla borç; envanterde hayalet top + fazladan çekme sapması satırı; fason karnesi bozulur |
| Olasılık | **Bugün düşük, yükseliyor** | Ön koşul: ağ zaman aşımı **+** çevrimdışı kuyruk yeniden gönderimi **+** ilk isteğin hâlâ sunucuda olması. Pencere geniş (fason kabul sistemin en uzun tx'i), ama sahada tokenli kabul 2/143 ve yalnız 4 günlük |
| Düzeltici | **Ne tam sessiz ne tam net** | Operatör **net bir hata** görür (→ bir kademe düşür) ama hata **YANLIŞ ŞEYİ** söyler ("barkod üretilemedi", oysa çakışan şey idempotency anahtarı) ve tam da bu yüzden operatörü elle yeniden girişe iter; **ortaya çıkan çift düşüm SESSİZDİR** (ikinci makbuz meşru görünür, alarm yok) → bir kademe yükselt. İki etki birbirini götürür |

**Sonuç: S1.** S0 yapmak için K2 (sahada fiili ihlal) gerekirdi; arandı, **0** bulundu — bu yüzden
S0'a çıkarılmadı. K3 %100 tekrar edilebilir ve ön koşul sahada yeni yayılmaya başladığı için
S2'ye de düşürülmedi.

---

## 5. Düzeltmenin şekli (2. tur için — bu denetimde UYGULANMADI)

Repoda **zaten çalışan** desene bağlamak; yeni mekanizma icat etmeye gerek yok:

1. `subcontractor.service.ts:2677` → `withBarcodeRetry(fn, undefined, (err) => !isClientTokenP2002(err))`
   (`utils/p2002.ts` zaten var ve kuralı yorumunda yazıyor).
2. Çağrının etrafına dış `catch`: `if (data.clientToken && isClientTokenP2002(err)) { … }` →
   `:2349-2370`'teki cached-makbuz dalını **yeniden kullan** (iptal edilmiş makbuz kontrolü —
   `RECEIPT_CANCELLED` — orada zaten doğru kurulmuş, tekrar yazma).
3. **Migration YOK, izin YOK, APK YOK, feature-flag YOK** — değişiklik tamamen sunucuda ve
   geriye uyumlu (eski istemci token göndermiyorsa davranış birebir aynı kalır).
4. **Bekçi:** `scripts/audit_repro_BULGU-T1-005.ts` bu haliyle regresyon bekçisidir — düzeltmeden
   sonra "YANILTICI barkod-409 = 0/30, idempotent replay = 30/30" beklenir ve kontrol sondası
   (openSack 9/9) körlük zemini olarak kalır.

**Kabul kriteri:** N=2/5/10 × 10 tur → yanıltıcı 409 = 0, idempotent replay = N-1, aktif makbuz = 1,
topta kalan = 180 m, kontrol sondası 9/9 sağlıklı.

**Yan not (ayrı iş, bu bulgunun kapsamı DIŞI):** kalan 19 predicate'siz `withBarcodeRetry` çağrısı
içinde `clientToken` yazmayan ama başka **kalıcı iş-anahtarı** unique'i yazanlar (ör.
`roll_movements_one_open_per_roll_step_uq`, `kursun_bypass_one_pending_per_step`) aynı sınıfın
kardeşleridir — bu doğrulamada ölçülmedi.

---

## 6. KAPSANMAYAN / ERİŞİLEMEYEN

- **Canlı prod'a erişim yok** — K2 ölçümü prod'un 2026-08-25 kopyası üzerinde. Yedekten sonraki
  4 günde (26-28 Ağustos) tokenli kabul sayısı artmış olabilir; ihlal orada doğmuş olabilir.
  Aynı `BULGU-T1-005.sql` §3/§4 canlıda salt-okunur koşulmalı.
- **Saha kopyası 190/195 migration** — bu bulgunun ilgilendiği kolonlar (`clientToken`, `isPartial`,
  `receivedQty`) kopyada MEVCUT (`information_schema` ile doğrulandı), yani ölçüm geçerli.
- **HTTP/uç katmanı koşulmadı** — repro servis katmanını (`SubcontractorService.receive`) doğrudan
  çağırır. Controller/Zod katmanının davranışı (ör. bir üst katmanda P2002'yi yakalayan bir
  middleware) ölçülmedi; `error.middleware` incelemesi bu doğrulamanın kapsamı dışında bırakıldı —
  ancak `AppError.conflict` zaten uygulama hatası olarak üretildiği için middleware'in onu
  değiştirmesi beklenmez.
- **Mobil istemci sözleşmesi kaynaktan okunmadı** (`mobil/src/offline/entryAttempt.ts`) — "kesin
  4xx'te token YAPIŞMAZ" kuralı kök `CLAUDE.md`'de yazılı olduğu için oradan alındı; zincirin bu
  halkası [VARSAYIM] değil ama kod düzeyinde bu turda teyit edilmedi.
- **Gerçek ağ zaman aşımı simüle edilmedi** — repro, timeout'un sonucunu (aynı token'la ikinci
  istek) doğrudan kurar. Zaman aşımının kendisi istemci tarafı bir olaydır ve dev DB'de
  üretilemez.

## 7. SINIR ÖTESİ NOTLAR

- **Haritaya düzeltme:** `audit/00-map/KRITIK-YAZMA-YOLLARI.md` KYY-28 satırındaki
  "`withBarcodeRetry` **25 çağrı** … **predicate'li yalnız 4**" ve "(B) wBR **21/25** predicate'siz"
  ifadeleri bir eksik: doğrusu **5 predicate'li / 20 predicate'siz** (`item.service.ts:225`
  `() => isAutoCode` sayılmamış). Toplam 25 sayısı doğru.
- **Ölçüm yöntemi uyarısı (diğer denetçilere):** `grep -rn "isRetryable"` predicate'in **geçilip
  geçilmediğini ölçemez** (parametre adı yalnız tanımda geçer); ayrıca düz paren sayan bir tarayıcı
  Türkçe kesme işareti (`token'ı`) yüzünden sessizce yanlış sonuç verir. Argüman sayımı yorum/dize/
  regex duyarlı yapılmalı.
- `subcontractor.service.ts:1035` (fason **sevk**) ve `:6018` (doğrudan sevk) de predicate'sizdir;
  ikisi de `clientToken` yazmıyor, o yüzden bu bulgunun kapsamında değiller — ama içeride üretilen
  `@unique` alanlar açısından ayrıca bakılması gereken yollar.
