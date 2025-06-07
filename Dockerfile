# Multi-stage build for Mock OpenAI API
FROM node:22-alpine AS builder

# Add metadata labels
LABEL org.opencontainers.image.title="Mock OpenAI API"
LABEL org.opencontainers.image.description="A complete OpenAI API compatible mock server for development and testing"
LABEL org.opencontainers.image.vendor="zerob13"
LABEL org.opencontainers.image.source="https://github.com/zerob13/mock-openai-api"
LABEL org.opencontainers.image.url="https://hub.docker.com/r/zerob13/mock-openai-api"
LABEL org.opencontainers.image.documentation="https://github.com/zerob13/mock-openai-api#readme"
LABEL org.opencontainers.image.licenses="MIT"

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:22-alpine

# Add metadata labels
LABEL org.opencontainers.image.title="Mock OpenAI API"
LABEL org.opencontainers.image.description="A complete OpenAI API compatible mock server for development and testing"
LABEL org.opencontainers.image.vendor="zerob13"
LABEL org.opencontainers.image.source="https://github.com/zerob13/mock-openai-api"
LABEL org.opencontainers.image.url="https://hub.docker.com/r/zerob13/mock-openai-api"
LABEL org.opencontainers.image.documentation="https://github.com/zerob13/mock-openai-api#readme"
LABEL org.opencontainers.image.licenses="MIT"

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Copy necessary files
COPY README.md LICENSE ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Change ownership to non-root user
RUN chown -R nextjs:nodejs /usr/src/app
USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { \
    res.statusCode === 200 ? process.exit(0) : process.exit(1); \
  }).on('error', () => process.exit(1));"

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV VERBOSE=false
ENV TZ=UTC
ENV NODE_OPTIONS="--max-old-space-size=256"
ENV NPM_CONFIG_CACHE=/tmp/.npm
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]
