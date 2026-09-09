#!/usr/bin/env python3
"""
generate_standby_music.py
Gera uma trilha sonora ambiente relaxante e elegante (A Major 9 Ambient Pad)
100% sem direitos autorais (Royalty-Free) para a tela de Standby da TV Braza.
"""
import os
import math
import wave
import struct

def generate_ambient_music(output_file):
    sample_rate = 44100
    duration = 10.0 # segundos
    num_samples = int(sample_rate * duration)

    # Notas do acorde elegante A Major 9 (A2, E3, A3, C#4, E4, G#4, B4)
    notes = [
        (110.0, 0.18),    # A2 (Grave / Bass)
        (164.81, 0.12),   # E3
        (220.0, 0.14),    # A3
        (277.18, 0.12),   # C#4
        (329.63, 0.10),   # E4
        (415.30, 0.08),   # G#4 (Major 7th)
        (493.88, 0.06)    # B4 (9th)
    ]

    os.makedirs(os.path.dirname(output_file), exist_ok=True)

    with wave.open(output_file, 'w') as wav_file:
        wav_file.setnchannels(2) # Stereo
        wav_file.setsampwidth(2) # 16-bit
        wav_file.setframerate(sample_rate)

        frames = bytearray()
        for i in range(num_samples):
            t = i / sample_rate
            
            # Envelope de fade-in (1s) e fade-out (1s) para loop perfeito sem estalos
            envelope = 1.0
            if t < 1.0:
                envelope = t
            elif t > (duration - 1.0):
                envelope = duration - t
                
            # LFO de tremolo suave (0.2 Hz)
            lfo = 0.85 + 0.15 * math.sin(2 * math.pi * 0.2 * t)
            
            # Sintetiza as notas do acorde com timbres harmônicos suaves
            left_val = 0.0
            right_val = 0.0
            for idx, (freq, amp) in enumerate(notes):
                # Fundamental + 2º harmônico suave
                wave_val = amp * (math.sin(2 * math.pi * freq * t) + 0.25 * math.sin(4 * math.pi * freq * t))
                # Panning estéreo sutil por frequência
                pan_angle = (idx / len(notes)) * math.pi * 0.5
                left_val += wave_val * math.cos(pan_angle)
                right_val += wave_val * math.sin(pan_angle)

            left_sample = int(left_val * envelope * lfo * 32767 * 0.6)
            right_sample = int(right_val * envelope * lfo * 32767 * 0.6)

            left_sample = max(-32767, min(32767, left_sample))
            right_sample = max(-32767, min(32767, right_sample))

            frames.extend(struct.pack('<hh', left_sample, right_sample))

        wav_file.writeframes(frames)
    print(f'[Standby Music] Trilha ambiente gerada com sucesso em: {output_file}')

if __name__ == '__main__':
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else 'server/public/assets/standby_music.wav'
    generate_ambient_music(target)
