import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShell } from "./components/layout/app-shell";
import { OverviewPage } from "./features/overview/dashboard-page";
import { BuildsPage } from "./features/builds/builds-page";
import { SubmissionsPage } from "./features/submissions/submissions-page";
import { UpdatesPage } from "./features/updates/updates-page";
import { WorkersPage } from "./features/workers/workers-page";
import { TeamPage } from "./features/team/team-page";
import { SettingsPage } from "./features/settings/settings-page";

const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
});
const buildsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/builds",
  component: BuildsPage,
});
const submissionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/submissions",
  component: SubmissionsPage,
});
const updatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/updates",
  component: UpdatesPage,
});
const workersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workers",
  component: WorkersPage,
});
const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/team",
  component: TeamPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  buildsRoute,
  submissionsRoute,
  updatesRoute,
  workersRoute,
  teamRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
