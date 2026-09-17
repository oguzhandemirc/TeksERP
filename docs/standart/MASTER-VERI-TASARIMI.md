# Master Veri Tasarımı — beş kapı

Bu dosya **yeni bir master veri (ana veri) modeli** tasarlarken sorulacak beş sorudur: firma, kişi,
ürün, depo, istasyon gibi "gerçek dünyada bir NESNEYE karşılık gelen" tablolar. Hareket/defter
tabloları buraya girmez (onlar `docs/kurallar/defter.md`).

Doğuş: fason firmaları `Customer`dan AYRI bir tabloda tanımlandı; aynı firma iki kimlik taşıdı, iki
cari hesabı olabildi ve düzeltmesi üç dilimlik bir faz oldu (ölçüm ve göç:
[`docs/design/IS-ORTAGI-ROL-MODELI.md`](../design/IS-ORTAGI-ROL-MODELI.md)). Kullanıcı kuralı
(2026-09-17): *"master veri sektör standardında olmalı; ilk fason tablosunda düşünemedik, geriye
dönüp böyle problem yaşamayalım."*

⚠️ Bu dosya bir KONTROL LİSTESİDİR, bir kapı değil: beş sorunun cevabı tasarım kararıdır ve
belge onu ZORLAYAMAZ. Zorlayan tek şey her satırdaki `zorlama:` alanıdır.

- **[MV-01]** KİMLİK ile ROLÜ ayır: aynı gerçek nesne ileride başka bir rol de alabiliyorsa rol bir
  BAYRAK (ya da role bağlı profil tablosu) olur, ayrı bir kimlik tablosu DEĞİL; tek seçimli tür
  enum'u ancak "bir nesne aynı anda ikisi OLAMAZ" ölçüldükten sonra yazılır. · zorlama: `insan:tasarım kararı — AST'den "bu nesne ileride iki rol alır mı" sorulamaz` + `bekçi:test_master_data_kimlik_tekilligi §3 — master modeldeki her tek-seçimli TÜR ekseni (`type`/`kind`/`*Type`/`*Kind` enum alanı) BEYANLI olmak zorunda; beyan, "bu nesne aynı anda ikisi OLAMAZ" cümlesinin ölçüldüğü iddiasıdır. İki yönlü: ölü beyan da kırmızı. Bu çapa satırı silinirse kol ÖLÇÜLEMEDİ olur (beyanların dayanağı okunamaz)` · kanıt: fason vakası — aynı firma `Customer` + `Subcontractor` olarak iki kimlik taşıdı; düzeltme `IS-ORTAGI-ROL-MODELI.md` §2 (üç rol bayrağı, `type` türetilmiş)
- **[MV-02]** FİNANS KİMLİĞİ TEKTİR: para yüzeyi (cari hesap, bakiye, ekstre) tek bir kimliğe bağlanır;
  bir hesabı iki ayrı tabloya XOR ile bağlamak yasaktır. · zorlama: `insan:şema kararı; XOR CHECK'in VARLIĞI kuralı ihlal etmez, ihlali GÖRÜNÜR kılar` + `bekçi:test_master_data_kimlik_tekilligi §2 — iki master tablo arasındaki 1:1 KİMLİK BAĞI (opsiyonel + @unique FK) ve o bağın iki ucuna birden FK taşıyan her ALAN ÇİFTİ beyanlı; her beyan bir SINIF iddiasıdır (borç ↔ iki-rol). Ad eşleyen `_xor` taraması bunu ayırt EDEMEZ (kasa↔banka aynı nesne olamaz), "iki master FK ile bağlanabiliyor mu" ölçütü ise 10/10 sahte pozitif verdi — HİYERARŞİ de bir FK'dır` · kanıt: `CariAccount` `customerId` XOR `subcontractorId` iki CHECK'le korunuyordu ve aynı firmanın borcu iki satırda görünebiliyordu (`IS-ORTAGI-ROL-MODELI.md` §1) — göç hesapları karta topluyor, §2.2 yeni hesabın da tek yazardan geçmesini şart koşuyor
- **[MV-03]** OPERASYON VERİSİ role bağlı PROFİLE bağlanır, kimliğe değil: profil tablosu kalır ve
  kimliği DEĞİŞMEZ — geçmiş kayıtların bağı yeniden yazılmaz. · zorlama: `insan:tasarım kararı` · kanıt: `Subcontractor` 12 operasyon ilişkisi taşıyor (sevk · kabul · levent · dokuma · kartela); rol modeli tabloyu ERİTMEDİ, profil yaptı — 398 sevk / 329 kabul satırı dokunulmadan kaldı (`IS-ORTAGI-ROL-MODELI.md` §7.3)
- **[MV-04]** KOD ve AD tekilliği TABLOLAR ARASI sorulur: aynı gerçek nesneyi iki tabloda tutan bir
  tasarımda tekillik tek tablo içinde ölçülür ve çakışma GÖRÜLMEZ; kod üretimi de tek yerden yapılır. · zorlama: `bekçi:test_master_data_kimlik_tekilligi §1 — `customers.nameFold` ↔ `subcontractors.nameFold` ve aynı vergi numarası, BAĞSIZ çiftlerde 0 (bağlı çift ve tombstone beyanlı muaf); DB gerektirir, hedefin ADI basılır — fixture'da yeşil olmak "saha temiz" DEMEZ` · kanıt: master-data birleştirme yalnız AYNI tablo içinde çalışıyor (delegate tek model) — cari ↔ fason ad çakışması hiçbir kapıdan geçmiyordu; göç script'i bu yüzden `nameFold` çakışmasında OTOMATİK BAĞLAMAZ, öneri satırı yazar (`test_migrate_partner_roles §4/§7`)
- **[MV-05]** GERİYE DÖNÜKLÜK CÜMLESİ yazılmadan master veri şeması değişmez: "eski istemci ne yapar"
  ve "türetilmiş alan ne zaman kalkar" — ikincisi ÖLÇÜLEBİLİR bir koşulla. · zorlama: `insan:cümle metindir; ölçülebilirliğini kapı değil inceleyen görür` · kanıt: `Customer.type` türetilmiş alan olarak KALDI (eski istemci okumaya devam ediyor); kalkma koşulu dört yeşil ölçümdür ve dördüncüsü ölçülemiyorsa faz açılmaz (`IS-ORTAGI-ROL-MODELI.md` §7.1)

## Kapıların sırası

Sıra önemlidir: MV-01 yanlışsa ötekiler de yanlış kurulur. Fason vakasında MV-01 kaçırıldı; MV-02
(XOR'lu hesap) ve MV-04 (çapraz tekillik) onun SONUCUYDU, bağımsız hatalar değil.
