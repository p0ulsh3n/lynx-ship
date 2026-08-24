import { sha256 } from "@lynxship/contracts";

export interface TextAsset {
  data?: string;
}

export type Delta =
  | { type: "none"; baseHash: string; resultHash: string; size: number }
  | {
      type: "full";
      baseHash: string;
      resultHash: string;
      size: number;
      data: string;
    }
  | {
      type: "delta";
      baseHash: string;
      resultHash: string;
      offset: number;
      remove: number;
      data: string;
      size: number;
    };

export function createDelta(
  base: TextAsset,
  next: TextAsset,
  options: { maxPatchRatio?: number } = {},
): Delta {
  const oldText = Buffer.from(base.data ?? "");
  const newText = Buffer.from(next.data ?? "");
  const baseHash = sha256(oldText);
  const resultHash = sha256(newText);
  if (baseHash === resultHash)
    return { type: "none", baseHash, resultHash, size: 0 };
  let prefix = 0;
  while (
    prefix < oldText.length &&
    prefix < newText.length &&
    oldText[prefix] === newText[prefix]
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - 1 - suffix] ===
      newText[newText.length - 1 - suffix]
  )
    suffix += 1;
  const patch = newText.subarray(prefix, newText.length - suffix);
  const ratio = newText.length ? patch.length / newText.length : 0;
  if (ratio > (options.maxPatchRatio ?? 0.7))
    return {
      type: "full",
      baseHash,
      resultHash,
      size: newText.length,
      data: newText.toString(),
    };
  return {
    type: "delta",
    baseHash,
    resultHash,
    offset: prefix,
    remove: oldText.length - prefix - suffix,
    data: patch.toString(),
    size: patch.length,
  };
}

export function applyDelta(base: TextAsset, delta: Delta): string {
  if (delta.type !== "delta")
    return delta.type === "none" ? (base.data ?? "") : delta.data;
  const input = Buffer.from(base.data ?? "");
  return `${input.subarray(0, delta.offset).toString()}${delta.data}${input.subarray(delta.offset + delta.remove).toString()}`;
}
