/**
 * The project's kind colours, for every drawing below the app.
 *
 * A context rather than a prop, because the drawings live under three unrelated
 * owners — a tool card, a reply, the file viewer — and the colours are the project's,
 * not any one document's. `null` is the answer when the project declares none.
 */
import { createContext } from "react";
import type { ProjectAppearance } from "@pi-outpost/shared/structured-exchange/profile";

export const StructuredAppearanceContext = createContext<ProjectAppearance | null>(null);
