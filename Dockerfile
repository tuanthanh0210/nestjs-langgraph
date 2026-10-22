FROM node:22-alpine AS deps

RUN npm install -g pnpm@11.28.5
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY public ./public
RUN pnpm build

FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV PORT=3000

RUN npm install -g pnpm@11.28.5
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts && pnpm store prune

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

RUN chmod -R a+rX /app/public /app/dist

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "dist/main.js"]
