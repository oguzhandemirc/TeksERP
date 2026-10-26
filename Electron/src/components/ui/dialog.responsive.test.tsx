import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

/** UX-3: telefonda (<640 px) her diyalog/seçici tam ekran; geniş ekranda çağıranın boyutu geçer. */
describe("DialogContent — dar ekranda tam ekran", () => {
  it("max-sm tam-ekran sınıfları çağıranın geniş ekran sınıflarıyla birlikte durur", () => {
    render(
      <Dialog open>
        <DialogContent className="max-w-3xl">
          <DialogTitle>Seçici</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const el = document.querySelector("[data-ui-dialog]") as HTMLElement;
    for (const c of ["max-w-3xl", "max-sm:inset-0", "max-sm:h-full", "max-sm:max-h-full", "max-sm:max-w-none", "max-sm:translate-x-0"]) {
      expect(el.className.split(/\s+/)).toContain(c);
    }
  });
});
