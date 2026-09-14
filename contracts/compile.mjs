import fs from "node:fs";
import solc from "solc";
export function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "MemoryPermissionRegistry.sol": {
        content: fs.readFileSync(
          new URL("./src/MemoryPermissionRegistry.sol", import.meta.url),
          "utf8",
        ),
      },
    },
    settings: {
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const result = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = result.errors?.filter((e) => e.severity === "error");
  if (errors?.length)
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  return result.contracts["MemoryPermissionRegistry.sol"]
    .MemoryPermissionRegistry;
}
