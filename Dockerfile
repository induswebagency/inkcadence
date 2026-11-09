# Build Vite web app, then run the hardened Express API.
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
COPY --from=web /web/dist ./web/dist

USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
