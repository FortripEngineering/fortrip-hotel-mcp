FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY guides ./guides
COPY LICENSE README.md ./
USER node
ENTRYPOINT ["node", "src/index.js"]
