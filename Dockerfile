FROM node:12.14-slim

ENV PATH="/emsdk:/emsdk/emscripten/tag-1.38.21:${PATH}"
ENV EMSDK="/emsdk"
ENV EM_CONFIG="/root/.emscripten"
ENV EMSCRIPTEN="/emsdk/emscripten/tag-1.38.21"
ENV EMSCRIPTEN_NATIVE_OPTIMIZER="/emsdk/emscripten/tag-1.38.21_64bit_optimizer/optimizer"

RUN echo "deb http://archive.debian.org/debian stretch main" > /etc/apt/sources.list && \
    echo "deb http://archive.debian.org/debian-security stretch/updates main" >> /etc/apt/sources.list && \
    echo "Acquire::Check-Valid-Until false;" > /etc/apt/apt.conf.d/99no-check-valid-until && \
    apt-get update -qq && apt-get -qqy --allow-unauthenticated install \
    cmake git curl unzip net-tools python-dev python-pip mercurial && \
    curl -sSL https://bootstrap.pypa.io/pip/2.7/get-pip.py -o get-pip.py && python get-pip.py && rm get-pip.py && \
    pip install mbed-cli

ENV EMSDK_REVISION="50df5a2983d1b793f189c674ad588d8df5f9b2f4"
RUN curl -LO https://github.com/emscripten-core/emsdk/archive/${EMSDK_REVISION}.zip && \
    unzip ${EMSDK_REVISION}.zip && \
    mv emsdk-${EMSDK_REVISION} emsdk

RUN emsdk/emsdk install fastcomp-clang-e1.38.21-64bit && \
    emsdk/emsdk activate fastcomp-clang-e1.38.21-64bit && \
    emsdk/emsdk install emscripten-tag-1.38.21-64bit && \
    emsdk/emsdk activate emscripten-tag-1.38.21-64bit

ADD . /app
WORKDIR /app

ENV DEMOS_DIRECTORY="demos"
RUN npm install && npm run build-demos

EXPOSE 7829

CMD ["npm", "run", "start"]
