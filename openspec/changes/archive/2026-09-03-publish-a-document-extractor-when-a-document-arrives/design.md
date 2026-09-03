## The trigger, and why it is the document rather than the workspace

Three candidates were on the table.

**The workspace containing such a file.** Decided once at session bind, so the toolset
never changes mid-conversation and no prefix is ever invalidated. Rejected: a repository
with a `docs/` folder, a `README.pdf`, one stray `.xlsx` in a fixtures directory would
publish all four for every session, including the ones refactoring TypeScript. It
optimises for the presence of a document rather than the use of one, which is the case
this change exists to stop.

**An opener** — one small tool that publishes the right extractor on request, the pattern
opencode uses for skills. Rejected for the same reason it was rejected for the Work Plan:
it charges a round trip on the path that is already the point, and here the round trip
would land in the middle of "read this file for me".

**The document entering the conversation.** What is implemented. The composer already
appends every referenced file as an `@path` mention before sending (see the `SendMessage`
requirement), and an uploaded document is written into the workspace and attached as a
path rather than as content. So the prompt the server receives names the file, and naming
it is exactly the moment the tool becomes useful.

## Where the decision is made

On the prompt path, before the turn is dispatched: the server reads the outgoing text for
paths ending in the four extensions and publishes the matching tools. The turn then goes
out with them.

It is deliberately a **text** trigger rather than a filesystem one. The file may not exist
yet, may be outside the sandbox, may be a broken path — none of which matters: what the
tool costs is being described, and what makes describing it worthwhile is that the
conversation has turned to a document of that kind. A wrong guess publishes a tool that
goes unused for the rest of the session, which is the same position we are in today.

## What happens to a wrong guess

Publication is sticky *for a tool that was used*, and only for that one. A turn that named
a document and never called the extractor gets it withdrawn when the turn ends.

The two halves answer different risks. Withdrawing after use would strand an agent
mid-task: extraction is rarely one call — a spreadsheet read sheet by sheet, a PDF written
out and then reread — and an agent cannot ask for a tool back, since publication is
triggered by what the *user* writes. Keeping a tool nobody called would mean paying for
every false positive, on every later request, for the rest of the session.

So a newly published tool spends the turn on trial: a `tool_start` naming it clears the
trial, the end of the turn collects what is left.

## Registration order

The four are registered after every other tool. On a provider that caches prefixes, the
invalidation from publishing one starts at its position in the tool list, so a tool
registered fifth of fourteen invalidates almost everything: `pdf_extract` currently sits
there and its publication would keep only 9.2% of the prefix. Registered last, the
definitions ahead of it survive.

This changes nothing on a provider that does not cache — which includes the deployment
these figures come from — and costs nothing on one that does.

## What it does not reach

The RPC runtime, which has no command for the active toolset and publishes everything it
was launched with. Stated, not emulated: the embedded SDK runtime is the supported target.
