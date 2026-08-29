import type { ApiRouteContext } from "../routes.js";
import type { SubmissionService } from "@lynxship/submit";

export function registerSubmissionsRoutes(context: ApiRouteContext): void {
  const { server, app, persist, canAccess } = context;
  server.post("/v1/submissions", async (request, reply) => {
    const submission = await app.submissions.submit(
      request.body as Parameters<SubmissionService["submit"]>[0],
    );
    await persist();
    return reply.code(201).send(submission);
  });
  server.get("/v1/submissions", async (request) => {
    const query = request.query as {
      organizationId?: string;
      projectId?: string;
    };
    return app.submissions.list().filter(
      (submission) =>
        canAccess(request, {
          organizationId: submission.organizationId,
          projectId: submission.projectId,
        }) &&
        (!query.organizationId ||
          submission.organizationId === query.organizationId) &&
        (!query.projectId || submission.projectId === query.projectId),
    );
  });
}
