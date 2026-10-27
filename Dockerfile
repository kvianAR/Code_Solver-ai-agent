FROM node:22-alpine
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY package.json config.json ./
COPY server ./server
COPY extension ./extension
COPY scripts ./scripts
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/app/data
EXPOSE 8787
CMD ["node", "server/index.mjs"]
