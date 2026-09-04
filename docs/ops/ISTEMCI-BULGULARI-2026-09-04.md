# İstemci-Taraflı Bulgular (2026-09-04) — geliştirme ortamına devir

> **Bu not, kaynak koda erişimi olan oturum içindir.** Bulgular çalışan bir
> kurulumda ölçüldü; ölçen oturumda **yalnız derlenmiş paket vardı**, istemci
> (mobil / Electron) kaynağı yoktu. Backend tarafı ölçüldü ve kesin; istemci
> tarafı **çıkarım**, doğrulaması sizde.
>
> **Repo hedefi önerisi:** `docs/ops/ISTEMCI-BULGULARI-2026-09-04.md`

---

> ### ⚠️ 2026-09-04 — BULGU A GERİ ÇEKİLDİ
>
> Bu notun ilk hâli A'yı bir backend kusuru sayıyordu. **Yanlıştı.**
> Geliştirme ortamı kaynağı ölçtü: mobil istemci joker dalını **taşıyor**
> (`hasGlobalWildcard`, testi yeşil) ve `["*"]` kestirmesi `CLAUDE.md`'de
> **bilinçli bir karar**. Kodda hata yok; **tablette eski bundle koşuyor.**
> Ayrıntı ve doğru eylem §2'de. **`["*"]` kestirmesini KALDIRMAYIN.**
>
> B bölümü geri çekilmedi ama aynı şüpheye açık — §3'teki uyarıya bakın.

---

## 0. Ortak kök — ikisi de aynı yerden bakınca görünmüyor

İlk hâlde ikisini "sunucu izin veriyor, istemci kendini kapatıyor" diye tek
sınıfa koymuştum. A'nın düzeltilmesinden sonra ortak kök **başka bir şey**:

**Sunucu tarafından bakınca istemcinin hangi sürümü koştuğu görünmüyor.**

Backend `clientType`'ı (`electron` / `mobile` / `web`) alıyor ve oturuma
yazıyor, ama **hiçbir yerde istemci sürümü/bundle damgası tutulmuyor**
(ölçüldü: `devices` ve oturum tablolarında sürüm kolonu yok). Sonuç: bayat bir
istemci, backend kusuru gibi okunuyor — bu notun ilk hâlinde tam olarak bu
oldu.

**Öneri (küçük, kalıcı):** login/announce isteğine bir `appVersion` alanı
ekleyin, `devices` satırına yazın ve Cihazlar ekranında gösterin. "Hangi
sürüm bağlı" sorusu bir kez bakılır hâle gelir ve bu sınıf karışıklık biter.

Not: her iki belirti de **satıcı hesabının gizliliği söküldükten sonra**
görüldü — o hesap ilk kez gerçekten kullanıldı ve daha önce yürünmemiş yollar
yürünmüş oldu.

---

## 1. Ölçüm ortamı

| | |
|---|---|
| Paket | `tekserp-backend-20260904_032424-6d7f1209.zip` · v2.9.0 · main |
| Kurulum | `C:\TeksERP` — sıfırdan, fabrika dump'ı + 231 migration |
| Satıcı hesabı | `sysadmin`, `npm run superadmin:kur` ile kuruldu (04:10:17) |
| Gizlilik | **Bu pakette zaten sökülmüş** — `system-account.helper.js` 1.6 KB → 266 bayt, geriye yalnız `ACTOR_SELECT` kaldı |
| Tablet | `Tablet 59bd09a5` (`deviceId 59bd09a5-806c-4af8-a387-520a6b114833`), 04:15'te announce etti |

⚠️ Aşağıdaki satır numaraları **derlenmiş `dist/`** üzerinden okundu.
**Dosya adları güvenilir, satır numaraları `.ts` karşılıklarında kayar.**

---

## 2. BULGU A — Süperadmin tablette "yetkin yok" alıyor

### Belirti
`sysadmin` tablette giriş yapıyor ama ekranlara girerken "yetkin yok" hatası
alıyor. Oysa hesabın yetkisi tam.

### Ölçülenler

```
katalogdaki toplam izin : 86
sysadmin'in izin satiri : 86       ← hepsi var
bunlarin mobile: olani  : 19
```

Yani izin **satırları eksiksiz** — araç onları gerçekten yazıyor.

Sorun `getEffectivePermissions`'ın satırları hiç okumaması
(`src/services/auth.service.ts`):

```ts
static async getEffectivePermissions(userId) {
  const owner = await prisma.user.findUnique({
    where: { id: userId }, select: { isSystemAccount: true },
  });
  if (owner?.isSystemAccount) return ["*"];     // ← 86 satır okunmadan çıkılıyor
  ...
}
```

Bu dizi doğrudan JWT'ye giriyor (`issueToken` ilk satırında bunu çağırıyor) ve
`GET /api/auth/me` de aynısını döndürüyor
(`src/controllers/auth.controller.ts` → `permissions: req.user?.permissions ?? []`).

**Backend jokeri anlıyor** (`src/middlewares/rbac.middleware.ts`):

```ts
const matchesPermission = (userPermissions, required) => {
  if (userPermissions.includes("*")) return true;        // ← sunucu her şeye izin veriyor
  if (userPermissions.includes(required)) return true;
  const colon = required.indexOf(":");
  if (colon > 0 && userPermissions.includes(`${required.slice(0,colon)}:*`)) return true;
  return false;
};
```

### ❌ İlk çıkarım YANLIŞTI

İlk hâlde "tablet tam kod eşleşmesi yapıyor, `["*"]` kestirmesi kaldırılmalı"
denmişti. Geliştirme ortamı kaynağı ölçtü ve çürüttü:

- Mobil istemci **joker dalını taşıyor** (`hasGlobalWildcard`), testi **yeşil**
- `["*"]` kestirmesi `CLAUDE.md`'de kayıtlı **bilinçli bir karar**
- Yani `getEffectivePermissions` · `rbac.middleware` · mobil istemci — **üçü de
  doğru ve birbiriyle tutarlı**

⚠️ **`["*"]` kestirmesini KALDIRMAYIN.** Bu notun ilk hâline dayanıp
kaldırmak, bilinçli bir kararı ölçülmemiş bir çıkarım uğruna bozmak olurdu.

### Gerçek sebep: tablette BAYAT BUNDLE koşuyor

`hasGlobalWildcard` dalı, tablete kurulu derlemeden **sonra** eklenmiş.
Kurulu APK jokeri bilmiyor, `["*"]` listesinde `mobile:...` arıyor,
bulamıyor, "yetkin yok" diyor. Backend'in bununla ilgisi yok.

Bu ölçümle de tutarlı: `TeksERP-1.0.1-vc58.apk` prova makinesine hiç
taşınmadı; tablette **daha eski, elle kurulmuş** bir derleme çalışıyor.

### Doğru eylem
1. Tablete **güncel APK'yı** kurun (`hasGlobalWildcard` içeren derleme).
2. `sysadmin` ile tekrar deneyin — hata kalkmalı.
3. Kalkmazsa **o zaman** kod aranmalı; o noktaya kadar backend'e dokunmayın.

### Backend'de dokunulmaması gereken ikinci yer
`issueToken` içindeki masaüstü kapısı:

```ts
if (isDesktopClient(ctx?.clientType) &&
    !permissions.some(p => !p.startsWith("mobile:")))
  throw AppError.forbidden("Bu hesabın masaüstü paneline erişimi yok.");
```

`["*"]` bu kapıyı geçiyor (`"*"` `mobile:` ile başlamıyor). Kestirme
korunduğu sürece sorun yok — yalnız **kestirmeyi ileride biri kaldırmaya
kalkarsa bu satırın da gözden geçirilmesi gerektiğini** bilin. Bir test
yazmaya değer.

---

## 3. BULGU B — Cihaz onayı bayrağı kapalıyken tablet yine onay istiyor

> ⚠️ **ÖNCE BUNU OKUYUN — B de aynı şüpheye açık.** Bu belirti **A ile aynı
> tablette, aynı bayat bundle'la** görüldü. Yani B'nin istemci yarısı da eski
> derlemenin davranışı olabilir. **Güncel APK kurulmadan B'yi bir kod bulgusu
> saymayın** — önce §2'deki eylemi yapın, sonra tekrar deneyin.
>
> Aşağıdaki **sunucu tarafı ölçümler bundle'dan bağımsız geçerlidir**;
> istemcinin ne yaptığı ise doğrulanmamıştır.

### Belirti
`devicePairingRequired` kapalı olmasına rağmen tablet "cihaz onayı bekleniyor"
ekranında duruyor.

### Ölçülenler — backend üç yerden de "gerek yok" diyor

```
1) DB              : device.pairingRequired = false
2) GET /api/devices/pairing-required  ->  {"success":true,"data":{"required":false}}
3) src/middlewares/device.middleware.ts  ->  yalniz pairingRequired TRUE iken
                                             401/503 doner; false iken next()
```

Ama durum ucu ham `status` döndürüyor:

```
GET /api/devices/status   (x-device-id: 59bd09a5-...)
-> {"status":"PENDING","machineId":null,"machineCode":null,
    "machineName":null,"stationId":null,"stationName":null}
```

`DeviceService.getStatus` bayrağı hiç okumuyor; cihazın kaydını olduğu gibi
veriyor (bulunamazsa `UNKNOWN`).

### Çıkarım (istemcide doğrulanmalı)
Tablet onay ekranını **`status === "PENDING"`** koşuluna bağlamış görünüyor.
`/api/devices/pairing-required` ucunu ya hiç sormuyor ya cevabını kullanmıyor.

### Önerilen düzeltme
İki seçenek, biri seçilmeli:

**(a) İstemci tarafı — koşulu düzelt**
```
onayEkraniGoster = pairingRequired && status !== "APPROVED"
```
Uç zaten var ve doğru cevap veriyor.

**(b) Sunucu tarafı — kararı uca taşı**
`GET /api/devices/status` cevabına `pairingRequired` alanını ekleyin. Böylece
istemcinin iki ucu birlikte sorup mantığı kendi kurması gerekmez; tek cevap
kararı taşır. İki istemci (tablet + Electron) aynı hatayı ayrı ayrı yapamaz.

**(b) tercih edilir** — bu notun 0. bölümündeki ortak kökü kapatan tek yol,
kararı sunucuda tutmak.

### ⚠️ Bu tek bir tablete özgü DEĞİL — her yeni cihaz aynısını yaşar

`DeviceService.announce` yeni kaydı **koşulsuz** `PENDING` yaratıyor; bayrağa
hiç bakmıyor (`src/services/device.service.ts`):

```ts
create: { deviceId, name: fallbackName, kind, status: "PENDING", isActive: true, ... }
```

Yani `devicePairingRequired` kapalı olsa bile **her yeni cihaz PENDING doğar**
ve tablet PENDING'i onay ekranı olarak okur. Cihaza özgü bir durum yok.

**Neden bugüne kadar görülmedi** — fabrika verisindeki cihaz dağılımı:

```
APPROVED : 16 TABLET · 11 DESKTOP · 1 PHONE   (hepsi çoktan onaylanmış)
PENDING  :  1 TABLET ·  1 DESKTOP             (biri bu provada eklendi)
```

Sahadaki 28 cihazın hepsi zaten `APPROVED`. Kusur yalnız **yeni bir cihaz
eklendiğinde** görünür hâle geliyor — yani tam olarak şu iki anda:

- **yeni müşteri kurulumu** (bütün cihazlar yeni)
- **arızalı tablet değişimi** (vardiya ortasında, en kötü zamanlama)

Bu yüzden mevcut fabrikada sessiz kaldı ve "tek gövde, çok fabrika" hedefinde
ilk kurulumda karşınıza çıkacak ilk şeylerden biri olacak.

### İlgili doküman kayması
`KURULUM.md` E43 şunu vaat ediyor:

> `devicePairingRequired` default **KAPALI** → tablet beklemeden login olur

**Bugün gerçekleşmiyor.** Düzeltme yapılana kadar bu cümle yanlış; düzeltme
yapılınca doğru olacak. Hangisi olursa olsun bu satır güncellenmeli.

### Geçici çözüm (saha)
Cihazı elle onaylayın: Electron → Cihazlar → ilgili tablet → "Onayla & Ata".
`status` `APPROVED` olur ve tablet devam eder.

---

## 4. BULGU C — Keşif aynı sunucuyu birden çok kez listeliyor

### Belirti
Tablet "ağdakileri tara" dediğinde **iki sunucu** çıkıyor
(`192.168.1.102:4000` ve `192.168.137.1:4000`); aynı makinedeki Electron ise
**üçüncü bir adres** gösteriyor (`172.20.144.1:4000`). Operatöre üç farklı
sunucu varmış gibi görünüyor.

### Ölçülenler — tek sunucu, çok kapı

Dört adresten `/api/discovery/identity` soruldu, **dördü de aynı kimliği**
döndürdü:

```
192.168.1.102  }
192.168.137.1  }  installationId = 94c955fe-f354-401b-83e0-6dd2ec12283c
172.20.144.1   }  serverName = ThinkPad · v2.9.0
100.70.47.46   }
```

4000 portunu dinleyen **tek süreç** var (PID 6224, `HOST=0.0.0.0`). Makinede
ise **yedi IPv4 adresi** var: Wi-Fi · mobil erişim noktası · Hyper-V sanal
anahtarı · Tailscale · üç adet link-local.

### Sebep 1 — tekilleştirme yok
Keşif, sunucuya **ulaşılabilen her adresi ayrı bir kayıt** olarak listeliyor.
Tablet dışarıdan iki adrese ulaşabiliyor (Wi-Fi + hotspot), o yüzden iki satır
görüyor. Sunucu log'u bunu doğruluyor — aynı saniyede iki ağdan aynı istek:

```
13:12:24  192.168.1.102     "GET /api/discovery/identity" 200  "okhttp/4.12.0"
13:12:24  192.168.137.124   "GET /api/discovery/identity" 200  "okhttp/4.12.0"
```

**Düzeltme:** tarama sonuçlarını `installationId`'ye göre tekilleştirin. Alan
**cevapta zaten var** (`buildDiscoveryIdentity`, `src/services/discovery.service.ts`)
ve tam bu iş için uygun. Çok adresli sunucu tek satır olur; kullanıcı isterse
adres seçebilir.

### Sebep 2 — "ilk cevap veren" seçiliyor, "en iyi yol" değil
Electron'un neden `172.20.144.1`'i seçtiği ölçüldü — Windows arayüz metrikleri:

```
Tailscale                     metrik  5
vEthernet (Default Switch)    metrik 15   ← 172.20.144.1  (Hyper-V, host-only)
Wi-Fi                         metrik 50   ← 192.168.1.102 (gerçek LAN)
Yerel Ağ Bağlantısı* 2        metrik 55   ← 192.168.137.1 (hotspot)
```

**Hyper-V'nin sanal anahtarı gerçek Wi-Fi kartından öncelikli** (15 < 50).
Tarama sırayla deneyip ilk cevap verende duruyor.

`172.20.144.1` yalnız o makineden erişilebilir — tablet onu hiç görmedi. Yani
bu risk **sadece sunucuyla aynı makinede koşan panelde** var; farklı
makinedeki istemciler host-only adrese zaten ulaşamaz. Fabrika sunucusunda
Hyper-V/WSL/Docker sanal anahtarı olması muhtemel olduğundan, sunucuda panel
de açılıyorsa karşınıza çıkar.

**Öneri:** seçim `installationId` tekilleştirmesinden sonra kullanıcıya
bırakılsın; otomatik seçim yapılacaksa link-local (`169.254.*`) ve bilinen
sanal aralıklar (`172.1x.*` Hyper-V/Docker) **son sıraya** alınsın.

### ✅ DÜZELTİLDİ (2026-09-04, geliştirme ortamı)

Sebep 1 ve 2 kapandı. Kural iki istemcide **tek metin** olarak yaşıyor
(`>>> KEŞİF-İKİZ` bloğu — `Electron/shared/discovery.ts` ↔
`mobil/src/lib/discovery.ts`, iki bekçi birebir kıyaslıyor):

- `groupByInstallation` → **bir satır = bir SUNUCU**; adresler grubun içinde
  durur, masaüstünde "bu sunucunun N adresi var" ile açılır ve elle seçilebilir.
- `addressPreferenceRank` → LAN (192.168/10) · ad · **172.16/12** · **100.64/10**
  · loopback · link-local. ⚠️ **SIRALAMA, ELEME DEĞİL** — sanal/overlay adresten
  gerçekten hizmet veriliyor olabilir; hiçbir aday listeden düşmez.
- `installationId` **null** dönen sunucuda (eski sürüm) eski davranış birebir
  korunur: adres bazlı, birleştirme YOK.

Ayrıntı ve negatif sondalar: `docs/history/CLAUDE-NOT-ARSIVI.md` → 2026-09-04.
**Fabrika ağı topolojisi bölümü (aşağıda) hâlâ AÇIK** — ölçüm sahada yapılacak.

### Fabrika ağı — ayrı bir risk, ölçülemedi

Sahada **birden çok Wi-Fi dağıtıcısı** var, hepsi aynı switch üzerinden
modeme gidiyor ve cihazlar farklı dağıtıcılara otomatik bağlanıyor. Keşif iki
ayağa basıyor ve **ikisi de aynı alt ağ varsayar**:

- mDNS ilanı (`_teks-erp._tcp`) — multicast, **TTL=1, router'ı aşmaz**
- alt ağ taraması — istemci **kendi** alt ağını tarar

| Dağıtıcılar | Sonuç |
|---|---|
| **Köprü / AP modu** (DHCP'yi modem verir, herkes `192.168.1.x`) | Sorun yok — hangi dağıtıcıya bağlandığı fark etmez |
| **Router modu** (her biri kendi DHCP/NAT'ı) | mDNS geçmez, tarama boşa gider → cihaz **hangi dağıtıcıya düştüğüne göre** sunucuyu bulur ya da bulamaz |

⚠️ Router modunda bile **gömülü sabit adres (`192.168.1.250`) çalışmaya devam
edebilir** — NAT dışarı doğru izin verir. Yani **önce keşif bozulur, bağlantı
ayakta kalır**; belirti "elle yazınca çalışıyor, taramada çıkmıyor" olur ve
teşhisi zorlaştırır.

⚠️ Üçüncü ihtimal: dağıtıcılarda **istemci izolasyonu** (AP isolation / misafir
modu) açıksa aynı alt ağda bile cihazlar birbirini göremez; o durumda elle IP
de çalışmaz.

**Sahada yapılacak tek kontrol** — iki farklı dağıtıcıya bağlı iki tablette IP
ve ağ geçidine bakın:

| Görünen | Anlamı |
|---|---|
| İkisi de `192.168.1.x`, geçit `192.168.1.1` | Köprü — sorun yok |
| Biri farklı alt ağ, geçit dağıtıcının kendisi | Router — keşif kırılacak, AP moduna alın |

Bu bölüm **ölçülemedi** — fabrika ağına erişim yoktu. Yukarıdakiler koddan
(mDNS + alt ağ taraması) çıkan mantıksal sonuçlar ve sahada tek bakışla
doğrulanır.

---

## 5. Neyin ölçüldüğü, neyin ölçülmediği

| | Durum |
|---|---|
| Backend davranışı (izinler, bayrak, uçlar, `announce`, `getStatus`) | ✅ **ölçüldü** — çalışan kurulumda, canlı sorgularla |
| Mobil istemcinin joker desteği | ✅ geliştirme ortamında ölçüldü — **var**, test yeşil |
| Tablette koşan bundle'ın sürümü | ❌ **ölçülemedi** — sunucu istemci sürümü tutmuyor (§0) |
| B'de istemcinin onay ekranını hangi koşula bağladığı | ❌ **ölçülmedi** — çıkarım |
| C'de tek sunucunun çok adresten göründüğü | ✅ **ölçüldü** — `installationId` dört adreste aynı, tek dinleyen süreç |
| C'de Electron'un sanal adresi seçme sebebi | ✅ **ölçüldü** — Windows arayüz metrikleri (Hyper-V 15 < Wi-Fi 50) |
| C'de fabrika Wi-Fi topolojisi (köprü mü router mı) | ❌ **ölçülemedi** — fabrika ağına erişim yoktu |

⚠️ **Bu notun ilk hâli, ölçülmemiş bir çıkarımı bulgu diye sundu ve yanlış bir
düzeltme önerdi.** Ders, aşağıdaki bölümün konusu.

---

## 6. Asıl ders — ve bir öneri

Bu notun ilk hâli şu zinciri kurdu: *sunucu izin veriyor → istemci reddediyor
→ demek ki sözleşme kopuk → backend'i değiştir.* Zincirin ilk iki halkası
ölçülmüştü, üçüncüsü **varsayımdı** ve yanlıştı. Doğrusu: *istemci bayattı.*

Bu hata, sunucudan bakan birinin **kaçınamayacağı** bir hataydı — çünkü
sunucu, karşısındaki istemcinin hangi sürüm olduğunu bilmiyor. Tek seferlik
bir dikkat meselesi değil, ölçüm boşluğu.

**Somut öneri 1 — istemci sürümünü görünür yapın.** Login/announce'a
`appVersion` ekleyin, `devices` satırına yazın, Cihazlar ekranında gösterin.
Bayat istemci o gün bir bakışta anlaşılır; bu notun yanlış yarısı hiç
yazılmazdı.

**Somut öneri 2 — satıcı hesabıyla uçtan uca akış testi.** Giriş → tablet
ekranı → modül anahtarı yazma. Bugün her parça ayrı ayrı yeşil; birleşimini
hiçbir test yürümüyor ve gizlilik söküldükten sonra ilk yürüyen gerçek
kullanım oldu.
