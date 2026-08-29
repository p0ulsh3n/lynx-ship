import type { CliGuidance, GuidanceContext } from "./guidance/types.js";
import { guidance } from "./guidance/catalog.js";

export type { CliGuidance, GuidanceContext } from "./guidance/types.js";

function guidanceForErrorBase(error: unknown): CliGuidance {
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && guidance[code]) return guidance[code];

  if (typeof code === "string") {
    if (code.startsWith("SUBMISSION_") || code.startsWith("AUTH_")) {
      return {
        commands: [
          "lynxship store configure --platform android",
          "lynxship submit --platform android --latest",
        ],
        note: "Check the provider credentials and required account permissions.",
      };
    }
    if (code.startsWith("OTA_")) {
      return {
        commands: [
          "lynxship ota doctor --platform android",
          "lynxship update --platform android --bundle dist/main.lynx.bundle",
        ],
      };
    }
    if (code.startsWith("CONFIG_")) {
      return {
        commands: ["lynxship init", "lynxship doctor"],
      };
    }
    if (code.startsWith("BUILD_")) {
      return {
        commands: [
          "lynxship doctor --platform android",
          "lynxship build --platform android --profile production",
        ],
        note: "Inspect the first failed build event before retrying.",
      };
    }
    if (code.startsWith("STORE_")) {
      return {
        commands: [
          "lynxship store configure --platform android",
          "lynxship submit --platform android --latest",
        ],
      };
    }
    if (code.startsWith("IOS_")) {
      return {
        commands: [
          "lynxship doctor --platform ios",
          "lynxship build --platform ios --profile production",
        ],
      };
    }
    if (code.startsWith("ANDROID_")) {
      return {
        commands: [
          "lynxship doctor --platform android",
          "lynxship build --platform android --profile production",
        ],
      };
    }
    if (code.startsWith("CLI_")) {
      return { commands: ["lynxship --help"] };
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/pnpm|npm|yarn|corepack|not recognized|not found/i.test(message)) {
    return {
      commands: ["corepack enable", "pnpm install", "lynxship doctor"],
      note: "Use the package manager selected by the project's lockfile.",
    };
  }
  if (/ENOENT|no such file or directory/i.test(message)) {
    return {
      commands: ["lynxship init", "lynxship doctor"],
      note: "Check that the project directory and required configuration files exist.",
    };
  }
  if (/gradle|gradlew|android sdk|build tools/i.test(message)) {
    return {
      commands: [
        "lynxship doctor --platform android",
        "lynxship build --platform android --profile production",
      ],
      note: "Check JDK 17, Android SDK, Build Tools and the project Gradle wrapper.",
    };
  }
  if (/xcode|xcrun|cocoapods|pod install/i.test(message)) {
    return {
      commands: [
        "cd ios && pod install --repo-update",
        "lynxship doctor --platform ios --profile simulator",
        "lynxship build --platform ios --simulator --profile simulator --no-upload",
      ],
      note: "Check macOS, Xcode command-line tools and CocoaPods. For a first install, refresh the CocoaPods specs repository.",
    };
  }
  return { commands: [] };
}

type TargetPlatform = "android" | "ios" | "harmony" | "web" | "desktop" | "all";

function argumentValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const inline = args.find((value) => value.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

function targetFromCode(code: string | undefined): TargetPlatform | undefined {
  if (!code) return undefined;
  if (code.startsWith("ANDROID_")) return "android";
  if (code.startsWith("IOS_")) return "ios";
  if (code.startsWith("HARMONY_")) return "harmony";
  if (code.startsWith("WEB_")) return "web";
  if (code.startsWith("DESKTOP_")) return "desktop";
  if (code === "BUILD_ALL_MACOS_REQUIRED") return "all";
  return undefined;
}

function targetFromCommand(command: string): TargetPlatform | undefined {
  const match = command.match(
    /--platform\s+(android|ios|harmony|web|desktop|all)/,
  );
  return match?.[1] as TargetPlatform | undefined;
}

function targetCommand(
  platform: TargetPlatform,
  simulator: boolean,
  action: "doctor" | "build",
): string {
  if (platform === "all")
    return action === "doctor"
      ? "lynxship doctor --platform android"
      : "lynxship build --platform all --profile production";
  if (platform === "ios" && simulator) {
    return action === "doctor"
      ? "lynxship doctor --platform ios --profile simulator"
      : "lynxship build --platform ios --simulator --profile simulator --no-upload";
  }
  if (action === "doctor") return `lynxship doctor --platform ${platform}`;
  return `lynxship build --platform ${platform} --profile production`;
}

function adaptGuidance(
  guidance: CliGuidance,
  error: unknown,
  context: GuidanceContext,
): CliGuidance {
  const code = (error as { code?: unknown }).code;
  const errorCode = typeof code === "string" ? code : undefined;
  const args = context.args ?? [];
  const requested = argumentValue(args, "--platform") as
    | TargetPlatform
    | undefined;
  const target = requested ?? targetFromCode(errorCode);
  const simulator = args.includes("--simulator");
  let commands = guidance.commands;

  // Generic errors must preserve the platform the developer actually asked
  // for. The old fallback to Android was misleading for iOS/Web/Desktop jobs.
  if (
    target &&
    errorCode !== "BUILD_ALL_MACOS_REQUIRED" &&
    ["BUILD_", "PROFILE_NOT_FOUND"].some((prefix) =>
      errorCode?.startsWith(prefix),
    )
  ) {
    commands = [
      targetCommand(target, target === "ios" && simulator, "doctor"),
      targetCommand(target, target === "ios" && simulator, "build"),
    ];
  }

  const hostPlatform = context.hostPlatform ?? process.platform;
  const macOnly = hostPlatform !== "darwin";
  let requiredEnvironment: string | undefined;
  commands = commands.map((command) => {
    const commandTarget = targetFromCommand(command);
    const isIosCommand =
      commandTarget === "ios" ||
      command.includes("ios host") ||
      command.startsWith("xcode-select") ||
      command.startsWith("xcrun ") ||
      command.startsWith("brew ");
    const isAllCommand = commandTarget === "all";
    if (macOnly && isIosCommand) {
      requiredEnvironment = "macOS or a macOS CI runner";
      return command;
    }
    if (macOnly && isAllCommand) {
      requiredEnvironment = "macOS or a macOS CI runner";
      return command;
    }
    return command;
  });

  const notes = guidance.note ? [guidance.note] : [];
  if (requiredEnvironment)
    notes.push(
      "These commands must be run on macOS or a macOS CI runner; Android remains supported on Windows, macOS and Linux.",
    );
  return {
    commands,
    note: notes.length > 0 ? notes.join(" ") : undefined,
    environment: requiredEnvironment,
  };
}

export function guidanceForError(
  error: unknown,
  context: GuidanceContext = {},
): CliGuidance {
  return adaptGuidance(guidanceForErrorBase(error), error, context);
}
