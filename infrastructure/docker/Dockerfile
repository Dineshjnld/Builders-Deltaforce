FROM node:24-slim
WORKDIR /app
COPY services/api/package*.json ./services/api/
RUN npm ci --prefix services/api --omit=dev --ignore-scripts --no-audit --no-fund
COPY services ./services
COPY apps/web ./apps/web
COPY infrastructure/migrations ./infrastructure/migrations
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node","services/api/server.mjs"]
