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
export async function ensureStandbyVideo(forceRegenerate = false) {
  if (standbyFileExists() && !forceRegenerate) {
    return STANDBY_FILE;
  }

  console.log('[Standby] Gerando vídeo standby HD moderno da TV Braza com música ambiente sem direitos autorais...');

  const musicFile = path.resolve(__dirname, '../../public/assets/standby_music.wav');
  const genScript = path.resolve(__dirname, '../utils/generate_standby_music.py');

  if (!fs.existsSync(musicFile) && fs.existsSync(genScript)) {
    try {
      const { execFileSync } = await import('child_process');
      execFileSync('python3', [genScript, musicFile]);
    } catch (_) {}
  }

  return new Promise((resolve) => {
    let audioInput = [];
    if (fs.existsSync(musicFile)) {
      audioInput = ['-stream_loop', '-1', '-i', musicFile];
    } else {
      const audioExpr = 'aevalsrc=\'0.05*sin(2*PI*220*t)*sin(0.3*PI*t)+0.05*sin(2*PI*277.18*t)+0.04*sin(2*PI*329.63*t)+0.03*sin(2*PI*440*t)+0.03*sin(2*PI*110*t)\':s=44100:d=10';
      audioInput = ['-f', 'lavfi', '-i', audioExpr];
    }

    // Vídeo: Card escuro futurista com borda neon dourada e sombra, textos elegantes em alta resolução
    const videoFilter = [
      '[0:v]drawbox=x=0:y=0:w=1920:h=1080:color=0x070a14@1:t=fill[bg]',
      '[bg]drawbox=x=310:y=210:w=1300:h=660:color=0x0f172a@0.9:t=fill[card]',
      '[card]drawbox=x=310:y=210:w=1300:h=8:color=0xf59e0b:t=fill[card_border]',
      '[card_border]drawtext=text=\'TV BRAZA\':fontcolor=0xffffff:fontsize=120:x=(w-text_w)/2:y=320:shadowcolor=0xf59e0b:shadowx=4:shadowy=4[t1]',
      '[t1]drawtext=text=\'ESTUDIO DE TRANSMISSAO 24H • PROGRAMACAO EM INSTANTES\':fontcolor=0x94a3b8:fontsize=30:x=(w-text_w)/2:y=470[t2]',
      '[t2]drawbox=x=760:y=560:w=400:h=56:color=0x10b981@0.15:t=fill[tag_bg]',
      '[tag_bg]drawbox=x=760:y=560:w=400:h=56:color=0x10b981@0.5:t=2[tag_border]',
      '[tag_border]drawtext=text=\'● SINAL NO AR • 1080p 60FPS\':fontcolor=0x10b981:fontsize=20:x=(w-text_w)/2:y=578[t3]',
      '[t3]drawtext=text=\'TV Braza Studio 24/7 - Transmissao Continua sem Interrupcao\':fontcolor=0x64748b:fontsize=20:x=(w-text_w)/2:y=760[outv]'
    ].join(';');

    const args = [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0x070a14:s=1920x1080:d=10:r=30',
      ...audioInput,
      '-filter_complex', videoFilter,
      '-map', '[outv]',
      '-map', '1:a',
      '-t', '10',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k',
      STANDBY_FILE
    ];

    const proc = spawn('ffmpeg', args);

    proc.on('close', (code) => {
      if (code === 0 && standbyFileExists()) {
        console.log('[Standby] Vídeo HD com música ambiente gerado com sucesso:', STANDBY_FILE);
        resolve(STANDBY_FILE);
      } else {
        console.warn(`[Standby] Não foi possível gerar vídeo standby via FFmpeg (código ${code}). Usando fallback sintético.`);
        resolve(null);
      }
    });

    proc.on('error', (err) => {
      console.warn('[Standby] Erro ao disparar FFmpeg para standby:', err.message);
      resolve(null);
    });
  });
}
