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
