#!/usr/bin/env python3
"""
pytube_downloader.py
Downloader de Alta Velocidade para TV Braza
1. Fast-Path com yt-dlp + cookies.txt (Download nativo em MP4 com velocidade máxima e sem bloqueio).
2. Fallback via pytubefix com clientes alternativos (ANDROID_VR / VISION_OS).
"""
import sys
import os
import subprocess
import re

def find_cookies_file():
    candidates = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../data/cookies.txt')),
        os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data/cookies.txt')),
        os.path.abspath(os.path.join(os.path.dirname(__file__), '../data/cookies.txt')),
        '/app/data/cookies.txt',
        './data/cookies.txt'
    ]
    for p in candidates:
        if os.path.exists(p) and os.path.getsize(p) > 20:
            return p
    return None

def download_video(url, output_path):
    print(f"[Downloader] Inicializando download de alta performance para: {url}", flush=True)
    out_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(out_dir, exist_ok=True)
    cookies_path = find_cookies_file()

    # 1. Fast-Path via yt-dlp com cookies da sessão
    yt_commands = [
        [sys.executable, '-m', 'yt_dlp'],
        ['yt-dlp'],
        ['/usr/local/bin/yt-dlp']
    ]

    for yt_bin in yt_commands:
        try:
            cmd = yt_bin + [
                '--no-playlist',
                '--no-warnings',
                '--extractor-args', 'youtube:player_client=android_vr,android,web',
                '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                '--merge-output-format', 'mp4',
                '-o', output_path,
                '--newline',
                url
            ]
            if cookies_path:
                cmd.extend(['--cookies', cookies_path])

            print(f"[Downloader] Disparando motor primário yt-dlp...", flush=True)
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

            for line in iter(proc.stdout.readline, ''):
                line_str = line.strip()
                # Parse de progresso padrão yt-dlp: [download]  45.2% of 12.34MiB at 3.45MiB/s
                m = re.search(r'\[download\]\s+([\d.]+)%', line_str)
                if m:
                    print(f"[PROGRESS] {m.group(1)}%", flush=True)

            proc.stdout.close()
            ret_code = proc.wait()

            if ret_code == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 10240:
                print(f"[Downloader] ✅ Download concluído com sucesso via yt-dlp em: {output_path}", flush=True)
                return True
        except Exception as e:
            print(f"[Downloader] Aviso: tentativa yt-dlp falhou ({e}). Tentando fallback...", flush=True)
            continue

    # 2. Fallback via pytubefix
    try:
        from pytubefix import YouTube
        for client in ['ANDROID_VR', 'VISION_OS', 'IOS']:
            try:
                print(f"[Downloader] Tentando fallback pytubefix ({client})...", flush=True)
                yt = YouTube(url, client=client)
                stream = yt.streams.filter(progressive=True, file_extension='mp4').order_by('resolution').desc().first()
                if not stream:
                    stream = yt.streams.get_highest_resolution()

                if stream:
                    stream.download(output_path=out_dir, filename=os.path.basename(output_path))
                    if os.path.exists(output_path) and os.path.getsize(output_path) > 10240:
                        print(f"[Downloader] ✅ Download concluído via pytubefix ({client})!", flush=True)
                        return True
            except Exception:
                continue
    except Exception:
        pass

    raise Exception("Não foi possível concluir o download em nenhum dos motores disponíveis.")

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
        print(f"[Downloader Erro] {ex}", file=sys.stderr, flush=True)
        sys.exit(1)
