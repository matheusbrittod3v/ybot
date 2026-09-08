#!/usr/bin/env python3
"""
pytube_downloader.py
Downloader automático para TV Braza que contorna bloqueios de robô (PO Token)
sem exigir upload de cookies.
"""
import sys
import os
import time
import subprocess
from pytubefix import YouTube

def on_progress(stream, chunk, bytes_remaining):
    total_size = stream.filesize
    bytes_downloaded = total_size - bytes_remaining
    percent = (bytes_downloaded / total_size) * 100
    print(f"[PROGRESS] {percent:.1f}%", flush=True)

def download_video(url, output_path):
    print(f"[PytubeDownloader] Inicializando download para: {url}", flush=True)
    
    # Tenta primeiro cliente WEB (gera PO Token automaticamente via node)
    yt = None
    clients = ['WEB', 'ANDROID_VR', 'ANDROID']
    
    last_err = None
    for client in clients:
        try:
            print(f"[PytubeDownloader] Tentando com cliente: {client}", flush=True)
            yt = YouTube(url, client=client, on_progress_callback=on_progress)
            # Força carregamento das streams para validar
            _ = yt.title
            print(f"[PytubeDownloader] Conectado com sucesso! Título: {yt.title}", flush=True)
            break
        except Exception as e:
            print(f"[PytubeDownloader] Falha ao conectar com {client}: {e}", flush=True)
            last_err = e
            yt = None

    if not yt:
        raise Exception(f"Não foi possível conectar ao YouTube em nenhum cliente: {last_err}")

    # Diretório de destino
    out_dir = os.path.dirname(os.path.abspath(output_path))
    out_filename = os.path.basename(output_path)
    os.makedirs(out_dir, exist_ok=True)

    # 1. Procurar melhor stream de vídeo (1080p -> 720p -> melhor disponível)
    video_stream = None
    for res in ['1080p', '720p', '480p']:
        video_stream = yt.streams.filter(res=res, type='video').first()
        if video_stream:
            print(f"[PytubeDownloader] Stream de vídeo encontrada: {res} ({video_stream.mime_type})", flush=True)
            break

    if not video_stream:
        video_stream = yt.streams.filter(type='video').first()

    # 2. Se a stream for progressiva (já tem áudio embutido), baixa direto para o arquivo final!
    if video_stream and video_stream.is_progressive:
        print(f"[PytubeDownloader] Baixando stream progressiva completa...", flush=True)
        video_stream.download(output_path=out_dir, filename=out_filename)
        print(f"[PytubeDownloader] Download progressivo concluído com sucesso!", flush=True)
        return True

    # 3. Stream adaptativa: precisa baixar vídeo + áudio e juntar com FFmpeg
    audio_stream = yt.streams.filter(only_audio=True).first()
    if not audio_stream:
        # Tenta qualquer áudio disponível
        audio_stream = yt.streams.get_audio_only()

    temp_v = os.path.join(out_dir, f"temp_v_{int(time.time())}_{out_filename}")
    temp_a = os.path.join(out_dir, f"temp_a_{int(time.time())}_{out_filename}")

    try:
        print(f"[PytubeDownloader] Baixando faixa de vídeo...", flush=True)
        video_stream.download(output_path=out_dir, filename=os.path.basename(temp_v))

        print(f"[PytubeDownloader] Baixando faixa de áudio...", flush=True)
        audio_stream.download(output_path=out_dir, filename=os.path.basename(temp_a))

        print(f"[PytubeDownloader] Mesclando áudio e vídeo via FFmpeg...", flush=True)
        # Executa FFmpeg para mesclar sem recodificar o vídeo (cópia direta super rápida)
        cmd = [
            'ffmpeg', '-y',
            '-i', temp_v,
            '-i', temp_a,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',
            output_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if res.returncode != 0:
            # Se falhar a cópia direta, tenta recodificação básica
            print(f"[PytubeDownloader] Aviso: cópia direta falhou, tentando fallback ffmpeg...", flush=True)
            cmd_fallback = [
                'ffmpeg', '-y',
                '-i', temp_v,
                '-i', temp_a,
                '-c:v', 'libx264', '-preset', 'ultrafast',
                '-c:a', 'aac',
                '-shortest',
                output_path
            ]
            res_fallback = subprocess.run(cmd_fallback, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res_fallback.returncode != 0:
                raise Exception(f"Erro no FFmpeg: {res_fallback.stderr.decode('utf-8', errors='ignore')}")

        print(f"[PytubeDownloader] Vídeo final mesclado com sucesso em: {output_path}", flush=True)
        return True

    finally:
        # Limpa arquivos temporários
        for f in [temp_v, temp_a]:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Uso: pytube_downloader.py <url> <output_path>")
        sys.exit(1)

    url_arg = sys.argv[1]
    out_arg = sys.argv[2]

    try:
        download_video(url_arg, out_arg)
        sys.exit(0)
    except Exception as ex:
        print(f"[PytubeDownloader Erro] {ex}", file=sys.stderr, flush=True)
        sys.exit(1)
