FROM node:24-alpine
WORKDIR /app
COPY apps/api/package.json ./apps/api/package.json
RUN npm --prefix ./apps/api install --omit=dev --no-audit --no-fund
COPY apps/api ./apps/api
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0
RUN mkdir -p /data /app/.state/media
EXPOSE 4000
CMD ["node", "apps/api/src/main.js"]
