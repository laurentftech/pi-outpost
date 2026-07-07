import { useEffect, useRef } from "react";
import { AssistantMessage } from "./components/AssistantMessage";
import { Composer } from "./components/Composer";
import { ToolCard } from "./components/ToolCard";
import { useAgent } from "./useAgent";

export default function App() {
  const { state, prompt, abort } = useAgent();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll while streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.items, state.isStreaming]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
        <span className="text-lg font-semibold tracking-tight">π</span>
        <span className="font-mono text-xs text-zinc-500">{state.model || "…"}</span>
        {state.isStreaming && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            working
          </span>
        )}
        <span
          className={`ml-auto h-2 w-2 rounded-full ${state.connected ? "bg-emerald-500" : "bg-red-500"}`}
          title={state.connected ? "connected" : "disconnected"}
        />
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6">
          {state.items.length === 0 && (
            <div className="mt-24 text-center text-zinc-600">
              <div className="mb-2 text-4xl">π</div>
              <p className="text-sm">Send a message to start the agent.</p>
            </div>
          )}
          {state.items.map((item, i) => {
            if (item.kind === "user") {
              return (
                <div key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-xl bg-sky-950/60 px-4 py-2 text-[15px]">
                  {item.text}
                </div>
              );
            }
            if (item.kind === "tool") {
              return <ToolCard key={item.toolCallId || i} item={item} />;
            }
            return <AssistantMessage key={i} item={item} />;
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
            <div key={i} className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
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
            onSend={prompt}
            onAbort={abort}
          />
        </div>
      </footer>
    </div>
  );
}
