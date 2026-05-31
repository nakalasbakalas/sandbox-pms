# syntax=docker/dockerfile:1

FROM node:22.12-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM deps AS build
COPY . .
RUN npm run db:generate
RUN npm run build

FROM node:22.12-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=10000 \
    HOST=0.0.0.0 \
    VITE_PMS_API_MODE=server
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 10000
CMD ["npm", "run", "start"]
