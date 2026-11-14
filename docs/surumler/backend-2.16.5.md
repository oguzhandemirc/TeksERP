# Backend `2.16.5`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk ve tek hedef `test` grubu (grubun tek kurulumu `deneme-bulut`,
BARINDIRILAN, Linux, ONAYLI kip — 2.16.3 turunda ölçüldü, 2026-11-14). Öncü/genel gruba çıkış ayrı karar
(terfi etiketi). Kullanıcı onayı (deneme dağıtımı): 2026-11-15.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki ve denemede kurulu sürüm 2.16.4 (etiket `backend-v2.16.4` →
`90963d083`).

Sürüm numarası: YAMA hanesi, otomatik (`node scripts/backend-surum.mjs`).

## 1. Özet

Yaşlanan stok bildiriminin (`stok.yaslanan`) saydığı top kümesi Stok & Ölü Stok raporunun raf kümesiyle hizalandı;
yeni ayar `bildirim.stokYaslanan.kapsam` (varsayılan `raf`). Göç YOK.

## 2. Ne değişti

Ölçüm: `backend-v2.16.4` (`90963d083`) → `origin/main` @ `1058a1b8e`, ilk ebeveyn hattında 1 PR (#728).
Alt proje farkı: `Teks-Erp/src` (koşul kaynağı, yaşlanma ve raf yardımcıları, ayar) · `Electron` (Ayarlar →
Bildirimler satırı; web paneli imajın `/app/dist-web` dizinine girer) · `Teks-Erp/scripts` (bekçi) · belge.
`patron/sunucu`, `patron/uygulama`, `mobil` DEĞİŞMEDİ.

**Yaşlanan stok kapsamı (#728)** — yeni ayar `bildirim.stokYaslanan.kapsam` (Ayarlar → Bildirimler, "Yaşlanan stok:
hangi toplar sayılsın"):
- `raf` (varsayılan): Stok & Ölü Stok raporuyla aynı küme — çuvala girmiş ya da sevkiyata okutulmuş top sayılmaz;
  emanet modülü açıksa müşteri malı da raporda olduğu gibi dışarıda kalır. Raf yüklemi tek yerde
  (`helpers/stock-shelf.helper.ts#shelfRollSql`); rapor ve bildirim aynı parçayı okur, rapor davranışı değişmedi.
- `depodaki-her-top`: 2.16.4'teki küme (çuvaldaki, planlı sevkiyattaki, fasondan dönen ve emanet toplar dahil).
- Bildirim metni kapsamı yazar ("kapsam: raf" / "kapsam: tümü").

**Varsayılan sapması (bilinçli):** 2.16.4'te `stok.yaslanan` fiilen "depodaki her top"u sayıyordu; 2.16.5'in
varsayılanı `raf`. Ayar satırı olmayan kurulumda (deneme dahil) kurulumdan sonraki ilk taramada depo başına adet
KÜÇÜLEBİLİR (çuvaldaki/sevkiyattaki/emanet toplar düşer); bir depoda raf kümesinde yaşlı top kalmazsa o deponun
koşulu "çözüldü" olur. Eski davranış isteniyorsa ayar `depodaki-her-top` yapılır. Tür 2.16.4'te yeni olduğundan
sahada (test grubu dışında) eski davranışa alışmış kurulum yok.

`tekserp-guncelleyici`, `tekserp-hizmet`, `deploy/`, `Teks-Erp/native`, `Teks-Erp/docker`, `Dockerfile`,
`Teks-Erp/prisma` DEĞİŞMEDİ. Yeni bağımlılık yok.

Tam döküm: Ek A.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (`backend-v2.16.4..1058a1b8e`).
  - Uç eklenmedi/kaldırılmadı; ayar listesine bir anahtar eklendi (`bildirim.stokYaslanan.kapsam`).
  - Bildirim yükü ek alan `kapsam` taşır (aynı biçim).
  - Buluta giden tel ve projeksiyonlar değişmedi → "bulut önce" GEREKMEZ (`patron/sunucu` farkı yok).
- **Eski istemci ne yapar:**
  - Masaüstü panel (eski sürüm): yeni ayarı görmez; bildirim varsayılan kapsamla (`raf`) çalışır. Web paneli
    imajla birlikte yenilenir.
  - Tablet ve patron uygulaması: etkilenmez.
  - Patron bulutu: değişmedi.
- **`minVersion` dokunuldu mu:** hayır.
- **Yeni bayraklar:** yok. Tür mevcut `bildirim.gelenKutusuEnabled` / `bildirim.patronPushEnabled` bayraklarının
  arkasında.

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** 518 (2.16.4 ile aynı). Değiştirilen/silinen eski göç yok; veri değiştiren betik/backfill yok.
- **Geri alınabilir mi:** göç yok; 2.16.4 imajı aynı şemayla açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + yeniden başlatma; deneme ölçeğinde bir dakikadan az.
- **Sıra:** backend (web paneli imajla birlikte) → masaüstü panel değişiklikleri bağımsız.
- **Bu sürüme özel:** yayından sonra deneme panelinde "Şimdi yokla" (runbook §16.4 adım 4b). Yeni ayarın varsayılanı
  `raf`; kurulum hiçbir ayar satırı yazmaz. Test grubunda `stok.yaslanan` adetleri küçülebilir (§2 varsayılan sapması).
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış: kapsam Ayarlar → Bildirimler'den `depodaki-her-top` yapılır (2.16.4 kümesi) ya da `stok.yaslanan` Bildirim
profillerinden kapatılır. Sürüm: güncelleyiciyle kurulan sürüm açılmazsa önceki imaja ve güncelleme öncesi yedeğe
kendiliğinden dönülür (`GERI_DONDU`). Göç olmadığından 2.16.4 imajı aynı şemayla açılır; yine de grupta geri inme
yok, düzeltme ileri sürümle. Etiket `backend-v2.16.5` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.16.5; güncelleyici durumu `BASARILI`.
- Veritabanı: 518 migration bitmiş, yarım/geri alınmış 0.
- `GET /api/client-policy/patron` 200.
- Ayar uçlarında `bildirim.stokYaslanan.kapsam` varsayılan `raf`.
- Kurulum sırasında/sonrasında `notification_conditions`ta yeni `sistem.lisans-uyarisi` kaydı yok.
- Konteyner günlüğünde `bildirim-ozet` / koşul tarayıcısı hatası yok.
- Web panelinde Ayarlar → Bildirimler'de "Yaşlanan stok: hangi toplar sayılsın" satırı görünür.
- Patron bulutu eşitlemesi kurulumdan sonra 200 sürüyor.

## Ek A — commit dökümü (ilk ebeveyn, eskiden yeniye, 1)

- `1dbb50da6` #728 feat(bildirim): align stok.yaslanan roll scope with stock report shelf set

## Ek B — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel turunda `surum-notlari.json`a girer. Metin terfide
kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-15a",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Yaşlanan stok bildirimi raporla aynı topları sayar",
  "maddeler": [
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Depoda uzun bekleyen stok bildirimi artık Stok & Ölü Stok raporundaki raf toplarını sayar; çuvaldaki ve sevkiyattaki toplar dahil edilmez. Depodaki her topun sayılmasını isterseniz Ayarlar → Bildirimler'den seçebilirsiniz." }
  ]
}
```
