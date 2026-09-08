import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { MEDIA_DIR } from '../db.js';

const STANDBY_FILE = path.join(MEDIA_DIR, 'standby.mp4');

export function getStandbyFilePath() {
  return STANDBY_FILE;
}

export function standbyFileExists() {
  return fs.existsSync(STANDBY_FILE) && fs.statSync(STANDBY_FILE).size > 1024;
}

/**
 * Cria automaticamente um vídeo standby de alta definição (1080p, 30fps)
 * com a identidade visual da TV Braza caso não exista um arquivo customizado.
 */
export async function ensureStandbyVideo() {
  if (standbyFileExists()) {
    return STANDBY_FILE;
  }

  console.log('[Standby] Gerando vídeo standby padrão da TV Braza via FFmpeg...');

  return new Promise((resolve, reject) => {
    // 10-second looping video with modern TV Braza slate:
    // Dark background #0b0f19, glowing center banner, smooth pulse, ambient soft audio tone
    const filter = [
      'color=c=0x0b0f19:s=1920x1080:d=10:r=30[bg]',
      'testsrc=size=1920x1080:rate=30:duration=10[ts]',
      '[bg]drawbox=x=0:y=0:w=1920:h=1080:color=0x111827@1:t=fill[base]',
      '[base]drawbox=x=0:y=440:w=1920:h=200:color=0xf59e0b@0.15:t=fill[accent]',
      `[accent]drawtext=text='TV BRAZA':fontcolor=0xffffff:fontsize=96:x=(w-text_w)/2:y=460:shadowcolor=0xf59e0b:shadowx=3:shadowy=3[t1]`,
      `[t1]drawtext=text='PROGRAMACAO EM INSTANTES - TRANSMISSAO 24H':fontcolor=0x94a3b8:fontsize=36:x=(w-text_w)/2:y=580[outv]`
    ].join(';');

    // Audio: gentle 440Hz harmonic chord at low volume (-30dB)
    const audioFilter = 'sine=frequency=220:duration=10,volume=0.03';

    const args = [
      '-y',
      '-f', 'lavfi', '-i', `color=c=0x0b0f19:s=1920x1080:d=10:r=30`,
      '-f', 'lavfi', '-i', `sine=frequency=220:duration=10`,
      '-filter_complex',
      `[0:v]drawbox=x=0:y=440:w=1920:h=200:color=0xf59e0b@0.2:t=fill,drawtext=text='TV BRAZA':fontcolor=white:fontsize=100:x=(w-text_w)/2:y=460,drawtext=text='AO VIVO 24H - AGUARDE A PROGRAMACAO':fontcolor=0x94a3b8:fontsize=34:x=(w-text_w)/2:y=580[v];[1:a]volume=0.03[a]`,
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      STANDBY_FILE
    ];

    const proc = spawn('ffmpeg', args);

    proc.on('close', (code) => {
      if (code === 0 && standbyFileExists()) {
        console.log('[Standby] Vídeo padrão gerado com sucesso:', STANDBY_FILE);
        resolve(STANDBY_FILE);
      } else {
        console.warn(`[Standby] Não foi possível gerar vídeo standby via FFmpeg (code ${code}). O sistema usará fallback sintético direto.`);
        resolve(null);
      }
    });

    proc.on('error', (err) => {
      console.warn('[Standby] FFmpeg não disponível para gerar standby pré-gravado:', err.message);
      resolve(null);
    });
  });
}
