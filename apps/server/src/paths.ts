import { extname } from "node:path";

/**
 * Where a note or an attachment was when it came into Boni: the hidden fields Juan's first import left on what it
 * brought (2026-10-20 to 23; the vault itself is gone), still how a calendar row, a money note or a statement is
 * found until notes stop having paths (docs/clases.md, PR «Sin rutas»). And the type of an attachment by its name.
 */

/** Hidden fields where each entry keeps the path its note had, and that note's hash. */
export const PATH_FIELD = "f_vault_path";
export const HASH_FIELD = "f_vault_hash";
/** The field of an attachment's row that holds the file. */
export const FILE_FIELD = "f_boni_file";
/** The field of a row of "Archivos" that keeps the folder the file was in. */
export const FOLDER_FIELD = "f_folder";

/** Attachment types by extension; anything else is kept as bytes. */
const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
};
export const mimeOf = (name: string) =>
  MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
