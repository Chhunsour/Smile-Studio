export const SOUNDS = [
  { id: 'bright', name: 'Bright steps', kind: 'Music', group: 'Upbeat', bpm: 120, duration: 16, description: 'Upbeat plucks · 120 BPM' },
  { id: 'soft', name: 'Soft focus', kind: 'Music', group: 'Calm', bpm: 90, duration: 16, description: 'Gentle keys · 90 BPM' },
  { id: 'pulse', name: 'Night pulse', kind: 'Music', group: 'Electronic', bpm: 120, duration: 16, description: 'Electronic groove · 120 BPM' },
  { id: 'warm', name: 'Golden hour', kind: 'Music', group: 'Calm', bpm: 80, duration: 18, description: 'Warm arpeggios · 80 BPM' },
  { id: 'lofi', name: 'Lo-fi sketch', kind: 'Music', group: 'Calm', bpm: 90, duration: 16, description: 'Mellow keys and soft beats · 90 BPM' },
  { id: 'playful', name: 'Little adventure', kind: 'Music', group: 'Upbeat', bpm: 128, duration: 15, description: 'Bouncy, bright melody · 128 BPM' },
  { id: 'drift', name: 'Cloud drift', kind: 'Music', group: 'Electronic', bpm: 100, duration: 18, description: 'Airy synth melody · 100 BPM' },
  { id: 'cinema', name: 'Opening scene', kind: 'Music', group: 'Cinematic', bpm: 75, duration: 20, description: 'Slow, spacious tones · 75 BPM' },
  { id: 'pop', name: 'Pop', kind: 'Effects', group: 'Accents', duration: .28, description: 'A playful, quick accent' },
  { id: 'chime', name: 'Chime', kind: 'Effects', group: 'Reveals', duration: 1.1, description: 'A bright reveal' },
  { id: 'whoosh', name: 'Whoosh', kind: 'Effects', group: 'Transitions', duration: .65, description: 'A soft transition sweep' },
  { id: 'tap', name: 'Tap', kind: 'Effects', group: 'Accents', duration: .12, description: 'A subtle rhythmic click' },
  { id: 'rise', name: 'Rise', kind: 'Effects', group: 'Transitions', duration: 1.4, description: 'Build into your next scene' },
  { id: 'sparkle', name: 'Sparkle', kind: 'Effects', group: 'Reveals', duration: 1.5, description: 'A shimmering finish' },
  { id: 'shutter', name: 'Camera click', kind: 'Effects', group: 'Accents', duration: .24, description: 'A crisp, mechanical photo accent' },
  { id: 'impact', name: 'Deep impact', kind: 'Effects', group: 'Transitions', duration: .8, description: 'A low, cinematic hit' },
  { id: 'success', name: 'Small win', kind: 'Effects', group: 'Reveals', duration: .95, description: 'A cheerful two-note reveal' },
  { id: 'rewind', name: 'Rewind', kind: 'Effects', group: 'Transitions', duration: .6, description: 'A descending digital sweep' },
] as const;
export type SoundId = typeof SOUNDS[number]['id'];
export type SoundKind = typeof SOUNDS[number]['kind'];
export const SOUND_RATE = 22050;
const TAU = Math.PI * 2;
const notes = [261.63, 329.63, 392, 523.25, 440, 392, 329.63, 293.66];
const melodies: Partial<Record<SoundId, readonly number[]>> = {
  warm: [220, 277.18, 329.63, 415.3, 369.99, 329.63, 277.18, 246.94],
  lofi: [261.63, 311.13, 392, 466.16, 349.23, 311.13, 233.08, 293.66],
  playful: [523.25, 659.25, 783.99, 659.25, 698.46, 587.33, 783.99, 1046.5],
  drift: [293.66, 369.99, 440, 554.37, 493.88, 440, 369.99, 329.63],
  cinema: [130.81, 196, 261.63, 311.13, 174.61, 261.63, 349.23, 392],
};

export function filterSounds(kind: SoundKind, query = '', group = 'All') {
  const search = query.trim().toLocaleLowerCase();
  return SOUNDS.filter(sound => sound.kind === kind && (group === 'All' || sound.group === group) && (!search || `${sound.name} ${sound.description} ${sound.group}`.toLocaleLowerCase().includes(search)));
}

export function synthesizeSound(id: SoundId): Uint8Array {
  const sound = SOUNDS.find(s => s.id === id);
  if (!sound) throw new Error('Unknown sound');
  const length = Math.round(sound.duration * SOUND_RATE);
  const bytes = new Uint8Array(44 + length * 2), data = new DataView(bytes.buffer);
  const word = (offset: number, value: string) => [...value].forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)));
  word(0, 'RIFF'); data.setUint32(4, bytes.length - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, SOUND_RATE, true); data.setUint32(28, SOUND_RATE * 2, true);
  data.setUint16(32, 2, true); data.setUint16(34, 16, true); word(36, 'data'); data.setUint32(40, length * 2, true);
  let seed = 73829;
  for (let i = 0; i < length; i++) {
    const t = i / SOUND_RATE;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    let v = 0;
    if (sound.kind === 'Music') {
      const beat = 60 / sound.bpm;
      const step = Math.floor(t / beat), local = t % beat;
      const melody = melodies[id] ?? notes;
      const freq = id === 'pulse' ? [220, 261.63, 329.63, 392, 329.63, 261.63, 196, 246.94][step % 8] : melody[step % melody.length];
      const gentle = sound.group === 'Calm' || sound.group === 'Cinematic';
      const decay = Math.exp(-local * (gentle ? 4 : 8));
      v = (Math.sin(TAU * freq * local) + .25 * Math.sin(TAU * freq * 2 * local)) * decay * .22;
      v += Math.sin(TAU * freq / (id === 'pulse' ? 2 : 4) * local) * .13;
      if (id === 'drift') v += Math.sin(TAU * freq * 1.005 * local) * .09 * Math.sin(Math.PI * local / beat);
      if (id === 'cinema') v += Math.sin(TAU * freq / 2 * local) * .12;
      if (id === 'warm') v *= .8;
      v *= Math.min(1, local / .012, (beat - local) / .02);
      if (!gentle || id === 'lofi') {
        const kick = t % (beat * 2);
        v += Math.sin(TAU * (48 * kick + 3 * (1 - Math.exp(-kick * 30)))) * Math.exp(-kick * 18) * .25;
        v += noise * Math.exp(-(t % (beat / 2)) * 100) * (id === 'lofi' ? .025 : .055);
      }
    } else if (id === 'pop') v = Math.sin(TAU * (450 * t - 550 * t * t)) * Math.exp(-t * 22) * .65;
    else if (id === 'tap') v = noise * Math.exp(-t * 80) * .55;
    else if (id === 'whoosh') v = noise * Math.sin(Math.PI * t / sound.duration) ** 2 * .25;
    else if (id === 'rise') v = (Math.sin(TAU * (150 * t + 350 * t * t)) * .2 + noise * .08) * (t / sound.duration) ** 2;
    else if (id === 'chime') v = (Math.sin(TAU * 880 * t) + .5 * Math.sin(TAU * 1320 * t)) * Math.exp(-t * 5) * .32;
    else if (id === 'shutter') v = noise * (Math.exp(-t * 100) + .65 * Math.exp(-Math.abs(t - .07) * 140)) * .45;
    else if (id === 'impact') v = (Math.sin(TAU * (45 * t + 2.5 * (1 - Math.exp(-t * 30)))) * Math.exp(-t * 7) * .65 + noise * Math.exp(-t * 40) * .18);
    else if (id === 'success') {
      const local = t < .18 ? t : t - .18;
      const frequency = t < .18 ? 659.25 : 987.77;
      v = (Math.sin(TAU * frequency * local) + .3 * Math.sin(TAU * frequency * 2 * local)) * Math.exp(-local * 7) * Math.min(1, local / .008, t < .18 ? (.18 - t) / .008 : 1) * .35;
    } else if (id === 'rewind') v = Math.sin(TAU * (1300 * t - 850 * t * t)) * (.6 + .4 * Math.cos(TAU * 22 * t)) * Math.sin(Math.PI * t / sound.duration) ** 2 * .3;
    else v = (Math.sin(TAU * 1046.5 * t) + Math.sin(TAU * 1568 * t) * .5) * Math.exp(-t * 3) * (.6 + .4 * Math.cos(TAU * 8 * t)) * .3;
    const envelope = Math.min(1, t / .008, (sound.duration - t) / .025);
    data.setInt16(44 + i * 2, Math.round(Math.max(-.95, Math.min(.95, v * envelope)) * 32767), true);
  }
  return bytes;
}
