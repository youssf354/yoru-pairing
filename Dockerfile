FROM node:20-slim

WORKDIR /app

COPY package.json .
RUN npm install

COPY server.js .
COPY index.html .

EXPOSE 7860

ENV PORT=7860

CMD ["node", "server.js"]
