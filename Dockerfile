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

WORKDIR /app

# Node dependencies first: a source edit must not invalidate this layer (and
# with it puppeteer's ~580 MB Chrome download, which is what lets the image
# run `--launch-headless --scenario`).
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

# Everything else. .dockerignore keeps the fetched dependency checkouts, the
# object cache, libmbed.a and out/ out of the context: they are build products
# (or host-built copies of them) and must be recreated inside the image.
COPY . .

# Materialize the pinned dependency closure (mbed-os, mbed-http,
# simple-mbed-cloud-client, the CMSIS submodules) and apply patches/.
# `node cli.js` would also do this lazily through libmbed.build(), but an
# explicit step means a fetch failure reads as a fetch failure, not as a
# compile failure, and it is the step CI re-runs as a guard.
RUN node build-tools/fetch-deps.js

# libmbed.a plus all 21 demos. cli.js creates out/ when it does not exist.
ENV DEMOS_DIRECTORY="demos"
RUN npm run build-demos

EXPOSE 7829

CMD ["npm", "run", "start"]
