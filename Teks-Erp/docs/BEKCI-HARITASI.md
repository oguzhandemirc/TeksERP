# Bekçi haritası — DİZİN (alan → dosya)

> **Harita alan başına bölündü (2026-11-03):** satırlar `Teks-Erp/docs/bekci-harita/<alan>.md` dosyalarında; bu dosya yalnız dizindir (≤ 10 KB) — bütün haritayı okuma, alanın dosyasını aç. Bölmeden önceki tek dosya (1,6 MB) git geçmişinde; bölmede `(bu commit)` işaretli ✓B hücreleri o anki blame sha'sıyla yazıldı.
>
> - **Elle bakımlı** — üretici betik YOK. Yeni bekçi satırı YALNIZ kendi alan dosyasına eklenir (çakışma kuralı); yeni alan = yeni dosya + bu dizine `## <alan>` başlığı ve bağlantısı (`test_identity_ledger` dizin ↔ dosya tazeliğini ölçer).
> - **Erişim:** `grep -rn "<servis/konu>" Teks-Erp/docs/bekci-harita/` ya da `Teks-Erp/docs/bekci-harita/<alan>.md`. Büyük dosyalar (lisans · diger · surum-deploy · dokuma · patron-bulutu) de bütün okunmaz — grep ile girilir.
> - **Koşma:** backend tek bekçi `cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>`; tam paket CI'da. Electron `cd Electron && npx vitest run <yol>`; mobil `cd mobil && npx jest <yol>`. Port bekçileri: `bekci-harita/bilerek-kirmizi.md` § Nasıl koşulur.
> - **Satır biçimi:** `| Dosya | Ne ölçüyor | DB | Negatif sonda | |`. "Negatif sonda" hücresi SINIF + SAYI taşır: `✓K<n>` kalıcı sonda · `✓B<n>` bir kezlik + sha ya da `(bu commit)` (sha blame'den türer) — `test_harita_sonda_atfi` ölçer. ⚠️ = bayatlık şüphesi.
> - **Özet satırı zorunlu:** bekçi `=== Sonuç: N geçti, M başarısız ===` basmadan çıkış 0 verirse koşucu KIRMIZI sayar; büyük çıktılı bekçi `process.exitCode` ile biter.
> - **Sayı YAZILMAZ** — güncel dağılım: `grep -c "^| .Teks-Erp/scripts/" Teks-Erp/docs/bekci-harita/*.md`.

## bilerek-kirmizi — (bekçi × VERİ) listesi

[bekci-harita/bilerek-kirmizi.md](bekci-harita/bilerek-kirmizi.md)

## yetki-izin

[bekci-harita/yetki-izin.md](bekci-harita/yetki-izin.md)

## is-emri

[bekci-harita/is-emri.md](bekci-harita/is-emri.md)

## ui-bilesen

[bekci-harita/ui-bilesen.md](bekci-harita/ui-bilesen.md)

## fason

[bekci-harita/fason.md](bekci-harita/fason.md)

## diger

[bekci-harita/diger.md](bekci-harita/diger.md)

## sevkiyat

[bekci-harita/sevkiyat.md](bekci-harita/sevkiyat.md)

## etiket

[bekci-harita/etiket.md](bekci-harita/etiket.md)

## finans

[bekci-harita/finans.md](bekci-harita/finans.md)

## siparis

[bekci-harita/siparis.md](bekci-harita/siparis.md)

## modul-bayrak

[bekci-harita/modul-bayrak.md](bekci-harita/modul-bayrak.md)

## belge

[bekci-harita/belge.md](bekci-harita/belge.md)

## ayar

[bekci-harita/ayar.md](bekci-harita/ayar.md)

## cuval

[bekci-harita/cuval.md](bekci-harita/cuval.md)

## rapor

[bekci-harita/rapor.md](bekci-harita/rapor.md)

## kesif-cihaz

[bekci-harita/kesif-cihaz.md](bekci-harita/kesif-cihaz.md)

## tambur

[bekci-harita/tambur.md](bekci-harita/tambur.md)

## depo

[bekci-harita/depo.md](bekci-harita/depo.md)

## parti

[bekci-harita/parti.md](bekci-harita/parti.md)

## renk

[bekci-harita/renk.md](bekci-harita/renk.md)

## db-invariant

[bekci-harita/db-invariant.md](bekci-harita/db-invariant.md)

## iptal-fire

[bekci-harita/iptal-fire.md](bekci-harita/iptal-fire.md)

## refakat-karti

[bekci-harita/refakat-karti.md](bekci-harita/refakat-karti.md)

## audit

[bekci-harita/audit.md](bekci-harita/audit.md)

## tutarlilik

[bekci-harita/tutarlilik.md](bekci-harita/tutarlilik.md)

## top-duzeltme

[bekci-harita/top-duzeltme.md](bekci-harita/top-duzeltme.md)

## kk1

[bekci-harita/kk1.md](bekci-harita/kk1.md)

## mukerrer

[bekci-harita/mukerrer.md](bekci-harita/mukerrer.md)

## kursun

[bekci-harita/kursun.md](bekci-harita/kursun.md)

## kalite

[bekci-harita/kalite.md](bekci-harita/kalite.md)

## surum-deploy

[bekci-harita/surum-deploy.md](bekci-harita/surum-deploy.md)

## rota

[bekci-harita/rota.md](bekci-harita/rota.md)

## offline-kuyruk

[bekci-harita/offline-kuyruk.md](bekci-harita/offline-kuyruk.md)

## superadmin

[bekci-harita/superadmin.md](bekci-harita/superadmin.md)

## ozellik

[bekci-harita/ozellik.md](bekci-harita/ozellik.md)

## kartela

[bekci-harita/kartela.md](bekci-harita/kartela.md)

## sebep-katalogu

[bekci-harita/sebep-katalogu.md](bekci-harita/sebep-katalogu.md)

## iplik

[bekci-harita/iplik.md](bekci-harita/iplik.md)

## uzak-erisim

[bekci-harita/uzak-erisim.md](bekci-harita/uzak-erisim.md)

## yari-mamul

[bekci-harita/yari-mamul.md](bekci-harita/yari-mamul.md)

## dokuma

[bekci-harita/dokuma.md](bekci-harita/dokuma.md)

## urun-yasam-dongusu

[bekci-harita/urun-yasam-dongusu.md](bekci-harita/urun-yasam-dongusu.md)

## lisans

[bekci-harita/lisans.md](bekci-harita/lisans.md)

## patron-bulutu

[bekci-harita/patron-bulutu.md](bekci-harita/patron-bulutu.md)

## bildirim

[bekci-harita/bildirim.md](bekci-harita/bildirim.md)

## maliyet

[bekci-harita/maliyet.md](bekci-harita/maliyet.md)
