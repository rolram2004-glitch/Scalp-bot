FROM node:22-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm install --omit=dev --ignore-scripts

COPY server.js tsconfig.json ecosystem.config.js ./
COPY src ./src
COPY frontend ./frontend

RUN cd frontend && npm ci --include=dev && npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
