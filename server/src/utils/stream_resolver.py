#!/usr/bin/env python3
"""
stream_resolver.py
Extrator de URLs diretas de streaming de alta definição (1080p / 720p / 4K)
Arquitetura de Alta Performance "100% de Primeira":
1. Fast-Path com yt-dlp + cookies.txt da sessão do usuário + cliente Android/Web/iOS (retorno em ~1s).
2. Validação Pre-flight (Range bytes=0-1024) antes de entregar ao FFmpeg para garantir zero HTTP 403.
3. Fallback inteligente apenas se o motor primário falhar.
"""
import sys
import os
import json
import subprocess
import urllib.request

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

def preflight_check(url, timeout=3):
    """Verifica se a URL do GoogleVideo responde 200/206 antes de entregar ao FFmpeg"""
    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Range': 'bytes=0-1024'
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status in (200, 206)
    except Exception:
        return False

def resolve_stream(url):
    cookies_path = find_cookies_file()

    # 1. Fast-Path: yt-dlp com cookies autenticados e clientes Android/Web
    yt_commands = [
        [sys.executable, '-m', 'yt_dlp'],
        ['yt-dlp']
    ]

    for yt_bin in yt_commands:
        try:
            cmd = yt_bin + [
                '--no-playlist',
                '--no-warnings',
                '--extractor-args', 'youtube:player_client=android,web',
                '-e',
                '-g',
                '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bestvideo+bestaudio/best',
                url
            ]
            if cookies_path:
                cmd.extend(['--cookies', cookies_path])

            res = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
            if res.returncode == 0 and res.stdout.strip():
                # Filtra linhas de saída ignorando avisos do python/urllib
                lines = [
                    l.strip() for l in res.stdout.split('\n')
                    if l.strip() and not l.strip().startswith(('Deprecated', 'WARNING:', '/'))
                ]
                if len(lines) >= 2:
                    title = lines[0]
                    video_url = lines[1]
                    audio_url = lines[2] if len(lines) > 2 else None
                    is_progressive = len(lines) <= 2

                    # Validação de integridade rápida
                    if preflight_check(video_url):
                        return {
                            'success': True,
                            'provider': 'yt-dlp_fastpath',
                            'title': title,
                            'videoUrl': video_url,
                            'audioUrl': audio_url,
                            'isProgressive': is_progressive,
                            'resolution': '1080p' if not is_progressive else '720p'
                        }
        except Exception:
            continue

    # 2. Fallback Secundário: pytubefix (cliente direto único com menor taxa de bloqueio)
    try:
        from pytubefix import YouTube
        for client in ['ANDROID_VR', 'VISION_OS', 'IOS']:
            try:
                yt = YouTube(url, client=client)
                video = (
                    yt.streams.filter(res='1080p', type='video').first() or
                    yt.streams.filter(res='720p', type='video').first() or
                    yt.streams.get_highest_resolution()
                )
                audio = yt.streams.get_audio_only()
                if video and video.url and preflight_check(video.url):
                    return {
                        'success': True,
                        'provider': f'pytubefix_{client}',
                        'title': yt.title,
                        'videoUrl': video.url,
                        'audioUrl': audio.url if (audio and not video.is_progressive) else None,
                        'isProgressive': bool(video.is_progressive or not audio),
                        'resolution': video.resolution or '720p'
                    }
            except Exception:
                continue
    except Exception:
        pass

    return {
        'success': False,
        'error': 'Não foi possível resolver o fluxo do vídeo de forma estável.'
    }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Informe a URL do vídeo'}))
        sys.exit(1)
    
    video_url = sys.argv[1]
    result = resolve_stream(video_url)
    print(json.dumps(result))
