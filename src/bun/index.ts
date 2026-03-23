import { BrowserWindow } from "electrobun/bun";

const mainWindow = new BrowserWindow({
	title: "YOLOStudio",
	url: "views://mainview/index.html",
	frame: {
		width:  1280,
		height: 800,
		x:      100,
		y:      80,
	},
});

console.log("YOLOStudio started!");
