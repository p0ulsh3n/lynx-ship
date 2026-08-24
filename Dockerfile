FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY examples ./examples
RUN pnpm install --frozen-lockfile
RUN find packages examples -name '*.tsbuildinfo' -delete && pnpm --filter @lynxship/api build && pnpm --filter @lynxship/cli build && pnpm --filter @lynxship/dashboard build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production LYNXSHIP_PORT=8787
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/examples ./examples
RUN pnpm install --frozen-lockfile --prod
USER node
EXPOSE 8787
CMD ["node", "packages/api/dist/server.js"]
