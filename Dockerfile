FROM node:18-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

EXPOSE 4000

# Run migrations then seed (idempotent), then start
CMD ["sh", "-c", "npm run migrate && npm run seed && npm start"]
