FROM node:18-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data

ENV PORT=3500
ENV DB_PATH=/data/urlshortener.db

EXPOSE 3500

CMD ["node", "app.js"]
