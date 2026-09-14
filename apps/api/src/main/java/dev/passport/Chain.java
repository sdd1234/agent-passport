package dev.passport;

import java.util.*;
import org.springframework.stereotype.Service;
import org.web3j.abi.*;
import org.web3j.abi.datatypes.*;
import org.web3j.abi.datatypes.generated.*;
import org.web3j.crypto.Hash;
import org.web3j.protocol.Web3j;
import org.web3j.protocol.core.DefaultBlockParameterName;
import org.web3j.protocol.core.methods.request.Transaction;
import org.web3j.protocol.http.HttpService;
import org.web3j.utils.Numeric;

@Service
public class Chain {
  public String registry() {
    return Config.env("REGISTRY_ADDRESS", "");
  }

  public String scopeHash(String owner, String scope, String salt) {
    return Hash.sha3String(owner + ":" + salt + ":" + scope);
  }

  public String agentHash(String agent) {
    return Hash.sha3String(agent);
  }

  public boolean access(String owner, String agent, String scopeHash, int bit) {
    if (registry().isBlank()) throw Auth.error(503, "REGISTRY_NOT_CONFIGURED");
    Function f =
        new Function(
            "hasAccess",
            List.of(
                new Address(owner),
                new Bytes32(Numeric.hexStringToByteArray(agentHash(agent))),
                new Bytes32(Numeric.hexStringToByteArray(scopeHash)),
                new Uint8(bit)),
            List.of(new TypeReference<Bool>() {}));
    try {
      Web3j web = Web3j.build(new HttpService(Config.env("EVM_RPC_URL", "http://127.0.0.1:8545")));
      try {
        var result =
            web.ethCall(
                    Transaction.createEthCallTransaction(
                        owner, registry(), FunctionEncoder.encode(f)),
                    DefaultBlockParameterName.LATEST)
                .send();
        if (result.hasError()) throw new IllegalStateException();
        var decoded = FunctionReturnDecoder.decode(result.getValue(), f.getOutputParameters());
        if (decoded.isEmpty()) throw new IllegalStateException();
        return (Boolean) decoded.getFirst().getValue();
      } finally {
        web.shutdown();
      }
    } catch (Exception e) {
      throw Auth.error(503, "CHAIN_UNAVAILABLE");
    }
  }

  public void verifyTransaction(String owner, String hash, String data) {
    if (hash == null || !hash.matches("0x[0-9a-fA-F]{64}"))
      throw Auth.error(400, "CONFIRMED_TX_REQUIRED");
    Web3j web = Web3j.build(new HttpService(Config.env("EVM_RPC_URL", "http://127.0.0.1:8545")));
    try {
      if (web.ethChainId().send().getChainId().longValue() != Config.chainId())
        throw Auth.error(503, "CHAIN_ID_MISMATCH");
      var receipt = web.ethGetTransactionReceipt(hash).send().getTransactionReceipt();
      var transaction = web.ethGetTransactionByHash(hash).send().getTransaction();
      if (receipt.isEmpty() || transaction.isEmpty() || !receipt.get().isStatusOK())
        throw Auth.error(409, "TX_NOT_CONFIRMED");
      var t = transaction.get();
      if (!owner.equalsIgnoreCase(t.getFrom())
          || !registry().equalsIgnoreCase(t.getTo())
          || !data.equalsIgnoreCase(t.getInput()))
        throw Auth.error(403, "TX_DOES_NOT_MATCH_CONSENT");
    } catch (org.springframework.web.server.ResponseStatusException e) {
      throw e;
    } catch (Exception e) {
      throw Auth.error(503, "CHAIN_UNAVAILABLE");
    } finally {
      web.shutdown();
    }
  }

  public void verifyPermissionTransaction(
      String owner, String agent, String scopeHash, int bits, long expires, String hash) {
    List<Type> args =
        new ArrayList<>(
            List.of(
                new Bytes32(Numeric.hexStringToByteArray(agentHash(agent))),
                new Bytes32(Numeric.hexStringToByteArray(scopeHash))));
    if (bits != 0) {
      args.add(new Uint8(bits));
      args.add(new Uint64(expires));
    }
    verifyTransaction(
        owner,
        hash,
        FunctionEncoder.encode(
            new Function(bits == 0 ? "revokeAccess" : "grantAccess", args, List.of())));
  }

  public void verifyAnchorTransaction(String owner, String batch, String root, String hash) {
    verifyTransaction(
        owner,
        hash,
        FunctionEncoder.encode(
            new Function(
                "anchorMemoryRoot",
                List.of(
                    new Bytes32(Numeric.hexStringToByteArray(batch)),
                    new Bytes32(Numeric.hexStringToByteArray(root))),
                List.of())));
  }

  public void verifyAnchor(String owner, String batch, String root) {
    Function f =
        new Function(
            "roots",
            List.of(new Address(owner), new Bytes32(Numeric.hexStringToByteArray(batch))),
            List.of(new TypeReference<Bytes32>() {}));
    Web3j web = Web3j.build(new HttpService(Config.env("EVM_RPC_URL", "http://127.0.0.1:8545")));
    try {
      var r =
          web.ethCall(
                  Transaction.createEthCallTransaction(
                      owner, registry(), FunctionEncoder.encode(f)),
                  DefaultBlockParameterName.LATEST)
              .send();
      var d = FunctionReturnDecoder.decode(r.getValue(), f.getOutputParameters());
      if (d.isEmpty()
          || !Numeric.toHexString((byte[]) d.getFirst().getValue()).equalsIgnoreCase(root))
        throw Auth.error(409, "ANCHOR_NOT_CONFIRMED");
    } catch (org.springframework.web.server.ResponseStatusException e) {
      throw e;
    } catch (Exception e) {
      throw Auth.error(503, "CHAIN_UNAVAILABLE");
    } finally {
      web.shutdown();
    }
  }
}
