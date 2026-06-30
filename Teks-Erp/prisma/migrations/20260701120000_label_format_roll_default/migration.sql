-- LabelFormatProfile: TOP (rulo) etiketleri için sistem-varsayılan boyut bayrağı.
-- Partial unique → aynı anda en fazla bir profil isRollDefault=true olabilir.
ALTER TABLE "label_format_profiles" ADD COLUMN "isRollDefault" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "label_format_profiles_roll_default_key"
  ON "label_format_profiles" ("isRollDefault")
  WHERE "isRollDefault" = true;
