FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY .env.example ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

RUN mkdir -p /app/results /app/data

CMD ["npm", "start"]
