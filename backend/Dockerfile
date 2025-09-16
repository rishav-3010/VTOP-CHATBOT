FROM mcr.microsoft.com/playwright:v1.53.2-noble

WORKDIR /app

# Copy package files first (for Docker layer caching)
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application code
COPY . .

# Set production environment
ENV NODE_ENV=production

# Expose your app's port
EXPOSE 3000

# Start command
CMD ["node", "server.js"]
