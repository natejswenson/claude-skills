# App-owned frontend gateway. Codex, credentials, and user data stay on the Mac.
FROM k3d-localdev-registry:5000/base/node@sha256:24b8bc17702002d2ed0c1da9ad66c3ee507cc279d0856726662ff2b6fc35c149 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY index.html tsconfig.json vite.config.ts ./
RUN npm run build && npm prune --omit=dev

FROM k3d-localdev-registry:5000/base/node@sha256:24b8bc17702002d2ed0c1da9ad66c3ee507cc279d0856726662ff2b6fc35c149
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY preview/server.mjs preview/login.html ./preview/
COPY src/tokens.css ./src/tokens.css
USER 1000
EXPOSE 8080
CMD ["node", "preview/server.mjs"]
