# TV Braza Studio - Dockerfile Playout 24/7
FROM node:20-bookworm-slim

# Instala dependências do sistema: FFmpeg, Python3, python3-pip, curl e certificados
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Instala pytubefix (Biblioteca com PO Token automático para download sem cookies)
RUN pip install --no-cache-dir --break-system-packages pytubefix

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

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Expõe a porta do painel administrativo
EXPOSE 3000

# Executa o servidor de Playout
CMD ["node", "server/src/index.js"]
