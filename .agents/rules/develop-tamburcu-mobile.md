---
description: "Tamburcu application UI workflow instructions"
globs: "*"
alwaysApply: false
globs: *
alwaysApply: false
---

# Develop Tambur Screen (Mobile-First) Workflow

Tambur ekranı, sahadaki üretim izlenebilirliğinde kritik olan, operatörün elindeki mobil terminal / tablet / ekran üzerinden yapacağı işlemlerdir. Tıklama hedef alanlarının (touch targets) büyük olması elzemdir!

## 1. Tasarım Önceliği (iPad & Mobil)
* Cihaz genelde dikey tablet (iPad) formudur.
* UI bileşenleri dev (kolay dokunulabilir) butonlardan ibaret olmalıdır. (Tailwind class: `h-16 text-xl p-4`).
* Sayfada gereksiz dekorasyonlara, küçük tablolara yer verilmemeli. Kullanıcıya net olarak ne yapması gerektiği söylenmeli. 

## 2. Barkod Okuyucu Odağı
* Barkod okutulduğunda UI otomatik olarak yanıt vermeli (örneğin formu submit etmeden veya input içinde okutup enter sinyali beklemeden yakalama).
* Okuma anında başarılı/başarısız okumayı belirtmek için yeşil bir flaş, toast mesajı veya ses çıkışı gibi sinyaller arayüzde gösterilmeli.

## 3. Kurşun / Tambur İş Mantığı UI Adımları
1. Ekrana İş Emri / Refakat Kartı Okutulur. İş başlar.
2. Ekranda, Kurşun Makinasında yazılan hata/fire miktarları devasa kırmızı kutularda gösterilir. (Business rule: Kurşun -> Tambur ilişkisi).
3. "Kesi" veya "Geç" kararı vermek için `Swipe` (kaydır) veya çok büyük Yes/No butonları konulur.
4. "Kes" denildiğinde (SCRAP) arka planda yeni barkod çıkacağı için UI'ın kilitlenip kullanıcının etiket yazıcısını beklemesi / yazdırma onay basamağını geçirmesi istenir. Ekranda "Etiket Yazdır" ibaresi ön plana çıkar.
