# Build stage: install dependencies and produce TanStack Start output
FROM node:22-alpine AS build
WORKDIR /app

# Build tooling required by some npm packages
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package*.json ./
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY vite.wc.config.ts ./
COPY components.json ./
COPY eslint.config.js ./
COPY nitro.config.ts ./
COPY public ./public
COPY src ./src

RUN npm ci
RUN npm run build
RUN npm prune --omit=dev
RUN npm cache clean --force

# Runtime stage: run the prebuilt TanStack Start server
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV TSS_APP_BASE=/
ENV TSS_SERVER_FN_BASE=/_serverFn
ENV PORT=80
ENV HOST=0.0.0.0
ENV NITRO_HOST=0.0.0.0
WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/dist ./dist

EXPOSE 80
CMD ["node", ".output/server/index.mjs"]
