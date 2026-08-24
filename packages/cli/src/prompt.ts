import { createInterface } from "node:readline/promises";
import { c } from "./ui/state.js";

export async function prompt(
  label: string,
  defaultValue?: string,
): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const value = await readline.question(`${c.brand(label)}${suffix}: `);
    return value.trim() || defaultValue || "";
  } finally {
    readline.close();
  }
}

export async function secret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode)
    throw new Error(
      "Secret input requires an interactive terminal; use environment variables in CI",
    );

  process.stdout.write(`${c.brand(label)}: `);
  const input = process.stdin;
  const previousEncoding = input.readableEncoding;
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.setRawMode?.(false);
      input.pause();
      input.removeListener("data", onData);
      if (previousEncoding) input.setEncoding(previousEncoding);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Input cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };
    input.on("data", onData);
  });
}
