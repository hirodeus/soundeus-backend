export type TrackEvent = { note:string, time:number, duration:number, velocity:number };
export type Track = { channelId:string, prompt:string, profileName:string, preset:string, role:string, bpm:number, key:string, mode:string, melody:TrackEvent[], bass:TrackEvent[], drums:any };
const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function noteToFreq(note:string){
  const m = note.match(/^([A-G]#?)(\d)$/);
  if(!m) return 440;
  const name = m[1];
  const octave = parseInt(m[2],10);
  const n = NOTES.indexOf(name);
  const semitoneIndex = n + (octave - 4)*12;
  const a4Index = NOTES.indexOf('A');
  const diff = semitoneIndex - a4Index;
  return 440 * Math.pow(2, diff/12);
}
function hashCode(s:string){ let h=0; for(let i=0;i<s.length;i++){ h = ((h<<5)-h)+s.charCodeAt(i); h |= 0; } return Math.abs(h); }
function mulberry32(a:number){ return function(){ var t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; } }
function noteFromScale(root:string, scale:number[], index:number, octave=4){ const rootIdx = NOTES.indexOf(root.toUpperCase()); const degree = scale[index % scale.length]; const noteIdx = (rootIdx + degree) % 12; return NOTES[noteIdx] + octave; }
const SCALES:any = { major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10], pentatonic:[0,2,4,7,9] };
export function generateTrackFromPrompt(opts:{channelId:string,prompt:string,bpm:number,key:string,mode:string}){
  const { channelId,prompt,bpm=100,key='C',mode='minor' } = opts;
  const p = prompt.toLowerCase();
  const profileName = p.includes('zamba') ? 'zamba' : p.includes('african') ? 'african voices' : p.includes('brazil') ? 'brazil drums' : p.includes('trumpet') ? 'mexican trumpet' : p.includes('house') ? 'house' : p.includes('lofi') ? 'lofi' : 'ambient';
  const style = profileName.includes('house') ? 'house' : 'ethnic';
  const seed = hashCode(prompt + '::' + Date.now());
  const rand = mulberry32(seed);
  const scale = SCALES[mode] || SCALES.minor;
  const bars = 8;
  const slots = bars * 4;
  const melody:TrackEvent[] = [];
  for(let t=0;t<slots;t++){
    if(rand() < 0.5){
      const idx = Math.floor(rand()*scale.length);
      const octave = (rand() < 0.3) ? 5 : 4;
      const note = noteFromScale(key, scale, idx, octave);
      const dur = [0.25,0.5,1][Math.floor(rand()*3)];
      melody.push({ note, time: t*0.25, duration: dur, velocity: 0.6 + rand()*0.4 });
    }
  }
  const bass:TrackEvent[] = [];
  for(let t=0;t<bars*2;t++){
    if(rand() < 0.4){
      const idx = Math.floor(rand()*scale.length);
      const note = noteFromScale(key, scale, idx, 2);
      bass.push({ note, time: t*0.5, duration: 0.5, velocity: 0.7 });
    }
  }
  const drums = { pattern:[1,0,0,0,1,0,1,0] };
  return { channelId, prompt, profileName, preset:'synth', role:style, bpm, key, mode, melody, bass, drums };
}
export async function renderTrackToWavBase64(track:Track, opts:{sampleRate?:number} = {}){
  const sampleRate = opts.sampleRate || 44100;
  const durationSeconds = Math.max( (track.melody.length ? track.melody[track.melody.length-1].time + track.melody[track.melody.length-1].duration : 4), 4 );
  const totalSamples = Math.ceil(durationSeconds * sampleRate);
  const buffer = new Float32Array(totalSamples);
  for(const ev of track.melody){
    const freq = noteToFreq(ev.note);
    const startSample = Math.floor(ev.time * sampleRate);
    const len = Math.floor(ev.duration * sampleRate);
    for(let i=0;i<len;i++){
      const t = i / sampleRate;
      const env = Math.exp(-3 * (i/len));
      const s = Math.sin(2*Math.PI*freq*t) * ev.velocity * env * 0.6;
      const idx = startSample + i;
      if(idx < buffer.length) buffer[idx] += s;
    }
  }
  for(const ev of track.bass){
    const freq = noteToFreq(ev.note);
    const startSample = Math.floor(ev.time * sampleRate);
    const len = Math.floor(ev.duration * sampleRate);
    for(let i=0;i<len;i++){
      const t = i / sampleRate;
      const env = 0.9 * Math.exp(-2 * (i/len));
      const s = Math.sign(Math.sin(2*Math.PI*freq*t)) * ev.velocity * env * 0.5;
      const idx = startSample + i;
      if(idx < buffer.length) buffer[idx] += s;
    }
  }
  const beatLength = 0.25;
  for(let i=0;i<track.drums.pattern.length;i++){
    if(track.drums.pattern[i]){
      const t0 = i * beatLength;
      const start = Math.floor(t0 * sampleRate);
      const len = Math.floor(0.08 * sampleRate);
      for(let j=0;j<len;j++){
        const n = (Math.random()*2-1) * Math.exp(-10 * (j/len));
        const idx = start + j;
        if(idx < buffer.length) buffer[idx] += n * 0.8;
      }
    }
  }
  let maxAmp = 0;
  for(let i=0;i<buffer.length;i++) if(Math.abs(buffer[i]) > maxAmp) maxAmp = Math.abs(buffer[i]);
  if(maxAmp < 1e-5) maxAmp = 1;
  const norm = 0.9 / maxAmp;
  for(let i=0;i<buffer.length;i++) buffer[i] = Math.max(-1, Math.min(1, buffer[i] * norm));
  const wav = encodeWAV(buffer, sampleRate);
  return wav;
}
function encodeWAV(float32Array:Float32Array, sampleRate:number){
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = float32Array.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for(let i=0;i<float32Array.length;i++, offset += 2){
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  const bytes = new Uint8Array(buffer);
  // Node base64
  const nodeBuf = Buffer.from(bytes);
  return nodeBuf.toString('base64');
}
function writeString(view:DataView, offset:number, str:string){
  for(let i=0;i<str.length;i++) view.setUint8(offset + i, str.charCodeAt(i));
}
