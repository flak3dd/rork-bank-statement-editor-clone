import { describe, expect, it } from "vitest";
import { detectApiAvailability } from "@/lib/api-status";

describe("boot-time API availability", () => {
  it("reports always-on visual metrics as ready", async () => {
    const report = await detectApiAvailability();
    const ids = report.items.map((i) => i.id);
    expect(ids).toContain("ssim");
    expect(ids).toContain("tile-max");
    expect(ids).toContain("phash");
    expect(ids).toContain("pdfium");
    expect(ids).toContain("applitools");

    for (const id of ["ssim", "tile-max", "phash"]) {
      const item = report.items.find((i) => i.id === id)!;
      expect(item.ok).toBe(true);
      expect(item.kind).toBe("local-always");
    }

    const eyes = report.items.find((i) => i.id === "applitools")!;
    expect(eyes.signupUrl).toContain("applitools.com");
    expect(eyes.group).toBe("optional");

    const mindee = report.items.find((i) => i.id === "mindee")!;
    expect(mindee.signupUrl).toBeTruthy();
  });
});
