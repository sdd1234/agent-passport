package dev.passport;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

@Component
public class Crypto {
  private final byte[] key;

  public Crypto() throws Exception {
    String configured = System.getenv("MEMORY_ENCRYPTION_KEY");
    if (configured != null && !configured.isBlank()) key = Base64.getDecoder().decode(configured);
    else {
      if (!Config.demo())
        throw new IllegalStateException("MEMORY_ENCRYPTION_KEY required in live mode");
      Path p = Path.of(".data/encryption.key");
      Files.createDirectories(p.getParent());
      if (!Files.exists(p)) {
        byte[] b = new byte[32];
        new SecureRandom().nextBytes(b);
        Files.write(p, b);
        try {
          Files.setPosixFilePermissions(
              p, java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException ignored) {
        }
      }
      key = Files.readAllBytes(p);
    }
    if (key.length != 32) throw new IllegalStateException("Encryption key must be 32 bytes");
  }

  public String encrypt(String plain) {
    try {
      byte[] iv = new byte[12];
      new SecureRandom().nextBytes(iv);
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
      return Base64.getEncoder().encodeToString(iv)
          + ":"
          + Base64.getEncoder().encodeToString(c.doFinal(plain.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public String decrypt(String raw) {
    try {
      String[] s = raw.split(":");
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(
          Cipher.DECRYPT_MODE,
          new SecretKeySpec(key, "AES"),
          new GCMParameterSpec(128, Base64.getDecoder().decode(s[0])));
      return new String(c.doFinal(Base64.getDecoder().decode(s[1])), StandardCharsets.UTF_8);
    } catch (Exception e) {
      throw new IllegalStateException("Stored data integrity failure", e);
    }
  }

  public static String hash(String s) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
