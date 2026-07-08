import { useEffect, useRef } from "react";
import { AssistantMessage } from "./components/AssistantMessage";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { ToolCard } from "./components/ToolCard";
import { useAgent } from "./useAgent";

export default function App() {
  const {
    state,
    prompt,
    abort,
    setModel,
    setThinking,
    newSession,
    switchSession,
    deleteSession,
    listSessions,
  } = useAgent();
  const mainRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Track whether the user is reading scrollback: only auto-scroll when
  // already near the bottom (avoids yanking during streaming).
  function handleScroll() {
    const main = mainRef.current;
    if (!main) return;
    stickToBottom.current = main.scrollHeight - main.scrollTop - main.clientHeight < 120;
  }

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [state.items]);

  useEffect(() => {
    document.title = state.branding.title ?? "pi";
    if (state.branding.accentColor) {
      document.documentElement.style.setProperty("--accent", state.branding.accentColor);
    }
  }, [state.branding]);

  return (
    <div className="flex h-full flex-col">
      <Header
        title={state.branding.title}
        model={state.model}
        models={state.models}
        thinkingLevel={state.thinkingLevel}
        modelSupportsReasoning={state.modelSupportsReasoning}
        sessions={state.sessions}
        sessionId={state.sessionId}
        isStreaming={state.isStreaming}
        connected={state.connected}
        onSetModel={setModel}
        onSetThinking={setThinking}
        onNewSession={newSession}
        onSwitchSession={switchSession}
        onDeleteSession={deleteSession}
        onListSessions={listSessions}
      />

      <main ref={mainRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6">
          {state.items.length === 0 && (
            <div className="mt-24 text-center text-zinc-600">
              <div className="mb-2 text-4xl">{state.branding.title ?? "π"}</div>
              <p className="text-sm">{state.branding.welcome ?? "Send a message to start the agent."}</p>
            </div>
          )}
          {state.items.map((item, i) => {
            // Scope keys to the session so component state (collapsed cards…)
            // never bleeds across session_replaced
            const key = `${state.sessionId}:${i}`;
            if (item.kind === "user") {
              return (
                <div
                  key={key}
                  className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-xl bg-sky-950/60 px-4 py-2 text-[15px]"
                >
                  {item.text}
                </div>
              );
            }
            if (item.kind === "tool") {
              return <ToolCard key={item.toolCallId ? `${state.sessionId}:${item.toolCallId}` : key} item={item} />;
            }
            // Tool-call-only messages produce empty assistant items — skip them
            if (item.blocks.length === 0 && !item.errorMessage) return null;
            return <AssistantMessage key={key} item={item} />;
          })}

          {(state.queue.steering.length > 0 || state.queue.followUp.length > 0) && (
            <div className="rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-500">
              {state.queue.steering.map((text, i) => (
                <div key={`s${i}`}>⏩ steering: {text}</div>
              ))}
              {state.queue.followUp.map((text, i) => (
                <div key={`f${i}`}>⏭ follow-up: {text}</div>
              ))}
            </div>
          )}

          {state.errors.map((error, i) => (
            <div
              key={i}
              className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="border-t border-zinc-800 px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <Composer
            isStreaming={state.isStreaming}
            connected={state.connected}
            commands={state.commands}
            onSend={prompt}
            onAbort={abort}
          />
        </div>
      </footer>
    </div>
  );
}
