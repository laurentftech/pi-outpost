## ADDED Requirements

### Requirement: QueuedPromptsArePendingBubbles

A prompt the agent queued behind the running turn SHALL be shown as a pending user bubble below the turn, in queue order, with the text the user typed and its images, and SHALL NOT appear in the conversation until the agent receives it. When the agent receives it, it SHALL join the conversation as an ordinary user bubble at that point and leave the pending list.

#### Scenario: AQueuedPromptWaitsAsAPendingBubble
- **GIVEN** a turn that is running
- **WHEN** the user sends a prompt
- **THEN** it is shown once, as a pending bubble below the turn with an edit and a remove action, and not as a bubble in the conversation

#### Scenario: AQueuedPromptJoinsTheConversationWhenDelivered
- **GIVEN** a pending prompt with an image
- **WHEN** the agent receives it at the end of the current assistant turn
- **THEN** it leaves the pending list and appears in the conversation, with its text and image, after the messages that preceded its delivery

### Requirement: ThePendingListFollowsTheAgentsQueue

The pending list SHALL show what the agent's queue holds: a prompt still queued after an abort stays pending, and every client of the workspace, including one that connects later, sees the same list.

#### Scenario: APendingPromptOutlivesAnAbort
- **GIVEN** a pending prompt
- **WHEN** the user stops the turn
- **THEN** the prompt is still pending, with its edit and remove actions

#### Scenario: ALateClientSeesThePendingPrompts
- **GIVEN** a pending prompt sent from one client
- **WHEN** another client connects to the workspace
- **THEN** it shows the same pending prompt

### Requirement: TheUserEditsAQueuedPrompt

Editing a pending prompt SHALL replace it in the agent's queue with the edited text, keeping its images and its place among the other queued prompts, through the same prompt path a new prompt takes. A prompt the agent received before the edit took effect SHALL NOT be rewritten: the edit SHALL be refused with a message saying so, the edited text SHALL be offered back in the composer of the client that made it, and the other queued prompts SHALL stay queued in their order.

#### Scenario: EditAQueuedPrompt
- **GIVEN** two pending prompts, first and second, the first with an image
- **WHEN** the user edits the first and saves it
- **THEN** the agent's queue holds the edited first prompt and then the second, and the agent receives the edited text with the image

#### Scenario: AnEditStartsFromWhatWasTyped
- **GIVEN** a pending prompt typed as a skill command
- **WHEN** the user opens it for editing
- **THEN** the editor holds the command as typed, not its expansion, and the saved prompt is expanded again when queued

#### Scenario: AnEditOfADeliveredPromptIsRefused
- **GIVEN** a pending prompt open for editing, and a second pending prompt
- **WHEN** the agent receives the first before the edit is saved, and the user saves it
- **THEN** the edit is refused with a message, the edited text is in the composer, the first prompt appears once in the conversation unchanged, and the second is still pending

### Requirement: TheUserRemovesAQueuedPrompt

Removing a pending prompt SHALL take it out of the agent's queue, keeping the other queued prompts in their order. A prompt the agent already received SHALL NOT be removed: the removal SHALL be refused with a message saying so.

#### Scenario: RemoveAQueuedPrompt
- **GIVEN** two pending prompts
- **WHEN** the user removes the second
- **THEN** only the first stays pending, and the agent never receives the second

#### Scenario: RemovingADeliveredPromptIsRefused
- **GIVEN** a pending prompt
- **WHEN** the agent receives it and the user's removal arrives after
- **THEN** the removal is refused with a message, and the prompt is in the conversation once

### Requirement: QueueChangesAreSerialised

Edits, removals, and prompts sent while a turn runs SHALL be applied one at a time per workspace, so that none of them interleaves with another's re-queue.

#### Scenario: APromptSentDuringAnEditQueuesAfterIt
- **GIVEN** two pending prompts
- **WHEN** a client sends a new prompt while another's edit of the first is being applied
- **THEN** the queue holds the edited first, the second, then the new prompt

### Requirement: AQueueThatCannotBeRewrittenIsReadOnly

Pending prompts SHALL offer no edit or remove action, and the server SHALL refuse both, when the runtime cannot take its queue back (an RPC agent without `clear_queue`) or when the queue holds a message pi-outpost did not send (one an extension queued).

#### Scenario: ARuntimeWithoutClearQueueIsReadOnly
- **GIVEN** an RPC agent whose dialect has no `clear_queue`
- **WHEN** a prompt is queued
- **THEN** it is shown pending without edit or remove action, and an edit request is refused

#### Scenario: AnExtensionMessageMakesTheQueueReadOnly
- **GIVEN** a pending prompt and a message an extension queued behind it
- **WHEN** the pending list is shown
- **THEN** no pending prompt offers an edit or remove action, and an edit request is refused

### Requirement: TheUserSendsTheQueueNow

The pending prompts SHALL offer to be sent now, as one action for the whole queue, without the user typing anything. Sent now, every pending prompt SHALL reach the agent in the first request of a new turn, in queue order, with its images. While a turn runs, sending now SHALL stop it first, and SHALL ask before doing so, saying that the step in progress is abandoned and the completed work kept; declining SHALL change nothing.

#### Scenario: TheQueueIsSentAfterAStop
- **GIVEN** two pending prompts left by a stopped turn
- **WHEN** the user sends the queue now
- **THEN** a turn starts whose first request holds both prompts in order, and nothing was typed in the composer

#### Scenario: SendingNowStopsTheStepInProgress
- **GIVEN** a running turn that has completed one step, and a pending prompt
- **WHEN** the user sends the queue now and confirms
- **THEN** the step in progress is stopped, the completed step stays in the conversation, and the next request holds it and the pending prompt

#### Scenario: SendingNowAsksFirstWhileATurnRuns
- **GIVEN** a running turn and a pending prompt
- **WHEN** the user asks to send the queue now
- **THEN** a confirmation says the step in progress will be abandoned and completed work kept, and declining leaves the turn running and the prompt pending
