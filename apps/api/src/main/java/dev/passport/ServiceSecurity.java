package dev.passport;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class ServiceSecurity extends OncePerRequestFilter {
  final Accounts accounts;

  public ServiceSecurity(Accounts accounts) {
    this.accounts = accounts;
    if (!java.util.List.of("demo", "service", "live").contains(Config.env("APP_MODE", "demo")))
      throw new IllegalStateException("Unknown APP_MODE");
    if (Config.env("APP_MODE", "demo").equals("service")
        && Config.env("DEPLOYMENT", "development").equals("production")) {
      if (!Config.origin().startsWith("https://")
          || !Config.env("COOKIE_SECURE", "false").equals("true")
          || !Config.env("DATABASE_URL", "").startsWith("jdbc:postgresql:")
          || Config.env("MEMORY_ENCRYPTION_KEY", "").isBlank())
        throw new IllegalStateException(
            "Production requires HTTPS origin, secure cookies, PostgreSQL and an encryption key");
    }
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    if (req.getRequestURI().startsWith("/api/account") && !req.getMethod().equals("GET")) {
      try {
        accounts.throttle(req, "account");
      } catch (org.springframework.web.server.ResponseStatusException e) {
        res.setStatus(429);
        res.setContentType("application/json");
        res.getWriter().write("{\"code\":\"TRY_LATER\"}");
        return;
      }
    }
    if (java.util.List.of("POST", "PUT", "PATCH", "DELETE").contains(req.getMethod())) {
      if (req.getContentLengthLong() > 1048576) {
        reject(res);
        return;
      }
      byte[] body = req.getInputStream().readNBytes(1048577);
      if (body.length > 1048576) {
        reject(res);
        return;
      }
      var wrapper =
          new HttpServletRequestWrapper(req) {
            @Override
            public ServletInputStream getInputStream() {
              var input = new ByteArrayInputStream(body);
              return new ServletInputStream() {
                public int read() {
                  return input.read();
                }

                public boolean isFinished() {
                  return input.available() == 0;
                }

                public boolean isReady() {
                  return true;
                }

                public void setReadListener(ReadListener listener) {
                  throw new UnsupportedOperationException();
                }
              };
            }

            @Override
            public BufferedReader getReader() {
              return new BufferedReader(
                  new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
            }
          };
      chain.doFilter(wrapper, res);
    } else chain.doFilter(req, res);
  }

  void reject(HttpServletResponse r) throws IOException {
    r.setStatus(413);
    r.setContentType("application/json");
    r.getWriter().write("{\"code\":\"REQUEST_TOO_LARGE\"}");
  }
}
