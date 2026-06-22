-- sacks.manualCode: AMB%05d oto-üretilen MÜŞTERİ çuval kodu için PARTIAL UNIQUE.
--
-- Sorun: eşzamanlı iki addSack GLOBAL max+1 okuyup aynı AMB kodunu üretebiliyordu.
-- manualCode UNIQUE DEĞİLDİ → P2002 hiç oluşmuyor, addSack'i saran withBarcodeRetry
-- bu kod için ölüydü; çift kod sessizce donmuş irsaliyeye gidiyordu.
--
-- Çözüm: yalnız oto-üretim desenine (^AMB[0-9]{5}$) kapsanan PARTIAL UNIQUE index.
-- Operatörün girdiği serbest kodlar (kasıtlı non-unique) KAPSAM DIŞI kalır. Artık
-- çift AMB → P2002 → withBarcodeRetry taze max okuyup sıradaki numarayı alır.
--
-- Drift-free pattern (CLAUDE.md §9.4): şemada @@index([manualCode]) KALIR; bu aynı
-- adlı indexi UNIQUE + PARTIAL'a çevirir (Prisma 7 partial predicate'i drift saymaz).
-- Tablo küçük → statement_timeout riski yok.
DROP INDEX IF EXISTS "sacks_manualCode_idx";
CREATE UNIQUE INDEX "sacks_manualCode_idx" ON "sacks" ("manualCode") WHERE "manualCode" ~ '^AMB[0-9]{5}$';
