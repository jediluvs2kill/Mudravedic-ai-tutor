
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob as GeminiBlob } from '@google/genai';
import { decode, encode, decodeAudioData } from './utils/audioUtils';

// --- Constants ---
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
const FRAME_RATE = 1; 
const JPEG_QUALITY = 0.6;
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const AUDIO_GAIN_VALUE = 4.0; 

// Mudra Catalog Data with High-Accuracy Visuals
const MUDRA_CATALOG = [
  { 
    name: 'Gyan', 
    power: 5, 
    focus: 'Wisdom', 
    description: 'Touch thumb to index. The "Seal of Knowledge" for deep concentration.', 
    tier: 'Master', 
    color: 'rgba(245, 158, 11, 0.6)',
    imageUrl: 'https://images.unsplash.com/photo-1617113930975-f9c732338696?auto=format&fit=crop&w=500&q=80' 
  },
  { 
    name: 'Prana', 
    power: 5, 
    focus: 'Vitality', 
    description: 'Thumb to ring and pinky. Ignites life force and boosts immunity.', 
    tier: 'Master', 
    color: 'rgba(245, 158, 11, 0.6)',
    imageUrl: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=500&q=80'
  },
  { 
    name: 'Shunya', 
    power: 4, 
    focus: 'Ethereal', 
    description: 'Middle finger under thumb. Clears inner hearing and the "Inner Sky".', 
    tier: 'Elite', 
    color: 'rgba(34, 211, 238, 0.6)',
    imageUrl: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=500&q=80'
  },
  { 
    name: 'Surya', 
    power: 4, 
    focus: 'Fire', 
    description: 'Fold ring finger under thumb. Boosts fire element and metabolism.', 
    tier: 'Elite', 
    color: 'rgba(34, 211, 238, 0.6)',
    imageUrl: 'https://images.unsplash.com/photo-1599447421416-3414500d1f15?auto=format&fit=crop&w=500&q=80'
  },
  { 
    name: 'Anjali', 
    power: 3, 
    focus: 'Unity', 
    description: 'Pressed palms together. Harmonizes the heart and mind.', 
    tier: 'Adept', 
    color: 'rgba(255, 255, 255, 0.4)',
    imageUrl: 'https://images.unsplash.com/photo-1515377662630-6c7b98a246a2?auto=format&fit=crop&w=500&q=80'
  },
  { 
    name: 'Apana', 
    power: 3, 
    focus: 'Detox', 
    description: 'Thumb to middle and ring. The Mudra of Digestion and Cleansing.', 
    tier: 'Adept', 
    color: 'rgba(255, 255, 255, 0.4)',
    imageUrl: 'https://images.unsplash.com/photo-1635848602276-dbca9620c393?auto=format&fit=crop&w=500&q=80'
  },
  { 
    name: 'Prithvi', 
    power: 2, 
    focus: 'Earth', 
    description: 'Thumb to ring finger. Grounding, stability, and physical strength.', 
    tier: 'Basic', 
    color: 'rgba(255, 255, 255, 0.4)',
    imageUrl: 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?auto=format&fit=crop&w=500&q=80'
  },
];

const INTUITION_MUDRA = { name: 'Intuitional Flow', power: '?', focus: 'Intuition', description: 'Spontaneous energy channeling.', tier: 'Unbound', color: 'rgba(168, 85, 247, 0.6)' };

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

const App: React.FC = () => {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [transcription, setTranscription] = useState<string[]>([]);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetMudra, setTargetMudra] = useState<string | null>(null);
  const [validatedMudra, setValidatedMudra] = useState<typeof MUDRA_CATALOG[0] | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<{
    input: AudioContext;
    output: AudioContext;
    inputNode: GainNode;
    outputNode: GainNode;
    compressor: DynamicsCompressorNode;
    audioTag: HTMLAudioElement;
  } | null>(null);
  const sessionRef = useRef<any>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  
  const currentOutputRef = useRef("");
  const currentInputRef = useRef("");

  useEffect(() => {
    const checkKey = async () => {
      try {
        const selected = await window.aistudio?.hasSelectedApiKey();
        setHasKey(!!selected);
      } catch (e) {
        setHasKey(false);
      }
    };
    checkKey();
  }, []);

  useEffect(() => {
    if (validatedMudra) {
      const timer = setTimeout(() => setValidatedMudra(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [validatedMudra]);

  const handleSelectKey = async () => {
    try {
      await window.aistudio?.openSelectKey();
      setHasKey(true);
    } catch (e) {
      setError("Failed to open key selection dialog.");
    }
  };

  const initAudio = useCallback(() => {
    if (!audioContextRef.current) {
      const input = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
      const output = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
      const inputNode = input.createGain();
      const outputNode = output.createGain();
      outputNode.gain.value = AUDIO_GAIN_VALUE;

      const compressor = output.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-20, output.currentTime);
      compressor.knee.setValueAtTime(30, output.currentTime);
      compressor.ratio.setValueAtTime(12, output.currentTime);
      compressor.attack.setValueAtTime(0.003, output.currentTime);
      compressor.release.setValueAtTime(0.25, output.currentTime);

      const dest = output.createMediaStreamDestination();
      const audioTag = new Audio();
      audioTag.srcObject = dest.stream;
      audioTag.setAttribute('playsinline', 'true');
      audioTag.autoplay = true;

      outputNode.connect(compressor);
      compressor.connect(dest);
      compressor.connect(output.destination);
      
      audioContextRef.current = { input, output, inputNode, outputNode, compressor, audioTag };
    }
    return audioContextRef.current;
  }, []);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (frameIntervalRef.current) {
      window.clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    setIsActive(false);
    setIsInitializing(false);
    setTargetMudra(null);
    setValidatedMudra(null);
  }, []);

  const startSession = async (mudraName?: string) => {
    setIsInitializing(true);
    setError(null);
    const contexts = initAudio();
    contexts.audioTag.play().catch(console.error);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: { width: { ideal: 640 }, height: { ideal: 480 } } 
      });

      if (videoRef.current) videoRef.current.srcObject = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const instruction = `You are a Vedic Master. Your tone is resonant, ancient, and deeply interpretive.
      Identify traditional mudras. BUT, if the user makes "wacky", non-traditional, or spontaneous movements, do NOT say you don't know them.
      Instead, use your ancient wisdom to interpret the 'Sacred Geometry' of their hands. 
      Interpret the flow, the tension, and the geometric intent (triangles, circles, spikes). 
      Every movement is a 'Sacred Intuition'. Explain its unique 'Intuitional Power'.`;

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: instruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsInitializing(false);
            setIsActive(true);
            if (mudraName) setTargetMudra(mudraName);

            const source = contexts.input.createMediaStreamSource(stream);
            const scriptProcessor = contexts.input.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob: GeminiBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then(session => session?.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(contexts.input.destination);

            frameIntervalRef.current = window.setInterval(() => {
              if (videoRef.current && canvasRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                if (ctx) {
                  canvasRef.current.width = videoRef.current.videoWidth;
                  canvasRef.current.height = videoRef.current.videoHeight;
                  ctx.drawImage(videoRef.current, 0, 0);
                  canvasRef.current.toBlob(async (blob) => {
                    if (blob) {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        const base64Data = (reader.result as string).split(',')[1];
                        sessionPromise.then(session => {
                          session?.sendRealtimeInput({
                            media: { data: base64Data, mimeType: 'image/jpeg' }
                          });
                        });
                      };
                      reader.readAsDataURL(blob);
                    }
                  }, 'image/jpeg', JPEG_QUALITY);
                }
              }
            }, 1000 / FRAME_RATE);
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              const audioBuffer = await decodeAudioData(decode(base64Audio), contexts.output, OUTPUT_SAMPLE_RATE, 1);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, contexts.output.currentTime);
              const source = contexts.output.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(contexts.outputNode);
              source.onended = () => sourcesRef.current.delete(source);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            if (message.serverContent?.inputTranscription) currentInputRef.current += message.serverContent.inputTranscription.text;
            if (message.serverContent?.outputTranscription) currentOutputRef.current += message.serverContent.outputTranscription.text;
            
            if (message.serverContent?.turnComplete) {
              const u = currentInputRef.current.trim();
              const a = currentOutputRef.current.trim();
              
              if (a) {
                const found = MUDRA_CATALOG.find(m => a.toLowerCase().includes(m.name.toLowerCase()));
                if (found) {
                  setValidatedMudra(found);
                } else {
                  const isInterpreting = /shape|form|movement|gesture|energy|power/i.test(a);
                  if (isInterpreting) setValidatedMudra(INTUITION_MUDRA as any);
                }
              }

              if (u || a) setTranscription(p => [...p, ...(u ? [`User: ${u}`] : []), ...(a ? [`Veda: ${a}`] : [])].slice(-10));
              currentInputRef.current = ""; currentOutputRef.current = "";
            }
          },
          onerror: (e: any) => {
            if (e?.message?.includes("Requested entity was not found")) setHasKey(false);
            setError(`Connection error: ${e?.message || 'Unknown network error'}`);
            stopSession();
          },
          onclose: () => stopSession()
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      setError(err.message || 'Could not start session.');
      setIsInitializing(false);
    }
  };

  const selectMudraChallenge = (mudra: typeof MUDRA_CATALOG[0]) => {
    if (isActive) {
      sessionRef.current?.sendRealtimeInput({
        text: `The seeker is attempting the ${mudra.name} Mudra. Verify their energy.`
      });
      setTargetMudra(mudra.name);
    } else {
      startSession(mudra.name);
    }
  };

  if (hasKey === false) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl">
          <h1 className="cinzel text-3xl font-bold text-amber-500 mb-6">Setup Required</h1>
          <p className="text-slate-400 mb-8 text-sm leading-relaxed">Connect a Google Cloud project with billing enabled for real-time analysis.</p>
          <button onClick={handleSelectKey} className="w-full py-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-full tracking-widest transition-all mb-4">SELECT API KEY</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center p-4 md:p-8 overflow-x-hidden">
      <header className="w-full max-w-6xl text-center mb-10">
        <h1 className="cinzel text-4xl md:text-6xl font-bold text-amber-500 tracking-[0.2em] flex items-center justify-center gap-4">
          <i className="fa-solid fa-hands text-4xl md:text-5xl drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]"></i>
          MUDRAVEDA
        </h1>
        <p className="mt-3 text-slate-400 font-light italic tracking-widest text-sm md:text-base uppercase">Ancient Geometry • Real-Time Vision</p>
      </header>

      <div className="w-full max-w-[1400px] grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Visual Mudra Catalog */}
        <div className="xl:col-span-3 space-y-4">
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="cinzel text-xl text-amber-400 flex items-center gap-3">
              <i className="fa-solid fa-scroll text-amber-500"></i> Grimoire of Hands
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 max-h-[75vh] overflow-y-auto custom-scrollbar pr-3">
            {MUDRA_CATALOG.map(mudra => (
              <button 
                key={mudra.name}
                onClick={() => selectMudraChallenge(mudra)}
                className={`relative text-left rounded-2xl border transition-all duration-300 group overflow-hidden ${
                  targetMudra === mudra.name 
                  ? 'bg-amber-500 border-amber-400 text-slate-950 shadow-[0_0_25px_rgba(245,158,11,0.3)]' 
                  : 'bg-slate-900/40 border-slate-800/60 text-slate-300 hover:border-amber-500/50 hover:bg-slate-900/80'
                }`}
              >
                {/* Visual Thumbnail */}
                <div className="relative h-40 w-full overflow-hidden border-b border-amber-500/20">
                  <img 
                    src={mudra.imageUrl} 
                    alt={mudra.name} 
                    className={`w-full h-full object-cover transition-all duration-700 group-hover:scale-105 ${targetMudra === mudra.name ? 'grayscale-0 scale-105' : 'grayscale opacity-50'}`} 
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
                  <div className={`absolute top-3 right-3 px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-full border ${
                    targetMudra === mudra.name ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-900/80 text-slate-400 border-slate-700'
                  }`}>
                    {mudra.tier}
                  </div>
                </div>

                <div className="p-5">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold cinzel text-xl tracking-wider">{mudra.name}</span>
                    <div className="flex gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className={`w-3 h-1 rounded-sm ${i < mudra.power ? (targetMudra === mudra.name ? 'bg-slate-950' : 'bg-amber-500') : 'bg-slate-800'}`} />
                      ))}
                    </div>
                  </div>
                  <p className={`text-[10px] uppercase font-bold tracking-[0.2em] mb-3 ${targetMudra === mudra.name ? 'text-slate-950/70' : 'text-amber-500/70'}`}>
                    Focus: {mudra.focus}
                  </p>
                  <p className={`text-xs leading-relaxed line-clamp-2 ${targetMudra === mudra.name ? 'text-slate-950/80' : 'text-slate-400'}`}>
                    {mudra.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Center Column: Vision Interface */}
        <div className="xl:col-span-6 space-y-6">
          <div className="relative aspect-video bg-black rounded-[2.5rem] overflow-hidden shadow-2xl border-8 border-slate-900 group">
            <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover transition-all duration-1000 ${isActive ? 'opacity-100' : 'opacity-40'}`} />
            <canvas ref={canvasRef} className="hidden" />
            
            {/* SACRED AURA OVERLAY */}
            {validatedMudra && (
              <div className="absolute inset-0 pointer-events-none z-10 animate-fade-in">
                <div 
                  className={`absolute inset-0 transition-all duration-1000 ease-out ${validatedMudra.name === 'Intuitional Flow' ? 'animate-intuition-swirl' : 'animate-aura-pulse'}`}
                  style={{ 
                    boxShadow: `inset 0 0 100px 40px ${validatedMudra.color}, 0 0 150px 20px ${validatedMudra.color}`,
                    background: `radial-gradient(circle at center, transparent 30%, ${validatedMudra.color} 100%)`,
                    opacity: 0.8
                  }}
                />
                
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="absolute w-2 h-2 rounded-full animate-float-up opacity-0" style={{ left: `${Math.random() * 100}%`, bottom: '-20px', backgroundColor: validatedMudra.color, animationDelay: `${Math.random() * 2}s`, boxShadow: `0 0 10px ${validatedMudra.color}` }} />
                ))}

                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center animate-mudra-zoom">
                   <p className="cinzel text-5xl md:text-7xl font-black text-white drop-shadow-[0_0_20px_rgba(0,0,0,0.8)] tracking-[0.2em] uppercase">
                     {validatedMudra.name}
                   </p>
                   <p className={`mt-2 font-bold tracking-[0.5em] text-xs uppercase drop-shadow-md ${validatedMudra.name === 'Intuitional Flow' ? 'text-purple-400' : 'text-amber-400'}`}>
                     {validatedMudra.name === 'Intuitional Flow' ? 'Third Eye Resonance' : `Mudra Validated • Tier ${validatedMudra.tier}`}
                   </p>
                </div>
              </div>
            )}

            {/* Target Hud + Reference Preview */}
            {targetMudra && isActive && !validatedMudra && (
              <div className="absolute top-8 left-8 flex items-start gap-4 pointer-events-none z-0">
                <div className="bg-slate-950/70 backdrop-blur-xl border-l-4 border-amber-500 px-8 py-5 rounded-r-3xl shadow-2xl flex items-center gap-8">
                  <div>
                    <p className="text-[10px] text-amber-500 font-black uppercase tracking-[0.4em] mb-1">Seeking Alignment</p>
                    <h3 className="cinzel text-3xl text-white font-bold tracking-[0.1em]">{targetMudra}</h3>
                  </div>
                  {/* Miniature Visual Reference */}
                  <div className="w-20 h-20 rounded-2xl border-2 border-white/20 overflow-hidden shadow-2xl animate-pulse ring-4 ring-amber-500/10">
                    <img src={MUDRA_CATALOG.find(m => m.name === targetMudra)?.imageUrl} className="w-full h-full object-cover" alt="Ref" />
                  </div>
                </div>
              </div>
            )}

            {!isActive && !isInitializing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-sm z-20">
                <div className="relative w-32 h-32 rounded-full border-2 border-amber-500/40 flex items-center justify-center animate-spin-slow">
                  <i className="fa-solid fa-om text-6xl text-amber-500/80"></i>
                </div>
                <h2 className="mt-8 cinzel text-amber-500 text-2xl tracking-[0.3em] font-bold">START VEDA LINK</h2>
              </div>
            )}

            {isInitializing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 z-30 text-center">
                <div className="w-20 h-20 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-8"></div>
                <p className="text-amber-500 cinzel text-2xl tracking-[0.4em] animate-pulse">Aligning Prana...</p>
              </div>
            )}
            
            <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[length:100%_2px,3px_100%] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))]"></div>
          </div>

          <div className="flex flex-col items-center gap-6">
            <button
              onClick={isActive ? stopSession : () => startSession()}
              disabled={isInitializing}
              className={`w-full max-w-lg py-6 rounded-full font-black text-xl tracking-[0.4em] cinzel transition-all duration-500 shadow-2xl flex items-center justify-center gap-4 ${
                isActive ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              } disabled:opacity-50`}
            >
              <i className={`fa-solid ${isActive ? 'fa-circle-stop' : 'fa-sun'}`}></i>
              {isActive ? 'EXIT VEDA' : 'START VEDA'}
            </button>
            <div className="flex gap-8 opacity-40">
               <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-2">
                  <i className="fa-solid fa-eye text-amber-500"></i> High-Fidelity Reference
               </span>
               <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-2">
                  <i className="fa-solid fa-volume-high text-amber-500"></i> Vedic Narration
               </span>
            </div>
          </div>
        </div>

        {/* Right Column: Wisdom Stream */}
        <div className="xl:col-span-3 space-y-4">
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="cinzel text-xl text-amber-400 flex items-center gap-3">
              <i className="fa-solid fa-feather-pointed text-amber-500"></i> Wisdom Stream
            </h2>
          </div>
          <div className="bg-slate-900/30 border border-slate-800/50 rounded-[2rem] p-6 h-[75vh] overflow-y-auto custom-scrollbar shadow-2xl backdrop-blur-md relative flex flex-col gap-6">
            {transcription.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-600 text-sm text-center">
                <p className="font-light tracking-[0.2em] uppercase text-[10px]">Silence precedes wisdom.</p>
              </div>
            ) : (
              transcription.map((line, i) => {
                const isUser = line.startsWith('User:');
                return (
                  <div key={i} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                    <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1.5 px-2">
                      {isUser ? 'Seeker' : 'Veda Oracle'}
                    </span>
                    <div className={`w-fit max-w-[95%] px-5 py-4 rounded-3xl text-sm leading-relaxed ${
                      isUser 
                      ? 'bg-amber-500/10 text-amber-200 border border-amber-500/20' 
                      : 'bg-slate-800/60 text-slate-100 border border-slate-700/50'
                    }`}>
                      {line.split(': ').slice(1).join(': ')}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(245, 158, 11, 0.2); border-radius: 10px; }
        
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spin-slow 12s linear infinite; }
        
        @keyframes aura-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.02); }
        }
        .animate-aura-pulse { animation: aura-pulse 3s infinite ease-in-out; }

        @keyframes intuition-swirl {
          0%, 100% { opacity: 0.5; filter: hue-rotate(0deg); transform: scale(1); }
          50% { opacity: 0.9; filter: hue-rotate(90deg); transform: scale(1.05); }
        }
        .animate-intuition-swirl { animation: intuition-swirl 5s infinite ease-in-out; }

        @keyframes float-up {
          0% { transform: translateY(0); opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 0.8; }
          100% { transform: translateY(-300px); opacity: 0; }
        }
        .animate-float-up { animation: float-up 4s linear infinite; }

        @keyframes mudra-zoom {
          0% { opacity: 0; transform: scale(0.8); filter: blur(10px); }
          20% { opacity: 1; transform: scale(1); filter: blur(0px); }
          80% { opacity: 1; transform: scale(1.05); }
          100% { opacity: 0; transform: scale(1.2); filter: blur(5px); }
        }
        .animate-mudra-zoom { animation: mudra-zoom 4s ease-out forwards; }
        
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .animate-fade-in { animation: fade-in 0.5s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default App;
