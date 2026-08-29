# @lynxship/dashboard

Private React/Vite operations dashboard for the LynxShip control plane. It
uses TanStack Router and Query to inspect builds, workers, submissions,
updates and usage through the authenticated API.

This package is not a mobile UI library and is not published as an SDK. Run
`pnpm --filter @lynxship/dashboard dev` for local development or
`pnpm --filter @lynxship/dashboard build` for the production bundle. Configure
the API URL and authentication through the project’s dashboard environment;
never embed server credentials in the generated browser assets.
