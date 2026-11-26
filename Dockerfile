FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY admin ./admin
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1
CMD ["node", "server.js"]
