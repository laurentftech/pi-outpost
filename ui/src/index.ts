// Theme
export { ThemeContext, useThemeContext } from "./theme/ThemeContext";
export { useTheme } from "./theme/useTheme";
export { loadStoredTheme, resolveSystemTheme, storeTheme } from "./theme/theme";

// Utility functions
export { diffLines, toSideBySide, rowsWithContext, withContext } from "./util/diff";
export type { DiffLine, SideBySideRow } from "./util/diff";
export { normalizeMathDelimiters } from "./util/markdownMath";
export { getFormattedToolOutput } from "./util/toolOutput";
export { isExternalRef, isImageFile, rawFileUrl, resolveRelativeHref } from "./util/workspacePath";

// Utility components
export { CopyButton } from "./components/CopyButton";
export { CodeHighlight } from "./components/CodeHighlight";
export { Mermaid } from "./components/Mermaid";
export { RenderedHtml } from "./components/RenderedHtml";
export { DiffBlock, SplitDiffBlock } from "./components/DiffBlocks";

// Chat item components
export { UserMessage } from "./components/UserMessage";
export { AssistantMessage } from "./components/AssistantMessage";
export { ToolCard } from "./components/ToolCard";
export { CustomMessageCard } from "./components/CustomMessageCard";

// App shell
export { default as App } from "./App";
export type { AppHandle } from "./App";

// Agent connection
export { useAgent } from "./useAgent";
export type {
  AgentState,
  DialogRequest,
  DirState,
  OpenFile,
  FileSearch,
  SessionSearch,
  GitStatusState,
  GitDiffState,
  GitShowState,
  OutcomeState,
  ExtensionNotification,
  ExtensionWidget,
} from "./useAgent";

// Attachment utilities
export {
  addPathAttachment,
  imagePreviewToAttachment,
  removeAttachment,
  replacePreviewAttachment,
  textPreviewToAttachment,
  filesToAttachments,
  composePrompt,
  mentionedPaths,
} from "./attachments";
export type { Attachment } from "./attachments";

// Full app components
export { Composer } from "./components/Composer";
export { ExtensionDialog } from "./components/ExtensionDialog";
export { ExtensionNotifications } from "./components/ExtensionNotifications";
export { ExtensionWidgets } from "./components/ExtensionWidgets";
export { FileViewer } from "./components/FileViewer";
export { FileTree } from "./components/FileTree";
export { GitCommitView } from "./components/GitCommitView";
export { GitMenu } from "./components/GitMenu";
export { Header } from "./components/Header";
export { ModelBar } from "./components/ModelBar";
export { Onboarding } from "./components/Onboarding";
export { OutcomePanel } from "./components/OutcomePanel";
export { SettingsMenu } from "./components/SettingsMenu";
export { Sidebar } from "./components/Sidebar";
export { TokenGate } from "./components/TokenGate";
export { TreeMenu } from "./components/TreeMenu";
export { TerminalPanel } from "./components/TerminalPanel";
