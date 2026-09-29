// Vitest ortak kurulum — jest-dom eşleyicileri + her testten sonra DOM temizliği.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
