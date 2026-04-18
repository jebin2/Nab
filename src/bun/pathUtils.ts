import { readdir, stat } from "fs/promises";
import { join, extname } from "path";
import { IMAGE_EXTS } from "./common";

export async function pathExists(p: string): Promise<boolean> {
	try { await stat(p); return true; } catch { return false; }
}

export async function collectImagePaths(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const results = await Promise.all(entries.map(async entry => {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) return collectImagePaths(fullPath);
		if (IMAGE_EXTS.has(extname(entry.name).toLowerCase())) return [fullPath];
		return [];
	}));
	return results.flat();
}

export function sortPathsNumerically(paths: string[]): string[] {
	return paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}