# One container serves both the API and the built React app (same origin,
# so the httpOnly session cookie and SSE work without CORS).

FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY server/prisma server/prisma
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json /app/server/openapi.yaml ./server/
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
WORKDIR /app/server
RUN mkdir -p uploads
EXPOSE 4000
# Apply migrations, seed the provided dataset on first boot only, then start.
CMD ["npm", "run", "start:prod"]
