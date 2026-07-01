-- LabelTemplate: şablon-başına yerleşim ayarları (satır aralığı + QR boyutu).
-- Her ikisi de nullable → boş = mevcut/varsayılan davranış (geriye dönük güvenli).
ALTER TABLE "label_templates" ADD COLUMN "lineStepMm" DECIMAL(4,1);
ALTER TABLE "label_templates" ADD COLUMN "qrScale" INTEGER;
