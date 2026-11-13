"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { useVoiceChat } from "./use-voice-chat";

const suggestions = ["Hoy necesito que me escuches", "Me está costando descansar", "Extraño a la gente que quiero"];

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef(null);
  const input = useRef(null);
  const pending = useRef(false);
  const voice = useVoiceChat();

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages, loading, error]);

  async function send(text) {
    const message = text.trim();
    if (!message || message.length > 2000 || pending.current) return;
    voice.cancelListening();
    voice.stopSpeaking();
    pending.current = true;
    setLoading(true);
    setError("");
    setDraft("");
    const id = crypto.randomUUID();
    setMessages((items) => [...items, { id, role: "user", text: message }]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: messages.slice(-20).map(({ role, text }) => ({ role, text: text.slice(0, 12000) })),
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo enviar el mensaje.");
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("No recibimos una respuesta. Intentá de nuevo.");
      const replyId = crypto.randomUUID();
      setMessages((items) => [...items, { id: replyId, role: "assistant", text: data.reply }]);
      voice.speak(data.reply, replyId, true);
    } catch (error) {
      setMessages((items) => items.filter((item) => item.id !== id));
      setDraft(message);
      setError(error.name === "TimeoutError" ? "La respuesta tardó demasiado. Intentá de nuevo." : error instanceof TypeError || error instanceof SyntaxError ? "No pudimos conectar con el asistente. Intentá de nuevo." : error.message);
    } finally {
      pending.current = false;
      setLoading(false);
      input.current?.focus();
    }
  }

  function reset() {
    if (pending.current) return;
    voice.cancelListening();
    voice.stopSpeaking();
    setMessages([]);
    setDraft("");
    setError("");
    input.current?.focus();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}><span className={styles.mark} aria-hidden="true">✦</span><div><h1>Compañero</h1><p>Tu compañía durante la misión · IA</p></div></div>
        <button className={styles.newChat} onClick={reset} disabled={loading || !messages.length}>＋ Nuevo chat</button>
      </header>
      <section className={styles.conversation} aria-label="Conversación">
        {!messages.length && !loading && <div className={styles.welcome}>
          <span className={styles.welcomeMark} aria-hidden="true">✦</span>
          <p className={styles.eyebrow}>UN MOMENTO PARA VOS</p>
          <h2>¿Cómo venís hoy?</h2>
          <p>Podemos hablar de cómo te sentís, de tu día o de eso que tenés dando vueltas.</p>
          <div className={styles.suggestions}>{suggestions.map((text) => <button key={text} onClick={() => send(text)}>{text}<span aria-hidden="true">↗</span></button>)}</div>
        </div>}
        <div className={styles.messages} role="log" aria-label="Mensajes" aria-live="polite" aria-relevant="additions">
          {messages.map((message) => <article key={message.id} className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant}`}>
            <span className={styles.author}>{message.role === "user" ? "Vos" : "✦ Compañero"}</span>
            <div className={styles.bubble}>{message.text}</div>
            {message.role === "assistant" && voice.canSpeak && (
              <button className={styles.voiceButton} disabled={voice.listening || voice.transcribing || voice.requestingMic} onClick={() => voice.speakingId === message.id ? voice.stopSpeaking() : voice.speak(message.text, message.id)}>
                {voice.speakingId === message.id ? "■ Detener audio" : "▷ Escuchar"}
              </button>
            )}
          </article>)}
        </div>
        {loading && <p className={styles.loading} role="status">✦ Gemini está pensando…</p>}
        {error && <p className={styles.error} role="alert">{error} Tu mensaje está listo para reenviar.</p>}
        <div ref={bottom} />
      </section>
      <footer className={styles.footer}>
        <div className={styles.voiceControls}>
          <button className={styles.voiceButton} disabled={!voice.canListen || loading || voice.transcribing || voice.requestingMic} aria-pressed={voice.listening}
            onClick={() => voice.listening ? voice.finishListening() : voice.startListening({ draft, onTranscript: setDraft, onSend: send })}>
            {voice.requestingMic ? "Abriendo micrófono…" : voice.transcribing ? "Transcribiendo…" : voice.listening ? "■ Terminar y enviar" : "🎙 Hablar"}
          </button>
          {(voice.listening || voice.transcribing || voice.requestingMic) && <button className={styles.voiceButton} onClick={voice.cancelListening}>Cancelar</button>}
          <button className={styles.voiceButton} disabled={!voice.canSpeak} aria-pressed={voice.audioEnabled} onClick={voice.toggleAudio}>
            {voice.audioEnabled ? "Audio activado" : "Activar respuestas con audio"}
          </button>
        </div>
        {voice.canSpeak && (
          <details className={styles.voiceSettings}>
            <summary>Elegir voz y velocidad</summary>
            <div className={styles.voiceSettingsFields}>
              <label className={styles.voiceField}>
                Voz del dispositivo
                <select value={voice.selectedVoice} onChange={(event) => voice.chooseVoice(event.target.value)}>
                  <option value="">Automática · español</option>
                  {voice.availableVoices.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.lang})</option>)}
                </select>
              </label>
              <label className={styles.voiceField}>
                Velocidad · {voice.speechRate.toFixed(2)}×
                <input type="range" min="0.75" max="1.2" step="0.05" value={voice.speechRate} onChange={(event) => voice.changeSpeechRate(event.target.value)} />
              </label>
              <button type="button" className={styles.voiceButton} disabled={loading || voice.listening || voice.transcribing || voice.requestingMic}
                onClick={() => voice.speakingId === "voice-preview" ? voice.stopSpeaking() : voice.speak("Hola, ¿cómo venís hoy? Podemos charlar un rato, sin apuro. Contame qué tenés en mente.", "voice-preview")}>
                {voice.speakingId === "voice-preview" ? "■ Detener prueba" : "▷ Probar voz"}
              </button>
            </div>
            <p className={styles.voiceHint}>Las voces dependen de tu dispositivo. Las opciones en español aparecen primero.</p>
          </details>
        )}
        <p className={styles.voiceHint} role="status">
          {voice.requestingMic ? "Permití el acceso al micrófono para comenzar." : voice.transcribing ? "Convirtiendo tu audio en texto…" : voice.listening ? "Grabando… Tocá Terminar y enviar cuando termines. Máximo 60 segundos." : voice.canListen ? "Tocá Hablar, grabá tu mensaje y después Terminar y enviar." : "La entrada por voz no está disponible acá. Probá un navegador compatible en HTTPS o localhost."}
        </p>
        {voice.voiceError && <p className={styles.voiceError} role="alert">{voice.voiceError}</p>}
        <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); send(draft); }}>
          <label className={styles.srOnly} htmlFor="message">Tu mensaje</label>
          <textarea ref={input} id="message" placeholder="Escribí tu mensaje…" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} readOnly={loading || voice.listening || voice.transcribing || voice.requestingMic} rows={2} aria-describedby="message-hint"
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }} />
          <div className={styles.actions}><span id="message-hint">{draft.length}/2000 <span className={styles.keyboardHint}>· Shift + Enter para una nueva línea</span></span><button type="submit" disabled={loading || !draft.trim()} aria-label="Enviar mensaje">↑</button></div>
        </form>
        {voice.canListen && <p className={styles.voiceHint}>Al terminar, tu audio se envía a Gemini para transcribirlo. Cancelar descarta la grabación pendiente.</p>}
        <p className={styles.disclaimer}>Compañero virtual con IA. No reemplaza la atención médica o psicológica.</p>
      </footer>
    </main>
  );
}
