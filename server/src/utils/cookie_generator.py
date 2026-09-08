#!/usr/bin/env python3
"""
cookie_generator.py
Gera automaticamente cookies sintéticos/falsos e tokens de sessão de visitante do YouTube
em formato Netscape cookies.txt para contornar bloqueios anti-bot em VPS sem intervenção manual.
"""
import sys
import os
import time
import random
import string
import urllib.request
import http.cookiejar

def generate_random_token(length=32):
    chars = string.ascii_letters + string.digits
    return ''.join(random.choice(chars) for _ in range(length))

def generate_cookies(output_path):
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    
    cj = http.cookiejar.MozillaCookieJar(output_path)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    
    # User-Agent moderno e realista de navegador
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
    ]
    ua = random.choice(user_agents)
    
    opener.addheaders = [
        ('User-Agent', ua),
        ('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'),
        ('Accept-Language', 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'),
        ('Sec-Fetch-Dest', 'document'),
        ('Sec-Fetch-Mode', 'navigate'),
        ('Sec-Fetch-Site', 'none'),
        ('Sec-Fetch-User', '?1'),
        ('Upgrade-Insecure-Requests', '1')
    ]

    print(f"[CookieGenerator] Solicitando handshake com o YouTube...", flush=True)
    try:
        req = urllib.request.Request('https://www.youtube.com', headers=dict(opener.addheaders))
        resp = opener.open(req, timeout=10)
        cj.save(ignore_discard=True, ignore_expires=True)
        print(f"[CookieGenerator] Tokens de visitante recebidos do YouTube.", flush=True)
    except Exception as e:
        print(f"[CookieGenerator] Aviso na coleta inicial: {e}. Gerando estrutura sintética...", flush=True)

    # Garante que o arquivo exista
    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        with open(output_path, 'w') as f:
            f.write("# Netscape HTTP Cookie File\n")
            f.write("# http://curl.haxx.se/rfc/cookie_spec.html\n")
            f.write("# This is a generated file!  Do not edit.\n\n")

    now = int(time.time())
    expires = now + (60 * 60 * 24 * 365) # 1 ano de validade

    # Lê cookies existentes para evitar duplicatas
    existing_content = ""
    try:
        with open(output_path, 'r') as f:
            existing_content = f.read()
    except Exception:
        pass

    extra_cookies = []

    # Se o YouTube não enviou VISITOR_INFO1_LIVE, injeta sintético
    if 'VISITOR_INFO1_LIVE' not in existing_content:
        synth_visitor = generate_random_token(11)
        extra_cookies.append(f".youtube.com\tTRUE\t/\tTRUE\t{expires}\tVISITOR_INFO1_LIVE\t{synth_visitor}\n")

    # Injeta tokens de consentimento LGPD/GDPR aprovados
    if 'SOCS' not in existing_content:
        extra_cookies.append(f".youtube.com\tTRUE\t/\tTRUE\t{expires}\tSOCS\tCAISOAgFEgkJnQ%3D%3D\n")

    # Injeta preferências de idioma e player
    if 'PREF' not in existing_content:
        extra_cookies.append(f".youtube.com\tTRUE\t/\tTRUE\t{expires}\tPREF\tf6=40000000&hl=pt-BR&gl=BR\n")

    if 'CONSENT' not in existing_content:
        extra_cookies.append(f".youtube.com\tTRUE\t/\tTRUE\t{expires}\tCONSENT\tYES+cb.20210328-17-p0.pt-BR+FX+999\n")

    if 'GPS' not in existing_content:
        extra_cookies.append(f".youtube.com\tTRUE\t/\tTRUE\t{now + 86400}\tGPS\t1\n")

    if extra_cookies:
        with open(output_path, 'a') as f:
            for c in extra_cookies:
                f.write(c)

    file_size = os.path.getsize(output_path)
    print(f"[CookieGenerator] Cookies gravados com sucesso em {output_path} ({file_size} bytes)!", flush=True)
    return True

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else '/app/data/cookies.txt'
    try:
        generate_cookies(target)
        sys.exit(0)
    except Exception as err:
        print(f"[CookieGenerator Erro] {err}", file=sys.stderr)
        sys.exit(1)
