// The box's process: listens on its socket (BONI_SANDBOX_SOCKET) until it is stopped (docs/extensiones.md §11, E1).
import { DEFAULT_SOCKET } from "@boni/sandbox";
import { startBox } from "./server.ts";

const socketPath = process.env.BONI_SANDBOX_SOCKET ?? DEFAULT_SOCKET;
const box = await startBox(socketPath);
console.log(`Boni sandbox listening on ${socketPath}`);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => void box.close().then(() => process.exit(0)));
