CREATE TABLE folder_pairings (
  id VARCHAR(80) PRIMARY KEY,
  folder_id VARCHAR(80) NOT NULL REFERENCES workspace_folders(id) ON DELETE CASCADE,
  owner_id VARCHAR(80) NOT NULL,
  receiver_id VARCHAR(80),
  code_hash VARCHAR(100) NOT NULL UNIQUE,
  role VARCHAR(10) NOT NULL,
  expires_at BIGINT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX pairing_owner ON folder_pairings(owner_id);
-- Retire previously issued link invitations when upgrading to two-party pairing.
DELETE FROM folder_invites;
