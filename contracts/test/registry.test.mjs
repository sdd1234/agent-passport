import test from "node:test";
import assert from "node:assert/strict";
import ganache from "ganache";
import { BrowserProvider, ContractFactory, id, ZeroHash } from "ethers";
import { compile } from "../compile.mjs";
test("registry: consent, expiry, ownership, events, immutable anchors", async (t) => {
  const server = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 31337 },
  });
  const provider = new BrowserProvider(server);
  const owner = await provider.getSigner(0),
    other = await provider.getSigner(1);
  const artifact = compile();
  const c = await new ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    owner,
  ).deploy();
  await c.waitForDeployment();
  const a = id("agent"),
    s = id("salt:development"),
    address = await owner.getAddress();
  await t.test("default deny, invalid required bitmask", async () => {
    assert.equal(await c.hasAccess(address, a, s, 1), false);
    assert.equal(await c.hasAccess(address, a, s, 0), false);
    await assert.rejects(c.grantAccess(a, s, 4, 0));
  });
  await t.test("grant read/write emits owner consent", async () => {
    const r = await (await c.grantAccess(a, s, 3, 0)).wait();
    assert.equal(c.interface.parseLog(r.logs[0]).name, "AccessGranted");
    assert.equal(await c.hasAccess(address, a, s, 3), true);
  });
  await t.test("another wallet cannot revoke owner grant", async () => {
    await (await c.connect(other).revokeAccess(a, s)).wait();
    assert.equal(await c.hasAccess(address, a, s, 1), true);
    assert.equal(await c.hasAccess(await other.getAddress(), a, s, 1), false);
  });
  await t.test("revoke is immediate and regrant works", async () => {
    await (await c.revokeAccess(a, s)).wait();
    assert.equal(await c.hasAccess(address, a, s, 1), false);
    await (await c.grantAccess(a, s, 1, 0)).wait();
    assert.equal(await c.hasAccess(address, a, s, 1), true);
    assert.equal(await c.hasAccess(address, a, s, 2), false);
  });
  await t.test("expiry excludes exact boundary", async () => {
    const block = await provider.getBlock("latest");
    const expiry = block.timestamp + 30;
    await (await c.grantAccess(a, s, 3, expiry)).wait();
    assert.equal(await c.hasAccess(address, a, s, 1), true);
    await server.request({ method: "evm_setTime", params: [expiry * 1000] });
    await server.request({ method: "evm_mine", params: [] });
    assert.equal(await c.hasAccess(address, a, s, 1), false);
    await assert.rejects(c.grantAccess(a, s, 1, expiry));
  });
  await t.test("batch root is immutable and owner namespaced", async () => {
    const batch = id("batch"),
      root = id("salted-leaves");
    await (await c.anchorMemoryRoot(batch, root)).wait();
    assert.equal(await c.roots(address, batch), root);
    assert.equal(await c.roots(await other.getAddress(), batch), ZeroHash);
    await assert.rejects(c.anchorMemoryRoot(batch, id("changed")));
    await assert.rejects(c.anchorMemoryRoot(id("new"), ZeroHash));
  });
  await server.disconnect();
});
