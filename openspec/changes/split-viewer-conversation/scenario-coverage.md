| Scenario | Coverage | Assertion evidence |
|---|---|---|
| `components / AFileRowsMenuInItsOrder` | covered | `ui/src/components/FileTree.test.tsx` — AFileRowsMenuInItsOrder: the rendered menu reads its groups in order |
| `components / AFolderRowsMenu` | covered | `ui/src/components/FileTree.test.tsx` — AFolderRowsMenu: a writable folder offers everything a file does that a folder can take |
| `components / AReadOnlyFileOffersOnlyWhatItCanTake` | covered | `ui/src/components/fileTreeModel.test.ts` — AReadOnlyFileOffersOnlyWhatItCanTake: no change, no creation, but download and reference |
| `components / TheRootsOfferNoRemoval` | covered | `ui/src/components/FileTree.test.tsx` — TheRootsOfferNoRemoval: the writable root's own folder cannot be renamed, moved or deleted |
| `components / TheContextMenuOpensTheSameMenu` | covered | `ui/src/components/FileTree.test.tsx` — TheContextMenuOpensTheSameMenu: a right-click opens it instead of the browser's own |
| `components / TheRowKeepsTheAtAndItsStates` | covered | `ui/src/components/FileTree.test.tsx` — TheRowKeepsTheAtAndItsStates: the @, the git badge and ⋯, nothing else, on files and folders |
| `components / EachItemCarriesItsSymbol` | covered | `ui/src/components/FileTree.test.tsx` — each menu item carries the symbol of its action |
| `components / TheMenuIsAKeyboardMenu` | covered | `ui/src/components/RowMenu.test.tsx` — TheMenuIsAKeyboardMenu: focus starts on the first item and the arrows, Home and End move it |
| `components / OneMenuAtATime` | covered | `ui/src/components/FileTree.test.tsx` — OneMenuAtATime: opening another row's menu replaces the first; a new project closes it |
| `components / CopyARowsPaths` | covered | `ui/src/components/FileTree.test.tsx` — CopyARowsPaths: relative, then absolute, each briefly confirmed |
| `components / AnAbsolutePathUsesTheServersSeparator` | covered | `ui/src/components/fileTreeModel.test.ts` — AnAbsolutePathUsesTheServersSeparator: a Windows root gets backslashes throughout |
| `components / DeleteASelectionWithOneConfirmation` | covered | `ui/src/components/FileTree.test.tsx` — DeleteASelectionWithOneConfirmation: one confirmation naming the count, one batch request |
| `components / DownloadASelectionAsOneArchive` | covered | `ui/src/components/FileTree.test.tsx` — DownloadASelectionAsOneArchive, and a single file or folder downloads as itself or a zip |
| `components / DragASelectionOntoAFolder` | covered | `ui/src/components/FileTree.test.tsx` — DragASelectionOntoAFolder: dropping one selected row moves them all in one request |
| `components / AMixedSelectionOffersNoMutation` | covered | `ui/src/components/FileTree.test.tsx` — AMixedSelectionOffersNoMutation: a read-only entry in it takes Delete and Move away |
| `components / TheMenuOfAnUnselectedRowActsOnThatRow` | covered | `ui/src/components/FileTree.test.tsx` — TheMenuOfAnUnselectedRowActsOnThatRow: the selection becomes that row |
| `components / KeyboardShortcutsOnTheSelection` | covered | `ui/src/components/FileTree.test.tsx` — KeyboardShortcutsOnTheSelection: Delete asks the same single confirmation, F2 renames one entry |
| `components / CopyASelectionsPaths` | covered | `ui/src/components/FileTree.test.tsx` — CopyASelectionsPaths: one path per line |
| `components / HeaderAboveTheFilesSidebar` | covered | `ui/src/App.test.tsx` — HeaderAboveTheFilesSidebar: the header is above the row holding the sidebar, not beside it |
| `components / HeaderStaysOnOneRowWhenSplit` | covered | `scripts/probes/crawl-ui.mjs` — headerRows measured at 520px across viewer/sidebar configurations |
| `components / HeaderMenusOverlayThePanes` | covered | `scripts/probes/crawl-ui.mjs` — header menu click pass checks offscreen elements and horizontal page overflow in every state |
| `components / APhoneShowsTheWholeViewer` | covered | `scripts/probes/crawl-ui.mjs` — 390px file-viewer crawl checks page overflow and visible controls |
| `components / TheDrawerGetsOutOfTheWay` | covered | `ui/src/App.test.tsx` — below md, opening a file from the Files drawer closes the drawer |
| `components / ANarrowConversationColumnWraps` | covered | `scripts/probes/crawl-ui.mjs` — narrow-column configs check horizontal overflow after each button interaction |
| `components / AClickSelectsADoubleClickOpens` | covered | `ui/src/components/FileTree.test.tsx` — AClickSelectsADoubleClickOpens: a mouse click selects, a double-click opens |
| `components / EnterOpensTheFocusedFile` | covered | `ui/src/components/FileTree.test.tsx` — EnterOpensTheFocusedFile: a keyboard activation opens at once |
| `components / ATapOpens` | covered | `ui/src/components/FileTree.test.tsx` — ATapOpens: a touch tap opens without a second tap |
| `components / OneActivationStillOpensFromTheBadgeAndTheMenu` | covered | `ui/src/components/FileTree.test.tsx` — git badges / opens the file straight on its diff; actions menu / Open item is present |
| `file / OpenFileFullSize` | covered | `e2e/file-editor.spec.ts` — TheSourceIsReadInTheEditor: the source shows as the editor does, and typing changes nothing |
| `file / OpenPdfFullSize` | covered | `ui/src/components/FileViewer.pdf.test.tsx` — renders the PDF instead of the binary-file refusal |
| `file / PdfIsNotEditable` | covered | `ui/src/components/FileViewer.pdf.test.tsx` — offers no edit action, even inside the writable zone |
| `file / EditableFile` | covered | `ui/src/components/FileViewer.test.tsx` — offers editing when everything is writable; e2e/file-editor.spec.ts / SavingKeepsTheEditorOpen |
| `file / ReadOnlyFile` | covered | `ui/src/components/FileViewer.test.tsx` — marks the file read-only when nothing is writable |
| `file / DirtyCloseConfirmed` | covered | `ui/src/components/FileViewer.test.tsx` — asks before closing over unsaved changes; stays open when declined |
| `file / PreviewAttachmentAvailable` | covered | `ui/src/components/FileViewer.test.tsx` — confirms the image decoded before it can become an attachment |
| `file / WordDownloadOfferedForText` | covered | `ui/src/components/FileViewer.docxExport.test.tsx` — offers a Word download for text |
| `file / WordDownloadIgnoresTheWritableZone` | covered | `ui/src/components/FileViewer.docxExport.test.tsx` — offers it for a read-only file, because a download is not a write |
| `file / NoWordDownloadForBinaryOrDiff` | covered | `ui/src/components/FileViewer.docxExport.test.tsx` — does not offer it for a PDF or a failed load; export is absent for diff |
| `file / TheEditorNumbersAndColoursLines` | covered | `e2e/file-editor.spec.ts` — TheEditorNumbersAndColoursLines: numbers, colours as typed, brackets, Tab, several cursors and undo |
| `file / SavingKeepsTheEditorOpen` | covered | `e2e/file-editor.spec.ts` — SavingKeepsTheEditorOpen: Ctrl+S writes the file and stays in the editor; done leaves without asking |
| `file / ACrlfFileStaysCrlf` | covered | `e2e/file-editor.spec.ts` — ACrlfFileStaysCrlf: a CRLF file is saved with CRLF, the new line included |
| `file / TheSourceIsReadInTheEditor` | covered | `e2e/file-editor.spec.ts` — TheSourceIsReadInTheEditor: the source shows as the editor does, and typing changes nothing |
| `file / AStructuredExchangeFileExportsWhatItDraws` | covered | `e2e/docx-export-app.spec.ts` — a structured-exchange file exports what it draws: a figure as SVG, a table as a Word table and a workbook |
| `file / FollowTheAgentWhileWriting` | covered | `ui/src/App.test.tsx` — FollowTheAgentWhileWriting and TypingIsNotInterruptedByStreaming |
| `file / SwitchBothWaysKeepsTheDraft` | covered | `ui/src/App.test.tsx` — SwitchBothWaysKeepsTheDraft: the same editor survives both switches, with its undo history |
| `file / TypingIsNotInterruptedByStreaming` | covered | `ui/src/App.test.tsx` — FollowTheAgentWhileWriting and TypingIsNotInterruptedByStreaming |
| `file / TheFilesSidebarIsLeftAlone` | covered | `ui/src/App.test.tsx` — TheFilesSidebarIsLeftAlone: opening the file beside the chat does not fold the sidebar |
| `file / NarrowWindowKeepsTheOverlay` | covered | `ui/src/App.test.tsx` — TheToggleIsWhereTheEyeIs and NoBesideChatWhenNarrow |
| `file / LayoutChoiceIsRemembered` | covered | `ui/src/App.test.tsx` — LayoutChoiceIsRemembered: the next file opens beside the conversation |
| `file / TheToggleIsWhereTheEyeIs` | covered | `ui/src/App.test.tsx` — TheToggleIsWhereTheEyeIs and NoBesideChatWhenNarrow |
| `file / NoBesideChatWhenNarrow` | covered | `ui/src/App.test.tsx` — TheToggleIsWhereTheEyeIs and NoBesideChatWhenNarrow |
| `file / ShrinkingTheWindowKeepsTheDraft` | covered | `ui/src/App.test.tsx` — ShrinkingTheWindowKeepsTheDraft: beside collapses to the overlay below the threshold, same editor |
| `file / PromptWhileReadingAFile` | covered | `ui/src/App.test.tsx` — PromptWhileReadingAFile: sending keeps the viewer open |
| `file / PromptWithoutLeavingTheFile` | covered | `ui/src/App.test.tsx` — PromptWithoutLeavingTheFile: sending from the composer gives the caret back to the editor |
| `file / FocusFromElsewhereIsNotRedirected` | covered | `ui/src/App.test.tsx` — FocusFromElsewhereIsNotRedirected: a prompt sent without coming from the editor leaves focus alone |
| `file / QuestionArrivesWhileWritingInOverlay` | covered | `ui/src/App.test.tsx` — QuestionArrivesWhileWritingInOverlay: the strip says so without taking focus, and shows the question |
| `file / AFailedTurnIsNamed` | covered | `ui/src/App.test.tsx` — reports a failed turn on the strip instead of a silent empty reply |
| `file / PeekingKeepsTheDraft` | covered | `ui/src/App.test.tsx` — PeekingKeepsTheDraft: a look at the latest of the conversation and back to the same editor, focus included |
| `file / TypingWhileLookingGoesToTheComposer` | covered | `ui/src/App.test.tsx` — a look at the conversation puts the next keystrokes in the composer |
| `file / FromALookStraightBeside` | covered | `ui/src/App.test.tsx` — goes from a look at the conversation straight to the file beside it, back in the editor |
| `file / SwitchAndKeepTyping` | covered | `ui/src/App.test.tsx` — FollowTheAgentWhileWriting and TypingIsNotInterruptedByStreaming |
| `file / AQuestionWhileAway` | covered | `ui/src/App.test.tsx` — AQuestionWhileAway and TheMarkGoesWhenTheUserIsBack |
| `file / AReplyFinishedWhileAway` | covered | `ui/src/App.test.tsx` — AReplyFinishedWhileAway |
| `file / TheMarkGoesWhenTheUserIsBack` | covered | `ui/src/App.test.tsx` — AQuestionWhileAway and TheMarkGoesWhenTheUserIsBack |
| `file / ASecondFileOpensTabs` | covered | `ui/src/App.test.tsx` — ASecondFileOpensTabs: one file shows no tab bar, a second shows both, the new one active |
| `file / EachTabKeepsItsDraft` | covered | `ui/src/App.test.tsx` — EachTabKeepsItsDraft: same editor element, draft, caret, undo, and focus back in the editor after the switch |
| `file / OpeningAnOpenFileActivatesItsTab` | covered | `ui/src/App.test.tsx` — OpeningAnOpenFileActivatesItsTab: no third tab |
| `file / ClosingADirtyTabAsks` | covered | `ui/src/App.test.tsx` — ClosingADirtyTabAsks: declined, the tab and its edits stay |
| `file / ClosingTheActiveTabShowsItsNeighbour` | covered | `ui/src/App.test.tsx` — ClosingTheActiveTabShowsItsNeighbour: then the last close closes the viewer |
| `file / AnotherProjectClosesTheTabs` | covered | `ui/src/App.test.tsx` — AnotherProjectClosesTheTabs: a new session leaves no tab and no viewer |
