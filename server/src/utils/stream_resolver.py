#!/usr/bin/env python3
"""
stream_resolver.py
Extrator de URLs diretas de streaming de alta definição (1080p / 720p)
sem bloqueio de bot do YouTube usando múltiplos clientes especiais (VISION_OS, WEB_SAFARI, ANDROID_VR, etc).
Permite reprodução contínua direta via FFmpeg com ZERO anúncios e ZERO uso de disco.
"""
import sys
import json
import subprocess

def resolve_stream(url):
    clients = ['VISION_OS', 'WEB_SAFARI', 'ANDROID_VR', 'IOS', 'MWEB']
    
    # 1. Tentar via pytubefix com clientes de bypass
    try:
        from pytubefix import YouTube
        for client in clients:
            try:
                yt = YouTube(url, client=client)
                # Tenta 1080p -> 720p -> melhor disponível
                video = (yt.streams.filter(res='1080p', type='video').first() or 
                         yt.streams.filter(res='720p', type='video').first() or 
                         yt.streams.filter(type='video').order_by('resolution').desc().first() or 
                         yt.streams.get_highest_resolution())
                
                audio = yt.streams.get_audio_only()
                
                if video and video.url:
                    return {
                        'success': True,
                        'provider': f'pytubefix_{client}',
                        'title': yt.title,
                        'videoUrl': video.url,
                        'audioUrl': audio.url if (audio and not video.is_progressive) else None,
                        'isProgressive': bool(video.is_progressive or not audio),
                        'resolution': video.resolution or '1080p'
                    }
            except Exception:
                continue
    except Exception:
        pass

    # 2. Fallback via yt-dlp usando cliente android
    try:
        cmd = [
            'yt-dlp',
            '--no-playlist',
            '--extractor-args', 'youtube:player_client=android',
            '-g',
            '-f', 'b/best',
            url
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
        if res.returncode == 0 and res.stdout.strip():
            urls = res.stdout.strip().split('\n')
            return {
                'success': True,
                'provider': 'yt-dlp_android',
                'title': 'YouTube Stream',
                'videoUrl': urls[0],
                'audioUrl': urls[1] if len(urls) > 1 else None,
                'isProgressive': len(urls) == 1,
                'resolution': '720p'
            }
    except Exception:
        pass

    return {
        'success': False,
        'error': 'Não foi possível resolver os fluxos de áudio e vídeo sem autenticação de bot.'
    }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Informe a URL do vídeo'}))
        sys.exit(1)
    
    url = sys.argv[1]
    result = resolve_stream(url)
    print(json.dumps(result))
