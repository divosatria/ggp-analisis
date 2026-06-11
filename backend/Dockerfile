FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm config set ignore-scripts false
RUN npm install

COPY . .

EXPOSE 4000

CMD ["npm", "start"]
