FROM ghcr.io/puppeteer/puppeteer:latest

# Skip downloading Chromium since it is pre-installed in the base image
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /usr/src/app

# Copy files as pptruser (the default user of the base image) to avoid permission issues
COPY --chown=pptruser:pptruser package*.json ./
RUN npm ci

COPY --chown=pptruser:pptruser . .

EXPOSE 3000

CMD ["node", "server.js"]
