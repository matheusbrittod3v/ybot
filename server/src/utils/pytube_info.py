#!/usr/bin/env python3
"""
pytube_info.py
Extrator de metadados do YouTube via pytubefix com PO Token automático.
Retorna JSON com title, channel, duration, thumbnail e views.
"""
import sys
import json
from pytubefix import YouTube

if len(sys.argv) < 2:
    print(json.dumps({"error": "URL ausente"}))
    sys.exit(1)

url = sys.argv[1]

# Prioriza clientes que não sofrem bot-challenge do Google (Apple clients e Mobile Web)
for client in ['VISION_OS', 'IOS', 'MWEB', 'WEB_SAFARI', 'ANDROID_VR', 'WEB']:
    try:
        yt = YouTube(url, client=client)
        data = {
            "title": yt.title,
            "channel": yt.author,
            "duration": yt.length or 0,
            "thumbnail": yt.thumbnail_url or "",
            "views": yt.views or 0
        }
        print(json.dumps(data))
        sys.exit(0)
    except Exception:
        continue

print(json.dumps({"error": "Falha ao extrair metadados"}))
sys.exit(1)
