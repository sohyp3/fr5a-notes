// isomorphic-git uses a global `Buffer`, which only Node has. Imported first
// by isoGit.ts so it's in place before isomorphic-git evaluates.
import { Buffer } from 'buffer';

globalThis.Buffer ??= Buffer;
