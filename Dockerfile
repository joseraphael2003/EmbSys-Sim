FROM emscripten/emsdk:3.1.74

RUN apt-get update -qq && apt-get install -qqy --no-install-recommends \
    git \
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
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

ADD . /app
WORKDIR /app

ENV DEMOS_DIRECTORY="demos"
RUN npm install && npm run build-demos

EXPOSE 7829

CMD ["npm", "run", "start"]