# Ölçüm disiplini — SINIRSIZ EŞLEŞME vaka envanteri

Bu dosya [`OLCUM-DISIPLINI-YUKLEM.md`](OLCUM-DISIPLINI-YUKLEM.md) § Sınırsız eşleşme'nin
**vaka envanteridir**: orada kural cümlesi ve vaka tablosu durur, burada her vakanın
ÖLÇÜMÜ — korpus, payda, kapsam beyanı, panzehir. Ayrım biçimsel değil: *kural sabittir,
vaka envanteri her yeni ölçümle büyür* (bölme ölçütü ve emsalleri `README.md`'de).

Tablodaki harfler burayla birebirdir. **(a)** ve **(b)** tek satırda kapanıyor — ölçümleri
tabloda tam, ayrıntı gerekmedi; bu dosya (c)'den başlar.

### (c) Kurbanı bekçinin KENDİ fikstürü — alt dizgi
⭐ **(c) ailenin en pahalı biçimi, çünkü kurban bekçinin KENDİ ürettiği değer.**
*(d9, ölçüldü: sonda değeri `TEST-KAT-${Date.now()}-KAT`. Damga **9 ile bittiğinde**
dizgi `…5549-KAT` oluyor ve `"9-KAT"` alt dizgisini İÇERİYOR ⇒ yüklem alakasız bir
değerle eşleşiyor. "Aralıklılık" gizemi değil **damga aritmetiği**: `Date.now() % 10 === 9`
⇒ 1/10; CI'daki iki kırmızının ikisi de 9 ile bitiyordu — `1789324255549` · `1789323101009`.
Üç hipotez kuruldu (başka testin fikstür kalıntısı · kendi kalıntısı · bayat önbellek) ve
**üçü de yanlıştı**. Düzeltme `675211b2`: liste artık TOKEN olarak okunuyor, dört sonda,
biri (§0c) eski yüklemin yanılgısını BELGELİYOR.)*

> **Bir bekçi, kendi fikstürünü ortama koyduğu anda KENDİ YÜKLEMİNİN GİRDİSİ hâline
> gelir.** ⇒ Sınırı beyan etmek yetmez; ayrıca sor: ***sondanın ÜRETTİĞİ değer, sondanın
> YÜKLEMİNE girdi olabilir mi?*** *(Kuralın kendisi `OLCUM-DISIPLINI-YUKLEM.md`'de durur;
> burada vakanın yanında tekrar edilmesi bilinçlidir — ölçümü okuyan kuralı da görsün.)*

### (d) KESİŞİMLE tanımlanan kapsam, YOKLUĞU göremez
*(`69d5cabc` mobil enum aynası; ölçüldü 2026-09-14: `§0a` 81 backend enum · `§0b` 16 mobil
`export type` · `§0c` kesişim **13**.)* Kapsamı ELLE LİSTELEMEYİP ÖLÇMEK doğru hamledir —
bayat liste sınıfını kökten kaldırır. Ama kesişim bir sınırdır ve **beyan edilmemiştir**:
mobil karşılığı HİÇ OLMAYAN bir backend enum'u kapı *"geride"* saymaz, **kapsam dışı**
sayar. Yani *"tablet bu tipi hiç tanımıyor"* — ailenin en ağır vakası — *"bu tip tableti
ilgilendirmiyor"* ile **aynı kapıdan** sessizce çıkar. Yeşilin gerçek cümlesi
*"aynalanan 13 tip tutarlı"*dır, *"tabletin tipleri backend'le uyumlu"* değil.
⚠️ Körlük zemini (`§0c`) bunu yakalayamaz: yüklemi `kapsam > 0`, yani **13 ile 1'i ayırt
etmez**. ⛔ Ve 68 sayısı bir ARIZA değildir — çoğu enum tableti hiç ilgilendirmez; ölçülen
tek şey *ölçülmemiş olduğu*.
📌 Panzehir: **kapsamını ÖLÇEN her kapı, TÜMLEYENİNİ de BASSIN** (sayı + birkaç üye adı).
*"Ölçülen 13"* cümlesi tek başına *"68'i ölçmedim"* demez; okuyucu ikincisini asla
kendiliğinden sormaz. Emsal: `test_belge_capa_atfi`'nin *"⛔ BU KAPININ ÖLÇMEDİĞİ"* bloğu —
orada kapsam dışı üç sınıf her koşumda SAYIYLA basılır.

> ⚠️ **Ama panzehrin yarısı: TÜMLEYENİ BASMAK ÖLÇMEK DEĞİLDİR — kapsamı bir BEYAN kapatır.**
> *(d9, 2026-09-14: tümleyen basıldı ⇒ "beyan dışı 67 enum ÖLÇÜLMEDİ" + "mobilde union'ı olup
> backendde enum'u olmayan 3 tip" görünür oldu; ama basılan bir ad kimseye KIRMIZI göstermez.)*
> Kapsam ancak **beklenen küme BEYAN edilince** kapanır: beyanlı ama karşı tarafta yok → kırmızı ·
> karşı tarafta var ama beyansız → kırmızı (beyan kendini tazeler, yoksa silinen bir üye sessizce
> kapsam dışına çıkar). Kontrol grubu ölçüldü: bir tip mobilden silindiğinde yeni bekçi kırmızı,
> **eski bekçi aynı mutasyonda 24 geçti / 0 başarısız**.

⚠️ **Ve aralıklılık bir teşhis değil bir SORUDUR:** "bazen kırmızı" gördüğünde önce
*"hangi girdi 1/N olasılıkla değişiyor"* diye sor — zaman damgası, rastgele ad, sıra,
saat. Gizem çoğu kez aritmetiktir.
Kardeşleri § NE sorduğun kadar NEREYE sorduğun · § Bir adın geçmesi bir BAĞIMLILIK
değildir · § Bir yüklem, aradığı şeyin BOZULMUŞ hâlini aramaz (bunun TERSİ).

### (e) KISA + SAYISAL + KALABALIK KORPUS — çakışma bir ÇARPIMDIR
*(d9 ölçümü 2026-09-14; düzeltme `9aa4a4d7`.)*
Sır kapısı audit kolonlarını `LIKE '%'||PIN||'%'` ile tarıyordu: yüklem DOĞRU, sınır
BEYAN EDİLMEMİŞ. Bedeli sırrın BİÇİMİ belirliyor — `quickPin` altı hane ve yalnız rakam
(`randomInt(0, 1_000_000)` + `padStart(6,"0")`) ⇒ her PIN uzun bir sayının İÇİNDE geçebilir.

| yüklem | eşleşen | oran (payda: PIN uzayı 1.000.000) |
|---|---|---|
| sınırsız `%PIN%` | 10.677 | **%1,07** / PIN · tur başına iki PIN ⇒ **%2,12** |
| rakam sınırlı `(^\|[^0-9])PIN([^0-9]\|$)` | 1.243 | **%0,12** (8,6× iyi) |
| tırnaklı `"PIN"` | 0 | — |

⚠️ **Kapsam beyanı:** bu oranlar d9'un YEREL rejiminde, izole worktree test DB'sinin
`system_logs` korpusunda ölçüldü (19.895 satır · 4.351.608 karakter) — **CI'ın korpusunda
değil**; CI taze DB ile koşar ⇒ korpusu daha küçük, beklenen oran daha DÜŞÜK. CI'da AYRI
bir ölçüm var (ayrı payda): son 60 turun `gh run view --log-failed` taramasında bu bekçi
**1/59 ≈ %1,7** kırmızı. %2,12 ile %1,7'nin örtüşmesi *"aynı mertebe"*dir, **birebir
doğrulama değildir** — iki ayrı korpus, iki ayrı payda.
⚠️ **Ve sınıf HENÜZ KESİN DEĞİL:** ölçüm, çakışmanın kırmızıyı açıklamaya YETTİĞİNİ
gösterir; gerçek bir SIZINTIYI **dışlamaz**. Ayırt edici yön (kanıt değil): sızıntı bir
KOD YOLU olurdu ve PIN her turda yeniden rastgele yazıldığı için 1/59 değil **~59/59**
beklenirdi.
⭐ **Daraltmanın işe yaradığı UÇTAN UCA ölçüldü, ve üçüncü satır olmadan gösterilemezdi**
*(d9, `9aa4a4d7`)*: yeni yüklem + gerçek sızıntı → **85/1 ❌** · yeni yüklem + rakama
yapışık çakışma → **86/0 ✅** · **eski yüklem + AYNI çakışma → 78/1 ❌ yanlış pozitif.**
Üçüncüsü kontrol grubudur: onsuz "yeni yüklem yeşil" cümlesi, daraltmanın (B) çakışmayı
KESTİĞİNİ değil yalnız bugün eşleşme olmadığını gösterirdi.

📌 Panzehir üç sonuçlu (bkz. § Bir deneyin ÜÇ olası sonucunun anlamı, deney koşulmadan
ÖNCE yazılır (`OLCUM-DISIPLINI-CIKARIM.md`)): ① sınırlı eşleşme → **KIRMIZI (sızıntı)** ·
② yalnız geniş eşleşme → **sınıflandırılmış NOT** (sayı + sınıf basılır, **eşleşen metin
BASILMAZ**) · ③ hiç yok → sessiz yeşil.

### (f) BİRLEŞTİRME, hiçbir kolonda var olmayan bir KOMŞULUK uydurur
Önceki biçimlerde yüklem gevşekti. Burada **yüklem SINIRLI, sınırladığı DİZİ yanlış**:
üç kolon `||` ile birleştirilip desen birleşime uygulanınca, `newData` `…98` ile bitip
`oldData` `6412…` ile başlıyorsa birleşimde **`986412` DOĞAR** — hiçbir kolonda geçmeyen
bir dizi. Rakam sınırı düzgün çalışır; yanlış olan metnin KENDİSİDİR.

*(d9, 2026-09-14 — ⚠️ **ÖLÇÜLMEDİ ve ölçülmedi diye yazılıyor:** bu biçim koşulmadı,
yazım anında yakalandı ve yüklem kolon kolona çevrildi (`newData ~ d OR oldData ~ d OR
changes ~ d`, `9aa4a4d7`). Kanıt ANALİTİKTİR, istatistiksel değil; buraya bir oran
yazmak sınıfın kendisini çürütürdü.)*

> ***Bir sınır yüklemi, sınırladığı metnin İNŞASINI da kapsamak zorundadır.*** Teşhis
> hangi metni okuyorsa iddia da onu okumalı — boğaz ikizinin metin tarafı: geniş sorgu
> kolon kolon bakarken iddia birleşime bakıyordu.
📌 Ayırt edici soru: *"ölçtüğüm dizi, sistemde GERÇEKTEN o hâliyle var mı, yoksa ölçüm
için mi kuruldu?"* — kurulduysa sınır artık o kurgunun sınırıdır, olgunun değil.
Kardeşi § Mutasyonun ürettiği sayı, MUTASYONDAN gelmiş olabilir (`OLCUM-DISIPLINI-ARAC.md`).
