FROM mcr.microsoft.com/playwright:v1.53.2-noble

WORKDIR /app

# Copy package files first (for Docker layer caching)
COPY package*.json ./

# Skip browser download during npm install, use pre-installed ones
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# Copy application code
COPY . .

# Set production environment
ENV NODE_ENV=production

# Expose your app's port
EXPOSE 3000

# Start command
CMD ["node", "server.js"]
