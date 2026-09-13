# Ölçüm disiplini — KATMAN 1c · PAYLAŞILAN AĞAÇ ve ÇOK OTURUM

[`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md)'in **ortam** yarısı;
2026-09-13'te oradan **bölünerek** geldi (o dosya tavana 1,8 KB kalmıştı ve aktif
yazılıyordu; tavan yükseltilmedi).

**Çizgi:** buradaki sınıflarda kusur ne alette ne kurguda, **ÖLÇÜM ORTAMININ
PAYLAŞILMASINDADIR** — aynı çalışma ağacı, aynı indeks, aynı ref, aynı `node_modules`,
aynı kilit. Hepsinin ortak imzası şudur: *ölçümü bozan şey senin yaptığın bir şey değil,
BAŞKASININ aynı anda yaptığı bir şeydir* — yani tekrar ederek yakalanmaz, yalnız
**izolasyonla** ya da **beyanla** yakalanır.

Aletin kendisine ait sınıflar [`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md)'de,
kurguya ait olanlar [`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md)'de,
**KATMAN 2** [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md)'de, yöntem ve
kapı ölümleri [`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'de. Kurulum reçetesi:
`docs/RECETELER.md` § İzole oturum çalışma ağacı.

### Paylaşılan `node_modules` üstünde worktree, izolasyon değil TAKLİTTİR
O worktree'de koşan her **üretim** komutu — `generate` · `install` · `npx` ·
`tsc --build` · `.cache` yazan her araç — ana ağaca yazar. `prisma generate` okuma
gibi görünür, **YAZAR**.
⚠️ Ortak ağaç riskinin **altıncı ısırığı**, ve ilk beşin panzehirleri (pathspec
commit · worktree · adıyla stage'leme) burada **TUTMAZ**: onlar *dosya* üzerindeydi,
bu **üretilmiş artefakt** üzerinde.
**Savunma:** izolasyon iddiası ancak `node_modules` ve üretilmiş çıktı dizinleri de
ayrıyken kurulur.

### Adıyla stage'lemek YETMEZ — indeks paylaşılan DURUMDUR
Ortak ağaçta `git add <dosya>` doğru refleks ama **koruma değil**: dosyan artık
PAYLAŞILAN indekstedir ve **başka bir oturumun pathspec'siz `git commit`i onu kendi
commit'ine alır.** Kayıp dosya değil, **gerekçedir** — iş ağaçta durur, commit mesajı
başkasınındır ve o mesaj artık ne olduğunu YANLIŞ anlatır.
*(Vaka 2026-09-13 05:19: adıyla stage'lenmiş üç dosya, komşu bir oturumun
`git add <kendi dosyası> && git commit` çağrısıyla onun commit'ine girdi. Aynı anda
başka bir oturum `git commit -F … -- <yol>` biçimini kullanıyordu ve o hiç etkilenmedi.)*
> **Panzehir: stage etme.** `git commit -- <pathspec>` tek adımdır ve indekste pencere
> bırakmaz. `git add` + `git commit` iki adımdır; aradaki her saniye açık bir kapıdır.

⚠️ **İSTİSNA — ve kuralın kendi tuzağı:** pathspec commit **izlenmeyen dosyayı ALMAZ**.
YENİ dosya için `git add -- <yol>` ZORUNLUDUR; pencere daraltılabilir, **kapatılamaz**.
*(İki bağımsız vaka, aynı gece: biri `error: pathspec … did not match any file(s) known
to git`, öteki pathspec listesini değişkene koyup çıkış 128 aldı.)*
📌 Ve bu bir teselli değil bir ÖLÇÜTTÜR: git burada **sessizce yanlış yapmıyor,
gürültüyle duruyor** — hiçbir şey yazılmaz, yarım commit oluşmaz. *Bir disiplinin kendi
tuzağı varsa, o tuzağın SESLİ olması disiplini kurtarır.*

⚠️ Ortak ağaç riskinin **yedinci ısırığı** ve önceki panzehirlerin en çok güvenileni
(*"adıyla stage'le"*) tam burada yetersiz kalıyor — çünkü o kural **kendi commit'ini**
dar tutar, **başkasınınkini** değil.

### Ortak ağaçta "BENİM commit'im" diye bir şey yoktur — "ŞU ANKİ REF" vardır
Bir commit'i kendi malın sayman, ona sonradan dokunabileceğini varsayar. Ortak ağaçta o
varsayım üç ayrı biçimde çöker ve **üçü de aynı gün yaşandı (2026-09-13)**:

| # | Biçim | Ne oldu |
|---|---|---|
| ① | başkasının **commit'siz** işi ölçümü kirletti | cırcır tabanı ağaçtan ölçüldü, 13 kapanışın 6'sı ölçenindi |
| ② | commit **süpürüldü** | bir oturumun çıplak `git commit`i başkasının üç dosyasını kendi commit'ine aldı |
| ③ | **amend ayrıştı** | bir commit push'landı, yazarı bunu bilmeden amend etti; `main` çatallandı |

> **Push eden, push'ladığını YAZARA söyler — VE yazar, amend ettiğini PUSH EDEBİLECEK
> olana söyler.** Tek yönlü hâli ayrışmanın yalnız bir ucunu kapatır.

📌 Ve bu, **izole ağaca (worktree) geçişin en kısa gerekçesidir**: yukarıdaki üçünün
hiçbiri dikkatle önlenmez, çünkü üçü de *başkasının* zamanlamasına bağlıdır.
⚠️ Ama izolasyon **dosya** izolasyonudur, **ref** izolasyonu değildir
(§ Pencerenin BOŞ olduğunu ölçmek) — ve paylaşılan `node_modules` üstünde hiç değildir
(§ Paylaşılan `node_modules` üstünde worktree).

### Başka oturumun AĞAÇ-BÜTÜNÜ komutu, sondanı ZAMANDA DONDURUR
`stash` · `checkout` · `reset --hard` · `clean` ağacın **tamamının** fotoğrafını alır —
senin sondan o an ağaçtaysa **fotoğrafa girer**. Geri alman gerçek ağacı temizler ve
`shasum` ile doğrulanır; ama **donmuş kopya sonra geri gelebilir** (pop, çakışma
çözümü, checkout).
*(Vaka 2026-09-13, sıra ÖLÇÜLDÜ: sonda eklendi → başka oturum `git stash --keep-index`
çalıştırdı → sonda `cp` + `shasum -c` ile geri alındı (doğrulandı, ağaç temiz) → pop
çakışmasında satır "süren sonda" sanılıp ağaca geri yazıldı → pathspec'li commit onu
aldı. Teşhis ea'nın; ilk okumam "indekste kaldı" idi ve YANLIŞTI.)*
> **Ortak ağaçta `stash`/`checkout`/`reset --hard`/`clean` YOK** — bu kuralın
> mekanizması budur: komut senin değil, AĞACIN tamamının zamanını oynatır.

### Ortak ağaçta ölçülen sayı, BAŞKASININ commit'siz işini içerir — ve çoğu kez LEHİNE
Paylaşılan çalışma ağacı yalnız kapıyı körleştirmez (o yön `RECETELER.md` § İzole oturum
çalışma ağacı'nda yazılı: ana ağaçta *staged ama commit'siz* dosyaya link veren belge
kapıya ölü görünmez). **Ters yön de var ve daha sinsidir: kapının SAYISI da kirlenir.**
*(Vaka 2026-09-13, aynı commit iki ağaçta ölçüldü: kesik alan ortak ağaçta **32**, izole
ağaçta **33** — eksik olan bir, başka bir oturumun commit'lenmemiş düzeltmesiydi ve
benim sonucum sayılıyordu. Aynı kapı benzersiz bekçi adını ortak ağaçta **243**, izole
ağaçta **234** gördü: dokuz ad başkalarının commit'siz satırlarından geliyordu.)*
> **Sapma yönü rastgele değil:** ortak ağaçta biriken şey **başkalarının İLERLEMESİDİR**,
> yani sayı hep *iyi* tarafa kayar. Kirlenmiş bir ölçüm, fark ettirmeden bir ÖVGÜdür.

**Savunma:** cırcır tabanı olacak her sayı **izole ağaçtan** alınır; alınamıyorsa ölçüm
`git show HEAD:`/index üstünden yapılır ve *"ortak ağaçta ölçüldü"* diye beyan edilir.
Kardeşi § Başka oturumun AĞAÇ-BÜTÜNÜ komutu, sondanı ZAMANDA DONDURUR.

### `.git/index.lock` bir KUYRUK değil, bir REDDİR
Paylaşımlı ağaçta eşzamanlı commit **serileştirilmez**; ikincisi düşer.
*(Vaka: iki oturum aynı anda commit attı. Doğru hamle kilidi SİLMEK değildi — gerçek
bir süreç tutuyordu — bekleyici kurmaktı.)*
⚠️ Tehlikesi bir üstteki sınıfa açılır: **aynı saniyede deneyen biri sessizce düşer ve
çıkış kodunu ölçmeyen fark etmez.**
**Savunma:** kilidi asla körlemesine silme (önce tutan süreci ölç); commit'i bekleyici
ile sıraya sok ve çıkış kodunu OKU.

### Pencerenin BOŞ olduğunu ölçmek, DOĞRU AĞAÇTA olduğunu ölçmek değildir
`git worktree` **dosya** izolasyonu verir, **ref** izolasyonu VERMEZ: aynı `.git`,
aynı dallar. *(1e/6e)* Kardeşi § Paylaşılan `node_modules` üstünde worktree.
**Savunma:** commit öncesi dalı ve hedefi AYRI adımda oku
(`git rev-parse --abbrev-ref HEAD` · `git rev-parse HEAD main`), sonra commit et.
