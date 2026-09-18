CREATE TABLE folder_tasks (
 id VARCHAR(36) PRIMARY KEY,
 folder_id VARCHAR(36) NOT NULL REFERENCES workspace_folders(id) ON DELETE CASCADE,
 title VARCHAR(200) NOT NULL,
 description TEXT NOT NULL,
 work_scope VARCHAR(500) NOT NULL,
 status VARCHAR(20) NOT NULL,
 actor VARCHAR(100) NOT NULL,
 actor_name VARCHAR(200) NOT NULL,
 progress TEXT NOT NULL,
 lease_until BIGINT NOT NULL,
 revision INTEGER NOT NULL,
 updated_at BIGINT NOT NULL
);
CREATE INDEX folder_tasks_folder ON folder_tasks(folder_id, updated_at);
CREATE TABLE folder_task_events (
 id VARCHAR(36) PRIMARY KEY,
 task_id VARCHAR(36) NOT NULL REFERENCES folder_tasks(id) ON DELETE CASCADE,
 actor VARCHAR(100) NOT NULL,
 status VARCHAR(20) NOT NULL,
 progress TEXT NOT NULL,
 created_at BIGINT NOT NULL
);
CREATE INDEX task_events_task ON folder_task_events(task_id, created_at);
