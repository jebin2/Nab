import type { Configuration } from "electron-builder";

export default {
	appId: "nab.app",
	productName: "Nab",
	directories: {
		buildResources: "resources",
		output: "dist",
	},
	files: ["out/**"],
	extraResources: [
		{ from: "resources/app.png",  to: "app.png"  },
		{ from: "resources/app.ico",  to: "app.ico"  },
		{ from: "resources/app.icns", to: "app.icns" },
		{ from: "src/python", to: "python", filter: ["**/*.py"] },
		{ from: "src/main/cli.ts", to: "cli/cli.ts" },
		{ from: "src/main/util.ts", to: "cli/util.ts" },
		// Pinned Bun for CLI export; fetched by scripts/fetch-bun.mjs.
		{ from: "vendor/bun", to: "bun", filter: ["bun", "bun.exe"] },
	],
	linux: {
		icon: "resources/app.png",
		target: [{ target: "AppImage" }],
	},
	mac: {
		icon: "resources/app.icns",
		target: [{ target: "dmg" }],
	},
	win: {
		icon: "resources/app.ico",
		target: [{ target: "portable" }],
	},
} satisfies Configuration;
