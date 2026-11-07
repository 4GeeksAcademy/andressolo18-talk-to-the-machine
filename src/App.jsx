import { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Bot, ChartNoAxesColumn, MessageSquare, RotateCw, Send, Trash2, User } from 'lucide-react';

const numberFormat = new Intl.NumberFormat('es');
const storageKey = 'talk-to-the-machine.session.v1';

function createEmptySession() {
  return {
    messages: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    lastResponse: null,
  };
}

function restoreSession(saved) {
  if (saved?.version !== 1 || !Array.isArray(saved.messages)) throw new Error('Sesion invalida');
  const restored = createEmptySession();
  const ids = new Set();

  for (const message of saved.messages) {
    if (!message || typeof message.id !== 'string' || !message.id || ids.has(message.id) ||
        !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' || !message.content.trim()) {
      throw new Error('Mensaje invalido');
    }
    ids.add(message.id);
    const normalized = { id: message.id, role: message.role, content: message.content };
    if (message.role === 'assistant') {
      if (typeof message.model !== 'string' || !Number.isFinite(message.responseTimeMs) || message.responseTimeMs < 0 ||
          !['prompt_tokens', 'completion_tokens', 'total_tokens'].every((field) =>
            Number.isSafeInteger(message.usage?.[field]) && message.usage[field] >= 0)) {
        throw new Error('Metricas invalidas');
      }
      normalized.usage = {
        prompt_tokens: message.usage.prompt_tokens,
        completion_tokens: message.usage.completion_tokens,
        total_tokens: message.usage.total_tokens,
      };
      normalized.model = message.model;
      normalized.responseTimeMs = message.responseTimeMs;
      restored.usage.promptTokens += normalized.usage.prompt_tokens;
      restored.usage.completionTokens += normalized.usage.completion_tokens;
      restored.usage.totalTokens += normalized.usage.total_tokens;
      restored.lastResponse = { model: message.model, responseTimeMs: message.responseTimeMs };
    }
    restored.messages.push(normalized);
  }
  if (!Object.values(restored.usage).every(Number.isSafeInteger)) throw new Error('Totales invalidos');
  return restored;
}

export default function App() {
  const [status, setStatus] = useState('Conectando');
  const [session, setSession] = useState(createEmptySession);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [failedMessageId, setFailedMessageId] = useState(null);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const historyRef = useRef(null);
  const messages = session.messages;
  const usage = session.usage;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const restored = restoreSession(JSON.parse(stored));
        setSession(restored);
        if (restored.messages.at(-1)?.role === 'user') {
          setFailedMessageId(restored.messages.at(-1).id);
          setError('El ultimo mensaje no tiene respuesta guardada. La solicitud puede haber consumido tokens.');
        }
      }
    } catch {
      setStorageError('No se pudo recuperar la sesion guardada. El almacenamiento puede estar bloqueado o los datos dañados.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (session.messages.length === 0) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...session }));
      }
    } catch {
      setStorageError('No se pudo guardar la sesion en este navegador. Los cambios pueden perderse al recargar.');
    }
  }, [session, loaded]);

  function clearConversation() {
    if (!loaded || sending.current) return;
    if (messages.length > 0 && !window.confirm('Borrar la conversacion y todo su consumo acumulado?')) return;
    setSession(createEmptySession());
    setDraft('');
    setError('');
    setFailedMessageId(null);
    try {
      localStorage.removeItem(storageKey);
      setStorageError('');
    } catch {
      setStorageError('No se pudo borrar la sesion del navegador. El historial anterior podria reaparecer al recargar.');
    }
  }

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [session.messages.length]);

  async function sendMessage(event, retry = false) {
    event.preventDefault();
    if (!loaded || sending.current) return;
    const lastMessage = session.messages.at(-1);
    if (retry && (!failedMessageId || lastMessage?.id !== failedMessageId)) return;
    const content = retry ? lastMessage.content : draft.trim();
    if (!content) return;

    sending.current = true;
    const userMessage = retry ? lastMessage : { id: crypto.randomUUID(), role: 'user', content };
    const requestMessages = retry ? session.messages : [...session.messages, userMessage];
    if (!retry) {
      setSession((current) => ({ ...current, messages: [...current.messages, userMessage] }));
      setDraft('');
    }
    setPending(true);
    setFailedMessageId(null);
    setError('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: requestMessages.map(({ role, content }) => ({ role, content })),
        }),
        signal: AbortSignal.timeout(35000),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const errorMessages = {
          413: 'El historial es demasiado grande para enviarlo.',
          429: 'Se alcanzo el limite de solicitudes. Espera antes de reintentar.',
          502: 'No se pudo obtener una respuesta de la IA. Intenta de nuevo mas tarde.',
          503: 'El servicio no esta disponible en este momento. Intenta mas tarde.',
          504: 'La respuesta tardo demasiado. La solicitud puede haber consumido tokens.',
        };
        const message = typeof data?.error === 'string' && data.error.trim()
          ? data.error
          : errorMessages[response.status] || `No se pudo enviar el mensaje (HTTP ${response.status}). Intenta de nuevo mas tarde.`;
        throw new Error(message);
      }
      if (!data) throw new Error('El servidor devolvio una respuesta que no se pudo leer.');
      if (data.message?.role !== 'assistant' || typeof data.message.content !== 'string' ||
          !data.message.content.trim() || typeof data.model !== 'string' ||
          !Number.isFinite(data.responseTimeMs) || data.responseTimeMs < 0 ||
          !['prompt_tokens', 'completion_tokens', 'total_tokens'].every((field) =>
            Number.isSafeInteger(data.usage?.[field]) && data.usage[field] >= 0)) {
        throw new Error('El servidor devolvio una respuesta incompleta.');
      }

      const assistantMessage = {
        id: crypto.randomUUID(),
        ...data.message,
        usage: data.usage,
        model: data.model,
        responseTimeMs: data.responseTimeMs,
      };
      setSession((current) => ({
        messages: [...current.messages, assistantMessage],
        usage: {
          promptTokens: current.usage.promptTokens + data.usage.prompt_tokens,
          completionTokens: current.usage.completionTokens + data.usage.completion_tokens,
          totalTokens: current.usage.totalTokens + data.usage.total_tokens,
        },
        lastResponse: { model: data.model, responseTimeMs: data.responseTimeMs },
      }));
    } catch (failure) {
      setFailedMessageId(userMessage.id);
      setError(failure.name === 'TimeoutError' || failure.name === 'TypeError'
        ? 'No se pudo recibir la respuesta. La solicitud puede haber consumido tokens.'
        : failure.message);
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    async function checkServer() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Servidor no disponible');
        const data = await response.json();
        setStatus(data.status === 'ok' ? 'Servidor disponible' : 'Sin conexion');
      } catch {
        if (!controller.signal.aborted) setStatus('Sin conexion');
      }
    }

    checkServer();
    return () => controller.abort();
  }, []);

  return (
    <div className="workspace">
      <header className="header">
        <div className="brand">
          <MessageSquare size={24} aria-hidden="true" />
          <h1>Talk to the Machine</h1>
        </div>
        <span className="status" role="status">{status}</span>
      </header>
      <main className="chat-layout">
        <section className="conversation" aria-labelledby="conversation-title">
          <div className="section-heading">
            <h2 id="conversation-title">Historial de mensajes</h2>
            <div className="conversation-actions">
              <span className="message-count">{messages.length} mensajes</span>
              <button className="clear-conversation" type="button" disabled={!loaded || pending} onClick={clearConversation}>
                <Trash2 size={16} aria-hidden="true" />
                {'Borrar conversaci\u00f3n'}
              </button>
            </div>
          </div>
          <div className="messages" role="log" aria-label="Mensajes" ref={historyRef}>
            {messages.length === 0 ? (
              <div className="empty-state">
                <MessageSquare size={36} strokeWidth={1.5} aria-hidden="true" />
                <p>Sin mensajes</p>
              </div>
            ) : messages.map((message) => (
              <article
                className={`message message--${message.role}`}
                key={message.id}
                aria-label={message.role === 'user' ? 'Mensaje del usuario' : 'Respuesta de la IA'}
              >
                <h3>
                  {message.role === 'user'
                    ? <User size={16} aria-hidden="true" />
                    : <Bot size={16} aria-hidden="true" />}
                  {message.role === 'user' ? 'Usuario' : 'IA'}
                </h3>
                <p>{message.content}</p>
                {message.usage && (
                  <div className="message-meta">
                    {message.model} | {numberFormat.format(message.responseTimeMs)} ms
                    <br />
                    Prompt: {numberFormat.format(message.usage.prompt_tokens)} | Completado: {numberFormat.format(message.usage.completion_tokens)} | Total: {numberFormat.format(message.usage.total_tokens)}
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="composer-area">
            <span className="chat-status" role="status">{!loaded ? 'Recuperando sesion...' : pending ? 'Pensando...' : 'Listo'}</span>
            {storageError && <p className="chat-error" role="alert">{storageError}</p>}
            {error && <p className="chat-error" role="alert">{error}</p>}
            {failedMessageId && (
              <button type="button" disabled={pending} onClick={(event) => sendMessage(event, true)} aria-label="Reintentar ultimo mensaje" title="Reintentar ultimo mensaje">
                <RotateCw size={20} aria-hidden="true" />
              </button>
            )}
            <form className="composer" onSubmit={sendMessage} aria-busy={pending}>
              <label className="sr-only" htmlFor="message">Mensaje</label>
              <textarea
                id="message"
                placeholder="Escribe un mensaje..."
                rows={2}
                maxLength={20000}
                value={draft}
                disabled={!loaded || pending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    sendMessage(event);
                  }
                }}
              />
              <button type="submit" disabled={!loaded || pending || !draft.trim()} aria-label="Enviar" title="Enviar">
                <Send size={20} aria-hidden="true" />
              </button>
            </form>
          </div>
        </section>
        <aside className="statistics" aria-labelledby="statistics-title">
          <div className="section-heading">
            <h2 id="statistics-title">Consumo de tokens</h2>
            <ChartNoAxesColumn size={18} aria-hidden="true" />
          </div>
          <p className="session-label">Sesion actual</p>
          <dl className="token-statistics">
            <div className="total-statistic">
              <dt>Total acumulado</dt>
              <dd>{numberFormat.format(usage.totalTokens)}</dd>
            </div>
            <div className="token-statistic">
              <dt><ArrowUpRight className="prompt-icon" size={18} aria-hidden="true" />Prompt</dt>
              <dd>{numberFormat.format(usage.promptTokens)}</dd>
            </div>
            <div className="token-statistic">
              <dt><ArrowDownLeft className="completion-icon" size={18} aria-hidden="true" />Completado</dt>
              <dd>{numberFormat.format(usage.completionTokens)}</dd>
            </div>
          </dl>
          <dl className="model-statistics">
            <div>
              <dt>Modelo seleccionado</dt>
              <dd>{session.lastResponse?.model || 'qwen/qwen3.8-27b'}</dd>
            </div>
            <div>
              <dt>Tiempo de ultima respuesta</dt>
              <dd>{session.lastResponse ? `${numberFormat.format(session.lastResponse.responseTimeMs)} ms` : 'No disponible'}</dd>
            </div>
          </dl>
        </aside>
      </main>
    </div>
  );
}