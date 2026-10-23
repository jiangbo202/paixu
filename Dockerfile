FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN node scripts/build.mjs

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5173 DB_PATH=/data/paixu.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server.mjs engine.js modes.js six-seat.js rules.js rankings.js package.json ./
COPY --chown=node:node backend ./backend
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts/admin.mjs scripts/upgrade-local.mjs ./scripts/
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:5173/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs", "--dist"]
