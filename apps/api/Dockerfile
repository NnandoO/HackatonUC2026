FROM node:24-alpine
WORKDIR /app
COPY apps/api ./apps/api
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0 DB_PATH=/data/angibell.db
RUN mkdir -p /data /app/.state/media
EXPOSE 4000
CMD ["node", "apps/api/src/main.js"]
