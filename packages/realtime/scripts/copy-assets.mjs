import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const source = resolve(packageRoot, "src/react-lynx-banners.css");
const destinationDirectory = resolve(packageRoot, "dist");
const destination = resolve(destinationDirectory, "react-lynx-banners.css");

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
