FROM mcr.microsoft.com/playwright:v1.57.0-noble
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY background/package.json package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY background/index.mjs index.mjs
CMD ["node","index.mjs"]
