# `test_superadmin` — iki dallı koşum tasarımı (2026-09-12)

> **Bu belge bir TASARIMDIR; fikstür kararı VERİLDİ (2026-09-12), kod henüz
> yazılmadı.** Hedef "3 atlama"yı sıfırlamak DEĞİL: her atlamanın gerekçesinin
> ÖLÇÜLMÜŞ olması ve atlanan kontrolün **bir yerde** ölçülmüş olması. Kural
> satırı `docs/kurallar/superadmin.md`'ye girer.

## Soru

`test_superadmin` iki durumu ayrı ayrı ölçüyor ve ikisi **aynı anda** ölçülemez:

| Dal | Ön koşul | Ölçtüğü şey | Ölçemediği şey |
|---|---|---|---|
| `HESAP_YOK` | `users` içinde `isSystemAccount=true` **0** satır | **Supap** yolu: hesapsız kurulumda `admin:settings` modül anahtarını YAZAR, izinsiz kullanıcı yine reddedilir, supap kullanımı `SUPERADMIN_ABSENT_MODULE_WRITE` ile audit'e düşer | Tembel doğrulama |
| `HESAP_VAR` | ≥1 sistem hesabı | **Tembel doğrulama**: defter "yok" derken DB'de hesap VAR → guard KİLİTLER, defteri kalıcı düzeltir, süperadmin yine geçer | Supap davranışı |

Her dal diğerinin üç kontrolünü `atla()` ile beyan eder. Beyan **ölçülüdür** —
sebep metni `isSystemAccount` sayısını basar, tahmin etmez. Eksik olan beyan
değil, **tamamlayıcının hiç koşulmaması**.

## Ölçüm (2026-09-12, `teks-erp-d5`)

İki ayrı fixture DB'sinde, aynı kod, aynı sunucu kurgusu:

```
DAL=HESAP_YOK  (tekserp_d5_a_test, sysacct=0, TEST_API_URL=:4211)
  ⏭️ ATLANDI tembel doğrulama (boot'tan SONRA doğan hesap)
     — bu DB'de sistem hesabı yok — ölçüm ancak hesap VARKEN kurulabilir
  === Sonuç: 103 geçti, 0 başarısız, 3 atlandı ===

DAL=HESAP_VAR  (tekserp_d5_b_test, sysacct=1, TEST_API_URL=:4212)
  ⏭️ ATLANDI supap DAVRANIŞ ölçümü (hesapsız kurulum)
     — bu DB'de 1 sistem hesabı var — supap yolu ölçülemez
  === Sonuç: 103 geçti, 0 başarısız, 3 atlandı ===
```

**Sonuç:** iki dal **tam tümleyen**. Ortak küme 100 kontrol; evren 106. Tek
koşum evrenin %97'sini görür, İKİ koşum %100'ünü görür. Yani eksik kapsam bir
kontrol tasarımı sorunu değil, bir **koşum kurgusu** sorunudur.

## Neden tek koşumda çevrilemez

Ön koşul koşumun değil **HEDEF VERİTABANININ** bir özelliğidir:

1. `isSystemAccount` alanının **tek yazarı** `scripts/superadmin-olustur.ts`'tir
   ve **TTY ister** (`TTY'siz superadmin:kur` yasak).
2. Mevcut bir kullanıcıyı süperadmine **yükseltmek yasak**.
3. Kullanıcı **sert silinmez** (`system_logs_userId_fkey`) — dolayısıyla "hesabı
   yarat, ölç, sil" turu da kurulamaz.

Bu üç kural birlikte doğru olanı söylüyor: dalı koşum içinde çevirmeye çalışmak,
korunan davranışı bekçi uğruna gevşetmek olurdu.

## Öneri

**A. Dal damgası (ucuz, tek başına değerli — bugün inebilir).**
Bekçi özet satırından ÖNCE tek satır makine-okunur damga basar:

```
DAL=HESAP_YOK sysacct=0 · tamamlayıcı: DAL=HESAP_VAR (3 kontrol bu koşumda ÖLÇÜLMEDİ)
```

Her `atla()` sebebi ayrıca **hangi dalda ölçüldüğünü** söyler ("bu kontrol
`DAL=HESAP_VAR` koşumunda ölçülür"). Böylece tek koşumun çıktısı, neyi
görmediğini kendi başına beyan eder — bugün okuyucunun kafasından tamamlaması
gereken cümle budur.

**B. İki dallı koşucu (`scripts/kos-superadmin-iki-dal.mjs`).**
Bekçiyi iki `DATABASE_URL` ile ardışık koşar, iki damgayı toplar ve
**ikisi de görülmediyse KIRMIZI** verir. Tamamlık hükmü koşucunun çıkış
kodundadır; "iki kez koştum" beyanı değil.

**C. Dal fixture'ları.** `HESAP_YOK` dalı zaten her taze fixture DB'sidir.
`HESAP_VAR` dalı bir kuruluma muhtaç — kararı aşağıda (§ KARAR).

## KARAR (2026-09-12) — `HESAP_VAR` fixture'ı: **(C) dal, DB'nin verisidir**

Gerekçe ölçümün kendisinden çıkıyor: dal **koşumun değil HEDEF DB'nin**
özelliğidir ve üç kural birden tek koşumda çevrilmesini engelliyor. O hâlde
fixture de **DB düzeyinde bir varlık** olmalı — `HESAP_VAR` hedefi **bir kez**
kurulur ve öyle kalır.

**Şart:** hesap YAPTIRIMLI yoldan doğar — `superadmin:kur`, **TTY ile**. TTY'siz
sağlama yasaktır ve bu yasak fixture uğruna delinmez. O yol bir insan
müdahalesi gerektirdiği için fixture **kullanıcı döndüğünde** kurulur.

**O zamana kadar `HESAP_VAR` dalı BEYANLI ATLANIR, sessiz değil.** Atlama
gerekçesi birebir şudur: *"sistem hesabı yaratmak TTY ister, kullanıcı kararı"* —
yani atlama bir eksiklik beyanıdır, bir kapsam iddiası değil.

### Reddedilen iki aday (gerekçeleriyle, tekrar açılmasın diye)

1. **Fixture yazarı** (`fixture-superadmin.ts`) — `isSystemAccount`'a yazma
   yetkisi `hedefDbEngeli()` geçmiş DB'lerle sınırlı. *Bedeli:* "tek yazar
   script" kuralına ikinci yazar eklenir; kuralın mekanik bekçisi zayıflar.
2. **`superadmin:kur`'a TTY'siz test kipi** — yalnız fixture DB'sinde, parola
   argümandan. *Bedeli:* ürün script'ine test dallanması girer; sır hijyeni
   yüzeyi genişler.

İkisi de ancak (C)'nin YETMEDİĞİ ÖLÇÜLÜRSE yeniden açılır — tahminle değil.

**Uygulama sırası:** (A) dal damgası ve (B) iki dallı koşucu (C)'den BAĞIMSIZ
inebilir ve hiçbir kuralı gevşetmez; ikisi olmadan (C) zaten beyan üretmez.

## Yapılmayacaklar

- Atlama sayısını kontrolü zayıflatarak düşürmek (kapsam kaybı görünmez olur).
- İkinci bir "strict" bayrağı doğurmak — `TEKSERP_STRICT` tek isimdir; iki
  koşum iki farklı şey iddia etmeye başlar.
