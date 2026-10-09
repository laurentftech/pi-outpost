## 1. Server

- [x] 1.1 Reproduce: with two projects open, the raw URL for an image of the non-boot project answers 404.
- [x] 1.2 Read `/files/raw` from the project named by `workspace`, only among open projects (spec: ServeFromTheNamedProject, UnnamedReadsTheBootProject, UnopenedProjectRefused).

## 2. Interface

- [x] 2.1 Name the bound project on every raw URL: viewers, Markdown and reply images, attachments, exports (spec: ClientNamesTheBoundProject).

## 3. Running app

- [x] 3.1 Switch to the second project in the running app, open a PNG and a Markdown file referencing it, and check both decode; monkey pass over rapid project switches with a same-named image in each project.
