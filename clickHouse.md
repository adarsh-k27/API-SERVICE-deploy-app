  # log-events creation 
  CREATE TABLE log_events (
    event_id UUID,
    timestamp DateTime MATERIALIZED now() ,
    deployment_id Nullable(String),
    log Nullable(String)
) ENGINE = MergeTree PARTITION BY toYYYYMM(timestamp)
ORDER BY (event_id, timestamp);


# ALTER COLUMN NAME
ALTER TABLE log_events RENAME COLUMN logString TO log;

# select table data 
select * from log_events


