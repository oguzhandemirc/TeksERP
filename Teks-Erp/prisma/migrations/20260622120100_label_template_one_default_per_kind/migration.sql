-- label_templates: "her LabelKind içinde en fazla 1 isDefault=true" invariant'ını
-- DB seddiyle zorla. Önceden yalnız servis-içi clear-then-set vardı; eşzamanlı iki
-- setDefault/create/update (aynı kind) write-skew ile İKİ default bırakabiliyordu.
--
-- Partial unique: kind başına yalnız bir satır isDefault=true olabilir. Eşzamanlı
-- ikinci setter P2002 alır → servis 409'a çevirir (rethrowDefaultConflict). Yalnız
-- migration'da yaşar (şemada partial-unique temsil edilemez; repo'nun manuel-migration
-- disiplini gereği migrate dev çalıştırılmaz → drop edilmez).
CREATE UNIQUE INDEX "label_templates_one_default_per_kind" ON "label_templates" ("kind") WHERE "isDefault" = true;
