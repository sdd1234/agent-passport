package dev.passport;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.junit.jupiter.api.Test;

class BillingSignatureTest {
  @Test
  void authenticRawBodyRequiredAndReplaysExpire() throws Exception {
    String body = "{\"type\":\"customer.subscription.updated\"}", secret = "test-secret";
    long now = 1700000000;
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    String signature =
        HexFormat.of().formatHex(mac.doFinal((now + "." + body).getBytes(StandardCharsets.UTF_8)));
    String header = "t=" + now + ",v1=" + signature;
    assertDoesNotThrow(() -> Billing.verify(body, header, secret, now));
    assertThrows(Exception.class, () -> Billing.verify(body + " ", header, secret, now));
    assertThrows(Exception.class, () -> Billing.verify(body, header, secret, now + 301));
    assertThrows(Exception.class, () -> Billing.verify(body, header, "", now));
    assertThrows(Exception.class, () -> Billing.verify(body, "t=x", secret, now));
  }
}
