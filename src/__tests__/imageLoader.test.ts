import { describe, it, expect } from "vitest";
import { pathsToImageEntries } from "../mainview/lib/imageLoader";

describe("pathsToImageEntries", () => {
  it("creates one entry per image path", () => {
    const result = pathsToImageEntries(["/a/photo.jpg", "/b/image.png"]);
    expect(result).toHaveLength(2);
  });

  it("assigns a unique id to each entry", () => {
    const result = pathsToImageEntries(["/a/photo.jpg", "/b/image.png"]);
    expect(result[0].id).toBeDefined();
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("sets filePath correctly", () => {
    const result = pathsToImageEntries(["/test/photo.jpg"]);
    expect(result[0].filePath).toBe("/test/photo.jpg");
  });

  it("sets filename to the basename", () => {
    const result = pathsToImageEntries(["/home/user/images/photo.jpg"]);
    expect(result[0].filename).toBe("photo.jpg");
  });

  it("initializes empty annotations array", () => {
    const result = pathsToImageEntries(["/test/photo.jpg"]);
    expect(result[0].annotations).toEqual([]);
  });

  it("accepts all supported image extensions", () => {
    const paths = ["a.jpg", "b.jpeg", "c.png", "d.webp", "e.bmp", "f.gif", "g.tiff", "h.tif"];
    expect(pathsToImageEntries(paths)).toHaveLength(8);
  });

  it("is case-insensitive for extensions", () => {
    const result = pathsToImageEntries(["/test/photo.JPG", "/test/image.PNG"]);
    expect(result).toHaveLength(2);
  });

  it("filters out non-image files", () => {
    const paths = ["/test/image.jpg", "/test/doc.txt", "/test/script.py", "/test/data.json"];
    const result = pathsToImageEntries(paths);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("image.jpg");
  });

  it("returns empty array when no images in input", () => {
    expect(pathsToImageEntries(["/test/doc.txt", "/test/data.csv"])).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(pathsToImageEntries([])).toHaveLength(0);
  });
});
