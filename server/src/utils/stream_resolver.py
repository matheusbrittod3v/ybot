#!/usr/bin/env python3
"""
stream_resolver.py
Extrator Definitivo de URLs Diretas de Streaming (1080p / 720p / 4K)
Bypass Total de Bloqueio Bot / SABR / PO Token do YouTube:
- Utiliza cliente ANDROID_VR e ANDROID (imunes a SABR e restrições de PO Token em datacenters).
- Tenta com e sem cookies para máxima compatibilidade entre IPs residenciais e de datacenter.
- Timeout generoso de 30s para vídeos longos e podcasts.
- Extração de alta precisão sem quebra por mensagens de console.
"""
import sys
import os
import json
import subprocess

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

def parse_yt_dlp_output(stdout_text):
    raw_lines = [l.strip() for l in stdout_text.split('\n') if l.strip()]
    urls = [l for l in raw_lines if l.startswith('http://') or l.startswith('https://')]
    titles = [
        l for l in raw_lines
        if not l.startswith('http') and not l.startswith(('Deprecated', 'WARNING', '[youtube', '['))
    ]
    title = titles[0] if titles else 'YouTube Video'

    if len(urls) >= 1:
        video_url = urls[0]
        audio_url = urls[1] if len(urls) > 1 else None
        is_progressive = len(urls) == 1
        return {
            'success': True,
            'provider': 'yt-dlp_android_vr',
            'title': title,
            'videoUrl': video_url,
            'audioUrl': audio_url,
            'isProgressive': is_progressive,
            'resolution': '1080p' if not is_progressive else '720p'
        }
    return None

def resolve_stream(url):
    cookies_path = find_cookies_file()

    # Identifica binários disponíveis
    yt_commands = [
        [sys.executable, '-m', 'yt_dlp'],
        ['yt-dlp'],
        ['/usr/local/bin/yt-dlp']
    ]

    base_args = [
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=android_vr,android,web',
        '-e',
        '-g',
        '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bestvideo+bestaudio/best',
        url
    ]

    # 1. Tenta yt-dlp COM cookies (se disponível)
    if cookies_path:
        for yt_bin in yt_commands:
            try:
                cmd = yt_bin + base_args + ['--cookies', cookies_path]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                if res.returncode == 0 and res.stdout.strip():
                    parsed = parse_yt_dlp_output(res.stdout)
                    if parsed:
                        return parsed
                else:
                    if res.stderr.strip():
                        print(f"[Resolver Debug com cookies] {yt_bin[0]} erro: {res.stderr.strip()[:200]}", file=sys.stderr)
            except Exception as e:
                continue

    # 2. Tenta yt-dlp SEM cookies (muitas vezes IPs de datacenter funcionam melhor sem cookies para ANDROID_VR)
    for yt_bin in yt_commands:
        try:
            cmd = yt_bin + base_args
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if res.returncode == 0 and res.stdout.strip():
                parsed = parse_yt_dlp_output(res.stdout)
                if parsed:
                    parsed['provider'] = 'yt-dlp_nocookies'
                    return parsed
            else:
                if res.stderr.strip():
                    print(f"[Resolver Debug sem cookies] {yt_bin[0]} erro: {res.stderr.strip()[:200]}", file=sys.stderr)
        except Exception:
            continue

    # 3. Fallback Secundário: pytubefix com ANDROID_VR
    try:
        from pytubefix import YouTube
        for client in ['ANDROID_VR', 'VISION_OS', 'IOS']:
            try:
                yt = YouTube(url, client=client)
                video = (
                    yt.streams.filter(res='1080p', type='video').first() or
                    yt.streams.filter(res='720p', type='video').first() or
                    yt.streams.filter(progressive=True).order_by('resolution').desc().first() or
                    yt.streams.get_highest_resolution()
                )
                audio = yt.streams.get_audio_only()
                if video and video.url:
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
        'error': 'Não foi possível resolver os fluxos de áudio e vídeo do YouTube.'
    }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Informe a URL do vídeo'}))
        sys.exit(1)
    
    video_url = sys.argv[1]
    result = resolve_stream(video_url)
    print(json.dumps(result))
