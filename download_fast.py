#!/usr/bin/env python3
"""
download_fast.py
Script Python isolado e otimizado para baixar vídeos e lives longas do YouTube
na MELHOR qualidade possível e na VELOCIDADE MÁXIMA usando multithreading.
"""
import sys
import os
import time

def check_dependencies():
    try:
        import yt_dlp
    except ImportError:
        print("[AVISO] yt-dlp não está instalado. Instalando...")
        os.system(f"{sys.executable} -m pip install --upgrade yt-dlp")
        import yt_dlp
    return yt_dlp

def format_bytes(bytes_val):
    if not bytes_val:
        return "0 B"
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_val < 1024.0:
            return f"{bytes_val:.1f} {unit}"
        bytes_val /= 1024.0
    return f"{bytes_val:.1f} TB"

def progress_hook(d):
    status = d.get('status')
    if status == 'downloading':
        downloaded = d.get('downloaded_bytes', 0)
        total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
        speed = d.get('speed') or 0
        eta = d.get('eta') or 0

        percent_str = f"{(downloaded / total * 100):.1f}%" if total > 0 else "---%"
        speed_str = f"{format_bytes(speed)}/s" if speed else "Calculando..."
        total_str = format_bytes(total) if total else "Tamanho dinâmico"
        downloaded_str = format_bytes(downloaded)

        eta_min = int(eta // 60)
        eta_sec = int(eta % 60)
        eta_str = f"{eta_min:02d}:{eta_sec:02d}" if eta else "--:--"

        # Linha de status dinâmica no terminal
        sys.stdout.write(
            f"\r[BAIXANDO] {percent_str} | {downloaded_str} / {total_str} | Vel: {speed_str} | Restante: {eta_str}    "
        )
        sys.stdout.flush()

    elif status == 'finished':
        print("\n[DOWNLOAD CONCLUÍDO] Processando e mesclando faixas em alta definição...")

def download_video(url, output_dir=None):
    yt_dlp = check_dependencies()

    if not output_dir:
        output_dir = os.path.dirname(os.path.abspath(__file__))

    output_template = os.path.join(output_dir, "%(title)s [%(id)s].%(ext)s")

    print("=" * 65)
    print("🚀 TV BRAZA - DOWNLOADER TURBO (YOUTUBE)")
    print("=" * 65)
    print(f"URL Alvo:      {url}")
    print(f"Destino:       {output_dir}")
    print(f"Aceleração:    8 Conexões Simultâneas (Multithread)")
    print(f"Bypass:        Android + iOS Native Engine")
    print("=" * 65)

    # Configurações de alta performance do yt-dlp
    ydl_opts = {
        # Formato: Melhor vídeo até 1080p + melhor áudio (AAC/M4A), mesclando em MP4
        'format': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
        'merge_output_format': 'mp4',
        'outtmpl': output_template,

        # Bypass anti-bot usando múltiplos clientes InnerTube
        'extractor_args': {
            'youtube': {
                'player_client': ['android', 'ios', 'web']
            }
        },

        # OTIMIZAÇÕES DE VELOCIDADE MÁXIMA:
        'concurrent_fragment_downloads': 8,  # Baixa 8 pedaços de vídeo ao mesmo tempo!
        'buffersize': 1024 * 64,             # Buffer de 64 KB para evitar gargalo de I/O
        'http_chunk_size': 10485760,         # Chunks de 10 MB para burlar o throttle do YouTube
        'retries': 15,                       # Retenta automaticamente em caso de oscilação
        'fragment_retries': 15,
        'continuedl': True,                  # Continua de onde parou se cair

        # Logs e monitoramento
        'progress_hooks': [progress_hook],
        'quiet': True,
        'no_warnings': True
    }

    start_time = time.time()

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            print("[1/2] Obtendo metadados e abrindo canais de alta velocidade...")
            info = ydl.extract_info(url, download=True)
            elapsed = time.time() - start_time
            file_path = ydl.prepare_filename(info)
            if not file_path.endswith('.mp4'):
                file_path = os.path.splitext(file_path)[0] + '.mp4'

            size_mb = os.path.getsize(file_path) / 1024 / 1024 if os.path.exists(file_path) else 0

            print("\n" + "=" * 65)
            print("✅ SUCESSO TOTAL!")
            print(f"Título:   {info.get('title')}")
            print(f"Duração:  {info.get('duration_string', 'N/A')}")
            print(f"Arquivo:  {file_path}")
            print(f"Tamanho:  {size_mb:.1f} MB")
            print(f"Tempo:    {int(elapsed // 60)}m {int(elapsed % 60)}s")
            print("=" * 65)
            return file_path

        except Exception as e:
            print(f"\n[ERRO] Falha durante o download: {e}", file=sys.stderr)
            sys.exit(1)

if __name__ == '__main__':
    # URL padrão solicitada pelo usuário
    target_url = "https://www.youtube.com/watch?v=0vuOr2-5Ef8"
    if len(sys.argv) > 1:
        target_url = sys.argv[1]

    dest_folder = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()

    download_video(target_url, dest_folder)
