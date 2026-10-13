import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { PANEL_RESTORE_FLAGS } from "./service";

// Tek kaynak: panelin geri yükleme bayrakları runbook ve kur.ps1 ipucuyla BİREBİR (alt dizge değil).
describe("PANEL_RESTORE_FLAGS", () => {
  it("runbook ve kur.ps1 ipucu panelle AYNI bayrak dizisini taşır", () => {
    // vitest Electron/ içinden koşar (jsdom'da import.meta.url file: değil).
    const runbook = readFileSync(resolve(process.cwd(), "../docs/ops/DEPLOY-RUNBOOK.md"), "utf8");
    const kur = readFileSync(resolve(process.cwd(), "../deploy/kur.ps1"), "utf8");
    const satirlar = [...runbook.split("\n"), ...kur.split("\n")].filter((l) => /pg_restore -h .*--clean/.test(l));
    expect(satirlar.length).toBeGreaterThanOrEqual(2);
    for (const l of satirlar) expect(l.match(/--clean(?: --[a-z-]+)*/)?.[0]).toBe(PANEL_RESTORE_FLAGS);
  });

  it("--no-acl var, --no-owner yok", () => {
    expect(PANEL_RESTORE_FLAGS.split(" ")).toContain("--no-acl");
    expect(PANEL_RESTORE_FLAGS.split(" ")).not.toContain("--no-owner");
  });
});
