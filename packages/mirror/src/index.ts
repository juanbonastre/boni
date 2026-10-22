export { CORE_MARK } from "@boni/vault-import";
export {
  Mirror,
  type MirrorFs,
  type MirrorOptions,
  type Proposal,
  type ScanReport,
  type SwitchReport,
  type SyncReport,
  safeName,
} from "./mirror.ts";
export {
  changesFor,
  ID_KEY,
  INTEGRITY_KEY,
  type Links,
  noteFields,
  OMITTED_KEY,
  parseEdit,
  type Rendered,
  render,
  sameProp,
} from "./render.ts";
export {
  type EditRow,
  type MirroredType,
  type MirrorState,
  type NoteRow,
  openMirrorState,
  type Profile,
} from "./state.ts";
