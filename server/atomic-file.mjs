import { writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

// Windows readers and antivirus can briefly hold the destination open. Keep
// the previous complete file visible until the atomic replacement succeeds.
export async function atomicWriteJson(
  destination,
  value,
  { replace = rename } = {},
) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try {
        await replace(temporary, destination);
        return;
      } catch (error) {
        if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 5)
          throw error;
        await delay(25 * 2 ** attempt);
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
