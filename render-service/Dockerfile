# Render service: Node 20 + Chromium deps for Remotion's headless render.
# Builds the Remotion bundle once at image build time, then serves it as
# static files alongside the /render-marketing-video endpoint.

FROM node:20-bookworm-slim

# Chromium runtime libs Remotion needs. The list is the union of what
# puppeteer-core + a typical headless Chromium install pull in on
# Debian; trimmed to what actually loads.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libxss1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps with the lockfile when available for reproducible builds.
COPY package.json package-lock.json* ./
RUN npm install --omit=optional

# Source + remotion config + scripts.
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Build: TypeScript → dist/, then bundle Remotion into ./remotion-bundle.
RUN npm run build

# Remotion downloads its own Chromium snapshot the first time the
# renderer runs. Pre-fetch it here so cold starts on Railway don't pay
# the download cost on the first request.
RUN node -e "import('@remotion/renderer').then(async (m) => { await m.ensureBrowser(); console.log('chromium ready'); })" || true

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
