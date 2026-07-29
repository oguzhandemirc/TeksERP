-- Müşteriye bağlı SERBEST (statik) etiketler — M:N kolaylık bağı
-- (customer ⟺ standalone LabelTemplate). ROTA DEĞİL: rulo/kartela etiket
-- çözümüne (label-routing.resolver / CustomerTemplateRoute) KATILMAZ.
-- Salt-eklemeli: yeni tablo + @@unique + 2 index + 2 FK (ikisi de ON DELETE
-- CASCADE) — mevcut tablolara dokunmaz, canlı kurulumda güvenli.
CREATE TABLE customer_standalone_labels (
  id UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_standalone_labels_pkey PRIMARY KEY (id)
);
ALTER TABLE customer_standalone_labels
  ADD CONSTRAINT "customer_standalone_labels_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES customers (id)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE customer_standalone_labels
  ADD CONSTRAINT "customer_standalone_labels_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES label_templates (id)
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "customer_standalone_labels_customerId_templateId_key"
  ON customer_standalone_labels ("customerId", "templateId");
CREATE INDEX "customer_standalone_labels_templateId_idx"
  ON customer_standalone_labels ("templateId");
CREATE INDEX "customer_standalone_labels_customerId_idx"
  ON customer_standalone_labels ("customerId");
