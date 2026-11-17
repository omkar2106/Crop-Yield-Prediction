import React, { useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  Loader2,
  MapPin,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Send,
  Square,
} from 'lucide-react';
import type { MapsGroundingResponse } from '../shared/agronomyTypes.ts';
import { useFirebase } from '../context/FirebaseContext.tsx';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  modelUsed?: string;
}

interface AgronomyAssistantPanelProps {
  locationName: string;
  country: string;
  latitude: number;
  longitude: number;
  selectedCrop: string;
  predictedYield: number;
  suitabilityScore: number;
  soilTexture: string;
  ph: number;
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  temperature: number;
  rainfall: number;
  onVoiceNoteSaved?: () => void;
}

function pcmFloat32ToBase64(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export const AgronomyAssistantPanel: React.FC<AgronomyAssistantPanelProps> = ({
  locationName,
  country,
  latitude,
  longitude,
  selectedCrop,
  predictedYield,
  suitabilityScore,
  soilTexture,
  ph,
  nitrogen,
  phosphorus,
  potassium,
  temperature,
  rainfall,
  onVoiceNoteSaved,
}) => {
  const { user, getIdToken } = useFirebase();

  // Multi-turn Chat state
  const [chatModel, setChatModel] = useState<'gemini-4-hydrogen' | 'gemini-3.1-flash-lite'>('gemini-4-hydrogen');
  const [rolePreset, setRolePreset] = useState<'agronomist' | 'soil_chemist' | 'ml_analyst'>('agronomist');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'Ask about crop calibration, soil nutrient gaps, weather risks, or ML model behavior for this field.',
      modelUsed: 'gemini-4-hydrogen',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatSending, setIsChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Audio Transcription state (gemini-3.5-transcribe)
  const [isRecordingNote, setIsRecordingNote] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStatus, setTranscribeStatus] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Google Maps Grounding state (gemini-4-hydrogen + googleMaps)
  const [mapsQuery, setMapsQuery] = useState('soil testing laboratories and agricultural extension centers nearby');
  const [mapsResult, setMapsResult] = useState<MapsGroundingResponse | null>(null);
  const [isMapsLoading, setIsMapsLoading] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);

  // Real-time Gemini Live API state (gemini-3.8-live)
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveConnecting, setLiveConnecting] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveTranscripts, setLiveTranscripts] = useState<Array<{ role: string; text: string }>>([]);
  const liveWsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const contextSummary = `Location: ${locationName}, ${country} (${latitude.toFixed(3)}, ${longitude.toFixed(3)}) | Crop: ${selectedCrop} | Predicted Yield: ${predictedYield} t/ha (Suitability: ${suitabilityScore}/100) | Soil: ${soilTexture}, pH ${ph}, N=${nitrogen}, P=${phosphorus}, K=${potassium} kg/ha | Climate: ${temperature}°C, ${rainfall} mm/season`;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Clean up Live Voice session on unmount
  const stopLiveSession = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      void inputAudioCtxRef.current.close();
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      void outputAudioCtxRef.current.close();
      outputAudioCtxRef.current = null;
    }
    if (liveWsRef.current) {
      liveWsRef.current.close();
      liveWsRef.current = null;
    }
    setLiveConnected(false);
    setLiveConnecting(false);
    nextStartTimeRef.current = 0;
  };

  useEffect(() => {
    return () => {
      stopLiveSession();
    };
  }, []);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || isChatSending) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
    };
    const nextHistory = [...chatMessages, userMsg];
    setChatMessages(nextHistory);
    setChatInput('');
    setChatError(null);
    setIsChatSending(true);

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelChoice: chatModel,
          rolePreset,
          contextSummary,
          messages: nextHistory.filter((m) => m.id !== 'welcome').map((m) => ({
            role: m.role,
            text: m.text,
          })),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Chat request failed.');
      }
      setChatMessages((prev) => [
        ...prev,
        {
          id: `m_${Date.now()}`,
          role: 'model',
          text: data.reply || 'No response returned.',
          modelUsed: chatModel,
        },
      ]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Unable to send chat message.');
    } finally {
      setIsChatSending(false);
    }
  };

  // Microphone Audio Transcription (gemini-3.5-transcribe)
  const toggleMicRecording = async () => {
    if (isRecordingNote && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecordingNote(false);
      return;
    }

    setTranscribeStatus(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      recordedChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        setIsTranscribing(true);
        try {
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const audioBase64 = btoa(binary);
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (user) {
            const token = await getIdToken();
            if (token) headers.Authorization = `Bearer ${token}`;
          }

          const resp = await fetch('/api/audio/transcribe', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              audioBase64,
              mimeType,
              locationName,
              crop: selectedCrop,
            }),
          });
          const data = await resp.json();
          if (!resp.ok) {
            throw new Error(data.error || 'Transcription failed.');
          }
          const transcript = String(data.transcript ?? '').trim();
          if (transcript) {
            setChatInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
            setTranscribeStatus(
              data.savedToSql
                ? 'Transcribed via gemini-3.5-transcribe and archived to Cloud SQL.'
                : 'Transcribed via gemini-3.5-transcribe into prompt input.'
            );
            onVoiceNoteSaved?.();
          }
        } catch (err) {
          setTranscribeStatus(
            err instanceof Error ? err.message : 'Audio transcription failed.'
          );
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingNote(true);
    } catch (err) {
      setTranscribeStatus(
        err instanceof Error ? err.message : 'Microphone access denied.'
      );
    }
  };

  // Maps Grounding (gemini-4-hydrogen + googleMaps)
  const handleRunMapsGrounding = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsMapsLoading(true);
    setMapsError(null);
    try {
      const resp = await fetch('/api/agronomy/maps-grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: mapsQuery,
          latitude,
          longitude,
          locationName,
          crop: selectedCrop,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Maps Grounding query failed.');
      }
      setMapsResult(data as MapsGroundingResponse);
    } catch (err) {
      setMapsError(err instanceof Error ? err.message : 'Unable to query Google Maps Grounding.');
    } finally {
      setIsMapsLoading(false);
    }
  };

  // Real-time Gemini Live Voice Conversation (gemini-3.8-live)
  const startLiveSession = async () => {
    if (liveConnected || liveConnecting) return;
    setLiveError(null);
    setLiveConnecting(true);
    setLiveTranscripts([]);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/live`);
      liveWsRef.current = ws;

      ws.onopen = () => {
        setLiveConnected(true);
        setLiveConnecting(false);
        ws.send(
          JSON.stringify({
            context: contextSummary,
          })
        );

        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        source.connect(processor);
        processor.connect(inputCtx.destination);

        processor.onaudioprocess = (ev) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const base64 = pcmFloat32ToBase64(ev.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ audio: base64 }));
        };
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as {
          audio?: string;
          interrupted?: boolean;
          inputTranscript?: string;
          outputTranscript?: string;
          error?: string;
        };

        if (msg.error) {
          setLiveError(msg.error);
          stopLiveSession();
          return;
        }

        if (msg.interrupted && outputAudioCtxRef.current) {
          nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
        }

        if (msg.audio && outputAudioCtxRef.current) {
          const ctx = outputAudioCtxRef.current;
          const samples = base64PcmToFloat32(msg.audio);
          const buffer = ctx.createBuffer(1, samples.length, 24000);
          buffer.getChannelData(0).set(samples);
          const srcNode = ctx.createBufferSource();
          srcNode.buffer = buffer;
          srcNode.connect(ctx.destination);
          const startAt = Math.max(ctx.currentTime, nextStartTimeRef.current);
          srcNode.start(startAt);
          nextStartTimeRef.current = startAt + buffer.duration;
        }

        if (msg.inputTranscript) {
          setLiveTranscripts((prev) => [
            ...prev.slice(-8),
            { role: 'You', text: msg.inputTranscript! },
          ]);
        }
        if (msg.outputTranscript) {
          setLiveTranscripts((prev) => [
            ...prev.slice(-8),
            { role: 'Advisor', text: msg.outputTranscript! },
          ]);
        }
      };

      ws.onerror = () => {
        setLiveError('Live voice WebSocket connection encountered an error.');
        stopLiveSession();
      };

      ws.onclose = () => {
        stopLiveSession();
      };
    } catch (err) {
      setLiveError(
        err instanceof Error ? err.message : 'Unable to start live microphone conversation.'
      );
      stopLiveSession();
    }
  };

  return (
    <div className="space-y-6">
      {/* Row 1: Google Maps Grounding Nearby Services */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Local Agricultural Infrastructure (Google Maps Grounding)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Queries verified nearby soil labs, irrigation facilities, and extension centers around{' '}
            {locationName} ({latitude.toFixed(3)}, {longitude.toFixed(3)}).
          </p>
        </div>

        <form onSubmit={handleRunMapsGrounding} className="flex flex-wrap gap-2">
          <input
            type="text"
            value={mapsQuery}
            onChange={(e) => setMapsQuery(e.target.value)}
            aria-label="Google Maps Grounding query"
            className="flex-1 min-w-[240px] px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white"
          />
          <button
            type="submit"
            disabled={isMapsLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isMapsLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {isMapsLoading ? 'Finding Places...' : 'Find Local Resources'}
          </button>
        </form>

        {mapsError && (
          <div className="p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md">
            {mapsError}
          </div>
        )}

        {mapsResult && (
          <div className="pt-3 border-t border-slate-200 space-y-4">
            <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
              {mapsResult.answerMarkdown}
            </div>

            {mapsResult.places.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-2">
                  Google Maps Grounded Locations ({mapsResult.places.length})
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {mapsResult.places.map((pl) => (
                    <li
                      key={pl.uri}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1"
                    >
                      <a
                        href={pl.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-800 hover:underline"
                      >
                        <span>{pl.title}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                      </a>
                      {pl.snippets.length > 0 && (
                        <p className="text-xs text-slate-600 line-clamp-2">
                          {pl.snippets[0]}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Row 2: Multi-Turn Chatbot + Mic Transcription + Live Voice */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Multi-Turn Agronomy Chatbot + Speech Transcription */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Agronomy &amp; ML Assistant
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Multi-turn dialogue grounded in your live field telemetry and ML predictions
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={rolePreset}
                onChange={(e) =>
                  setRolePreset(
                    e.target.value as 'agronomist' | 'soil_chemist' | 'ml_analyst'
                  )
                }
                aria-label="Select chatbot role"
                className="px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-md text-slate-800"
              >
                <option value="agronomist">Role: Field Agronomist</option>
                <option value="soil_chemist">Role: Soil &amp; Nutrient</option>
                <option value="ml_analyst">Role: ML Model Analyst</option>
              </select>
              <select
                value={chatModel}
                onChange={(e) =>
                  setChatModel(
                    e.target.value as 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite'
                  )
                }
                aria-label="Select chat model"
                className="px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-md text-slate-800"
              >
                <option value="gemini-4-hydrogen">Standard (gemini-4-hydrogen)</option>
                <option value="gemini-3.1-flash-lite">Fast (gemini-3.1-flash-lite)</option>
              </select>
            </div>
          </div>

          <div className="h-72 overflow-y-auto py-4 space-y-3 pr-1">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`p-3 rounded-md text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-teal-50 border border-teal-200 text-slate-900 ml-8'
                    : 'bg-slate-50 border border-slate-200 text-slate-800 mr-8'
                }`}
              >
                <div className="text-[11px] font-semibold text-slate-500 mb-1">
                  {msg.role === 'user'
                    ? 'You'
                    : `Advisor${msg.modelUsed ? ` · ${msg.modelUsed}` : ''}`}
                </div>
                <div className="whitespace-pre-line">{msg.text}</div>
              </div>
            ))}
            {isChatSending && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-500 mr-8 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                Analyzing telemetry...
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {chatError && (
            <div className="mb-2 p-2.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded">
              {chatError}
            </div>
          )}

          {transcribeStatus && (
            <div className="mb-2 p-2 text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded">
              {transcribeStatus}
            </div>
          )}

          <form onSubmit={handleSendChat} className="pt-2 border-t border-slate-200 flex gap-2">
            <button
              type="button"
              onClick={toggleMicRecording}
              disabled={isTranscribing}
              title={
                isRecordingNote
                  ? 'Stop recording and transcribe'
                  : 'Record voice note (gemini-3.5-transcribe)'
              }
              className={`px-3 py-2 text-xs font-medium rounded-md border inline-flex items-center gap-1.5 shrink-0 cursor-pointer ${
                isRecordingNote
                  ? 'bg-rose-600 text-white border-rose-700'
                  : 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200'
              }`}
            >
              {isTranscribing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : isRecordingNote ? (
                <Square className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Mic className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span className="whitespace-nowrap">
                {isTranscribing
                  ? 'Transcribing'
                  : isRecordingNote
                  ? 'Stop Mic'
                  : 'Dictate'}
              </span>
            </button>

            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask about N-P-K adjustments, rainfall stress, or crop choice..."
              className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white"
            />

            <button
              type="submit"
              disabled={isChatSending || !chatInput.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md disabled:opacity-50 shrink-0 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              Send
            </button>
          </form>
        </div>

        {/* Real-Time Gemini Live API Voice Session */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Real-Time Voice Consultation
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Bidirectional live audio with gemini-3.8-live (16kHz mic / 24kHz audio)
              </p>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-600 space-y-1">
            <div className="font-medium text-slate-800">Active Field Context</div>
            <div className="font-mono text-[11px] leading-relaxed">
              {locationName} · {selectedCrop} ({predictedYield} t/ha) · pH {ph} · {rainfall} mm
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!liveConnected ? (
              <button
                type="button"
                onClick={startLiveSession}
                disabled={liveConnecting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-60 cursor-pointer"
              >
                {liveConnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <PhoneCall className="w-4 h-4" aria-hidden="true" />
                )}
                {liveConnecting ? 'Connecting Live Audio...' : 'Start Live Voice Session'}
              </button>
            ) : (
              <button
                type="button"
                onClick={stopLiveSession}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-md cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" aria-hidden="true" />
                End Live Session
              </button>
            )}
          </div>

          <div className="text-xs flex items-center gap-2 text-slate-600">
            {liveConnected ? (
              <>
                <Mic className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span className="font-medium text-emerald-800">
                  Live microphone streaming — speak naturally
                </span>
              </>
            ) : (
              <>
                <MicOff className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                <span>Voice channel idle</span>
              </>
            )}
          </div>

          {liveError && (
            <div className="p-2.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded">
              {liveError}
            </div>
          )}

          {liveTranscripts.length > 0 && (
            <div className="border-t border-slate-200 pt-3 space-y-2 max-h-44 overflow-y-auto">
              {liveTranscripts.map((t, i) => (
                <div key={i} className="text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">{t.role}: </span>
                  <span>{t.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
