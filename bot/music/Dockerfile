FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/yt-dlp && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]"
ENV PATH="/opt/yt-dlp/bin:${PATH}" NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY index.mjs player.mjs source.mjs effects.mjs video.mjs videoSource.mjs ./
USER node
CMD ["node", "index.mjs"]
