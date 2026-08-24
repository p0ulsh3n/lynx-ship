import { homedir } from "node:os";
import { join } from "node:path";

export function globalLynxShipDirectory(): string {
  if (process.env.LYNXSHIP_CONFIG_DIR) return process.env.LYNXSHIP_CONFIG_DIR;

  const home = homedir();
  if (process.platform === "win32")
    return join(
      process.env.APPDATA ?? join(home, "AppData", "Roaming"),
      "LynxShip",
    );
  if (process.platform === "darwin")
    return join(home, "Library", "Application Support", "LynxShip");
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "lynxship");
}
