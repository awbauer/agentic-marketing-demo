# The Google Cloud image (ADR-018): the React app and the Node server, built from one checkout.
FROM node:26-slim AS build
WORKDIR /app
# Node 26 images no longer ship corepack; install the pnpm the workspace pins.
RUN npm install -g pnpm@11.22.0 --no-audit --no-fund
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build && pnpm build:gcp

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/dist/client/client
COPY --from=build /app/dist/server /app/dist/server
COPY --from=build /app/dist/client/client /app/dist/client/client
RUN cd /app/dist/server && npm install --omit=dev --no-audit --no-fund
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "/app/dist/server/server.mjs"]
