FROM node:22.14.0-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    apt-transport-https \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Download and install Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome path
ENV CHROME_BIN=/usr/bin/google-chrome

# Install pnpm globally
RUN npm install -g pnpm

WORKDIR /usr/src/app

# Copy package files and install dependencies using pnpm
COPY package*.json ./
COPY . .
RUN pnpm install --frozen-lockfile

# Copy remaining application code and build
RUN pnpm run build

EXPOSE 8080
ENV NODE_ENV=production

# Start Xvfb and then your Node app
CMD ["bash", "-c", "Xvfb :99 -screen 0 1920x1080x24 & export DISPLAY=:99 && pnpm run start"]