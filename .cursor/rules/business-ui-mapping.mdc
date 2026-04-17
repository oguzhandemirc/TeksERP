---
description: "Mapping backend rules (business-rules.md) to Frontend UI state mechanics"
globs: "*"
alwaysApply: true
globs: *
alwaysApply: false
---

# Business UI Mapping

Bu belge, TeksERP backend'inin zorunlu iş kurallarının ekranda (UI'da) nasıl canlanacağını, hangi butonların hangi durum değişimlerine (State Machines) yol açacağını belirler.

## 1. İş Emri ve Rotasyon Hissi
* Frontend'de bir sipariş listelenirken doğrudan "Yola Çık" veya "Başla" diye basit işlemler yoktur.
* backend'in beklediği rota listesini UI bir **Stepper** (Adım adım ilerleme zinciri) şeklinde görselleştirir (Örn: Sipariş -> Fason -> Kurşun -> Tambur -> Sevkiyat). 
* Rota değiştiğinde kullanıcı anında görsel olarak bu istasyon aracı üzerinde ilerlediğini hissetmelidir.

## 2. Fason (Subcontracting) Operasyonu Input Modal
* Backend kuralında "Yeni Metraj / Kilo" girilmesi Fire sebebiyle zorunludur.
* Bu yüzden `Fasondan Döndü` (Return from Subcontractor) butonuna basılır basılmaz. UI aniden bir Modal (Dialog) pencerisini ekrana pop-up olarak fırlatmak **zorundadır**. 
* Modal, "Lütfen boyama/fason sonrası güncel Kg veya Metrajı girin" demeden kapatılamaz bir `required` input form sunar.

## 3. Sevkiyat Esnekliği ve Tamamlanma Anı
* UI, `Sevkiyat` sayfasındayken İş Emirlerini göstermez! Sadece "Hazır olan sipariş paketlerini/stokları (Ready for Shipment)" gösterir.
* Sevk işlemi onaylandığı an atılan API sonrası `quantity` ve `shippedQty` eşitlendiyse ekranda sipariş yeşile boyanır ve "COMPLETED" damgası (Badge) UI üzerinde basılır (Tıpkı bir kaşe efekti gibi).

## 4. Tambur ve Yeni Roll (Parça) Ayrıştırma
* Kurşun'da tespit edilen hatalar listelenir (Modal içinde veya liste olarak ekranın solunda).
* Tamburda hata "Kes" dediğinde UI, `Split Roll` API çağırdıktan sonra yeni eklenen "Scrap/A1" listesini tabloda veya ekranda **yeni bir barkodla birlikte bir satır/kutu (Card)** olarak türeterek gösterir, bütünden kopuş hissini verir.
