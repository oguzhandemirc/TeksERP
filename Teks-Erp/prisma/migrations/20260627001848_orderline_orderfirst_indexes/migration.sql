-- OrderLine: "sipariş-önce" aramalı liste (cursor keyset createdAt asc) +
-- ürün-filtreli sayfalama için index'ler. Büyük tabloda kilit süresini aşmamak
-- için statement_timeout sıfırlanır (CLAUDE.md §DB perf rule 14 tuzağı).
SET statement_timeout = 0;
CREATE INDEX "order_lines_createdAt_idx" ON "order_lines"("createdAt");
CREATE INDEX "order_lines_itemId_createdAt_idx" ON "order_lines"("itemId", "createdAt");
