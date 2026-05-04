# Multi-stage build for optimized image size
# Use node:22 (LTS) — provides stable native WebSocket required by
# @supabase/realtime-js (loaded transitively by @supabase/supabase-js).
# Node 18/20 fail at startup with "detected without native WebSocket support".
# Builder uses non-alpine: Tailwind v4 needs native bindings unavailable on Alpine.
FROM node:22 AS builder

WORKDIR /app

# Build args for Vite compile-time variables
ARG VITE_GEMINI_API_KEY
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

ENV VITE_GEMINI_API_KEY=$VITE_GEMINI_API_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Copy package files (no lockfile — forces fresh resolve of platform-specific native bindings)
COPY package.json ./

# Install dependencies + explicitly add Linux-native Tailwind/LightningCSS bindings
# (npm doesn't always resolve platform-specific optional deps correctly in Docker)
RUN npm install && \
    npm install @tailwindcss/oxide-linux-x64-gnu lightningcss-linux-x64-gnu @rollup/rollup-linux-x64-gnu

# Copy source files
COPY . .

# Build the application
RUN npm run build

# Production stage — alpine is fine here (no build step)
FROM node:22-alpine

WORKDIR /app

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./
COPY --from=builder /app/services ./services

# Install only production dependencies
RUN npm ci --only=production

# Set environment variables
ENV PORT=8080
ENV NODE_ENV=production
# Bridge proxy: points to host machine where local-bridge-server.cjs runs
# host.docker.internal resolves to the Docker host on Docker Desktop (Mac/Win)
# Override with BRIDGE_HOST for Linux Docker or custom setups
ENV BRIDGE_HOST=host.docker.internal
ENV BRIDGE_PORT=3456

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start the application using server.js
CMD ["node", "server.js"]


