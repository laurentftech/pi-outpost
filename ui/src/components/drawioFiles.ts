import { createContext, useContext } from "react";
import type { FileIo } from "../fileIo";

/**
 * What a drawn `.drawio` needs from the application, wherever it is drawn: the server
 * its viewer is served from, the file reads and writes behind touch-up, and the places
 * a reader can send the file. Provided once by `App`, so a diagram deep in a reply does
 * not need every list and message between it and the app to pass these along.
 */
export interface DrawioFiles {
  serverUrl: string;
  /** Absent where nothing can read or write files (a static export). */
  fileIo?: FileIo;
  /** Opens a workspace path in the file viewer. */
  onOpenFile?: (path: string) => void;
  /** Opens the file with draw.io desktop, where the server can. */
  onOpenNative?: (path: string) => void;
}

export const DrawioFilesContext = createContext<DrawioFiles>({ serverUrl: "" });

export function useDrawioFiles(): DrawioFiles {
  return useContext(DrawioFilesContext);
}
