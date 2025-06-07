# Build stage
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (without running prepare script)
RUN npm i

# Copy source code and config
COPY src ./src
COPY tsconfig.json ./

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV VERBOSE=true

# Start the application with verbose logging enabled
CMD ["node", "dist/index.js"]
