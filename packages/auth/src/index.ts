import { createHash, randomBytes } from "node:crypto";
import {
  assert,
  createId,
  type Membership,
  type Organization,
  type Project,
  type Role,
} from "@lynxship/contracts";

const roleScopes: Record<Role, Set<string>> = {
  owner: new Set(["*"]),
  admin: new Set([
    "project:read",
    "project:write",
    "build:write",
    "submit:write",
    "update:write",
    "credentials:write",
  ]),
  developer: new Set([
    "project:read",
    "build:write",
    "submit:write",
    "update:write",
  ]),
  viewer: new Set(["project:read"]),
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export interface TokenRecord {
  id: string;
  name: string;
  organizationId: string;
  projectId: string | null;
  scopes: string[];
  hash: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export class TokenManager {
  readonly tokens = new Map<string, TokenRecord>();

  create(input: {
    name: string;
    organizationId: string;
    projectId?: string;
    scopes?: string[];
    expiresAt?: string | null;
  }) {
    assert(
      input.name && input.organizationId,
      "TOKEN_INPUT",
      "Token name and organizationId are required",
    );
    const id = createId("tok");
    const secret = randomBytes(24).toString("base64url");
    const value = `lxs_${id}_${secret}`;
    this.tokens.set(id, {
      id,
      name: input.name,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      scopes: [...new Set(input.scopes ?? ["project:read"])],
      hash: digest(value),
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      lastUsedAt: null,
    });
    return {
      id,
      value,
      name: input.name,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      scopes: [...new Set(input.scopes ?? ["project:read"])],
      expiresAt: input.expiresAt ?? null,
    };
  }

  registerRaw(input: {
    value: string;
    id?: string;
    name?: string;
    organizationId?: string;
    scopes?: string[];
  }) {
    assert(input.value, "TOKEN_INPUT", "Raw token value is required");
    const id = input.id ?? createId("tok_env");
    this.tokens.set(id, {
      id,
      name: input.name ?? "environment",
      organizationId: input.organizationId ?? "environment",
      projectId: null,
      scopes: [...new Set(input.scopes ?? ["*"])],
      hash: digest(input.value),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    return id;
  }

  authenticate(
    value: string,
    input: {
      requiredScope?: string;
      organizationId?: string;
      projectId?: string;
    } = {},
  ) {
    const token = [...this.tokens.values()].find(
      (candidate) => candidate.hash === digest(value),
    );
    assert(token, "AUTH_INVALID", "Invalid service token");
    assert(!token.revokedAt, "AUTH_REVOKED", "Service token has been revoked");
    assert(
      !token.expiresAt || new Date(token.expiresAt) > new Date(),
      "AUTH_EXPIRED",
      "Service token has expired",
    );
    assert(
      !input.organizationId || token.organizationId === input.organizationId,
      "AUTH_SCOPE",
      "Token is not authorized for this organization",
    );
    assert(
      !input.projectId ||
        !token.projectId ||
        token.projectId === input.projectId,
      "AUTH_SCOPE",
      "Token is not authorized for this project",
    );
    assert(
      !input.requiredScope ||
        token.scopes.includes("*") ||
        token.scopes.includes(input.requiredScope),
      "AUTH_SCOPE",
      `Missing scope: ${input.requiredScope}`,
    );
    token.lastUsedAt = new Date().toISOString();
    const { hash: _hash, ...safe } = token;
    return safe;
  }

  revoke(id: string) {
    const token = this.tokens.get(id);
    assert(token, "TOKEN_NOT_FOUND", "Token not found");
    token.revokedAt = new Date().toISOString();
  }

  list() {
    return [...this.tokens.values()].map(({ hash: _hash, ...token }) => token);
  }
}

export function scopesForRole(role: Role): string[] {
  assert(roleScopes[role], "ROLE_INVALID", `Unknown role: ${role}`);
  return [...roleScopes[role]];
}

export class TenantDirectory {
  readonly organizations = new Map<string, Organization>();

  readonly projects = new Map<string, Project>();

  readonly memberships = new Map<string, Membership>();

  createOrganization(name: string, ownerUserId: string) {
    const organization = {
      id: createId("org"),
      name,
      createdAt: new Date().toISOString(),
    };
    this.organizations.set(organization.id, organization);
    this.memberships.set(`${organization.id}:${ownerUserId}`, {
      organizationId: organization.id,
      userId: ownerUserId,
      role: "owner",
    });
    return organization;
  }

  addMember(organizationId: string, userId: string, role: Role) {
    assert(
      this.organizations.has(organizationId),
      "ORG_NOT_FOUND",
      "Organization not found",
    );
    scopesForRole(role);
    const membership = { organizationId, userId, role };
    this.memberships.set(`${organizationId}:${userId}`, membership);
    return membership;
  }

  createProject(organizationId: string, name: string) {
    assert(
      this.organizations.has(organizationId),
      "ORG_NOT_FOUND",
      "Organization not found",
    );
    const project = {
      id: createId("proj"),
      organizationId,
      name,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  authorize(input: {
    organizationId: string;
    userId: string;
    projectId?: string;
    scope: string;
  }) {
    const membership = this.memberships.get(
      `${input.organizationId}:${input.userId}`,
    );
    assert(
      membership,
      "FORBIDDEN",
      "User is not a member of this organization",
    );
    const scopes = scopesForRole(membership.role);
    assert(
      scopes.includes("*") || scopes.includes(input.scope),
      "FORBIDDEN",
      `Role ${membership.role} lacks ${input.scope}`,
    );
    if (input.projectId)
      assert(
        this.projects.get(input.projectId)?.organizationId ===
          input.organizationId,
        "FORBIDDEN",
        "Project is outside the organization",
      );
    return membership;
  }

  listProjects(organizationId: string) {
    return [...this.projects.values()].filter(
      (project) => project.organizationId === organizationId,
    );
  }
}
