use std::{
    sync::{Arc, Mutex, mpsc},
    thread,
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use gpui::{
    App, Application, Bounds, Context, FocusHandle, Focusable, Timer, Window, WindowBounds,
    WindowOptions, div, prelude::*, px, size,
};
use serde_json::{Value, json};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

#[derive(Debug, Clone, PartialEq, Eq)]
enum UiEvent {
    Status(String),
    Snapshot(Vec<String>),
    User(String),
    AssistantStart,
    TextDelta(String),
    AssistantEnd(String),
    ToolStart(String),
    ToolUpdate(String),
    ToolEnd(String),
    Error(String),
    AgentEnd,
}

#[derive(Debug, PartialEq, Eq)]
enum WireEvent {
    Snapshot(Vec<String>),
    User(String),
    AssistantStart,
    TextDelta(String),
    AssistantEnd(String),
    ToolStart(String),
    ToolUpdate(String),
    ToolEnd(String),
    Error(String),
    AgentEnd,
    Ignore,
}

fn item_text(item: &Value) -> String {
    match item.get("kind").and_then(Value::as_str).unwrap_or("") {
        "user" => format!(
            "You: {}",
            item.get("text").and_then(Value::as_str).unwrap_or("")
        ),
        "assistant" => format!(
            "Assistant: {}",
            item.get("blocks")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        ),
        "tool" => {
            let name = item
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let output = item.get("output").and_then(Value::as_str).unwrap_or("");
            format!("Tool: {name}: {output}")
        }
        "custom" => item
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        "compaction" => item
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        _ => String::new(),
    }
}

fn decode_server_message(value: &Value) -> WireEvent {
    let text = |field: &str| {
        value
            .get(field)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned()
    };
    match value.get("type").and_then(Value::as_str).unwrap_or("") {
        "hello" | "session_replaced" | "workspace_switched" | "workspace_starting" => {
            let items = value
                .get("items")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(item_text)
                .filter(|item| !item.is_empty())
                .collect();
            WireEvent::Snapshot(items)
        }
        "user" => WireEvent::User(text("text")),
        "assistant_start" => WireEvent::AssistantStart,
        "block_delta" if value.get("block").and_then(Value::as_str) == Some("text") => {
            WireEvent::TextDelta(text("delta"))
        }
        "assistant_end" => {
            WireEvent::AssistantEnd(item_text(value.get("item").unwrap_or(&Value::Null)))
        }
        "tool_start" => WireEvent::ToolStart(format!("Running {}", text("toolName"))),
        "tool_update" => WireEvent::ToolUpdate(format!("{}: {}", text("toolCallId"), text("text"))),
        "tool_end" => WireEvent::ToolEnd(format!("{}: {}", text("toolCallId"), text("text"))),
        "agent_end" => WireEvent::AgentEnd,
        "error" => WireEvent::Error(text("message")),
        _ => WireEvent::Ignore,
    }
}

fn start_transport(event_tx: mpsc::Sender<UiEvent>, command_rx: mpsc::Receiver<String>) {
    thread::spawn(move || {
        let endpoint =
            std::env::var("PI_OUTPOST_URL").unwrap_or_else(|_| "ws://127.0.0.1:3141/ws".to_owned());
        let token = std::env::var("PI_OUTPOST_TOKEN").ok();
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                runtime.block_on(run_connection(
                    endpoint,
                    token,
                    event_tx.clone(),
                    command_rx,
                ))
            });
        if let Err(error) = result {
            let _ = event_tx.send(UiEvent::Status(format!("Disconnected: {error}")));
        }
    });
}

async fn run_connection(
    endpoint: String,
    token: Option<String>,
    event_tx: mpsc::Sender<UiEvent>,
    command_rx: mpsc::Receiver<String>,
) -> Result<(), String> {
    let mut request = endpoint
        .into_client_request()
        .map_err(|error| error.to_string())?;
    if let Some(token) = token {
        let value = format!("Bearer {token}")
            .parse()
            .map_err(|_| "PI_OUTPOST_TOKEN is not a valid HTTP header value".to_owned())?;
        request.headers_mut().insert("Authorization", value);
    }
    let (socket, _) = connect_async(request)
        .await
        .map_err(|error| error.to_string())?;
    let _ = event_tx.send(UiEvent::Status("Connected".to_owned()));
    let (mut write, mut read) = socket.split();
    let mut poll = tokio::time::interval(Duration::from_millis(40));
    loop {
        tokio::select! {
            message = read.next() => match message {
                Some(Ok(Message::Text(text))) => {
                    let value: Value = serde_json::from_str(&text).map_err(|error| format!("invalid server message: {error}"))?;
                    match decode_server_message(&value) {
                        WireEvent::Snapshot(items) => { let _ = event_tx.send(UiEvent::Snapshot(items)); }
                        WireEvent::User(text) => { let _ = event_tx.send(UiEvent::User(text)); }
                        WireEvent::AssistantStart => { let _ = event_tx.send(UiEvent::AssistantStart); }
                        WireEvent::TextDelta(text) => { let _ = event_tx.send(UiEvent::TextDelta(text)); }
                        WireEvent::AssistantEnd(text) => { let _ = event_tx.send(UiEvent::AssistantEnd(text)); }
                        WireEvent::ToolStart(text) => { let _ = event_tx.send(UiEvent::ToolStart(text)); }
                        WireEvent::ToolUpdate(text) => { let _ = event_tx.send(UiEvent::ToolUpdate(text)); }
                        WireEvent::ToolEnd(text) => { let _ = event_tx.send(UiEvent::ToolEnd(text)); }
                        WireEvent::Error(text) => { let _ = event_tx.send(UiEvent::Error(text)); }
                        WireEvent::AgentEnd => { let _ = event_tx.send(UiEvent::AgentEnd); }
                        WireEvent::Ignore => {}
                    }
                }
                Some(Ok(Message::Close(frame))) => return Err(frame.map(|f| f.reason.to_string()).unwrap_or_else(|| "server closed the connection".to_owned())),
                Some(Ok(_)) => {}
                Some(Err(error)) => return Err(error.to_string()),
                None => return Err("server closed the connection".to_owned()),
            },
            _ = poll.tick() => {
                while let Ok(text) = command_rx.try_recv() {
                    let payload = serde_json::to_string(&json!({"type":"prompt", "text":text})).map_err(|error| error.to_string())?;
                    write.send(Message::Text(payload.into())).await.map_err(|error| error.to_string())?;
                }
            }
        }
    }
}

struct NativeClient {
    focus_handle: FocusHandle,
    status: String,
    items: Vec<String>,
    draft: String,
    assistant_index: Option<usize>,
    event_rx: Arc<Mutex<mpsc::Receiver<UiEvent>>>,
    command_tx: mpsc::Sender<String>,
}

impl NativeClient {
    fn apply(&mut self, event: UiEvent) {
        match event {
            UiEvent::Status(status) => self.status = status,
            UiEvent::Snapshot(items) => {
                self.items = items;
                self.assistant_index = None;
            }
            UiEvent::User(text) => self.items.push(format!("You: {text}")),
            UiEvent::AssistantStart => {
                self.items.push("Assistant: ".to_owned());
                self.assistant_index = Some(self.items.len() - 1);
            }
            UiEvent::TextDelta(text) => {
                if let Some(index) = self.assistant_index {
                    self.items[index].push_str(&text);
                } else {
                    self.items.push(format!("Assistant: {text}"));
                    self.assistant_index = Some(self.items.len() - 1);
                }
            }
            UiEvent::AssistantEnd(text) => {
                if !text.is_empty() {
                    if let Some(index) = self.assistant_index.take() {
                        self.items[index] = if text.starts_with("Assistant: ") {
                            text
                        } else {
                            format!("Assistant: {text}")
                        };
                    } else {
                        self.items.push(format!("Assistant: {text}"));
                    }
                } else {
                    self.assistant_index = None;
                }
            }
            UiEvent::ToolStart(text) | UiEvent::ToolUpdate(text) | UiEvent::ToolEnd(text) => {
                self.items.push(format!("Tool: {text}"));
            }
            UiEvent::Error(error) => self.status = format!("Server error: {error}"),
            UiEvent::AgentEnd => {
                self.assistant_index = None;
                self.status = "Connected".to_owned();
            }
        }
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        let prompt = self.draft.trim().to_owned();
        if !prompt.is_empty() {
            match self.command_tx.send(prompt) {
                Ok(()) => self.draft.clear(),
                Err(_) => {
                    self.status =
                        "Connection is unavailable; restart the client to retry.".to_owned()
                }
            }
        }
        cx.notify();
    }
}

impl Focusable for NativeClient {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for NativeClient {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let pending = {
            let receiver = self.event_rx.lock().expect("event receiver mutex");
            std::iter::from_fn(|| receiver.try_recv().ok()).collect::<Vec<_>>()
        };
        for event in pending {
            self.apply(event);
        }
        let status = self.status.clone();
        let transcript = self.items.join("\n\n");
        let draft = self.draft.clone();
        div()
            .track_focus(&self.focus_handle(cx))
            .on_key_down(
                cx.listener(|this, event: &gpui::KeyDownEvent, _window, cx| {
                    let key = &event.keystroke;
                    if key.key == "enter" {
                        this.submit(cx);
                    } else if key.key == "backspace" {
                        this.draft.pop();
                        cx.notify();
                    } else if let Some(text) = &key.key_char {
                        if !key.modifiers.control && !key.modifiers.platform {
                            this.draft.push_str(text);
                            cx.notify();
                        }
                    }
                }),
            )
            .flex()
            .flex_col()
            .size_full()
            .bg(gpui::rgb(0xffffff))
            .text_color(gpui::rgb(0x161616))
            .gap_3()
            .p_4()
            .text_size(px(20.0))
            .child(
                div()
                    .h(px(48.0))
                    .bg(gpui::rgb(0xffcccc))
                    .text_color(gpui::rgb(0x111111))
                    .text_xl()
                    .p_2()
                    .child(format!("GPUI render test — {status}")),
            )
            .child(
                div()
                    .h(px(240.0))
                    .bg(gpui::rgb(0xe8f0ff))
                    .text_color(gpui::rgb(0x111111))
                    .p_2()
                    .child(transcript),
            )
            .child(
                div()
                    .bg(gpui::rgb(0xffffcc))
                    .text_color(gpui::rgb(0x111111))
                    .h(px(48.0))
                    .border_1()
                    .border_color(gpui::rgb(0x888888))
                    .p_2()
                    .child(if draft.is_empty() {
                        "Type a prompt and press Enter".to_owned()
                    } else {
                        draft
                    }),
            )
    }
}

fn main() {
    let (event_tx, event_rx) = mpsc::channel();
    let (command_tx, command_rx) = mpsc::channel();
    start_transport(event_tx, command_rx);
    Application::new().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(800.0), px(600.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            move |_, cx| {
                let client = cx.new(|cx| NativeClient {
                    focus_handle: cx.focus_handle(),
                    status: "Connecting…".to_owned(),
                    items: Vec::new(),
                    draft: String::new(),
                    assistant_index: None,
                    event_rx: Arc::new(Mutex::new(event_rx)),
                    command_tx,
                });
                let weak = client.downgrade();
                cx.spawn(async move |cx| {
                    loop {
                        Timer::after(Duration::from_millis(80)).await;
                        let Some(client) = weak.upgrade() else { break };
                        let _ = cx.update_entity(&client, |state, cx| {
                            let pending = {
                                let receiver = state.event_rx.lock().expect("event receiver mutex");
                                std::iter::from_fn(|| receiver.try_recv().ok()).collect::<Vec<_>>()
                            };
                            for event in pending {
                                state.apply(event);
                            }
                            cx.notify();
                        });
                    }
                })
                .detach();
                client
            },
        )
        .expect("open GPUI window");
        cx.activate(true);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_snapshot_items_and_ignores_unknown_fields() {
        let message = json!({
            "type":"hello", "sessionId":"s", "model":"m", "isStreaming":false,
            "extra":"future-field", "items":[
                {"kind":"user", "text":"hello", "entryId":"e"},
                {"kind":"assistant", "blocks":[{"type":"text","text":"world"}]},
                {"kind":"tool", "toolName":"bash", "output":"done"},
                {"kind":"compaction", "summary":"earlier context"}
            ]
        });
        assert_eq!(
            decode_server_message(&message),
            WireEvent::Snapshot(vec![
                "You: hello".into(),
                "Assistant: world".into(),
                "Tool: bash: done".into(),
                "earlier context".into()
            ])
        );
    }

    #[test]
    fn maps_prompt_response_and_tool_activity_events() {
        assert_eq!(
            decode_server_message(&json!({"type":"user","text":"hi"})),
            WireEvent::User("hi".into())
        );
        assert_eq!(
            decode_server_message(
                &json!({"type":"block_delta","block":"text","contentIndex":0,"delta":"there"})
            ),
            WireEvent::TextDelta("there".into())
        );
        assert_eq!(
            decode_server_message(
                &json!({"type":"block_delta","block":"thinking","contentIndex":1,"delta":"private"})
            ),
            WireEvent::Ignore
        );
        assert_eq!(
            decode_server_message(&json!({"type":"tool_start","toolName":"bash","toolCallId":"t"})),
            WireEvent::ToolStart("Running bash".into())
        );
        assert_eq!(
            decode_server_message(
                &json!({"type":"tool_end","toolCallId":"t","text":"ok","isError":false})
            ),
            WireEvent::ToolEnd("t: ok".into())
        );
    }

    #[test]
    fn turns_server_error_into_visible_event_and_ignores_unknown_message() {
        assert_eq!(
            decode_server_message(&json!({"type":"error","message":"refused"})),
            WireEvent::Error("refused".into())
        );
        assert_eq!(
            decode_server_message(&json!({"type":"new_future_event"})),
            WireEvent::Ignore
        );
    }
}
