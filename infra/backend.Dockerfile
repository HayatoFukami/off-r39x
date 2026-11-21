# Node 24, Debian CA trust store; all three services run the same built image digest.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
# .dockerignore drops .git, so the source commit (40-hex) arrives as a build argument; without it
# the backend build fails. Build with `pnpm build:backend:image --commit <tested revision>`: it
# resolves the commit once and streams `git archive <sha>` as the context with the same sha here.
# Do not pair this argument with a working-tree context: the sha would not prove what was built.
ARG R39X_BUILD_GIT_SHA
RUN pnpm build:backend

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/packages/db/migrations ./packages/db/migrations
USER node
CMD ["node", "dist/apps/api/server.js"]
