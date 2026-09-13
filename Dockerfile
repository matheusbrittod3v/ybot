# ====================================================
# Estágio 1: Build do Motor Nativo C++ com gRPC e Protobuf
# ====================================================
FROM node:20-bookworm-slim AS cpp-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libgrpc++-dev \
    protobuf-compiler-grpc \
    libprotobuf-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY server/proto/ ./server/proto/
COPY server/cpp-engine/ ./server/cpp-engine/

WORKDIR /src/server/cpp-engine/build
RUN cmake .. && make -j$(nproc)

# ====================================================
# Estágio 2: Imagem Final de Execução (Runtime Enxuto)
# ====================================================
FROM node:20-bookworm-slim

# Instala dependências de runtime: FFmpeg, Python3, python3-pip, curl, certificados e libs do gRPC
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    fonts-freefont-ttf \
    libgrpc++1.51 \
    libprotobuf32 \
    && rm -rf /var/lib/apt/lists/*

# Copia o binário C++ nativo gerado no estágio de build
COPY --from=cpp-builder /src/server/cpp-engine/build/tvbraza-engine /usr/local/bin/tvbraza-engine

# Instala pytubefix e yt-dlp no ambiente Python
RUN pip install --no-cache-dir --break-system-packages pytubefix yt-dlp

# Baixa a versão oficial mais recente do yt-dlp diretamente do repositório oficial (fallback)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Define diretório de trabalho
WORKDIR /app

# Copia arquivos de dependência do Node
COPY package*.json ./

# Instala dependências de produção
RUN npm install --omit=dev

# Copia o código-fonte da aplicação
COPY server/ ./server/

# Cria diretórios de dados persistentes com permissões completas
RUN mkdir -p /app/data/media /app/data/thumbs && chmod -R 777 /app/data

# Copia arquivo padrão de cookies para contornar verificações de bot
COPY data/cookies* /app/data/
RUN if [ ! -f /app/data/cookies.txt ]; then touch /app/data/cookies.txt; fi

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Expõe a porta do painel administrativo
EXPOSE 3000

# Executa o servidor de Playout
CMD ["node", "server/src/index.js"]
