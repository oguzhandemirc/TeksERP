# İstemci-Taraflı İki Bulgu (2026-09-04) — geliştirme ortamına devir

---

## ⚠️ DEVİR SONRASI DÜZELTME (2026-09-04, kaynakta ÖLÇÜLDÜ)

Notun kendi 4. bölümü ("Bu notun ölçemedikleri") üç çıkarımı doğrulamaya
bırakmıştı. Üçü de ölçüldü; **biri YANLIŞ çıktı**:

### BULGU A'nın istemci çıkarımı YANLIŞ — `["*"]` kestirmesi KALDIRILMAYACAK

`mobil/src/hooks/usePermission.ts` **global joker dalını zaten taşıyor**:

```ts
const hasGlobalWildcard = set.has('*');
const has = (code: string): boolean => {
  if (hasGlobalWildcard) return true;      // ← tablet "*"i anlıyor
  ...
```

Bekçisi de yeşil (`usePermission.test.ts`). Yani tablet `["*"]` alan bir hesabı
reddetmez. Ölçüm ortamında görülen "yetkin yok" ekranının sebebi **o tablette
ESKİ BUNDLE koşmasıdır** (joker dalı henüz o pakette yoktu) — sunucu tarafında
düzeltilecek bir şey değil, bir güncelleme meselesi.

`["*"]` kestirmesi kök `CLAUDE.md`'de **bilinçli bir karardır** (2026-09-03 —
süperadmin P2: "tam yetki `getEffectivePermissions` ilk ifadesi `["*"]`; grant
satırı doğmaz, süperadmin ROL DEĞİL, katalogda `*` yok"). Kaldırmak, aynı notta
sayılan `*` körlüklerinin (Electron `hasAdminAccess`, backend üç `includes
("admin:*")`) kapatılma gerekçesini de ortadan kaldırırdı. **Aşağıdaki
"Önerilen düzeltme" bloğu (2. bölüm) UYGULANMADI ve uygulanmayacak.**

### BULGU B'nin istemci çıkarımı da (kısmen) yanlıştı — ama kök sebep gerçekti

`mobil/src/navigation/RootNavigator.tsx` kapıyı ham `status`a değil
`assignmentRequired && status !== 'APPROVED'` koşuluna bağlamıştı; yani
"`/pairing-required` ucunu hiç sormuyor" çıkarımı da eski bundle etkisidir.
**Backend kusurları ise birebir doğruydu** ve düzeltildi (aşağıdaki 3. bölümün
(b) seçeneği uygulandı):

- `announce` yeni cihazı artık bayrağa göre doğurur — bayrak KAPALI → `APPROVED`
  (audit izi `DEVICE_AUTO_APPROVED`), AÇIK → `PENDING`.
- `GET /devices/status` **ve** `POST /devices/announce` cevapları
  `pairingRequired` taşır; onay ekranı kararı sunucudadır.
- Mobil kapı tek yükleme alındı: `mobil/src/navigation/pairingGate.ts`
  (`shouldShowPairingGate`) — sunucunun taşıdığı karar bayat uç bayrağını EZER.
- Bekçiler: `Teks-Erp/scripts/test_device_pairing_flag.ts` (18) +
  `mobil/src/navigation/pairingGate.test.ts` (9).

**Ders (0. bölümün ortak köküne ek):** derlenmiş paket üzerinden yapılan istemci
çıkarımı, **o paketin yaşını** ölçmez. "İstemci şunu yapmıyor" demeden önce
sorulacak soru: *bu cihazda hangi bundle koşuyor?*

---

> **Bu not, kaynak koda erişimi olan oturum içindir.** Bulgular çalışan bir
> kurulumda ölçüldü; ölçen oturumda **yalnız derlenmiş paket vardı**, istemci
> (mobil / Electron) kaynağı yoktu. Backend tarafı ölçüldü ve kesin; istemci
> tarafı **çıkarım**, doğrulaması sizde.
>
> **Repo hedefi önerisi:** `docs/ops/ISTEMCI-BULGULARI-2026-09-04.md`

---

## 0. Ortak kök — iki bulgu da aynı sınıf

**Sunucu izin veriyor, istemci kendi kendini kapatıyor.**

İkisinde de backend doğru davranıyor: kapılar açık, uçlar doğru cevap veriyor.
Ama istemci kararı kendi tarafında, backend'in söylediğine bakmadan veriyor.
Bu yüzden ikisi de sunucu log'una hiçbir hata düşürmüyor — sunucuda arayan
bulamaz.

İkisi de **satıcı hesabının gizliliği söküldükten sonra** ortaya çıktı. Sebep:
o hesap ilk kez gerçekten kullanılmaya başlandı (listelerde görünüyor, giriş
yapılabiliyor, ekranlara giriliyor) ve daha önce hiç yürünmemiş yollar
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

### Çıkarım (istemcide doğrulanmalı)
Tablet ekran kapılarını **tam kod eşleşmesiyle** kuruyor (`mobile:kk1` gibi).
Eline `["*"]` geçiyor, aradığı kodu listede bulamıyor, "yetkin yok" diyor.
Sunucuya hiç sormadan, ya da sorsa bile izin verilen isteği kendi engelleyerek.

### Önerilen düzeltme
**`["*"]` kestirmesini kaldırın.** Hiçbir istemci değişikliği gerekmez:

```ts
static async getEffectivePermissions(userId) {
  // isSystemAccount kestirmesi KALDIRILDI - satirlar zaten eksiksiz yaziliyor
  const now = new Date();
  const grants = await prisma.userPermission.findMany({ ... });
  ...
}
```

Güvenli, çünkü ölçüldü: **86/86**. Satıcı hesabı katalogdaki her izne zaten
sahip, joker gereksiz. Alternatif (iki istemciye birden `"*"` öğretmek) daha
çok iş ve aynı hatayı tekrar üretmeye açık.

### ⚠️ Kaldırırken dikkat — aynı fonksiyonda ikinci bir kapı
`issueToken` içinde masaüstü kapısı var:

```ts
if (isDesktopClient(ctx?.clientType) &&
    !permissions.some(p => !p.startsWith("mobile:")))
  throw AppError.forbidden("Bu hesabın masaüstü paneline erişimi yok.");
```

Bugün bu kapıyı `["*"]` **tesadüfen** geçiyor (`"*"` `mobile:` ile başlamıyor).
Kestirme kalkınca `sysadmin` yine geçer — 86 iznin çoğu `mobile:` değil — ama
bunun tesadüf olduğunu bilerek değiştirin. Testi buraya yazmaya değer.

---

## 3. BULGU B — Cihaz onayı bayrağı kapalıyken tablet yine onay istiyor

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

## 4. Bu notun ölçemedikleri

Dürüstlük payı — aşağıdakiler **doğrulanmadı**, çıkarım:

- Tabletin/Electron'un izin kontrolünü tam kod eşleşmesiyle yaptığı
  (davranıştan çıkarıldı: sunucu izin verirken istemci reddediyor)
- Tabletin onay ekranını hangi koşula bağladığı
- `/api/devices/pairing-required` ucunun istemci tarafından çağrılıp
  çağrılmadığı

Ölçen ortamda istemci kaynağı yoktu. Üçü de sizde tek `grep` ile kesinleşir.

---

## 5. Öneri — bir bekçi yazın

İki bulgu da aynı boşluktan doğdu: **"sunucu izin veriyor mu" ile "istemci
gösteriyor mu" ayrı ayrı doğru, birlikte yanlış.** Tekil düzeltmeler bunu
kapatmaz; üçüncüsü başka bir yüzeyde çıkar.

Somut öneri: satıcı hesabıyla uçtan uca bir akış testi (giriş → tablet ekranı
→ modül anahtarı yazma). Bugün her parça ayrı ayrı yeşil, birleşimi kırmızı ve
bunu hiçbir test görmüyor.
