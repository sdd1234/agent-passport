import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import fs from "node:fs";
import { compile } from "./compile.mjs";
const provider = new JsonRpcProvider(
  process.env.EVM_RPC_URL || "http://127.0.0.1:8545",
);
const signer = process.env.DEPLOYER_PRIVATE_KEY
  ? new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider)
  : await provider.getSigner();
const artifact = compile();
const contract = await new ContractFactory(
  artifact.abi,
  artifact.evm.bytecode.object,
  signer,
).deploy();
await contract.waitForDeployment();
const result = {
  address: await contract.getAddress(),
  chainId: Number((await provider.getNetwork()).chainId),
  transactionHash: contract.deploymentTransaction().hash,
  abi: artifact.abi,
};
fs.writeFileSync(
  new URL("./deployment.json", import.meta.url),
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    {
      REGISTRY_ADDRESS: result.address,
      CHAIN_ID: result.chainId,
      transactionHash: result.transactionHash,
    },
    null,
    2,
  ),
);
