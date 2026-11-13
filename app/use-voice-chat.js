"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getCapabilities = () =>
  (window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder ? 1 : 0) |
  (window.speechSynthesis && window.SpeechSynthesisUtterance ? 2 : 0);

function subscribeVoices(onChange) {
  window.speechSynthesis?.addEventListener("voiceschanged", onChange);
  return () => window.speechSynthesis?.removeEventListener("voiceschanged", onChange);
}

function getVoiceSnapshot() {
  return JSON.stringify((window.speechSynthesis?.getVoices() || []).map((voice) => ({
    id: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
  })));
}

export function useVoiceChat() {
  const capabilities = useSyncExternalStore(subscribe, getCapabilities, () => 0);
  const voiceSnapshot = useSyncExternalStore(subscribeVoices, getVoiceSnapshot, () => "[]");
  const availableVoices = JSON.parse(voiceSnapshot).sort((a, b) =>
    Number(/^es\b/i.test(b.lang)) - Number(/^es\b/i.test(a.lang)) || a.name.localeCompare(b.name)
  );
  const [selectedVoice, setSelectedVoice] = useState("");
  const [speechRate, setSpeechRate] = useState(0.95);
  const speechPreferences = useRef({ voiceId: "", rate: 0.95 });
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const recording = useRef(null);
  const utterance = useRef(null);
  const audioPreference = useRef(false);
  const recordingTimer = useRef(null);

  function stopSpeaking() {
    utterance.current = null;
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  }

  function chooseVoice(voiceId) {
    stopSpeaking();
    speechPreferences.current.voiceId = voiceId;
    setSelectedVoice(voiceId);
  }

  function changeSpeechRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0.75 || rate > 1.2) return;
    stopSpeaking();
    speechPreferences.current.rate = rate;
    setSpeechRate(rate);
  }

  function cancelListening() {
    const active = recording.current;
    recording.current = null;
    clearTimeout(recordingTimer.current);
    if (active) {
      active.controller.abort();
      if (active.recorder?.state === "recording") active.recorder.stop();
      active.stream?.getTracks().forEach((track) => track.stop());
    }
    setListening(false);
    setTranscribing(false);
    setRequestingMic(false);
  }

  useEffect(() => () => {
    const active = recording.current;
    recording.current = null;
    clearTimeout(recordingTimer.current);
    if (active) {
      active.controller.abort();
      if (active.recorder?.state === "recording") active.recorder.stop();
      active.stream?.getTracks().forEach((track) => track.stop());
    }
    utterance.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  function speak(text, id, automatic = false) {
    if (!(capabilities & 2) || (automatic && !audioPreference.current)) return;
    cancelListening();
    stopSpeaking();
    setVoiceError("");
    // Short chunks avoid long-utterance failures in browser speech engines.
    const plainText = text.replace(/```[\s\S]*?```/g, " Fragmento de código disponible en el chat. ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*#_`]/g, "");
    const chunks = plainText.match(/[^.!?\n]{1,200}(?:\s|[.!?\n]|$)|\S{1,200}/g) || [plainText];
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((item) => item.voiceURI === speechPreferences.current.voiceId)
      || voices.find((item) => /^es[-_]AR$/i.test(item.lang))
      || voices.find((item) => /^es\b/i.test(item.lang));
    setSpeakingId(id);

    function play(index) {
      const speech = new SpeechSynthesisUtterance(chunks[index]);
      speech.lang = voice?.lang || "es-AR";
      if (voice) speech.voice = voice;
      speech.rate = speechPreferences.current.rate;
      utterance.current = speech;
      speech.onend = () => {
        if (utterance.current !== speech) return;
        if (index + 1 < chunks.length) play(index + 1);
        else { utterance.current = null; setSpeakingId(null); }
      };
      speech.onerror = () => {
        if (utterance.current !== speech) return;
        utterance.current = null;
        setSpeakingId(null);
        setVoiceError("No se pudo reproducir el audio. Probá el botón Escuchar de la respuesta.");
      };
      try {
        window.speechSynthesis.speak(speech);
      } catch {
        speech.onerror();
      }
    }
    play(0);
  }

  function toggleAudio() {
    audioPreference.current = !audioPreference.current;
    setAudioEnabled(audioPreference.current);
    if (!audioPreference.current) stopSpeaking();
  }

  function finishListening() {
    const active = recording.current;
    if (active?.recorder?.state !== "recording") return;
    clearTimeout(recordingTimer.current);
    active.recorder.stop();
    active.stream.getTracks().forEach((track) => track.stop());
    setListening(false);
    setTranscribing(true);
  }

  async function startListening({ draft, onTranscript, onSend }) {
    if (!(capabilities & 1) || recording.current) return;
    stopSpeaking();
    setVoiceError("");
    setRequestingMic(true);
    audioPreference.current = Boolean(capabilities & 2);
    setAudioEnabled(audioPreference.current);
    const active = { controller: new AbortController(), stream: null, recorder: null };
    recording.current = active;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recording.current !== active) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      active.stream = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("UNSUPPORTED_AUDIO");
      const recorder = new MediaRecorder(stream, { mimeType });
      active.recorder = recorder;
      const chunks = [];
      let size = 0;
      recorder.ondataavailable = (event) => {
        if (recording.current !== active || !event.data.size) return;
        size += event.data.size;
        if (size > 5 * 1024 * 1024) {
          cancelListening();
          setVoiceError("La grabación es demasiado grande. Probá con una frase más corta.");
          return;
        }
        chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (recording.current !== active) return;
        cancelListening();
        setVoiceError("No se pudo grabar el audio. Revisá el micrófono e intentá de nuevo.");
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (recording.current !== active) return;
        clearTimeout(recordingTimer.current);
        setListening(false);
        setTranscribing(true);
        let timeout;
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          if (!blob.size) throw new Error("La grabación está vacía. Volvé a intentar.");
          timeout = setTimeout(() => active.controller.abort(), 30000);
          const response = await fetch("/api/transcribe", {
            method: "POST", body: blob,
            headers: { "Content-Type": blob.type },
            signal: active.controller.signal,
          });
          const data = await response.json();
          if (recording.current !== active) return;
          if (!response.ok) throw new Error(data.error || "No se pudo transcribir el audio.");
          if (typeof data.text !== "string" || !data.text.trim()) throw new Error("No se reconoció una frase. Volvé a grabar.");
          const text = [draft.trim(), data.text.trim()].filter(Boolean).join(" ");
          recording.current = null;
          setTranscribing(false);
          onTranscript(text.slice(0, 2000));
          if (text.length > 2000) {
            setVoiceError("Llegaste al límite de 2000 caracteres. Revisá el texto antes de enviarlo.");
          } else {
            onSend(text);
          }
        } catch (error) {
          if (recording.current !== active) return;
          recording.current = null;
          setTranscribing(false);
          setVoiceError(error.name === "AbortError" ? "La transcripción tardó demasiado. Volvé a intentar."
            : error instanceof TypeError || error instanceof SyntaxError ? "No se pudo conectar con la transcripción. Volvé a intentar."
            : error.message);
        } finally {
          clearTimeout(timeout);
        }
      };
      recorder.start(1000);
      setRequestingMic(false);
      setListening(true);
      recordingTimer.current = setTimeout(finishListening, 60000);
    } catch (error) {
      if (recording.current !== active) return;
      cancelListening();
      const errors = {
        NotAllowedError: "Permití el acceso al micrófono en el navegador para hablar.",
        NotFoundError: "No se encontró un micrófono conectado.",
        NotReadableError: "El micrófono está ocupado o no se puede abrir. Revisá otras aplicaciones.",
      };
      setVoiceError(errors[error.name] || (error.message === "UNSUPPORTED_AUDIO"
        ? "Este navegador no permite grabar en un formato compatible. Probá con otro navegador."
        : "No se pudo iniciar el micrófono. Revisá los permisos e intentá de nuevo."));
    }
  }

  return {
    canListen: Boolean(capabilities & 1), canSpeak: Boolean(capabilities & 2),
    listening, transcribing, requestingMic, speakingId, audioEnabled, voiceError,
    startListening, cancelListening, finishListening,
    speak, stopSpeaking, toggleAudio,
    availableVoices, selectedVoice, chooseVoice, speechRate, changeSpeechRate,
  };
}
