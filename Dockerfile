FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install deps first so a source edit does not bust the dependency layer.
# npm ci needs package-lock.json, which is committed for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# Run as the unprivileged user that the node image already ships.
USER node

EXPOSE 8080
CMD ["node", "server/index.js"]
