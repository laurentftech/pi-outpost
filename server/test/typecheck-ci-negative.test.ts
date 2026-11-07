// Deliberately ill-typed CI control. This branch must never be merged.
import { gitLog } from "../src/git.ts";
void gitLog("not a repository", 20);
