# Spec Delta

## MODIFIED Requirements

### Requirement: Reference files from the file tree

- **Implementation**: `FileTree::ui/src/components/FileTree.tsx`, `addPathAttachment::ui/src/attachments.ts`

> `TreeNode` and `toggleAttachPath` are local to their modules and cannot be
> anchored; `FileTree` is the exported component that renders them, and
> `addPathAttachment` the exported state transition it drives.

The system SHALL let the user reference any file or folder listed in the file tree as a prompt attachment without opening its preview, and SHALL let the user drop that reference the same way, with the `@` control on the entry's row or the Reference in prompt / Remove from prompt item of its actions menu. The tree SHALL mark every file or folder the next prompt references — whether the reference comes from an attachment or from an `@` mention typed in the draft — by keeping its `@` lit, and SHALL surface the `@` of an unreferenced entry only on hover, on devices that have hover. Referencing a selection SHALL reference each selected entry once.

#### Scenario: User references a file from the tree
- **WHEN** the user activates the `@` on a file's row, or chooses Reference in prompt in its actions menu
- **THEN** the composer contains a removable attachment for that file's path and the tree marks it as referenced

#### Scenario: Draft mentions a file by hand
- **WHEN** the user types an `@` mention of a file in the composer draft
- **THEN** the tree marks that file as referenced, and the reference control does not add a second reference to it

#### Scenario: A file is referenced twice
- **WHEN** a file is referenced from the tree while the same path is already attached, or its path is already typed as an `@` mention
- **THEN** the sent prompt mentions that path exactly once

#### Scenario: TheMarkerDropsTheReference
- **GIVEN** a file referenced from the tree
- **WHEN** the user activates its referenced marker, or chooses Remove from prompt in its menu
- **THEN** its attachment leaves the composer and the marker disappears

#### Scenario: ReferenceAFolder
- **WHEN** the user chooses Reference in prompt in a folder's actions menu
- **THEN** the composer holds a removable attachment for the folder's path and the folder row is marked as referenced

#### Scenario: ReferenceASelection
- **GIVEN** three files selected, one of them already referenced
- **WHEN** the user chooses Reference in prompt on the selection
- **THEN** the composer references each of the three files exactly once
