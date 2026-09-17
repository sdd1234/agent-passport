package dev.passport;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class BillingReconcile {
  final JdbcTemplate db;
  final Billing billing;

  public BillingReconcile(JdbcTemplate db, Billing billing) {
    this.db = db;
    this.billing = billing;
  }

  @Scheduled(fixedDelay = 60000, initialDelay = 60000)
  public void reconcile() {
    if (!billing.configured()) return;
    var rows =
        db.queryForList(
            "SELECT user_id FROM subscriptions WHERE subscription_id IS NOT NULL AND status NOT IN"
                + " ('canceled','incomplete_expired') AND updated_at<? ORDER BY updated_at LIMIT"
                + " 50",
            System.currentTimeMillis() - 3600000);
    for (var row : rows)
      try {
        billing.syncUser(row.get("user_id").toString());
      } catch (Exception e) {
        org.slf4j.LoggerFactory.getLogger(getClass())
            .warn("Billing reconciliation unavailable; retained last verified state");
        break;
      }
    db.update(
        "DELETE FROM billing_events WHERE processed_at<?",
        System.currentTimeMillis() - 7776000000L);
  }
}
