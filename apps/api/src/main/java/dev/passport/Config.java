package dev.passport;

public final class Config {
  public static String env(String key, String fallback) {
    return System.getenv().getOrDefault(key, fallback);
  }

  public static boolean demo() {
    return env("APP_MODE", "demo").equals("demo");
  }

  public static boolean chainMode() {
    return env("APP_MODE", "demo").equals("live");
  }

  public static String origin() {
    return env("APP_ORIGIN", "http://localhost:5173");
  }

  public static long chainId() {
    return Long.parseLong(env("CHAIN_ID", "31337"));
  }
}
