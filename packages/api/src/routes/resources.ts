import type { ApiRouteContext } from "../routes.js";
import { assert, sha256 } from "@lynxship/contracts";
import { validateSourceReference } from "@lynxship/build-orchestrator";
import { S3ObjectStorage } from "@lynxship/storage";

export function registerResourcesRoutes(context: ApiRouteContext): void {
  const {
    server,
    app,
    runtime,
    artifactStore,
    persist,
    identityFor,
    canAccess,
    storeBuildSource,
    planBuildSourceUpload,
    completeBuildSourceUpload,
  } = context;
  server.post("/v1/organizations", async (request, reply) => {
    const body = request.body as { name: string; ownerUserId: string };
    const organization = app.tenants.createOrganization(
      body.name,
      body.ownerUserId,
    );
    await persist();
    return reply.code(201).send(organization);
  });
  server.post("/v1/projects", async (request, reply) => {
    const body = request.body as { organizationId: string; name: string };
    const project = app.tenants.createProject(body.organizationId, body.name);
    await persist();
    return reply.code(201).send(project);
  });
  server.get("/v1/projects", async (request) => {
    const query = request.query as { organizationId?: string };
    const organizationId =
      query.organizationId ?? identityFor(request)?.organizationId ?? "";
    return app.tenants.listProjects(organizationId);
  });
  server.post("/v1/build-sources", async (request, reply) => {
    const body = request.body as {
      projectId?: string;
      organizationId?: string;
      dataBase64?: string;
    };
    assert(
      body.projectId && body.organizationId && body.dataBase64,
      "SOURCE_INPUT",
      "Project, organization and source data are required",
    );
    assert(
      canAccess(request, {
        organizationId: body.organizationId,
        projectId: body.projectId,
      }),
      "FORBIDDEN",
      "Source is outside the authenticated tenant",
    );
    const content = Buffer.from(body.dataBase64, "base64");
    assert(
      content.toString("base64") === body.dataBase64,
      "SOURCE_BASE64_INVALID",
      "Source data must be canonical base64",
    );
    const source = await storeBuildSource(content);
    await persist();
    return reply.code(201).send({
      source,
      projectId: body.projectId,
      organizationId: body.organizationId,
    });
  });
  server.post("/v1/build-sources/upload-plan", async (request, reply) => {
    const body = request.body as {
      projectId?: string;
      organizationId?: string;
      source?: unknown;
    };
    assert(
      body.projectId && body.organizationId && body.source,
      "SOURCE_INPUT",
      "Project, organization and source reference are required",
    );
    assert(
      canAccess(request, {
        organizationId: body.organizationId,
        projectId: body.projectId,
      }),
      "FORBIDDEN",
      "Source is outside the authenticated tenant",
    );
    validateSourceReference(body.source);
    const plan = await planBuildSourceUpload(body.source);
    return reply.code(201).send({
      ...plan,
      projectId: body.projectId,
      organizationId: body.organizationId,
    });
  });
  server.post("/v1/build-sources/complete", async (request, reply) => {
    const body = request.body as {
      projectId?: string;
      organizationId?: string;
      source?: unknown;
    };
    assert(
      body.projectId && body.organizationId && body.source,
      "SOURCE_INPUT",
      "Project, organization and source reference are required",
    );
    assert(
      canAccess(request, {
        organizationId: body.organizationId,
        projectId: body.projectId,
      }),
      "FORBIDDEN",
      "Source is outside the authenticated tenant",
    );
    validateSourceReference(body.source);
    const source = await completeBuildSourceUpload(body.source);
    return reply.code(200).send({
      source,
      projectId: body.projectId,
      organizationId: body.organizationId,
    });
  });
  server.post("/v1/artifacts", async (request, reply) => {
    const body = request.body as {
      projectId: string;
      organizationId: string;
      filename: string;
      contentType?: string;
      hash: string;
      dataBase64: string;
      artifact?: {
        key: string;
        hash: string;
        size?: number;
        contentType?: string;
        url: string;
        expiresAt?: string;
      };
    };
    assert(
      body.projectId && body.organizationId && body.filename,
      "ARTIFACT_INPUT",
      "Project, organization and filename are required",
    );
    const artifact = body.artifact
      ? body.artifact
      : await (async () => {
          assert(
            runtime?.storage !== "r2",
            "ARTIFACT_EXTERNAL_STORAGE",
            "The R2 runtime accepts artifact metadata, not binary uploads",
          );
          assert(
            body.hash && body.dataBase64,
            "ARTIFACT_DATA",
            "Artifact metadata or base64 data is required",
          );
          const content = Buffer.from(body.dataBase64, "base64");
          assert(
            sha256(content) === body.hash,
            "ARTIFACT_HASH",
            "Artifact hash does not match uploaded content",
          );
          const contentType = body.contentType ?? "application/octet-stream";
          const storageStore = runtime?.storageStore;
          if (storageStore instanceof S3ObjectStorage) {
            const key = `artifacts/${body.hash}`;
            await storageStore.put(key, content, contentType);
            return {
              key,
              hash: body.hash,
              size: content.length,
              contentType,
            };
          }
          return artifactStore.put(content, { contentType });
        })();
    if (body.artifact)
      assert(
        artifact.key &&
          artifact.hash &&
          body.artifact.url.startsWith("https://"),
        "ARTIFACT_METADATA",
        "R2 artifact key, hash and HTTPS download URL are required",
      );
    await persist();
    return reply.code(201).send({
      artifact,
      projectId: body.projectId,
      organizationId: body.organizationId,
      filename: body.filename,
    });
  });
}
