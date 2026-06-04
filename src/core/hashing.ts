import crypto from "node:crypto";
import fs from "node:fs/promises";

export async function hashFile(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
