FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY web ./web
COPY tsconfig.json ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV ADMIN_PORT=3001
ENV ADMIN_HOST=127.0.0.1
ENV DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 3000 3001
VOLUME ["/data"]
CMD ["node", "dist/server/index.js"]
