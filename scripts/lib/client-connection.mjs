import fs from "node:fs/promises";
import path from "node:path";
export async function readClientConnection(root, provider = "") {
  if (provider && !["claude", "codex"].includes(provider))
    throw Error("Invalid client provider");
  const file = path.join(
    root,
    `.data/service-client${provider ? "-" + provider : ""}.json`,
  );
  try {
    return {
      config: JSON.parse(await fs.readFile(file, "utf8")),
      legacy: false,
    };
  } catch (e) {
    if (e.code !== "ENOENT" || !provider) throw e;
    return {
      config: JSON.parse(
        await fs.readFile(path.join(root, ".data/service-client.json"), "utf8"),
      ),
      legacy: true,
    };
  }
}
