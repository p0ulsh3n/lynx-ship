export type TokenValue = string | number;

export interface TokenSet {
  readonly [name: string]: TokenValue | TokenSet;
}

export interface TokenIssue {
  readonly path: string;
  readonly code:
    | "EMPTY_NAME"
    | "EMPTY_VALUE"
    | "INVALID_NAME"
    | "INVALID_VALUE"
    | "DUPLICATE_NAME"
    | "TOO_DEEP"
    | "TOO_MANY_TOKENS";
  readonly message: string;
}

export interface TokenValidation {
  readonly valid: boolean;
  readonly issues: readonly TokenIssue[];
}
