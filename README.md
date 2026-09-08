# 📺 TV Braza - Sistema de Playout 24/7 no YouTube (Docker Compose)

Sistema de automação e transmissão contínua 24/7 para o canal **TV Braza** no YouTube, projetado especificamente para rodar em servidores VPS de baixo custo (a partir de 1GB de RAM e 20GB de SSD).

---

## 🚀 Como Funciona a Economia Inteligente de Espaço

> **Regra dos 2 Vídeos:** Para economizar espaço em disco na VPS:
> 1. O sistema mantém apenas o **vídeo em reprodução no ar** (`atual.mp4`).
> 2. Mantém o **próximo vídeo da grade pré-baixado** (`proximo.mp4`) para garantir que a transição ocorra de forma 100% instantânea e sem atrasos.
> 3. Assim que um vídeo termina de ser transmitido (ou quando você clica em "Pular Vídeo"), o arquivo dele é **apagado imediatamente do disco**, liberando espaço para baixar a próxima atração.
> 4. Se a fila de programação terminar, o sistema ativa uma **vinheta animada Standby da TV Braza em loop**, garantindo que a **live no YouTube NUNCA caia**.

---

## 🛠️ Requisitos Mínimos da VPS

- **Sistema Operacional:** Ubuntu 20.04 / 22.04 / 24.04 LTS ou Debian 11 / 12
- **Processador:** 1 vCPU (2 vCPUs recomendados para 1080p)
- **Memória RAM:** 1 GB (2 GB recomendados)
- **Armazenamento:** 15 GB SSD ou mais (o sistema usa menos de 5GB)
- **Docker & Docker Compose** instalados

---

## 📦 Instalação Passo a Passo na VPS

### 1. Conecte-se à sua VPS via SSH
```bash
ssh root@SEU_IP_DA_VPS
```

### 2. Instale o Docker e o Docker Compose (se ainda não tiver)
```bash
# Atualiza pacotes
sudo apt update && sudo apt upgrade -y

# Instala Docker oficial
curl -fsSL https://get.docker.com | sh

# Habilita o serviço do Docker
sudo systemctl enable --now docker
```

### 3. Clone ou envie os arquivos para a VPS
Crie a pasta do projeto:
```bash
mkdir -p /opt/tvbraza && cd /opt/tvbraza
```
Copie os arquivos deste repositório para a pasta `/opt/tvbraza`.

### 4. Configure as Variáveis de Ambiente
Copie o arquivo de exemplo e edite:
```bash
cp .env.example .env
nano .env
```

Preencha os campos:
```env
PORT=3000
YOUTUBE_STREAM_KEY=    # Sua chave do YouTube Studio
YOUTUBE_RTMP_URL=rtmp://a.rtmp.youtube.com/live2
ADMIN_PASSWORD=sua_senha_aqui
RESOLUTION=1080p
VIDEO_BITRATE=4500k
AUDIO_BITRATE=160k
```
> *(Você também pode configurar ou alterar a chave diretamente pelo Painel Web mais tarde!)*

### 5. Inicie o Sistema com Docker Compose
```bash
docker compose up -d --build
```

### 6. Libere a Porta no Firewall da VPS
Se estiver usando o firewall UFW:
```bash
sudo ufw allow 3000/tcp
sudo ufw reload
```

---

## 🌐 Acessando o Painel de Controle

Abra o seu navegador e acesse:
```
http://SEU_IP_DA_VPS:3000
```

### Como Adicionar Programação:
1. No YouTube, copie o link de qualquer vídeo (ex: `https://www.youtube.com/watch?v=XXXXX` ou `https://youtu.be/XXXXX`).
2. Cole no campo **"ADICIONAR VÍDEO DO YOUTUBE À PROGRAMAÇÃO"** no painel da TV Braza.
3. Clique em **"Consultar Link"** para visualizar a capa, duração e título.
4. Clique em **"Confirmar e Adicionar à Grade"**.
5. O sistema fará o download antecipado automaticamente em segundo plano e iniciará a transmissão conforme a ordem da grade!

---

## 🕹️ Comandos Úteis de Manutenção na VPS

### Ver logs em tempo real do Playout e Downloads:
```bash
docker compose logs -f
```

### Reiniciar o sistema:
```bash
docker compose restart
```

### Parar o sistema:
```bash
docker compose down
```

### Atualizar o sistema após alterações:
```bash
docker compose up -d --build
```

### Checar uso de disco da VPS:
```bash
df -h
```

---

## 🔒 Como Obter a Chave de Transmissão do YouTube
1. Acesse o [YouTube Studio](https://studio.youtube.com).
2. No canto superior direito, clique em **Criar > Fazer transmissão ao vivo**.
3. Na aba **Transmitir**, localize a seção **Chave de transmissão**.
4. Copie o código e cole nas **Configurações** do Painel da TV Braza.

---

## 🛡️ Licença e Créditos
Desenvolvido com carinho para a **TV Braza**.
Playout com tecnologia FFmpeg, yt-dlp, Node.js e Docker.
