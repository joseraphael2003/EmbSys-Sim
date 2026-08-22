FROM emscripten/emsdk:3.1.74

RUN apt-get update -qq && apt-get install -qqy --no-install-recommends git && rm -rf /var/lib/apt/lists/*

ADD . /app
WORKDIR /app

ENV DEMOS_DIRECTORY="demos"
RUN npm install && npm run build-demos

EXPOSE 7829

CMD ["npm", "run", "start"]