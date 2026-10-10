import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductThumb } from "./product-thumb";

describe("ProductThumb never shows a broken-image icon", () => {
  it("shows a labelled placeholder when there is no photo", () => {
    render(<ProductThumb url={null} name="Cotton Shirt" />);
    expect(screen.getByRole("img", { name: "No photo for Cotton Shirt" })).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
  it("shows the photo, lazy-loaded, with fixed dimensions so the layout does not jump", () => {
    render(<ProductThumb url="https://example.test/a.png?token=1" name="Cotton Shirt" size={64} />);
    const img = document.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://example.test/a.png?token=1");
    expect(img.getAttribute("alt")).toBe("Cotton Shirt");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["64", "64"]);
  });
  it("falls back to the placeholder if the image fails to load (expired link, deleted file)", () => {
    render(<ProductThumb url="https://example.test/gone.png" name="Cotton Shirt" />);
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "No photo for Cotton Shirt" })).toBeTruthy();
  });
  it("a NEW url (a replaced photo) is tried again after an earlier failure", () => {
    const { rerender } = render(<ProductThumb url="https://example.test/old.png" name="X" />);
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();
    rerender(<ProductThumb url="https://example.test/new.png" name="X" />);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://example.test/new.png");
  });
});
