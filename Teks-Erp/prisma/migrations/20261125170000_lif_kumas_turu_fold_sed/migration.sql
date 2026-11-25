-- K7/K8 katalog ad seddi: `assertNameNotDuplicate` (duplicateNameField) kilitsiz check-then-act'tir;
-- yarışı kapatan tek şey katlanmış ad üzerindeki UNIQUE'tir (test_master_data_name_dup §10).
CREATE UNIQUE INDEX "fabric_types_nameFold_key" ON "fabric_types"("nameFold");
CREATE UNIQUE INDEX "fiber_types_nameFold_key" ON "fiber_types"("nameFold");
