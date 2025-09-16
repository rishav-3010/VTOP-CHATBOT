FROM mcr.microsoft.com/playwright:v1.53.2-noble

WORKDIR /app

# Set the browser path for pre-installed browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy package files first
COPY package*.json ./

# Install dependencies 
RUN npm ci

# Copy application code
COPY . .

# Set production environment
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
