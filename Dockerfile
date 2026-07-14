FROM node:22-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
COPY ecosystem.config.js ./
COPY server.js ./
COPY src ./src
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY frontend/src ./frontend/src
COPY frontend/tsconfig.json frontend/vite.config.ts ./frontend/

RUN cd frontend && npm install && npm run build
RUN npm install --production

EXPOSE 3000

CMD ["npx", "pm2-runtime", "ecosystem.config.js"]
