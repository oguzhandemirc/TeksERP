# Ölçüm disiplini — KOMUTUN SÜRECİ ve ORTAMI

[`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md)'in **süreç/ortam** yarısı;
2026-09-13'te oradan **bölünerek** geldi (o dosya tavana 2,8 KB kalmıştı ve aynı gün üç
kez yazılmıştı; tavan yükseltilmedi).

**Çizgi:** orada kusur **aletin kendisindedir** (desen, ayrıştırıcı, varsayılan, kapsam);
**burada alet doğrudur ve onu ÇALIŞTIRAN şey bozar** — kabuk komutu nasıl ayrıştırdı,
süreç gerçekten çalışıyor mu yoksa girdi mi bekliyor, kanca çocuğuna hangi ortamı miras
verdi, yıkıcı bir yolun sondası nereye uygulandı.

⚠️ **`OLCUM-DISIPLINI-ORTAK-AGAC.md` ile karıştırma:** orada sorun **başka bir oturumun**
aynı ağacı paylaşmasıdır; burada sorun **senin kendi komutunun** süreci ve ortamıdır.
Biri eşzamanlılık, öteki yürütme.

Ölçüm yöntemi ve sayı yazma [`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'de; diğer arıza
sınıfları [`OLCUM-DISIPLINI-YUKLEM.md`](OLCUM-DISIPLINI-YUKLEM.md) (ne/nereye sorduğun) ·
[`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md) (deneyin kurgusu) ·
[`OLCUM-DISIPLINI-KAPI.md`](OLCUM-DISIPLINI-KAPI.md) / [`-KAPI-OLUMU.md`](OLCUM-DISIPLINI-KAPI-OLUMU.md) (kapı) ·
[`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md) (KATMAN 2).

### Koşullu bir yazımın "hatasız döndü"sü, "YAZDI" demek değildir
Komut koştu, çıkış kodu 0, hata yok — ve **hiçbir satır yazılmadı**. Koşullu yazımlar
(`INSERT … WHERE EXISTS` · `WHERE NOT EXISTS` · `ON CONFLICT DO NOTHING` · `updateMany`
ile eşleşmeyen `where`) başarıyla biter ve etkileri SIFIR olabilir. "Uygulandı" diye
okumak, o migration'ı koşmamış olmakla aynı şeydir — ama artık defterde "koştu" yazar,
yani ikinci kez koşmaz.

*(Vaka 2026-09-22, iki oturum aynı gün: modül grandfathering damgalarının INSERT'i
`WHERE EXISTS (SELECT 1 FROM rolls)` ile korunuyor. Sonda DB'si BOŞ ŞEMADAN kurulduğu
için migration koşarken `rolls` boştu ⇒ dördü de NO-OP oldu, komutlar hatasız döndü ve
"uygulandı" diye okundu. Bekçiler fikstürle top yaratınca kırmızı açıldı ve teşhis
"çevresel" sanıldı. Toplar varken yeniden koşulunca damga 0 → 9.)*

**Savunma:** yazımın ETKİSİNİ ayrıca ölç — `RETURNING` say, `count(*)` oku, `updateMany`in
`count`una bak. Bu depo aynı ilkeyi ÜRÜN kodunda zaten uyguluyor (atomik claim:
`count === 0 → 409`); ölçüm tarafında da aynısı geçerlidir.
> **Bir yazımın çıkış kodu, YAZDIĞININ delili değildir. Delil satır sayısıdır.**

### KABUK ailesi — "komut çalıştı" ile "ölçüm okundu" ayrı şeylerdir
Altı biçim, hepsi aynı yüklemi paylaşıyor *(kaynak: oturum ölçümü 2026-09-13, sha yok;
vakalar üç ayrı oturumun KENDİ hataları)*:

| # | Biçim | Vaka |
|---|---|---|
| a | **`&&` zinciri TEMİZ sonuçta kesilir** | `… \| grep -c … && git push` — `grep` 0 eşleşmede **çıkış 1** verir, `push` HİÇ koşmadı |
| b | **`$?` yanlış komuttan okunur** | `npx tsx … \| tail -25; echo $?` → okunan şey `tail`in kodu |
| c | **ölçüm + eylem AYNI zincirde** | `run-all-tests …; git push` — 11/13 KIRMIZI okunmadan push edildi |
| d | **koşmayan araç SIFIR üretir** | zsh'ta `--include=*.ts` glob'landı, `grep` hiç koşmadı, `wc -l` **0** bastı (gerçek 20) |
| e | **`head -3`** | `grep … \| head -3` üç satır verdi, gerçek kullanım **4.** satırdaydı → "0 referans" (gerçek 2) |
| f | **`tail -12`** | bir beyanın basılmadığı sanıldı; `tail` çıktının BAŞINI kesmişti, beyan oradaydı |

> **Ölçüm komutunda KIRPMA yoksa kapsam tamdır; kırpma varsa KAPSAM KIRPMADIR.**

**Savunma:** ölçümü eylemden ayır (`RC=$?` hemen işin ardından), zinciri kısalt, ve
kırpan her komutun (`head` · `tail` · `-m` · ajan çıktı sınırı) kapsamı daralttığını
raporda YAZ.

### ASILI KALMAK, çalışmanın DELİLİ değildir — stdin bekleyen komut "yavaş" görünür
Uzun süren bir adım iki şeyden biridir: **iş yapıyor** ya da **bir girdi bekliyor**. İkisi
dışarıdan AYNIDIR — çıktı yok, çıkış kodu yok, ilerleme yok. Ve bekleme hâli kendini
"paket yavaş" diye okutur, çünkü o açıklama zaten hazırdadır.

*(Vaka 2026-09-13, ölçüldü: bir commit 3 dakika "kapı koşuyor" sanıldı. Gerçekte kabuk,
commit mesajının İÇİNDEKİ backtick'leri komut ikamesi olarak çalıştırmıştı — mesajda
geçen `cp` hata bastı, `shasum -c` argümansız kalıp **stdin'i** beklemeye oturdu. Kapı
hiç başlamamıştı; teşhis `ps`te sürecin ÇOCUĞUNU görmekle geldi: `perl … shasum -c`.)*

> **Bir şey uzun sürüyorsa, NE yaptığını sor — süreyi değil, ÇOCUK SÜRECİ ölç.**
> `pgrep -P <pid>` üç saniyede cevap verir; "herhalde testler" bir saat yer.

⚠️ **Ve bu, bugünün üçüncü yüzeyi:** aynı sınıf (§ Kapı, kendi AYRIŞTIRICISININ darlığını
SAYIYA çevirebilir) önce `Kapanır:` alanında, sonra `bekçi:` alanında, sonunda **KABUKTA**
çıktı. Sınıf markdown'a ait değil: **ayraç içerikte de geçebiliyorsa, ayrıştırıcı içeriği
ÇALIŞTIRIR.** Komut mesajı, alan değeri, log satırı — hiçbiri "sadece veri" değildir.

**Savunma:** serbest metin bir komuta ARGÜMAN olarak değil DOSYA olarak geçer
(`git commit -F <dosya>`, heredoc); ve asılı kalan süreç önce `pgrep -P` ile açılır,
öldürülürken kendi PID'i adıyla öldürülür (`pkill -f <desen>` başkasının işini alır).

### KANCA ailesi — kendi repo'sunu kuran araç, KANCANIN git ortamını MİRAS ALIR
*"Geçici dizindeyim"* cümlesi **cwd'ye** bakar; git ise **`GIT_DIR`a** bakar. Git, hook
sürecine `GIT_DIR` · `GIT_INDEX_FILE` · `GIT_PREFIX` verir ve bunlar çocuk sürece aynen
iner. ⇒ Kanca içinden çağrılan ve **kendi repo'sunu kuran** bir araç (`git init` +
`add` + `commit`), geçici dizinde çalıştığını sanırken **gerçek repoya** yazar.

*(Vaka 2026-09-13, d5: yeni bir kapsam bekçisi geçici dizinde `git init/add/commit`
yapıyordu. Commit kapısına girdiği ilk gün, koşucu env'i çocuğa aynen geçirdiği için
bekçi geçici dizini değil **dalı** gördü: "taban" commit'i dala indi ve **3.977 dosya
silindi**. Kayıp yok — `reset` ile döndü. Vakanın kaydı `scripts/hooks/pre-commit.mjs`
içinde, düzeltmenin yanında duruyor.)*

> **`cwd` bir konumdur, `GIT_DIR` bir HEDEFTİR — ve git ikincisini dinler.**

⚠️ **Ve zarar tek yüzlü değildi — ÜÇ yüzü ölçüldü, sonuncusu KALICI:**
| # | ne oldu | kapsamı |
|---|---|---|
| 1 | dala "taban" commit'i, **3.977 dosya silindi** | geri alındı (`reset`) |
| 2 | `git init` `GIT_DIR`da koştu ⇒ ortak `.git/config`e **`core.bare=true`** | ana ağaçta `reset` *"bare repository"* ile düştü; `.git/config` **TÜM worktree'lerin ortak dosyası** |
| 3 | testin `git config user.*`ı ortak config'e gitti | bir **origin commit'i** `bekci <bekci@test>` kimliğiyle doğdu — `e904af4b`, force-push yasak ⇒ **kalıcı** |

⇒ **Ortak `.git/config`e yazan bir araç, tek bir ağacı değil TÜM ağaçları bozar** — ve
üçüncü yüzde olduğu gibi, bazı hasar geri alınamaz. Üçüncüsünün dersi ayrıca şudur:
*yıkıcı bir yan etkinin en ucuz görüneni (bir ad alanı) en kalıcısı olabilir.*

**Panzehir ÜÇ KAT** (tek kat yetmedi, üçü de ölçüldü):
① kancada `gitEnvSil` (yalnız kendi repo'sunu kuran adımlarda) ·
② **testin kendi izolasyonu**: `GIT_*` sök **+** `GIT_CONFIG_GLOBAL=/dev/null` **+**
`GIT_CONFIG_NOSYSTEM` **+** geçici `HOME` ·
③ `test_hook_config` §4 **tripwire**: ortak config temiz mi (`bare=false` ∧ worktree yok
∧ `user.*` yerelde yok). ⇒ *Kancayı düzeltmek testi düzeltmez; ikisi ayrı ayrı izole
edilir, üstüne bir tripwire konur.*

**Savunma (ölçülmüş, ve İKİ YÖNLÜ):** böyle adımlarda `GIT_*` değişkenleri **sökülür**
(`gitEnvSil`) — ama **yalnız işaretli adımlarda.** İndeksten okuyan adımlar
(`git show :<yol>`) pathspec commit'inde GEÇİCİ indeksi tam da `GIT_INDEX_FILE`dan bulur;
onlardan sökmek kapıyı körleştirir. ⇒ *Ortam değişkenini sökmek de bir KARARDIR ve
adım adım verilir.*

⚠️ **Ve ısırma ANI sınıfın ikinci yarısı:** bu bekçi bugüne dek yalnız **elle** ve
**CI'da** koşuyordu, orada zararsızdı; **kancaya girdiği an** ısırdı. Aynı yüklem, aynı
ağaç, aynı araç — **farklı REJİM** (`OLCUM-DISIPLINI.md` § Sayı yazma, beşinci eksen).
Bir aracı yeni bir koşum ortamına taşımak, onu **yeniden ölçmeyi** gerektirir.
Kardeşleri § 4 · Araç ölçümün içinde · `OLCUM-DISIPLINI-ORTAK-AGAC.md` § Başka oturumun
AĞAÇ-BÜTÜNÜ komutu.

### ÜRETİLMİŞ istemci ağaçla hizalı mı — `rebase`/`cherry-pick` şemayı taşır, ÜRETİLENİ taşımaz
`@prisma/client` kaynak değil **ÜRETİLMİŞ ARTIFAKTTIR**: `git` onu taşımaz. Şema değişikliği
içeren bir commit'i `rebase`/`cherry-pick`le aldıktan sonra `prisma generate` koşulmazsa,
ağaçtaki kod YENİ enum/alana bakar, istemci ESKİSİNİ bilir ⇒ bekçi **ürün kodunda** hata
gösterir. Okuyan kusuru üründe arar; oysa kusur ölçüm ORTAMINDADIR.
*(d9, 2026-09-14 — sınıf REJİM: aynı yüklem, aynı ağaç, farklı ortam, farklı sonuç.)*

> **Üretilmiş her artifakt bir ölçüm ÖN KOŞULUDUR:** ölçmeden önce *"elimdeki üretilmiş
> şey, ölçtüğüm ağaçtan mı doğdu?"* diye sor. Cevap "bilmiyorum"sa ölçüm henüz başlamadı.
📌 Ucuz kontrol — şemadaki TÜM enum'ları üretilmiş istemciyle karşılaştırır (tek enum
sormak, sorduğun enum eskiyse yanıltır):
```bash
cd Teks-Erp && node -e '
const fs=require("fs"), c=require("@prisma/client");
const sema=fs.readFileSync("prisma/schema.prisma","utf8");
let ayrik=0, n=0;
for (const m of sema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
  n++; const u=c[m[1]];
  const eksik=(m[2].match(/^\s*([A-Z0-9_]+)/gm)||[]).map(s=>s.trim()).filter(d=>!u||!(d in u));
  if (eksik.length) { console.log("✗", m[1], eksik.join(",")); ayrik++; }
}
console.log(`sema enum ${n} · ayrisan ${ayrik}`);'
```
*(Ölçüldü 2026-09-14: 81 şema enum'u, ayrışan 0 — yani o gün ortam hizalıydı ve bu da bir
ölçümdür; "koştum, temiz" demek için sayıyı görmek gerekir.)*
⚠️ **Ve izole çalışma ağacında bu kontrol PAYLAŞILAN bir şeyi ölçer:** `node_modules`
sembolik bağla ana ağaca bağlıysa üretilmiş istemci de ORTAKTIR — *"benim ağacımda hizalı"*
cümlesi, başka bir oturumun `generate`inin sonucu olabilir ve o oturum şemayı geri alırsa
sessizce bozulur. Kardeşi `OLCUM-DISIPLINI-ORTAK-AGAC.md` § Paylaşılan `node_modules`
üstünde worktree, izolasyon değil TAKLİTTİR.

### Yıkıcı bir yolun DÜZELTMESİ, önce KURBAN EDİLEBİLİR bir hedefte sınanır
Bir yolun yıkıcı olduğu **biliniyorsa**, *"düzelttim"* iddiasının ilk ölçümü gerçek
hedefte yapılmaz. Düzeltme yarım uygulanmış olabilir ve sonda, düzeltmeyi değil
**yıkımı tekrar** ölçer.

*(Vaka 2026-09-13, d5: kanca/`GIT_DIR` düzeltmesini yazarken izolasyon düzenlemesi YARIM
uygulanmıştı — `perl` bozuk çıktı vermiş, fark edilmemişti — ve sonda gerçek repoya karşı
koşuldu: **aynı ısırık ikinci kez** (`core.bare=true`, `user.*`, dal "taban"a kaydı).
Onarıldı; sonra sonda SAHTE bir repoda yapıldı: `GIT_DIR` sahte repoyu gösterirken test
koşuldu, sahte config'in sha'sı ve `HEAD` **önce = sonra** diye ölçüldü.)*

> **Gerçek hedef İKİNCİ ölçümdür.** Birincisi kurban edilebilir bir kopyada yapılır ve
> orada *hiçbir şeyin değişmediği* sha ile gösterilir.

⚠️ Bu, § 4 *Araç ölçümün içinde*'nin **eylem hâlidir**: orada araç gözlediğini bozar,
burada **ölçen kişinin kendisi** araçtır ve düzeltmesini doğrulamadan uygular.
**Savunma:** yıkıcı yol düzeltmesi üç adımdır — ① düzeltmenin UYGULANDIĞINI ölç
(`shasum`/`assert`, `SONDA ailesi` (b)) ② sahte hedefte sonda ③ gerçek hedefte sonda.
Kardeşi `OLCUM-DISIPLINI-SINIFLAR.md` § SONDA ailesi · § KANCA ailesi (üstte).
